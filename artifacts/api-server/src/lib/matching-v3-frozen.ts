import { canonicalSkillKey, canonicalSkillLabels, resolveSkill } from './skill-catalog';
export type SignalGrade = "Junior" | "Middle" | "Senior";
export type SalaryPeriod = "month" | "year";
export type SalaryType = "gross" | "net";

export type MatchNeed = {
  specialization: string;
  grade: SignalGrade;
  requiredSkills: readonly string[];
  desirableSkills: readonly string[];
  workFormat: string;
  salaryMin: number;
  salaryMax: number;
  salaryPeriod?: SalaryPeriod;
  salaryType?: SalaryType;
};

export type MatchCandidate = {
  userId: number;
  alias: string;
  specialization: string;
  verifiedGrade: SignalGrade | null;
  verifiedScore: number | null;
  verifiedSkills: readonly string[];
  stack: readonly string[];
  statedSkills: readonly string[];
  workFormat: string;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryPeriod?: SalaryPeriod;
  salaryType?: SalaryType;
  latestAssessmentAt: Date | null;
  hasFspHistory: boolean;
  visibility: "private" | "pseudonymous" | "public";
  consentMatching: boolean;
  demoMode: boolean;
  skillEvidence?: readonly SafeSkillEvidence[];
};

export type MatchEligibilityReason =
  | "pool"
  | "consent"
  | "visibility"
  | "specialization"
  | "grade"
  | "required_skills";

export type SafeSkillEvidence = {
  skill: string; candidateId: number; attemptId: number | null; programId: string | null; programVersion: string | null; templateId: string | null; templateVersion: string | number | null; criterionId: string | null; criterion: string | null; result: number | null; date: string | null; sourceType: "signal_assessment" | "demo_example" | "legacy_record" | "company_task" | "fsp"; limitation: string | null;
};

export type MatchEvidence = {
  skillId?: string | null;
  provenance?: SafeSkillEvidence | null;
  requirement: string;
  evidence: string;
  source: string;
  date: string | null;
  status: "verified" | "stated" | "unchecked" | "not_fit";
};

export type MatchFactor = {
  name: string;
  score: number;
  weight: number;
};

export type SalaryCompatibility = "compatible" | "incompatible" | "unknown";

export type MatchEvaluation = {
  eligible: boolean;
  ineligibilityReasons: MatchEligibilityReason[];
  baseScore: number;
  fspBonus: number;
  rankingScore: number;
  factors: MatchFactor[];
  evidence: MatchEvidence[];
  strengths: string[];
  gaps: string[];
  salaryCompatibility: SalaryCompatibility;
};

export const MATCH_ALGORITHM_VERSION = "fsp-signal-match-v3";
export const gradeRank: Record<SignalGrade, number> = {
  Junior: 1,
  Middle: 2,
  Senior: 3,
};

const evidenceFreshnessDays = 180;

function uniqueSkills(skills: readonly string[]): string[] {
  return canonicalSkillLabels(skills);
}

function boundedUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function formatFits(candidateFormat: string, needFormat: string): boolean {
  const candidate = candidateFormat.toLocaleLowerCase("ru-RU");
  const need = needFormat.toLocaleLowerCase("ru-RU");
  return (
    (candidate.includes("удал") && need.includes("удал")) ||
    (candidate.includes("гибрид") && need.includes("гибрид")) ||
    candidate === need
  );
}

/**
 * Salary ranges are comparable only after aligning their period and tax basis.
 * Gross/net cannot be converted without facts that the profile does not hold,
 * so it must stay unknown rather than becoming a hidden negative signal.
 */
export function compareSalaryCompatibility(
  need: Pick<MatchNeed, "salaryMin" | "salaryMax" | "salaryPeriod" | "salaryType">,
  candidate: Pick<
    MatchCandidate,
    "salaryMin" | "salaryMax" | "salaryPeriod" | "salaryType"
  >,
): SalaryCompatibility {
  if (
    candidate.salaryMin == null ||
    candidate.salaryMax == null ||
    !need.salaryPeriod ||
    !need.salaryType ||
    !candidate.salaryPeriod ||
    !candidate.salaryType
  ) {
    return "unknown";
  }
  if (candidate.salaryType !== need.salaryType) return "unknown";

  const monthlyFactor = (period: SalaryPeriod): number =>
    period === "year" ? 1 / 12 : 1;
  const candidateMin = candidate.salaryMin * monthlyFactor(candidate.salaryPeriod);
  const candidateMax = candidate.salaryMax * monthlyFactor(candidate.salaryPeriod);
  const needMin = need.salaryMin * monthlyFactor(need.salaryPeriod);
  const needMax = need.salaryMax * monthlyFactor(need.salaryPeriod);
  return candidateMin <= needMax && candidateMax >= needMin
    ? "compatible"
    : "incompatible";
}

