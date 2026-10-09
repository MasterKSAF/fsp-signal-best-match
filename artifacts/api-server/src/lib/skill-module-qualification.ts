import type { SkillCategorySnapshot, SkillLevel, signalSkillEvidenceTable } from '@workspace/db';
import { canonicalSkillKey, resolveSkill } from './skill-catalog';
import { middleOutcomeSkillBankVersions, seniorOutcomeSkillBankVersions, SENIOR_SKILL_RUBRIC_VERSION, supportedSkillBankVersions, skillModuleLabel, skillModuleRegistry } from './skill-module-bank';

export const SKILL_MATRIX_VERSION = 'signal-category-competency-matrix-v2';
export const skillLevelRank = { Junior: 1, Middle: 2, Senior: 3 } as const;
export type SkillModuleEvidence = typeof signalSkillEvidenceTable.$inferSelect;
export type SkillQualificationTarget = { userId: number; specialization: string; assumedGrade: SkillLevel; stack: readonly string[]; skills: readonly string[] };
export type SkillQualificationInputs = { evidence: SkillModuleEvidence[]; revokedIds: ReadonlySet<number> };
export type SkillEvidenceProjection = { skillId: string; label: string; level: SkillLevel; evidenceId: number; attemptId: number; programVersion: string; verifiedAt: string };
export type SkillCoverage = { id: string; label: string; skillId: string | null; level: SkillLevel; covered: boolean; evidenceId: number | null; reason: string };
export type SkillQualification = { verifiedGrade: SkillLevel | null; verifiedScore: null; verifiedSkills: string[]; skills: SkillEvidenceProjection[]; coverage: SkillCoverage[]; missing: string[]; category: SkillCategorySnapshot | null; source: 'skill_matrix'; limitation: string | null; latestAssessmentAt: Date | null };
const supported = (specialization: string) => specialization === 'Backend / Python' || specialization === 'Frontend / TypeScript';
const rawSkillId = (value: string) => resolveSkill(value).id ?? value.toLowerCase().trim();
function validEvidence(value: SkillModuleEvidence, target: SkillQualificationTarget, revokedIds: ReadonlySet<number>) {
  const module = skillModuleRegistry.find(m => m.id === value.skillId);
  const middleCoverage = value.level !== 'Middle' || !(middleOutcomeSkillBankVersions as readonly string[]).includes(value.programVersion) || module?.competencies.every((competencyId, c) => value.decision.levelCoverage?.some(v => v.requirementId === `${value.skillId}:middle-outcome-v2:${c + 1}` && v.passed === value.decision.competencies.find(x => x.id === competencyId)?.passed && (!(c === 0 || c === 5) || v.passed))) && value.decision.levelCoverage?.length === 6 && (value.decision.levelCoverage?.filter(v => v.passed).length ?? 0) >= 5;
  const seniorCoverage = value.level !== 'Senior' || Boolean(module && (seniorOutcomeSkillBankVersions as readonly string[]).includes(value.programVersion) && value.decision.rubricVersion === SENIOR_SKILL_RUBRIC_VERSION && value.decision.competencies.length === 6 && new Set(value.decision.competencies.map(c => c.id)).size === 6 && value.decision.levelCoverage?.length === 6 && new Set(value.decision.levelCoverage.map(c => c.requirementId)).size === 6 && module.competencies.every((competencyId, c) => {
    const competence = value.decision.competencies.find(x => x.id === competencyId);
    const critical = module.seniorCriticalCompetencies.includes(competencyId);
    return competence && competence.critical === critical && value.decision.levelCoverage!.some(v => v.requirementId === `${value.skillId}:senior-outcome-v1:${c + 1}` && v.passed === competence.passed) && (!critical || competence.passed) && (!competence.passed || value.competencyIds.includes(competencyId));
  }) && value.decision.competencies.filter(c => c.passed).length >= 5 && value.decision.score === Math.round(100 * value.decision.competencies.filter(c => c.passed).length / 6));
  return value.userId === target.userId && !revokedIds.has(value.id) && (supportedSkillBankVersions as readonly string[]).includes(value.programVersion) && middleCoverage && seniorCoverage && value.decision.passed && value.decision.criticalComplete && module?.availableLevels.includes(value.level) && module.competencies.every(id => value.decision.competencies.some(c => c.id === id)) && module.competencies.filter(id => value.competencyIds.includes(id)).length >= 5;
}
export function selectAccountSkillEvidence(target: SkillQualificationTarget, inputs: SkillQualificationInputs): SkillEvidenceProjection[] {
  const best = new Map<string, SkillModuleEvidence>();
  for (const evidence of inputs.evidence.filter(e => validEvidence(e, target, inputs.revokedIds))) {
    const previous = best.get(evidence.skillId);
    if (!previous || skillLevelRank[evidence.level] > skillLevelRank[previous.level] || evidence.level === previous.level && (evidence.verifiedAt > previous.verifiedAt || +evidence.verifiedAt === +previous.verifiedAt && evidence.id > previous.id)) best.set(evidence.skillId, evidence);
  }
  return [...best.values()].map(e => ({ skillId: e.skillId, label: skillModuleLabel(e.skillId), level: e.level, evidenceId: e.id, attemptId: e.attemptId, programVersion: e.programVersion, verifiedAt: e.verifiedAt.toISOString() })).sort((a, b) => a.skillId.localeCompare(b.skillId));
}
export function skillRequirementCovered(requirement: { skill: string; level?: SkillLevel | null }, evidence: readonly SkillEvidenceProjection[]) {
  const canonical = canonicalSkillKey(requirement.skill);
  return evidence.some(e => (canonicalSkillKey(e.label) === canonical || rawSkillId(requirement.skill) === e.skillId) && (!requirement.level || skillLevelRank[e.level] >= skillLevelRank[requirement.level]));
}
/** Individual proofs belong to the account; category coverage belongs to this
 * exact CV's role, declared stack and target grade. Neither substitutes for the other. */
