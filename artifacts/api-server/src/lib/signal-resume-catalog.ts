import { canonicalSkillKey, canonicalSkillLabels } from "./skill-catalog";
import {presentFspSignal} from './fsp-results';
import {
  compareSalaryCompatibility,
  type MatchCandidate,
  type MatchEvaluation,
  type SafeSkillEvidence,
} from "./signal-matching";
import type { SignalLegacyQualification } from "@workspace/db";

export const CATALOG_POLICY_VERSION = "resume-catalog-v2-confirmed-first";
export const RECENT_SKILL_DAYS = 30;
export type CatalogResume = MatchCandidate & {
  resumeId: number;
  resumeRevision: number;
  title: string;
  yearsExperience: number;
  consentCatalog: boolean;
  readyForOffers: boolean;
  avatarDataUrl: string | null;
  hasAccessiblePhoto?: boolean;
  publicName: string | null;
  deletedAt: Date | null;
  legacyQualification: SignalLegacyQualification | null;
};
export type CatalogFilters = {
  q?: string;
  specialization?: string;
  grade?: "Junior" | "Middle" | "Senior" | "unconfirmed";
  skill?: string;
  skills?: string[];
  fsp?: "yes" | "no";
  experienceMin?: number;
  experienceMax?: number;
  workFormat?: string;
  salaryMin?: number;
  salaryMax?: number;
  salaryPeriod?: "month" | "year";
  salaryType?: "gross" | "net";
  hasPhoto?: "yes" | "no";
  readyForOffers?: "yes" | "no";
  checkedWithinDays?: number;
};
export type PreparedCatalogFilters = { q: string | null; skills: string[] };
export function prepareCatalogFilters(
  filters: CatalogFilters,
): PreparedCatalogFilters {
  return {
    q: filters.q ? filters.q.toLocaleLowerCase("ru-RU") : null,
    skills: [
      ...(filters.skills ?? []),
      ...(filters.skill ? [filters.skill] : []),
    ].map(canonicalSkillKey),
  };
}
export const stableTextOrder = (a: string, b: string) =>
  a < b ? -1 : a > b ? 1 : 0;
const identityOrder = (a: CatalogResume, b: CatalogResume) =>
  stableTextOrder(a.alias.normalize("NFC"), b.alias.normalize("NFC")) ||
  a.userId - b.userId ||
  a.resumeId - b.resumeId;

export function catalogVisible(
  resume: CatalogResume,
  demoMode: boolean,
): boolean {
  return (
    !resume.deletedAt &&
    resume.demoMode === demoMode &&
    resume.consentCatalog &&
    resume.visibility !== "private"
  );
}
/** All predicates inspect the same résumé. Stated skills never satisfy verified skill filters. */
export function matchesCatalogFilters(
  resume: CatalogResume,
  filters: CatalogFilters,
  now: Date,
  prepared: PreparedCatalogFilters = prepareCatalogFilters(filters),
): boolean {
  if (
    prepared.q &&
    !resume.alias.toLocaleLowerCase("ru-RU").includes(prepared.q)
  )
    return false;
  if (
    filters.specialization &&
    resume.specialization !== filters.specialization
  )
    return false;
  if (
    filters.grade &&
    (filters.grade === "unconfirmed"
      ? resume.verifiedGrade !== null
      : resume.verifiedGrade !== filters.grade)
  )
    return false;
  const requestedSkills = prepared.skills;
  if (requestedSkills.length) {
    const skills = new Set(resume.verifiedSkills.map(canonicalSkillKey));
    if (!requestedSkills.every((skill) => skills.has(skill))) return false;
  }
  if (filters.fsp && resume.hasFspHistory !== (filters.fsp === "yes"))
    return false;
  if (
    filters.experienceMin !== undefined &&
    resume.yearsExperience < filters.experienceMin
  )
    return false;
  if (
    filters.experienceMax !== undefined &&
    resume.yearsExperience > filters.experienceMax
  )
    return false;
  if (filters.workFormat && resume.workFormat !== filters.workFormat)
    return false;
  const hasPhoto =
    resume.visibility === "public" &&
    Boolean(resume.hasAccessiblePhoto ?? resume.avatarDataUrl);
  if (filters.hasPhoto && hasPhoto !== (filters.hasPhoto === "yes"))
    return false;
  if (
    filters.readyForOffers &&
    resume.readyForOffers !== (filters.readyForOffers === "yes")
  )
    return false;
  if (
    filters.checkedWithinDays !== undefined &&
    (!resume.latestAssessmentAt ||
      resume.latestAssessmentAt.getTime() > now.getTime() ||
      now.getTime() - resume.latestAssessmentAt.getTime() >
        filters.checkedWithinDays * 86400000)
  )
    return false;
  if (filters.salaryMin !== undefined || filters.salaryMax !== undefined) {
    if (!filters.salaryPeriod || !filters.salaryType) return false;
    const compatibility = compareSalaryCompatibility(
      {
        salaryMin: filters.salaryMin ?? 0,
        salaryMax: filters.salaryMax ?? Number.MAX_SAFE_INTEGER,
        salaryPeriod: filters.salaryPeriod,
        salaryType: filters.salaryType,
      },
      resume,
    );
    if (compatibility !== "compatible") return false;
  }
  return true;
}

