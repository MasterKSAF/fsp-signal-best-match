import { canonicalSkillKey, canonicalSkillLabels, resolveSkill } from './skill-catalog';
import { hasMeaningfulRequiredSkills } from './employer-required-skills';
import { compactFspSignal, emptyFspSignal, fspBonusForSignal, type FspRankingFacts } from './fsp-results';
import type { SkillCategorySnapshot } from '@workspace/db';
import { evaluateGradeRequirement, evaluateSkillRequirement, interpretSkillRequirements, type RequirementMode, type SkillRequirement } from './recruiting-requirements';
export type SignalGrade = "Junior" | "Middle" | "Senior";
export type SalaryPeriod = "month" | "year";
export type SalaryType = "gross" | "net";

export type MatchNeed = {
  specialization: string;
  grade: SignalGrade;
  gradeMode?: RequirementMode;
  skillRequirements?: readonly SkillRequirement[];
  requiredSkills: readonly string[];
  /** Canonical skill keys only; missing values are historical requirements without a minimum level. */
  requiredSkillLevels?: Readonly<Record<string, SignalGrade>>;
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
  assumedGrade?: SignalGrade | null;
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
  /** Normalized current server provider facts; the legacy boolean grants nothing. */
  fspSignal?: FspRankingFacts;
  visibility: "private" | "pseudonymous" | "public";
  consentMatching: boolean;
  demoMode: boolean;
  skillEvidence?: readonly SafeSkillEvidence[];
  assessmentEvidence?: AssessmentRankingEvidence | null;
  categoryEvidence?: SkillCategorySnapshot | null;
};

/** Whitelisted current, immutable attempt; supplied only by the server loader. */
export type AssessmentRankingEvidence = {
  attemptId: number; candidateId: number; programId: string; programVersion: string;
  grade: SignalGrade; score: number; submittedAt: string; state: 'verified' | 'revoked';
  comparisonPolicy: 'same-program-version-rubric-v1'; rubricKey: string;
};
export type MatchRanking = {
  groupId: string; gradePriority: number; provenancePriority: number;
  orderPolicy: 'need-fit-proof-category-queues-v3'; businessFitScore: number;
  categoryId: string; categoryOrderPolicy: 'stable-category-anchor-v1';
  categoryPosition: number | null; categorySize: number | null;
  position: number | null; poolSize: number | null;
  freshnessBand: '0-30-days' | '31-90-days' | '91-179-days' | '180-plus-or-unknown';
  qualityStatus: 'measured' | 'not_measured' | 'revoked'; qualityScore: number | null;
  attemptId: number | null; programId: string | null; programVersion: string | null;
  comparisonPolicy: string | null; rubricKey: string | null; note: string;
};

export type MatchEligibilityReason =
  | "pool"
  | "consent"
  | "visibility"
  | "specialization"
  | "grade"
  | "required_skills";

export type SafeSkillEvidence = {
  skill: string; candidateId: number; attemptId: number | null; programId: string | null; programVersion: string | null; templateId: string | null; templateVersion: string | number | null; criterionId: string | null; criterion: string | null; result: number | null; date: string | null; sourceType: "signal_assessment" | "signal_skill_module" | "demo_example" | "legacy_record" | "company_task" | "fsp"; limitation: string | null; level?: SignalGrade; evidenceId?: number;
};

export type MatchEvidence = {
  skillId?: string | null;
  provenance?: SafeSkillEvidence | null;
  requirement: string;
  evidence: string;
  source: string;
  date: string | null;
  status: "verified" | "stated" | "unchecked" | "not_fit";
  requirementMode?: RequirementMode;
  satisfied?: boolean;
  reason?: string | null;
};

export type MatchFactor = {
  name: string;
  score: number | null;
  weight: number;
  effectiveWeight?: number;
  scope?: 'shared_fit' | 'within_comparable_group';
};

export type SalaryCompatibility = "compatible" | "incompatible" | "unknown";

export type MatchEvaluation = {
  eligible: boolean;
  ineligibilityReasons: MatchEligibilityReason[];
  baseScore: number;
  fspBonus: number;
  fspSignal: FspRankingFacts;
  scoreScope: 'shared_need_fit';
  rankingScore: number;
  ranking: MatchRanking;
  factors: MatchFactor[];
  evidence: MatchEvidence[];
  strengths: string[];
  gaps: string[];
  salaryCompatibility: SalaryCompatibility;
};

