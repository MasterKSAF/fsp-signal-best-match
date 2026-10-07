import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import type { SelectedFields } from "drizzle-orm/pg-core";
import {
  db,
  signalCandidateProfilesTable as profiles,
  signalCandidateResumesTable as resumes,
  signalUsersTable as users,
  signalFspConnectionsTable as fspConnections,
  type SignalResumeSnapshot,
} from "@workspace/db";
import type { CatalogResume } from "./signal-resume-catalog";
import { selectMatchingResumes } from "./signal-resume-catalog";
import { evaluateMatch, rankMatches, type MatchNeed } from "./signal-matching";
import { evaluateResumeCandidates } from "./signal-resume-evaluation";
import { FreshJsonPoolCache } from "./signal-fresh-pool-cache";
import { readonlyResumeProjection } from './signal-readonly-resume';
import { fspSignalFromConnection } from './fsp-provider';
import {compactFspSignal} from './fsp-results';
import { isDemoModeEnabled } from './signal-runtime';
import {
  FreshRankingCache,
  freshRankingKey,
} from "./signal-fresh-ranking-cache";
import { preparePoolAdmission } from "./matching-pool-admission";
import { withAssessmentRankingEvidence } from "./assessment-ranking-evidence";
import { rankingInputFingerprint } from "./assessment-ranking-evidence";
import {
  getResumeQualification,
  loadCandidateQualificationInputs,
} from "./signal-resume";
import { canonicalSkillKey } from "./skill-catalog";
import type { SafeSkillEvidence } from "./signal-matching";
import {
  poolScopeForAccount,
  signalPoolPredicate,
  type SignalPoolScope,
} from "./signal-pool-scope";

export type ResumeReader = Pick<typeof db, "select">;
export function resumeMatchColumns() {
  return {
    userId: users.id,
    alias: profiles.professionalAlias,
    resumeId: resumes.id,
    resumeRevision: resumes.revision,
    title: resumes.title,
    specialization: resumes.specialization,
    verifiedGrade: resumes.verifiedGrade,
    verifiedScore: resumes.verifiedScore,
    verifiedSkills: resumes.verifiedSkills,
    stack: resumes.stack,
    statedSkills: resumes.skills,
    yearsExperience: resumes.yearsExperience,
    workFormat: resumes.workFormat,
    salaryMin: resumes.salaryMin,
    salaryMax: resumes.salaryMax,
    salaryPeriod: resumes.salaryPeriod,
    salaryType: resumes.salaryType,
    latestAssessmentAt: resumes.latestAssessmentAt,
    hasFspHistory: profiles.hasFspHistory,
    // Temporary server-only loader input is removed before a pool view/DTO.
    fspConnection: sql<typeof fspConnections.$inferSelect | null>`to_jsonb(${fspConnections})`,
    visibility: resumes.visibility,
    consentMatching: resumes.consentMatching,
    consentCatalog: resumes.consentCatalog,
    readyForOffers: resumes.readyForOffers,
    demoMode: users.demoMode,
    reviewScopeId: users.reviewScopeId,
    deletedAt: resumes.deletedAt,
    legacyQualification: resumes.legacyQualification,
    // A photograph may be large; pool filtering needs its visibility-aware
    // presence, never N copies of the account image across résumé alternatives.
    hasAccessiblePhoto: sql<boolean>`coalesce(${resumes.visibility} = 'public' and ${profiles.avatarDataUrl} <> '', false)`,
    avatarDataUrl: sql<string | null>`null::text`,
    publicName: sql<
      string | null
    >`case when ${resumes.visibility} = 'public' then ${users.displayName} else null end`,
  };
}
/** Native JSON decoding avoids per-cell ORM entity checks and text-array
 * parsers on large pools. This is the same explicit whitelist, including the
 * visibility expressions; it never selects contacts or an assessment body. */