export function deduplicateResumes<T extends CatalogResume>(
  resumes: readonly T[],
): { selected: T; alternatives: T[] }[] {
  const people = new Map<number, T[]>();
  for (const resume of resumes) {
    const existing = people.get(resume.userId);
    if (existing) existing.push(resume);
    else people.set(resume.userId, [resume]);
  }
  return [...people.values()].map((rows) => {
    const sorted = [...rows].sort((a, b) => a.resumeId - b.resumeId);
    // Pick an actual whole confirmed résumé when one passed every filter;
    // never borrow a grade from an excluded alternative or combine fields.
    return { selected: sorted.find(isCatalogConfirmed) ?? sorted[0]!, alternatives: sorted };
  });
}

/** Select one whole résumé before calling the frozen person-level matcher. */
export function selectMatchingResumes<T extends CatalogResume>(
  entries: { candidate: T; evaluation: MatchEvaluation }[],
) {
  const people = new Map<number, typeof entries>();
  for (const entry of entries) {
    const existing = people.get(entry.candidate.userId);
    if (existing) existing.push(entry);
    else people.set(entry.candidate.userId, [entry]);
  }
  return [...people.values()].map((rows) => {
    const fit = Math.max(
      ...rows.map((row) => row.evaluation.ranking.businessFitScore),
    );
    const fitRows = rows.filter(
      (row) => row.evaluation.ranking.businessFitScore === fit,
    );
    const provenance = Math.min(
      ...fitRows.map((row) => row.evaluation.ranking.provenancePriority),
    );
    const finalists = fitRows.filter(
      (row) => row.evaluation.ranking.provenancePriority === provenance,
    );
    const comparable =
      new Set(finalists.map((row) => row.evaluation.ranking.groupId)).size ===
        1 &&
      finalists.every((row) => row.evaluation.ranking.qualityScore !== null);
    const chosen = [...finalists].sort(
      (a, b) =>
        (comparable
          ? b.evaluation.ranking.qualityScore! -
            a.evaluation.ranking.qualityScore!
          : 0) || a.candidate.resumeId - b.candidate.resumeId,
    )[0]!;
    const sorted = [
      chosen,
      ...rows
        .filter((row) => row !== chosen)
        .sort((a, b) => a.candidate.resumeId - b.candidate.resumeId),
    ];
    return { ...sorted[0]!, alternatives: sorted.map((row) => row.candidate) };
  });
}

export function isCatalogConfirmed(resume: CatalogResume) {
  return resume.verifiedGrade !== null && resume.assessmentEvidence?.state !== 'revoked';
}
export function orderCatalog<T extends CatalogResume>(
  people: { selected: T; alternatives: T[] }[],
) {
  const proofKey = (resume: T) => {
    const proof = resume.assessmentEvidence;
    return proof?.state === "verified"
      ? JSON.stringify([
          resume.specialization,
          resume.verifiedGrade,
          proof.programId,
          proof.programVersion,
          proof.rubricKey,
        ])
      : null;
  };
  const confirmed=people.filter(person=>isCatalogConfirmed(person.selected));
  const unconfirmed=people.filter(person=>!isCatalogConfirmed(person.selected));
  const keys = new Set(confirmed.map((person) => proofKey(person.selected)));
  const comparable = keys.size === 1 && !keys.has(null);
  const sorted = [...confirmed].sort(
    (a, b) =>
      (comparable
        ? b.selected.assessmentEvidence!.score -
          a.selected.assessmentEvidence!.score
        : 0) || identityOrder(a.selected, b.selected),
  );
  return {
    people: [...sorted,...unconfirmed.sort((a,b)=>identityOrder(a.selected,b.selected))],
    order: 'confirmed-first',
    confirmedOrder: comparable ? 'comparable-qualification' : 'neutral-alias',
    confirmedTotal: confirmed.length, unconfirmedTotal: unconfirmed.length,
    orderNote: 'Сначала резюме с действующим подтверждённым грейдом, затем резюме без подтверждённого грейда. Один человек занимает одно место после фильтров.' + (comparable
      ? ' Результаты подтверждённых резюме сравниваются в одном направлении, уровне и версии экзамена.'
      : ' Подтверждённые резюме разных направлений, уровней и версий расположены нейтрально: их баллы напрямую не сравниваются.') + ' Для обычного подбора и приглашения кандидату нужно подтвердить подходящий грейд в Signal.',
  };
}

