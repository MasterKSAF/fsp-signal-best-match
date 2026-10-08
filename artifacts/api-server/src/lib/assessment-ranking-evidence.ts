import { createHash } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  signalAssessmentAttemptsTable as attempts,
  signalAssessmentCorrectionsTable as corrections,
} from "@workspace/db";
import type {
  MatchCandidate,
  AssessmentRankingEvidence,
} from "./signal-matching";
import { FreshJsonPoolCache } from './signal-fresh-pool-cache';
import { readonlyResumeProjection, isReadonlyResumeProjection, resumeAssessmentMillis } from './signal-readonly-resume';

type ImmutableRankingIdentity = {
  id: number;
  userId: number;
  programId: string;
  grade: string;
  programVersion: string | null;
  purpose: string;
};
type RubricSummary = { version: string | null; rubricKey: string | null };
type FreshRankingRow = ImmutableRankingIdentity & {
  grade: "Junior" | "Middle" | "Senior";
  score: number | null;
  submittedAt: Date | null;
};
/** Only immutable rubric validation is memoized. No score/status/date, profile,
 * correction, identity, permission or answer is cached. Migration 0006 protects
 * the identity/cases/oracles fields; current linkage/revocation is read below. */
export class RankingRubricCache {
  private entries = new Map<number, { key: string; summary: RubricSummary }>();
  constructor(private capacity = 10000) {}
  private key(row: ImmutableRankingIdentity) {
    return JSON.stringify([
      row.userId,
      row.programId,
      row.grade,
      row.programVersion,
      row.purpose,
    ]);
  }
  get(row: ImmutableRankingIdentity): RubricSummary | undefined {
    const entry = this.entries.get(row.id);
    if (!entry || entry.key !== this.key(row)) {
      if (entry) this.entries.delete(row.id);
      return undefined;
    }
    this.entries.delete(row.id);
    this.entries.set(row.id, entry);
    return entry.summary;
  }
  put(row: ImmutableRankingIdentity, oracles: unknown): RubricSummary {
    const first =
      oracles && typeof oracles === "object"
        ? (Object.values(oracles)[0] as { blueprint?: { version?: string } })
        : null;
    const version =
      typeof first?.blueprint?.version === "string"
        ? first.blueprint.version
        : null;
    const summary = {
      version,
      rubricKey: version
        ? assessmentRubricKey(oracles, row.programId, version, row.grade)
        : null,
    };
    if (this.entries.size >= this.capacity && !this.entries.has(row.id))
      this.entries.delete(this.entries.keys().next().value!);
    this.entries.set(row.id, { key: this.key(row), summary });
    return summary;
  }
}
const immutableRubrics = new RankingRubricCache();
const currentRankingInputs = new WeakMap<object, string>();
type EncodedRankingRow = Omit<FreshRankingRow,'submittedAt'> & {submittedAt:string|null;revoked:boolean};
const freshMetadata = new FreshJsonPoolCache<EncodedRankingRow>(2,14*1024*1024,'assessment_metadata');
type PreparedMetadata = {
  rows:FreshRankingRow[];summaries:Map<number,RubricSummary>;revoked:Set<number>;
  grouped:Map<string,FreshRankingRow[]>;proofByAttempt:Map<number,AssessmentRankingEvidence>;
};
const preparedMetadata = new WeakMap<readonly EncodedRankingRow[],PreparedMetadata>();
const immutableEnrichment=new WeakMap<object,{fingerprint:string;data:(MatchCandidate&{assessmentEvidence:AssessmentRankingEvidence|null})[]}>();
const immutableEligibleIds = new WeakMap<object, readonly number[]>();
export function rankingInputFingerprint(candidates: object) {
  return currentRankingInputs.get(candidates);
}