export function getSkillQualification(target: SkillQualificationTarget, inputs: SkillQualificationInputs): SkillQualification {
  const allSkills = selectAccountSkillEvidence(target, inputs);
  const declared = new Set([...target.stack, ...target.skills].map(rawSkillId));
  // Removing a CV tag or changing role does not revoke an account-owned proof.
  // Only the requirements below use declarations to choose this CV's category.
  const skills = allSkills;
  const empty = (reason: string): SkillQualification => ({ verifiedGrade: null, verifiedScore: null, verifiedSkills: skills.map(s => s.label), skills, coverage: [], missing: [reason], category: null, source: 'skill_matrix', limitation: reason, latestAssessmentAt: null });
  if (!supported(target.specialization)) return empty('Программа общей квалификации для этой специализации пока не подготовлена.');
  const requirements = (level: SkillLevel): { id: string; label: string; alternatives: string[] }[] => target.specialization === 'Backend / Python' ? [
    { id: 'language', label: 'Язык серверного стека: Python или TypeScript', alternatives: ['python', 'typescript'].filter(id => declared.has(id)) },
    { id: 'data', label: 'SQL и работа с данными', alternatives: ['sql'] },
    { id: 'engineering', label: 'Контракты, надёжность, безопасность и интеграция Backend', alternatives: ['backend-engineering'] },
  ] : [
    { id: 'language', label: 'TypeScript', alternatives: ['typescript'] },
    { id: 'framework', label: 'React', alternatives: declared.has('react') ? ['react'] : [] },
    { id: 'engineering', label: 'Состояние, доступность и интеграция Frontend', alternatives: ['frontend-engineering'] },
  ];
  function coverageFor(level: SkillLevel): SkillCoverage[] {
    return requirements(level).map(r => {
      const proof = allSkills.find(e => r.alternatives.includes(e.skillId) && skillLevelRank[e.level] >= skillLevelRank[level]);
      return { id: r.id, label: r.label, skillId: proof?.skillId ?? r.alternatives[0] ?? null, level, covered: !!proof, evidenceId: proof?.evidenceId ?? null,
        reason: proof ? 'Подтверждено самостоятельной совместимой проверкой.' : !r.alternatives.length ? 'Выбранный стек не поддерживает эту обязательную компетенцию; укажите поддержанный стек либо дождитесь его программы.' : `Нужна проверка ${r.alternatives.map(skillModuleLabel).join(' или ')} уровня ${level}.` };
    });
  }
  let grade: SkillLevel | null = null; let used: SkillCoverage[] = [];
  for (const level of ['Junior', 'Middle', 'Senior'] as const) {
    if (skillLevelRank[level] > skillLevelRank[target.assumedGrade]) continue;
    const coverage = coverageFor(level); if (coverage.every(c => c.covered)) { grade = level; used = coverage; }
  }
  const coverage = coverageFor(target.assumedGrade);
  const category: SkillCategorySnapshot | null = grade ? { matrixVersion: SKILL_MATRIX_VERSION, specialization: target.specialization, grade, targetGrade: target.assumedGrade,
    requirements: used.map(c => { const e = allSkills.find(e => e.evidenceId === c.evidenceId)!; return { id: c.id, skillId: e.skillId, level: grade!, evidenceId: e.evidenceId, attemptId: e.attemptId, programVersion: e.programVersion, verifiedAt: e.verifiedAt }; }) } : null;
  const latest = category ? Math.max(...category.requirements.map(c => Date.parse(c.verifiedAt))) : null;
  return { verifiedGrade: grade, verifiedScore: null, verifiedSkills: skills.map(s => s.label), skills, coverage, missing: coverage.filter(c => !c.covered).map(c => c.reason), category, source: 'skill_matrix', limitation: category ? null : 'Общая категория подтверждается только при закрытии всех обязательных компетенций.', latestAssessmentAt: latest === null ? null : new Date(latest) };
}