export const MATCH_ALGORITHM_VERSION = "fsp-signal-match-v7";
export const gradeRank: Record<SignalGrade, number> = {
  Junior: 1,
  Middle: 2,
  Senior: 3,
};

const evidenceFreshnessDays = 180;

function rankingEvidence(candidate: MatchCandidate, need: MatchNeed): MatchRanking {
  const proof = candidate.assessmentEvidence;
  const expectedProgram = candidate.specialization === 'Backend / Python' ? 'backend-python' : candidate.specialization === 'Frontend / TypeScript' ? 'frontend-typescript' : null;
  const linked = proof && proof.candidateId === candidate.userId && proof.grade === candidate.verifiedGrade &&
    proof.programId === expectedProgram && proof.comparisonPolicy === 'same-program-version-rubric-v1' &&
    candidate.latestAssessmentAt && new Date(proof.submittedAt).getTime() === candidate.latestAssessmentAt.getTime() &&
    Number.isInteger(proof.attemptId) && proof.attemptId > 0 && Number.isFinite(proof.score) && proof.score >= 0 && proof.score <= 100 &&
    /^signal-(backend-python|frontend-typescript)-v\d+$/.test(proof.programVersion) && proof.rubricKey.length > 0;
  const status = linked ? proof.state === 'revoked' ? 'revoked' : 'measured' : 'not_measured';
  const measured = status === 'measured';
  const category = candidate.categoryEvidence?.specialization === candidate.specialization && candidate.categoryEvidence.grade === candidate.verifiedGrade && candidate.categoryEvidence.requirements.length >= 3 ? candidate.categoryEvidence : null;
  return {
    groupId: JSON.stringify([candidate.specialization, candidate.verifiedGrade, category ? 'skill-matrix' : measured ? proof!.programId : 'unestablished', category?.matrixVersion ?? (measured ? proof!.programVersion : ''), measured ? proof!.rubricKey : '']),
    // Grade is only a gate/comparison boundary. Proof completeness is a
    // secondary preference at exactly equal need-fit, never a invented score.
    gradePriority: 0, provenancePriority: measured || category ? 0 : 1,
    orderPolicy: 'need-fit-proof-category-queues-v3', businessFitScore: 0,
    categoryId: JSON.stringify([candidate.specialization, candidate.verifiedGrade]),
    categoryOrderPolicy: 'stable-category-anchor-v1', categoryPosition: null, categorySize: null,
    position: null, poolSize: null, freshnessBand: '180-plus-or-unknown',
    qualityStatus: status, qualityScore: measured ? proof!.score : null,
    attemptId: linked ? proof!.attemptId : null, programId: linked ? proof!.programId : null,
    programVersion: linked ? proof!.programVersion : null, comparisonPolicy: linked ? proof!.comparisonPolicy : null,
    rubricKey: linked ? proof!.rubricKey : null,
    note: category ? `Категория подтверждена матрицей ${category.matrixVersion} по нескольким самостоятельным свидетельствам. Общего сопоставимого балла нет; баллы разных навыков не усредняются. Данные ФСП учитываются только внутри подходящей категории.` : measured
      ? 'Сначала — соответствие требованиям и условиям, при равенстве — полный действующий экзамен. Результаты сравниваются внутри одного направления и подтверждённого уровня с учётом версии проверки. Подтверждённые результаты ФСП дают небольшой приоритет только внутри этой категории; они не заменяют грейд и обязательные навыки. Разные шкалы экзаменов напрямую не сравниваются. Равные категории расположены нейтрально, без преимущества одного уровня над другим.'
      : status === 'revoked' ? 'Связанная попытка отозвана и не используется для подбора.'
      : 'Полный действующий результат экзамена недоступен. Это не нулевой балл. Сначала учитывается соответствие требованиям и условиям; только при равенстве приоритет получает полный действующий экзамен.',
  };
}