/** Structural comparability only; never an assertion of equal human difficulty. */
export function assessmentRubricKey(
  oracles: unknown,
  programId: string,
  version: string,
  grade: string,
): string | null {
  if (!oracles || typeof oracles !== "object") return null;
  const expected =
    programId === "backend-python"
      ? [
          "api-contracts",
          "sql-data",
          "incident-diagnosis",
          "idempotency",
          "architecture",
          "condition-change",
        ]
      : programId === "frontend-typescript"
        ? [
            "typescript",
            "frontend-state",
            "frontend-performance",
            "accessibility",
            "frontend-architecture",
            "async-ui",
          ]
        : [];
  const blueprints = Object.values(oracles).map(
    (item) => (item as { blueprint?: Record<string, unknown> })?.blueprint,
  );
  const canonicalIntegerVersion = version === "signal-backend-python-v7" || version === "signal-frontend-typescript-v3";
  if (
    !expected.length ||
    blueprints.length !== 6 ||
    blueprints.some(
      (b) =>
        !b ||
        b.programId !== programId ||
        b.version !== version ||
        b.grade !== grade ||
        typeof b.templateId !== "string" ||
        !Number.isInteger(b.templateVersion) ||
        typeof b.critical !== "boolean" ||
        !["choice", "integer", "structured"].includes(String(b.responseType)) ||
        (canonicalIntegerVersion
          ? b.family === expected[1]
            ? b.responseType !== "integer" || b.answerComparison !== "canonical_integer_v1"
            : b.answerComparison != null
          : b.answerComparison != null) ||
        !["ordered_components", "all_or_nothing"].includes(
          String(b.partialCredit),
        ),
    )
  )
    return null;
  const rubric = blueprints
    .map((b) => ({
      criterion: String(b!.family),
      templateVersion: b!.templateVersion,
      responseType: b!.responseType,
      partialCredit: b!.partialCredit,
      ...(b!.answerComparison != null ? { answerComparison: b!.answerComparison } : {}),
      critical: b!.critical,
      maximum: 100,
      weight: 1 / 6,
    }))
    .sort((a, b) => (a.criterion < b.criterion ? -1 : 1));
  if (
    JSON.stringify(rubric.map((b) => b.criterion).sort()) !==
    JSON.stringify([...expected].sort())
  )
    return null;
  return createHash("sha256").update(JSON.stringify(rubric)).digest("hex");
}

