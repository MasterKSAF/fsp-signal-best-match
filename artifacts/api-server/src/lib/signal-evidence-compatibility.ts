/**
 * Versioned content policy, not a dictionary/fuzzy skill match.
 * A resume reuses the ORIGINAL criterion and earned level. It does not claim
 * that an older exam was sat against a newer rubric or upgrade its program.
 */
export const EVIDENCE_COMPATIBILITY_VERSION = "signal-evidence-compatibility-v2";
export type EvidenceGrade = "Junior" | "Middle" | "Senior";
export type EvidenceProgramId = "backend-python" | "frontend-typescript";

const criteria = {
  "backend-python": {
    "api-contracts": ["Python", "API contracts"], "sql-data": ["SQL"],
    "incident-diagnosis": ["Incident diagnosis"], idempotency: ["Python", "Idempotency"],
    architecture: ["Architecture"], "condition-change": ["Replay safety"],
  },
  "frontend-typescript": {
    typescript: ["TypeScript"], "frontend-state": ["Frontend state"],
    accessibility: ["Accessibility"], "frontend-performance": ["Frontend performance"],
    "frontend-architecture": ["Frontend architecture"], "async-ui": ["Async UI"],
  },
} as const;

export const EVIDENCE_PROGRAMS = [
  { id: "backend-python", specialization: "Backend / Python", versions: ["kalibr-backend-python-v4", "signal-backend-python-v5", "signal-backend-python-v6", "signal-backend-python-v7"] },
  { id: "frontend-typescript", specialization: "Frontend / TypeScript", versions: ["signal-frontend-typescript-v1", "signal-frontend-typescript-v2", "signal-frontend-typescript-v3"] },
] as const;

export type EvidenceCompatibilityRule = {
  id: string; sourceProgramId: EvidenceProgramId; sourceProgramVersion: string;
  sourceCriterionId: string; sourceGrade: EvidenceGrade;
  targetProgramId: EvidenceProgramId; targetCriterionId: string;
  equivalence: "same_original_criterion"; gradeEffect: "none"; rationale: string;
};

/** All current rules are identity rules for a recorded, validated criterion.
 * There is NO published cross-program equivalence between the current banks.
 * In particular SQL != PostgreSQL, Python != TypeScript, and backend event
 * replay != frontend async UI. Those skills need their own supported exam.
 */
export const EVIDENCE_COMPATIBILITY_RULES: readonly EvidenceCompatibilityRule[] = Object.freeze(
  EVIDENCE_PROGRAMS.flatMap(program => program.versions.flatMap(version =>
    Object.keys(criteria[program.id]).flatMap(criterionId => (["Junior", "Middle", "Senior"] as const).map(grade => Object.freeze({
      id: `${EVIDENCE_COMPATIBILITY_VERSION}:${version}:${grade}:${criterionId}`,
      sourceProgramId: program.id, sourceProgramVersion: version, sourceCriterionId: criterionId,
      sourceGrade: grade, targetProgramId: program.id, targetCriterionId: criterionId,
      equivalence: "same_original_criterion" as const, gradeEffect: "none" as const,
      rationale: "То же исходное проверенное умение и уровень в собственной программе. Версия, рубрика и дата источника сохраняются; это не подтверждение новой версии или полного грейда другого направления.",
    }))),
  )),
);

export function evidenceProgramForSpecialization(specialization: string): EvidenceProgramId | null {
  return EVIDENCE_PROGRAMS.find(program => program.specialization === specialization)?.id ?? null;
}

export function criterionSkillsForSource(programId: string, version: string, criterionId: string, grade: EvidenceGrade): readonly string[] {
  const rule = EVIDENCE_COMPATIBILITY_RULES.find(row => row.sourceProgramId === programId && row.sourceProgramVersion === version && row.sourceCriterionId === criterionId && row.sourceGrade === grade);
  if (!rule) return [];
  return (criteria[rule.sourceProgramId] as Readonly<Record<string, readonly string[]>>)[criterionId] ?? [];
}

export type EvidenceCompatibilityDecision = {
  applied: boolean; reasonCode: "compatible" | "different_program" | "unsupported_specialization" | "unreviewed_criterion";
  reason: string; compatibilityRuleId: string | null; nextStep: string | null;
};

export function resolveCriterionCompatibility(source: { programId: string; programVersion: string; criterionId: string; grade: EvidenceGrade }, targetSpecialization: string): EvidenceCompatibilityDecision {
  const targetProgramId = evidenceProgramForSpecialization(targetSpecialization);
  if (!targetProgramId) return { applied: false, reasonCode: "unsupported_specialization", compatibilityRuleId: null,
    reason: "Подтверждение сохранено. Для этого направления нет поддерживаемой программы квалификации Signal.",
    nextStep: "Выберите поддерживаемое направление или сохраните это подтверждение как историю исходной программы." };
  const rule = EVIDENCE_COMPATIBILITY_RULES.find(row => row.sourceProgramId === source.programId && row.sourceProgramVersion === source.programVersion && row.sourceCriterionId === source.criterionId && row.sourceGrade === source.grade && row.targetProgramId === targetProgramId);
  if (rule) return { applied: true, reasonCode: "compatible", reason: rule.rationale, compatibilityRuleId: rule.id, nextStep: null };
  if (source.programId !== targetProgramId) return { applied: false, reasonCode: "different_program", compatibilityRuleId: null,
    reason: "Подтверждение сохранено в аккаунте. Эквивалентность этого критерия с программой выбранного направления не установлена; одинакового названия навыка недостаточно. Весь грейд между программами не переносится.",
    nextStep: "Пройдите квалификационный экзамен Signal выбранного направления. Исходный результат останется в истории." };
  return { applied: false, reasonCode: "unreviewed_criterion", compatibilityRuleId: null,
    reason: "Подтверждение сохранено, но для этой версии, критерия и уровня нет проверенного правила совместимости.",
    nextStep: "Пройдите поддерживаемую программу или дождитесь содержательной проверки совместимости." };
}