export function evaluateMatch(
  need: MatchNeed,
  candidate: MatchCandidate,
  poolDemoMode: boolean,
  now = new Date(),
): MatchEvaluation {
  const requiredSkills = uniqueSkills(need.requiredSkills);
  const allRequirements = uniqueSkills([
    ...requiredSkills,
    ...need.desirableSkills,
  ]);
  const verified = new Set(candidate.verifiedSkills.map(canonicalSkillKey));
  const stated = new Set([...candidate.statedSkills, ...candidate.stack].map(canonicalSkillKey));
  const ineligibilityReasons: MatchEligibilityReason[] = [];

  if (candidate.demoMode !== poolDemoMode) ineligibilityReasons.push("pool");
  if (!candidate.consentMatching) ineligibilityReasons.push("consent");
  if (candidate.visibility === "private") ineligibilityReasons.push("visibility");
  if (candidate.specialization !== need.specialization) {
    ineligibilityReasons.push("specialization");
  }
  if (
    !candidate.verifiedGrade ||
    gradeRank[candidate.verifiedGrade] < gradeRank[need.grade]
  ) {
    ineligibilityReasons.push("grade");
  }
  if (!requiredSkills.every((skill) => verified.has(canonicalSkillKey(skill)))) {
    ineligibilityReasons.push("required_skills");
  }

  const verifiedSkillMatch =
    allRequirements.length === 0
      ? 1
      : allRequirements.filter((skill) => verified.has(canonicalSkillKey(skill))).length /
        allRequirements.length;
  // Raw scores from different grade programmes are not comparable. This factor
  // records only an established category at or above the minimum requirement.
  const relevantAssessmentEvidence = candidate.verifiedGrade && gradeRank[candidate.verifiedGrade] >= gradeRank[need.grade] ? 1 : 0;
  const statedContextFit = formatFits(candidate.workFormat, need.workFormat)
    ? 1
    : 0.5;
  const evidenceFreshness = candidate.latestAssessmentAt
    ? boundedUnit(
        1 -
          (now.getTime() - candidate.latestAssessmentAt.getTime()) /
            (evidenceFreshnessDays * 24 * 60 * 60 * 1000),
      )
    : 0;
  const factors: MatchFactor[] = [
    {
      name: "Подтверждённое покрытие навыков",
      score: verifiedSkillMatch,
      weight: 0.5,
    },
    {
      name: "Подтверждённая категория не ниже требуемой",
      score: relevantAssessmentEvidence,
      weight: 0.3,
    },
    { name: "Контекст работы", score: statedContextFit, weight: 0.15 },
    { name: "Свежесть свидетельств", score: evidenceFreshness, weight: 0.05 },
  ];
  const baseScore = Math.round(
    100 * factors.reduce((total, factor) => total + factor.score * factor.weight, 0),
  );
  // The current adapter exposes one verified mock-FSP signal. Its bounded
  // positive effect never substitutes a required skill or a verified grade.
  const fspBonus = candidate.hasFspHistory ? 3 : 0;
  const salaryCompatibility = compareSalaryCompatibility(need, candidate);
  const evidence: MatchEvidence[] = allRequirements.map((requirement) => {
    const confirmed = verified.has(canonicalSkillKey(requirement));
    const selfReported = stated.has(canonicalSkillKey(requirement));
    const provenance = confirmed ? candidate.skillEvidence?.find(item => canonicalSkillKey(item.skill) === canonicalSkillKey(requirement)) ?? null : null;
    const source = confirmed
      ? provenance?.sourceType === "signal_assessment" ? "Проверка навыков Signal"
        : provenance?.sourceType === "demo_example" || candidate.demoMode ? "Demo · синтетический пример"
          : provenance?.sourceType === "company_task" ? "Задание компании"
            : provenance?.sourceType === "fsp" ? "Данные ФСП"
              : "Сохранённое подтверждение · подробный протокол отсутствует"
      : selfReported ? "Самоописание кандидата" : "Нет источника";
    return {
      requirement, skillId: resolveSkill(requirement).id,
      evidence: confirmed ? `Подтверждённый навык: ${requirement}` : selfReported ? "Навык указан кандидатом, но не подтверждён" : "Данных для проверки пока нет",
      source, provenance,
      date: confirmed ? provenance?.date ?? candidate.latestAssessmentAt?.toISOString() ?? null : null,
      status: confirmed ? "verified" : selfReported ? "stated" : "unchecked",
    };
  });
  const strengths = allRequirements.filter((skill) => verified.has(canonicalSkillKey(skill)));
  const gaps = [
    ...allRequirements.filter(
      (skill) => !verified.has(canonicalSkillKey(skill)) && !stated.has(canonicalSkillKey(skill)),
    ),
    ...allRequirements
      .filter((skill) => !verified.has(canonicalSkillKey(skill)) && stated.has(canonicalSkillKey(skill)))
      .map((skill) => `${skill} (указан кандидатом, не подтверждён)`),
    ...(salaryCompatibility === "incompatible"
      ? ["Зарплатные ожидания могут не совпасть"]
      : salaryCompatibility === "unknown"
        ? ["Зарплатные ожидания нельзя сопоставить по указанной базе"]
        : []),
  ];

  return {
    eligible: ineligibilityReasons.length === 0,
    ineligibilityReasons,
    baseScore,
    fspBonus,
    rankingScore: baseScore + fspBonus,
    factors,
    evidence,
    strengths,
    gaps,
    salaryCompatibility,
  };
}

export function isMatchEligible(
  need: MatchNeed,
  candidate: MatchCandidate,
  poolDemoMode: boolean,
): boolean {
  return evaluateMatch(need, candidate, poolDemoMode).eligible;
}