type EncodedResume = Omit<CatalogResume, "latestAssessmentAt" | "deletedAt"> & {
  latestAssessmentAt: string | null;
  deletedAt: string | null;
  fspConnection?: Record<string,unknown> | null;
};
function normalizePoolFsp(row: EncodedResume) {
  const {fspConnection:stored,...professional}=row;
  // to_jsonb(table) uses SQL names. No external identifier or raw ledger is retained.
  const connection=stored?{fspId:stored.fsp_id as string|null,status:stored.status as string,consentVersion:stored.consent_version as string|null,consentedAt:stored.consented_at,verifiedAt:stored.verified_at,revokedAt:stored.revoked_at,provenance:stored.provenance as string|null,providerVersion:stored.provider_version as string|null,achievements:stored.achievements,lastErrorCode:stored.last_error_code as string|null}:null;
  const fspSignal=fspSignalFromConnection(connection,{accountIsDemo:row.demoMode,demoEnabled:isDemoModeEnabled()});
  return {...professional,...(fspSignal.historyStatus==='none'?{}:{fspSignal:compactFspSignal(fspSignal)}),hasFspHistory:fspSignal.historyStatus==='trusted_results'||fspSignal.historyStatus==='unresolved_results'};
}
const resumePoolJson = sql<EncodedResume>`jsonb_build_object(${sql.join(
  Object.entries(resumeMatchColumns()).flatMap(([key, value]) => [
    sql`${key}::text`,
    sql`${value}`,
  ]),
  sql`, `,
)})`;
// 0008 signs ALL résumé fields atomically on every INSERT/UPDATE. The fresh SQL
// still reads every joined identity/visibility expression and current pool ACL.
// No client digest, revision or TTL can authorize a reuse. Narrow SQL inputs
// prevent the planner sorting/re-serializing 25,000 complete résumé bodies.
const columns = resumeMatchColumns();
const joinedRecord = sql`row(${users.id}, ${users.role}, ${users.demoMode}, ${users.reviewScopeId}, ${profiles.professionalAlias}, ${profiles.hasFspHistory}, to_jsonb(${fspConnections}), ${columns.hasAccessiblePhoto}, ${columns.publicName})::text`;
const rowCommitment = sql`sha256(${resumes.poolContentDigest} || sha256(convert_to(${joinedRecord}, 'UTF8')))`;
const resumePoolFingerprint = sql<string>`encode(sha256(coalesce(string_agg(${rowCommitment}, decode('', 'hex') order by ${sql`${resumes.id}`}), decode('', 'hex'))), 'hex')`;
/** Read-only SQL diagnostics use the actual production fingerprint expression. */
export function resumePoolFingerprintExpression() { return resumePoolFingerprint; }
const freshPools = new FreshJsonPoolCache<CatalogResume>(2,128*1024*1024,'raw_pool',864);
const loadedPoolFingerprints = new WeakMap<object, string>();
const freshRanking = new FreshRankingCache();
const admittedSnapshots=new WeakMap<object,{key:string;rows:CatalogResume[]}>();
export function serializeRankedResumeMatches(entries:object,build:()=>string) { return freshRanking.serialize(entries,build); }

/** One professional row per résumé. No account contacts, answers or questionnaire are selected. */
export async function loadResumeCandidates(
  accountScope: SignalPoolScope | boolean,
  options: {
    purpose: "matching" | "catalog" | "owned";
    userId?: number;
    resumeId?: number;
    resumeIds?: number[];
    specialization?: string;
    /** Internal whole-pool callers only. Default/bounded reads keep fresh top-level copies. */
    immutableProjection?:boolean;
  },
  reader: ResumeReader = db,
): Promise<CatalogResume[]> {
  const predicate = and(
    eq(users.role, "candidate"),
    signalPoolPredicate(users, accountScope),
    isNull(resumes.deletedAt),
    options.userId ? eq(users.id, options.userId) : undefined,
    options.resumeId ? eq(resumes.id, options.resumeId) : undefined,
    options.resumeIds ? inArray(resumes.id, options.resumeIds) : undefined,
    options.specialization
      ? eq(resumes.specialization, options.specialization)
      : undefined,
    options.purpose === "owned" ? undefined : ne(resumes.visibility, "private"),
    options.purpose === "matching"
      ? eq(resumes.consentMatching, true)
      : options.purpose === "catalog"
        ? eq(resumes.consentCatalog, true)
        : undefined,
  );
  const query = <T extends SelectedFields>(columns: T) =>
    reader
      .select(columns)
      .from(
        sql`${resumes} inner join ${users} on ${users.id} = ${resumes.userId} inner join ${profiles} on ${profiles.userId} = ${resumes.userId} left join ${fspConnections} on ${fspConnections.userId} = ${users.id}`,
      )
      .where(predicate);
  let data: readonly CatalogResume[];
  // Explicit targets remain ordinary fresh bounded reads. Only whole pools may
  // reuse whitelisted encoded content after a current full SQL fingerprint.
  if (
    reader === db &&
    options.purpose !== "owned" &&
    !options.userId &&
    !options.resumeId &&
    !options.resumeIds
  ) {
    const {immutableProjection:_representationOnly,...semanticOptions}=options;
    const context = JSON.stringify([
      poolScopeForAccount(accountScope),
      semanticOptions,
      isDemoModeEnabled(),
    ]);
    const [fresh] = await query({ fingerprint: resumePoolFingerprint });
    data = await freshPools.read(context, fresh!.fingerprint, async () => {
      const [snapshot] = await query({
        fingerprint: resumePoolFingerprint,
        data: sql<
          EncodedResume[]
        >`coalesce(jsonb_agg(${resumePoolJson} order by ${sql`${resumes.id}`}), '[]'::jsonb)`,
      });
      return {fingerprint:snapshot!.fingerprint,data:snapshot!.data.map(row=>readonlyResumeProjection(normalizePoolFsp(row)) as unknown as CatalogResume)};
    },async()=>{const [ownFresh]=await query({fingerprint:resumePoolFingerprint});return ownFresh!.fingerprint;});
  } else data = (await query({ data: resumePoolJson })).map(({data})=>({...normalizePoolFsp(data),latestAssessmentAt:data.latestAssessmentAt?new Date(data.latestAssessmentAt):null,deletedAt:data.deletedAt?new Date(data.deletedAt):null}));
  const fingerprint = freshPools.fingerprintFor(data);
  if(options.immutableProjection&&fingerprint&&Object.isFrozen(data)) {
    loadedPoolFingerprints.set(data,`${fingerprint}:fsp-category-results-v1:demo=${isDemoModeEnabled()}`);
    return data as CatalogResume[];
  }
  const decoded = data.map((data) => ({
    ...data,
    latestAssessmentAt: data.latestAssessmentAt
      ? new Date(data.latestAssessmentAt)
      : null,
    deletedAt: data.deletedAt ? new Date(data.deletedAt) : null,
  }));
  if (fingerprint) loadedPoolFingerprints.set(decoded, `${fingerprint}:fsp-category-results-v1:demo=${isDemoModeEnabled()}`);
  return decoded;
}