export type RankedMatchEntry = { candidate: MatchCandidate; evaluation: MatchEvaluation };
const preparedOrder = new WeakMap<MatchRanking, { scope: object; position: number }>();
const textOrder = (x: string, y: string) => x < y ? -1 : x > y ? 1 : 0;
const stableIdentity = (a: RankedMatchEntry, b: RankedMatchEntry) =>
  textOrder(a.candidate.alias.normalize('NFC'), b.candidate.alias.normalize('NFC')) || a.candidate.userId - b.candidate.userId;

/** Comparator of one prepared pool: no pair-dependent, potentially cyclic rule. */
export function compareRankedMatches(a: RankedMatchEntry, b: RankedMatchEntry): number {
  const left = preparedOrder.get(a.evaluation.ranking), right = preparedOrder.get(b.evaluation.ranking);
  if (!left || !right || left.scope !== right.scope) throw new Error('Rank the complete pool with rankMatches before comparing its entries');
  return left.position - right.position;
}

/**
 * Common need-fit is compared across all admitted profiles. In each exact
 * need-fit tier, complete linked proofs precede unestablished historical
 * results. Categories form whole blocks in neutral, FSP-blind anchor order.
 * Only inside each specialization+grade category comparable groups form queues
 * ordered by local quality plus MAX trusted result (1/2/3). Their heads merge
 * locally using FSP then alias/id; raw scores never cross exam scales, and FSP
 * cannot move a category block. Prepared positions define the total order.
 */
export function rankMatches<T extends RankedMatchEntry>(entries: readonly T[]): T[] {
  const copied = entries.map(entry => ({ ...entry, evaluation: { ...entry.evaluation, ranking: { ...entry.evaluation.ranking, position: null, poolSize: null } } })) as T[];
  if (new Set(copied.map(entry => entry.candidate.userId)).size !== copied.length) throw new Error('Duplicate candidate in matching pool');
  const tiers = new Map<number, T[]>();
  for (const entry of copied) {
    // Admission remains a separate gate. Evaluators also order an explicitly
    // labelled counterfactual pool to report ranking independently of admission.
    if (!Number.isFinite(entry.evaluation.ranking.businessFitScore) || !Number.isFinite(entry.evaluation.fspBonus)) throw new Error('Matching order requires finite scores');
    const score = entry.evaluation.ranking.businessFitScore;
    const tier = tiers.get(score);
    if (tier) tier.push(entry);
    else tiers.set(score, [entry]);
  }
  const ordered: T[] = [];
  for (const score of [...tiers.keys()].sort((a,b) => b-a)) {
    for (const completeness of [0,1]) {
    const categories = new Map<string, T[]>();
    for (const entry of tiers.get(score)!.filter(entry => entry.evaluation.ranking.provenancePriority === completeness)) {
      const key = entry.evaluation.ranking.categoryId;
      const group = categories.get(key);
      if (group) group.push(entry);
      else categories.set(key, [entry]);
    }
    const blocks = [...categories.values()].map(entries => ({ entries, anchor: entries.reduce((a,b)=>stableIdentity(a,b)<=0?a:b) }))
      .sort((a,b)=>stableIdentity(a.anchor,b.anchor));
    for (const [blockIndex,block] of blocks.entries()) {
    const groups = new Map<string,T[]>();
    for(const entry of block.entries) {
      entry.evaluation.ranking.categoryPosition=blockIndex+1;
      entry.evaluation.ranking.categorySize=block.entries.length;
      const key=entry.evaluation.ranking.groupId,group=groups.get(key);
      if(group)group.push(entry);else groups.set(key,[entry]);
    }
    const queues = [...groups.values()].map(group => ({ entries: group.sort((a,b) => {
      const qa = a.evaluation.ranking.qualityScore, qb = b.evaluation.ranking.qualityScore;
      // Unknown quality has no numeric value. In normal production each queue
      // is uniformly established or unestablished; ablation can remove it.
      const quality = Number(qa === null)-Number(qb === null) || (qa !== null && qb !== null
        ? (qb+b.evaluation.fspBonus)-(qa+a.evaluation.fspBonus)
        : b.evaluation.fspBonus-a.evaluation.fspBonus);
      // Age already belongs to the common business band. A hidden exact-date
      // key inside unknown queues would make grade-only regrouping change
      // their identity order despite unchanged need-fit and absent quality.
      return quality || stableIdentity(a,b);
    }), offset: 0 }));
    while (queues.some(queue => queue.offset < queue.entries.length)) {
      let chosen: typeof queues[number] | undefined;
      for (const queue of queues) {
        if (queue.offset === queue.entries.length) continue;
        const head = queue.entries[queue.offset]!;
        const current = chosen?.entries[chosen.offset];
        if (!current || current.evaluation.fspBonus-head.evaluation.fspBonus < 0 ||
          (current.evaluation.fspBonus === head.evaluation.fspBonus && stableIdentity(head,current) < 0)) chosen = queue;
      }
      ordered.push(chosen!.entries[chosen!.offset++]!);
    }
    }
    }
  }
  const scope = {};
  ordered.forEach((entry,index) => {
    entry.evaluation.ranking.position = index+1;
    entry.evaluation.ranking.poolSize = ordered.length;
    preparedOrder.set(entry.evaluation.ranking, { scope, position: index+1 });
  });
  return ordered;
}