/** Batch whitelist: no answers, case statements or oracle keys leave this read. */
export async function withAssessmentRankingEvidence<T extends MatchCandidate>(
  candidates: T[],
  queryDb: Pick<typeof db, "select"> = db,
  rubricCache: RankingRubricCache | null = queryDb === db
    ? immutableRubrics
    : null,
  options: { mutateLocalProjection?: boolean } = {},
): Promise<(T & { assessmentEvidence: AssessmentRankingEvidence | null })[]> {
  const mayReuseIds=queryDb===db&&rubricCache===immutableRubrics&&Object.isFrozen(candidates);
  const savedIds=mayReuseIds?immutableEligibleIds.get(candidates):undefined;
  const ownedSource=mayReuseIds&&(savedIds!==undefined||candidates.every(isReadonlyResumeProjection));
  const eligibleIds:readonly number[]=savedIds ?? [
    ...new Set(
      candidates
        .filter((c) => c.verifiedGrade && resumeAssessmentMillis(c)!==null)
        .map((c) => c.userId),
    ),
  ];
  if(!savedIds&&ownedSource)
    immutableEligibleIds.set(candidates,Object.freeze(eligibleIds));
  if (!eligibleIds.length)
    return candidates.map((c) => ({ ...c, assessmentEvidence: null }));
  // Ranking needs the saved rubric metadata, never the answers or case source.
  // Preserve every object key and blueprint, including malformed metadata, so
  // historical/ambiguous evidence still follows the existing validation rules.
  const rankingOracles = sql<typeof attempts.$inferSelect.oracles>`case
    when jsonb_typeof(${attempts.oracles}) = 'object' then (
      select coalesce(jsonb_object_agg(entry.key, jsonb_build_object('blueprint',
        case when jsonb_typeof(entry.value -> 'blueprint') = 'object' then jsonb_build_object(
          'family', entry.value -> 'blueprint' -> 'family',
          'programId', entry.value -> 'blueprint' -> 'programId',
          'version', entry.value -> 'blueprint' -> 'version',
          'grade', entry.value -> 'blueprint' -> 'grade',
          'templateId', entry.value -> 'blueprint' -> 'templateId',
          'templateVersion', entry.value -> 'blueprint' -> 'templateVersion',
          'critical', entry.value -> 'blueprint' -> 'critical',
          'responseType', entry.value -> 'blueprint' -> 'responseType',
          'partialCredit', entry.value -> 'blueprint' -> 'partialCredit',
          'answerComparison', entry.value -> 'blueprint' -> 'answerComparison'
        ) else entry.value -> 'blueprint' end)), '{}'::jsonb)
      from jsonb_each(${attempts.oracles}) as entry
    ) else ${attempts.oracles} end`;
  const freshColumns = {
    id: attempts.id,
    userId: attempts.userId,
    programId: attempts.programId,
    programVersion: attempts.programVersion,
    purpose: attempts.purpose,
    grade: attempts.grade,
    score: attempts.score,
    submittedAt: attempts.submittedAt,
  };
  const projection = sql<
    Omit<FreshRankingRow, "submittedAt"> & { submittedAt: string | null }
  >`jsonb_build_object(${sql.join(
    Object.entries(freshColumns).flatMap(([key, value]) => [
      sql`${key}::text`,
      sql`${value}`,
    ]),
    sql`, `,
  )})`;
  const predicate=and(
    sql`${attempts.userId} = any(${sql.param(eligibleIds)}::int[])`,
    eq(attempts.status,'submitted'),eq(attempts.verified,true),eq(attempts.purpose,'signal_qualification'),
  );
  const mayReuseMetadata=queryDb===db&&rubricCache===immutableRubrics;
  let snapshot:readonly EncodedRankingRow[]|undefined,freshFingerprint:string|undefined;
  if(mayReuseMetadata) {
    const revoked=sql<boolean>`exists(select 1 from ${corrections} where ${corrections.attemptId}=${attempts.id})`;
    const metadataJson=sql<EncodedRankingRow>`jsonb_build_object(${sql.join(Object.entries({...freshColumns,revoked}).flatMap(([key,value])=>[sql`${key}::text`,sql`${value}`]),sql`, `)})`;
    const record=sql`row(${sql.join(Object.entries(freshColumns).map(([key,value])=>key==='submittedAt'?sql`extract(epoch from ${value})`:sql`${value}`),sql`, `)}, ${revoked})::text`;
    const fingerprint=sql<string>`encode(sha256(convert_to(coalesce(string_agg(${record},'' order by ${sql`${attempts.id}`}),''),'UTF8')),'hex')`;
    const query=<T>(columns:{fingerprint:typeof fingerprint;data?:ReturnType<typeof sql<EncodedRankingRow[]>>})=>db.select(columns).from(attempts).where(predicate);
    const [fresh]=await query({fingerprint});
    const context=JSON.stringify([...eligibleIds].sort((a,b)=>a-b));
    snapshot=await freshMetadata.read(context,fresh!.fingerprint,async()=>{
      const [own]=await query({fingerprint,data:sql<EncodedRankingRow[]>`coalesce(jsonb_agg(${metadataJson} order by ${sql`${attempts.id}`}), '[]'::jsonb)`});
      return {fingerprint:own!.fingerprint,data:own!.data!};
    },async()=>{const [ownFresh]=await query({fingerprint});return ownFresh!.fingerprint;});
    freshFingerprint=freshMetadata.fingerprintFor(snapshot);
  }
  const immutableSource=mayReuseMetadata&&ownedSource;
  const previous=immutableSource?immutableEnrichment.get(candidates):undefined;
  if(freshFingerprint&&previous?.fingerprint===freshFingerprint)
    return previous.data as (T&{assessmentEvidence:AssessmentRankingEvidence|null})[];
  const savedPrepared=snapshot?preparedMetadata.get(snapshot):undefined;
  const encodedRows = savedPrepared||snapshot ? [] : await queryDb
    .select({ data: projection })
    .from(attempts)
    .where(predicate);
  const rows: FreshRankingRow[] = savedPrepared?.rows ?? (snapshot ?? encodedRows.map(row=>row.data)).map((data) => ({
    ...data,
    submittedAt: data.submittedAt ? new Date(data.submittedAt) : null,
  }));
  const summaries = savedPrepared?.summaries ?? new Map<number, RubricSummary>();
  const uncached = savedPrepared?[]:rows.filter((row) => {
    const saved = rubricCache?.get(row);
    if (saved) summaries.set(row.id, saved);
    return !saved;
  });
  if (uncached.length) {
    const metadata = await queryDb
      .select({ id: attempts.id, oracles: rankingOracles })
      .from(attempts)
      .where(
        sql`${attempts.id} = any(${sql.param(uncached.map((row) => row.id))}::int[])`,
      );
    const byId = new Map(metadata.map((row) => [row.id, row.oracles]));
    for (const row of uncached) {
      const summary = (rubricCache ?? new RankingRubricCache(1)).put(
        row,
        byId.get(row.id),
      );
      summaries.set(row.id, summary);
    }
  }
  const revoked = savedPrepared?.revoked ?? (snapshot?new Set(snapshot.filter(row=>row.revoked).map(row=>row.id)):rows.length
    ? new Set(
        (
          await queryDb
            .select({ attemptId: corrections.attemptId })
            .from(corrections)
            .where(
              sql`${corrections.attemptId} = any(${sql.param(rows.map((row) => row.id))}::int[])`,
            )
        ).map((row) => row.attemptId),
      )
    : new Set<number>());
  const grouped = savedPrepared?.grouped ?? new Map<string, typeof rows>();
  for (const row of savedPrepared?[]:rows) {
    const key = `${row.userId}/${row.grade}/${row.submittedAt?.getTime()}`;
    const group = grouped.get(key);
    if (group) group.push(row);
    else grouped.set(key, [row]);
  }
  const proofByAttempt = savedPrepared?.proofByAttempt ?? new Map<number, AssessmentRankingEvidence>();
  if(snapshot&&!savedPrepared) preparedMetadata.set(snapshot,{rows,summaries,revoked,grouped,proofByAttempt});
  const enriched = candidates.map((candidate) => {
    const linked =
      grouped.get(
        `${candidate.userId}/${candidate.verifiedGrade}/${candidate.latestAssessmentAt?.getTime()}`,
      ) ?? [];
    // Ambiguous historical provenance remains unknown instead of invented.
    const row = linked.length === 1 ? linked[0] : null;
    const expectedProgram =
      candidate.specialization === "Backend / Python"
        ? "backend-python"
        : candidate.specialization === "Frontend / TypeScript"
          ? "frontend-typescript"
          : null;
    const summary = row ? summaries.get(row.id) : null;
    const version = summary?.version;
    const rubricKey = summary?.rubricKey;
    const canLink =
      row &&
      row.programId === expectedProgram &&
      row.submittedAt &&
      row.score !== null &&
      version &&
      rubricKey;
    let assessmentEvidence: AssessmentRankingEvidence | null = canLink
      ? (proofByAttempt.get(row!.id) ?? null)
      : null;
    if (canLink && !assessmentEvidence) {
      assessmentEvidence = {
        attemptId: row.id,
        candidateId: row.userId,
        programId: row.programId,
        programVersion: version,
        grade: row.grade,
        score: row.score!,
        submittedAt: row.submittedAt!.toISOString(),
        state: revoked.has(row.id) ? "revoked" : "verified",
        comparisonPolicy: "same-program-version-rubric-v1",
        rubricKey,
      };
      proofByAttempt.set(row!.id, Object.freeze(assessmentEvidence!));
    }
    // A current modular certificate has several evidence IDs and no comparable
    // overall score. Do not reattach an older single-exam score to that category.
    if ('categoryEvidence' in candidate && candidate.categoryEvidence) assessmentEvidence = null;
    // Only the two pool callers opt in: their top-level rows are fresh local
    // projections copied from frozen encoded SQL snapshots. Other callers keep
    // the original non-mutating contract, including injected-reader regressions.
    if (options.mutateLocalProjection&&!Object.isFrozen(candidate)) {
      candidate.assessmentEvidence = assessmentEvidence;
      return candidate as T & {
        assessmentEvidence: AssessmentRankingEvidence | null;
      };
    }
    const result={ ...candidate, assessmentEvidence };
    return immutableSource?readonlyResumeProjection(result):result;
  });
  currentRankingInputs.set(
    enriched,
    freshFingerprint ?? createHash("sha256")
      .update(
        JSON.stringify([
          rows,
          [...summaries],
          [...revoked].sort((a, b) => a - b),
        ]),
      )
      .digest("hex"),
  );
  if(immutableSource&&freshFingerprint) {
    Object.freeze(enriched);immutableEnrichment.set(candidates,{fingerprint:freshFingerprint,data:enriched});
  }
  return enriched;
}