/** Derive private proof only for requested/page résumés, in one bounded batch. Pool reads use transactionally materialized qualification. */
export async function withResumeSkillEvidence<T extends CatalogResume>(
  rows: T[],
  reader: ResumeReader = db,
): Promise<T[]> {
  if (!rows.length) return [];
  const inputs = await loadCandidateQualificationInputs(
    [...new Set(rows.map((row) => row.userId))],
    reader,
  );
  const attemptsByUser = new Map<number, typeof inputs.attempts>();
  for (const attempt of inputs.attempts) {
    const existing = attemptsByUser.get(attempt.userId);
    if (existing) existing.push(attempt);
    else attemptsByUser.set(attempt.userId, [attempt]);
  }
  const photoIds = rows
    .filter((row) => row.visibility === "public" && row.hasAccessiblePhoto)
    .map((row) => row.resumeId);
  const photos = photoIds.length
    ? await reader
        .select({ resumeId: resumes.id, data: profiles.avatarDataUrl })
        .from(resumes)
        .innerJoin(profiles, eq(profiles.userId, resumes.userId))
        .where(
          and(
            inArray(resumes.id, photoIds),
            isNull(resumes.deletedAt),
            eq(resumes.visibility, "public"),
          ),
        )
    : [];
  const photoByResume = new Map(
    photos.map((photo) => [photo.resumeId, photo.data]),
  );
  return rows.map((row) => {
    const qualification = getResumeQualification(
      row,
      attemptsByUser.get(row.userId) ?? [],
      inputs.correctedIds,
    );
    const proven = new Set(
      qualification.evidence.map((proof) => canonicalSkillKey(proof.skill)),
    );
    const legacy: SafeSkillEvidence[] = qualification.verifiedSkills
      .filter((skill) => !proven.has(canonicalSkillKey(skill)))
      .map((skill) => ({
        skill,
        candidateId: row.userId,
        attemptId: null,
        programId: null,
        programVersion: null,
        templateId: null,
        templateVersion: null,
        criterionId: null,
        criterion: null,
        result: null,
        date: qualification.latestAssessmentAt?.toISOString() ?? null,
        sourceType: row.demoMode ? "demo_example" : "legacy_record",
        limitation:
          qualification.limitation ??
          "Историческое подтверждение без подробного протокола.",
      }));
    return {
      ...row,
      avatarDataUrl:
        row.visibility === "public"
          ? (photoByResume.get(row.resumeId) ?? null)
          : null,
      verifiedGrade: qualification.verifiedGrade,
      verifiedScore: qualification.verifiedScore,
      verifiedSkills: qualification.verifiedSkills,
      latestAssessmentAt: qualification.latestAssessmentAt,
      skillEvidence: [...qualification.evidence, ...legacy],
    };
  });
}