function freshnessForNeed(at: Date | null, now: Date): { score: number; band: MatchRanking['freshnessBand'] } {
  if (!at || !Number.isFinite(at.getTime())) return { score: 0, band: '180-plus-or-unknown' };
  const days = Math.max(0, (now.getTime()-at.getTime())/86400000);
  if (days <= 30) return { score: 1, band: '0-30-days' };
  if (days <= 90) return { score: 2/3, band: '31-90-days' };
  if (days < evidenceFreshnessDays) return { score: 1/3, band: '91-179-days' };
  return { score: 0, band: '180-plus-or-unknown' };
}

function uniqueSkills(skills: readonly string[]): string[] {
  return canonicalSkillLabels(skills);
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
  const requirements = interpretSkillRequirements(requiredSkills, need.skillRequirements, need.requiredSkillLevels);
  const coverage = new Map(allRequirements.map(skill => [canonicalSkillKey(skill), evaluateSkillRequirement(requirements.find(item => canonicalSkillKey(item.skill) === canonicalSkillKey(skill)) ?? {skill,mode:'verified'},candidate)]));
  const coversRequirement = (skill: string) => coverage.get(canonicalSkillKey(skill))!.verifiedSufficient;
  const satisfiesRequirement = (skill: string) => coverage.get(canonicalSkillKey(skill))!.covered;
  const stated = new Set([...candidate.statedSkills, ...candidate.stack].map(canonicalSkillKey));
  const ineligibilityReasons: MatchEligibilityReason[] = [];
  const ranking = rankingEvidence(candidate, need);

  if (candidate.demoMode !== poolDemoMode) ineligibilityReasons.push("pool");
  if (!candidate.consentMatching) ineligibilityReasons.push("consent");
  if (candidate.visibility === "private") ineligibilityReasons.push("visibility");
  if (candidate.specialization !== need.specialization) {
    ineligibilityReasons.push("specialization");
  }
  if (!evaluateGradeRequirement(need.grade,need.gradeMode,candidate).satisfied) {
    ineligibilityReasons.push("grade");
  }
  if (!hasMeaningfulRequiredSkills(need.requiredSkills) || !requiredSkills.every(satisfiesRequirement)) {
    ineligibilityReasons.push("required_skills");
  }

  const verifiedSkillMatch =
    allRequirements.length === 0
      ? 1
      : allRequirements.filter(coversRequirement).length /
        allRequirements.length;
  const relevantAssessmentEvidence = ranking.qualityScore === null ? null : ranking.qualityScore / 100;
  const statedContextFit = formatFits(candidate.workFormat, need.workFormat)
    ? 1
    : 0.5;
  const freshness = freshnessForNeed(candidate.latestAssessmentAt, now);
  ranking.freshnessBand = freshness.band;
  const salaryCompatibility = compareSalaryCompatibility(need, candidate);
  const factors: MatchFactor[] = [
    {
      name: "Подтверждённое покрытие навыков",
      score: verifiedSkillMatch,
      weight: 0.625, scope: 'shared_fit',
    },
    {
      name: "Результат сопоставимой проверки",
      score: relevantAssessmentEvidence,
      weight: 0, scope: 'within_comparable_group',
    },
    { name: "Контекст работы", score: statedContextFit, weight: 0.1875, scope: 'shared_fit' },
    { name: "Свежесть свидетельств", score: freshness.score, weight: 0.0625, scope: 'shared_fit' },
    { name: "Совместимость зарплатных условий", score: salaryCompatibility === 'unknown' ? null : salaryCompatibility === 'compatible' ? 1 : 0, weight: 0.125, scope: 'shared_fit' },
  ];
  // Raw test quality is exclusively a within-group ordering input. Unknown
  // salary is excluded, not a fictional mismatch or a qualification penalty.
  const shared = factors.filter(factor => factor.scope === 'shared_fit' && factor.score !== null);
  const knownWeight = shared.reduce((total, factor) => total+factor.weight, 0);
  for (const factor of factors) factor.effectiveWeight = factor.scope !== 'shared_fit' || factor.score === null ? 0 : factor.weight/knownWeight;
  // Canonical shared precision removes IEEE-754 ulp differences between
  // mathematically equal factor sums (e.g. a perfect unknown-salary profile
  // and a perfect compatible-salary profile). Raw test scores stay untouched.
  const exactBaseScore = Number((100*shared.reduce((total,factor) => total+factor.score!*factor.weight,0)/knownWeight).toFixed(10));
  ranking.businessFitScore = exactBaseScore;
  const baseScore = Math.round(exactBaseScore);
  const fspBonus = fspBonusForSignal(candidate.fspSignal, candidate.demoMode);
  const fspSignal = compactFspSignal(fspBonus ? candidate.fspSignal! : candidate.fspSignal?.historyStatus === 'unresolved_results' ? candidate.fspSignal : emptyFspSignal(candidate.hasFspHistory || candidate.fspSignal?.historyStatus === 'unverified'));
  const evidence: MatchEvidence[] = allRequirements.map((requirement) => {
    const result = coverage.get(canonicalSkillKey(requirement))!;
    const confirmed = result.verified;
    const selfReported = stated.has(canonicalSkillKey(requirement));
    const provenance = result.provenance;
    const source = confirmed
      ? provenance?.sourceType === 'signal_skill_module' ? `Проверка ${provenance.skill} · ${provenance.level ?? ''}` : provenance?.sourceType === "signal_assessment" ? "Проверка навыков Signal"
        : provenance?.sourceType === "demo_example" || candidate.demoMode ? "Demo · синтетический пример"
          : provenance?.sourceType === "company_task" ? "Задание компании"
            : provenance?.sourceType === "fsp" ? "Данные ФСП"
              : "Сохранённое подтверждение · подробный протокол отсутствует"
      : selfReported ? "Самоописание кандидата" : "Нет источника";
    return {
      requirement, skillId: resolveSkill(requirement).id,
      evidence: confirmed ? `Подтверждённый навык: ${requirement}${result.verifiedLevel?` · ${result.verifiedLevel}`:''}` : selfReported ? "Навык указан кандидатом, но не подтверждён" : "Данных для проверки пока нет",
      source, provenance,
      date: confirmed ? provenance?.date ?? (candidate.latestAssessmentAt && Number.isFinite(candidate.latestAssessmentAt.getTime()) ? candidate.latestAssessmentAt.toISOString() : null) : null,
      status: confirmed ? "verified" : selfReported ? "stated" : "unchecked",
      requirementMode: result.mode, satisfied: result.covered, reason: result.reason,
    };
  });
  const strengths = allRequirements.filter(coversRequirement);
  const gaps = [
    ...allRequirements.filter(skill=>!satisfiesRequirement(skill)&&coverage.get(canonicalSkillKey(skill))!.verified).map(skill=>{
      const result=coverage.get(canonicalSkillKey(skill))!;
      return `${skill}: ${result.reason}`;
    }),
    ...allRequirements.filter(skill=>!satisfiesRequirement(skill)&&!coverage.get(canonicalSkillKey(skill))!.verified&&!stated.has(canonicalSkillKey(skill))),
    ...allRequirements.filter(skill=>!satisfiesRequirement(skill)&&!coverage.get(canonicalSkillKey(skill))!.verified&&stated.has(canonicalSkillKey(skill))).map(skill=>`${skill} (указан кандидатом, не подтверждён)`),
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
    fspSignal,
    scoreScope: 'shared_need_fit',
    // Compatibility field now shares the base need-fit scale; the local FSP
    // effect is not a universal percentage or cross-category quality score.
    rankingScore: exactBaseScore,
    ranking,
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