export type SkillBadge = {
  id: "ten-skills" | "recent-skills" | "practical";
  label: string;
  skills: SafeSkillEvidence[];
  note: string;
};
/** A preserved historical aggregate is not proof of ten measured criteria. */
export function factBadges(
  evidence: readonly SafeSkillEvidence[],
  now: Date,
): SkillBadge[] {
  const actual = evidence.filter(
    (proof) =>
      proof.attemptId !== null &&
      proof.programId &&
      proof.programVersion &&
      proof.criterionId &&
      proof.result !== null &&
      proof.date &&
      !proof.limitation &&
      proof.sourceType !== "legacy_record",
  );
  const unique = [
    ...new Map(
      actual.map((proof) => [canonicalSkillKey(proof.skill), proof]),
    ).values(),
  ].sort((a, b) =>
    stableTextOrder(canonicalSkillKey(a.skill), canonicalSkillKey(b.skill)),
  );
  const badges: SkillBadge[] = [];
  if (unique.length >= 10)
    badges.push({
      id: "ten-skills",
      label: "10+ подтверждённых навыков",
      skills: unique,
      note: `${unique.length} уникальных навыков с применимыми действующими доказательствами.`,
    });
  const recent = unique.filter((proof) => {
    const at = new Date(proof.date!).getTime();
    return (
      Number.isFinite(at) &&
      at <= now.getTime() &&
      now.getTime() - at <= RECENT_SKILL_DAYS * 86400000
    );
  });
  if (recent.length)
    badges.push({
      id: "recent-skills",
      label: "Навыки проверены недавно",
      skills: recent,
      note: `Проверено за последние ${RECENT_SKILL_DAYS} дней. Даты повторного использования не обновляются.`,
    });
  const practical = unique.filter(
    (proof) =>
      (proof as SafeSkillEvidence & { practicalPassed?: boolean })
        .practicalPassed === true,
  );
  if (practical.length)
    badges.push({
      id: "practical",
      label: "Квалификационный экзамен Signal пройден",
      skills: practical,
      note: "Подтверждение из успешно пройденного квалификационного экзамена Signal; это не задание компании и не производственный опыт.",
    });
  return badges.slice(0, 3);
}

export function safeCatalogResume(resume: CatalogResume) {
  return {
    resumeId: resume.resumeId,
    resumeRevision: resume.resumeRevision,
    title: resume.title,
    specialization: resume.specialization,
    verifiedGrade: resume.verifiedGrade,
    verifiedScore: resume.verifiedScore,
    verifiedSkills: canonicalSkillLabels(resume.verifiedSkills),
    stack: canonicalSkillLabels(resume.stack),
    yearsExperience: resume.yearsExperience,
    experienceSource: "self_reported",
    workFormat: resume.workFormat,
    salaryMin: resume.salaryMin,
    salaryMax: resume.salaryMax,
    salaryPeriod: resume.salaryPeriod,
    salaryType: resume.salaryType,
    readyForOffers: resume.readyForOffers,
    evidenceDate: resume.latestAssessmentAt?.toISOString() ?? null,
    confirmationStatus: isCatalogConfirmed(resume) ? 'confirmed' : 'unconfirmed',
    qualificationNextStep: isCatalogConfirmed(resume) ? null : {action:'take_signal_qualification',resumeId:resume.resumeId,specialization:resume.specialization},
    fspSignal: presentFspSignal(resume.fspSignal),
  };
}

/** Alternatives are selectors, not five copies of the card's entire content. */
export function availableResumeSummary(resume: CatalogResume) {
  return {
    id: resume.resumeId,
    resumeId: resume.resumeId,
    revision: resume.resumeRevision,
    resumeRevision: resume.resumeRevision,
    title: resume.title,
    specialization: resume.specialization,
    verifiedGrade: resume.verifiedGrade,
    evidenceDate: resume.latestAssessmentAt?.toISOString() ?? null,
  };
}