export async function rankedResumePool(
  need: MatchNeed,
  accountScope: SignalPoolScope | boolean,
  overrides: ReadonlyMap<number, number> = new Map(),
  reader: ResumeReader = db,
) {
  const scope = poolScopeForAccount(accountScope);
  const rows = await loadResumeCandidates(
    scope,
    { purpose: "matching", specialization: need.specialization,immutableProjection:true },
    reader,
  );
  const admissionKey=JSON.stringify([need,scope]),savedAdmission=admittedSnapshots.get(rows);
  const admitted=savedAdmission?.key===admissionKey?savedAdmission.rows:rows.filter(preparePoolAdmission(need,scope.demoMode));
  if(Object.isFrozen(rows)&&savedAdmission?.key!==admissionKey) {
    Object.freeze(admitted);admittedSnapshots.set(rows,{key:admissionKey,rows:admitted});
  }
  const candidates = await withAssessmentRankingEvidence(
    admitted,
    reader,
    undefined,
    { mutateLocalProjection: true },
  );
  const at = new Date();
  const compute = () => {
    const entries = evaluateResumeCandidates(
      need,
      candidates,
      scope.demoMode,
      at,
    ).filter((entry) => entry.evaluation.eligible);
    const entryByResume = new Map(
      entries.map((entry) => [entry.candidate.resumeId, entry]),
    );
    const selected = selectMatchingResumes(entries)
      .map((person) => {
        const override = overrides.get(person.candidate.userId);
        const requested = override ? entryByResume.get(override) : null;
        const exact =
          requested?.candidate.userId === person.candidate.userId
            ? requested
            : null;
        return exact ? { ...exact, alternatives: person.alternatives } : person;
      })
      .filter(
        (person) =>
          !overrides.has(person.candidate.userId) ||
          person.candidate.resumeId === overrides.get(person.candidate.userId),
      );
    return rankMatches(selected);
  };
  const rawFingerprint = loadedPoolFingerprints.get(rows),
    evidenceFingerprint = rankingInputFingerprint(candidates);
  if(reader===db&&rawFingerprint&&evidenceFingerprint&&overrides.size) {
    const defaultKey=freshRankingKey(need,scope,new Map(),rawFingerprint,evidenceFingerprint,candidates,at);
    const equivalent=freshRanking.readEquivalentDefault(defaultKey,candidates,overrides);
    if(equivalent)return equivalent;
  }
  return reader === db && rawFingerprint && evidenceFingerprint
    ? freshRanking.read(
        freshRankingKey(
          need,
          scope,
          overrides,
          rawFingerprint,
          evidenceFingerprint,
          candidates,
          at,
        ),
        candidates,
        compute,
      )
    : compute();
}

export function resumeSnapshot(
  resume: CatalogResume,
  updatedAt = new Date(),
): SignalResumeSnapshot {
  return {
    resumeId: resume.resumeId,
    revision: resume.resumeRevision,
    title: resume.title,
    specialization: resume.specialization,
    verifiedGrade: resume.verifiedGrade,
    verifiedScore: resume.verifiedScore,
    verifiedSkills: [...resume.verifiedSkills],
    stack: [...resume.stack],
    skills: [...resume.statedSkills],
    yearsExperience: resume.yearsExperience,
    workFormat: resume.workFormat,
    salaryMin: resume.salaryMin,
    salaryMax: resume.salaryMax,
    salaryPeriod: resume.salaryPeriod ?? "month",
    salaryType: resume.salaryType ?? "gross",
    updatedAt: updatedAt.toISOString(),
    summary: "",
  };
}

/** A historical professional snapshot cannot be a backdoor to a now hidden/deleted résumé. */
export async function historicalResumeVisible(
  userId: number,
  resumeId: number | null,
  accountScope: SignalPoolScope | boolean,
  reader: ResumeReader = db,
): Promise<boolean> {
  if (!resumeId) return false;
  const [row] = await reader
    .select({ id: resumes.id })
    .from(resumes)
    .innerJoin(users, eq(users.id, resumes.userId))
    .where(
      and(
        eq(resumes.id, resumeId),
        eq(resumes.userId, userId),
        isNull(resumes.deletedAt),
        ne(resumes.visibility, "private"),
        eq(users.role, "candidate"),
        signalPoolPredicate(users, accountScope),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export function publicHistoricalSnapshot(
  snapshot: SignalResumeSnapshot | null,
): SignalResumeSnapshot | null {
  if (!snapshot) return null;
  // Freeform prose from older snapshots can contain contacts: it never leaves history APIs.
  return { ...snapshot, summary: "" };
}
