import type { signalAssessmentAttemptsTable, signalCandidateResumesTable, SignalLegacyQualification } from "@workspace/db";
import { assessmentBankVersion, isCurrentKalibrAttempt, requiredScore, scoreAttempt, type AttemptOracle } from "./assessment-bank";
import { canonicalSkillKey, canonicalSkillLabels, resolveSkill } from "./skill-catalog";
import { isQualificationAttempt } from "./assessment-purpose";
import { criterionSkillsForSource, evidenceProgramForSpecialization, resolveCriterionCompatibility } from "./signal-evidence-compatibility";

export type ResumeQualificationAttempt = typeof signalAssessmentAttemptsTable.$inferSelect;
export type ResumeQualificationTarget = Pick<typeof signalCandidateResumesTable.$inferSelect, "userId" | "specialization" | "legacyQualification">;
export type SafeResumeEvidence = {
  purpose: "signal_qualification";
  skill: string; canonicalSkillId: string; candidateId: number; attemptId: number;
  programId: string; programVersion: string; grade: "Junior" | "Middle" | "Senior";
  result: number; date: string; criterion: string; criterionId: string;
  templateId: string | null; templateVersion: number | null;
  sourceType: "signal_assessment"; limitation: string | null; practicalPassed: boolean;
};
export type ResumeQualification = {
  verifiedGrade: "Junior" | "Middle" | "Senior" | null; verifiedScore: number | null;
  verifiedSkills: string[]; latestAssessmentAt: Date | null; qualificationAttemptId: number | null;
  programVersion: string | null; source: "assessment" | "legacy" | "none";
  limitation: string | null; evidence: SafeResumeEvidence[];
  applicability: { attemptId: number; applied: boolean; reason: string; reasonCode?: string; criteria?: CriterionApplicability[] }[];
};
export type CriterionApplicability = {
  evidenceId: string; canonicalSkillId: string; criterionId: string;
  applied: boolean; selected: boolean; reason: string; reasonCode: string;
  compatibilityRuleId: string | null; nextStep: string | null;
};
const gradeLevel = { Junior: 0, Middle: 1, Senior: 2 };
export const qualificationEvidenceId = (value: Pick<SafeResumeEvidence, "attemptId" | "criterionId" | "canonicalSkillId">): string => `${value.attemptId}:${value.criterionId}:${value.canonicalSkillId}`;

type QualificationAttemptSource = { valid: false; reason: string; reasonCode: string } | {
  valid: true; version: string; score: number; verified: boolean; evidence: SafeResumeEvidence[];
  criterionDescriptions: ReadonlyMap<string, string>;
};
/** The only extractor of account criterion sources. Even revoked sources stay
 * readable to their owner, but this function never decides their application. */
export function describeQualificationAttempt(userId: number, attempt: ResumeQualificationAttempt): QualificationAttemptSource {
  if (attempt.userId !== userId || attempt.status !== "submitted" || !attempt.submittedAt) return { valid: false, reasonCode: "not_submitted", reason: "Нет завершённого результата этого аккаунта." };
  if (!isQualificationAttempt(attempt)) return { valid: false, reasonCode: "not_qualification", reason: "Задание компании или источник не установлен: не квалификационная программа Signal." };
  if (!isCurrentKalibrAttempt(attempt.cases, attempt.oracles)) return { valid: false, reasonCode: "invalid_origin", reason: "Неполное происхождение программы; исторический итог хранится отдельно." };
  const version = assessmentBankVersion(attempt.cases, attempt.oracles);
  if (attempt.programVersion && attempt.programVersion !== version) return { valid: false, reasonCode: "version_mismatch", reason: "Версия контекста не соответствует сохранённой программе." };
  const oracles = attempt.oracles as AttemptOracle;
  const first = oracles[attempt.cases[0]!.id]!.blueprint;
  const sourceProgram = first.programId ?? (version === "kalibr-backend-python-v4" ? "backend-python" : null);
  if (sourceProgram !== attempt.programId || first.grade !== attempt.grade || attempt.resumeSpecialization && evidenceProgramForSpecialization(attempt.resumeSpecialization) !== sourceProgram) return { valid: false, reasonCode: "context_mismatch", reason: "Программа, уровень или специализация контекста не соответствуют исходной рубрике." };
  const evaluated = scoreAttempt(attempt.cases, oracles, attempt.answers);
  const verified = attempt.verified === true && evaluated.score >= requiredScore(attempt.grade) && evaluated.criticalComplete;
  const evidence: SafeResumeEvidence[] = [];
  const criterionDescriptions = new Map<string, string>();
  for (const [index, result] of evaluated.evidence.entries()) {
    if (result.score !== 100) continue;
    const blueprint = oracles[attempt.cases[index]!.id]!.blueprint;
    criterionDescriptions.set(blueprint.family, `${attempt.cases[index]!.family}: ${blueprint.objective}`);
    const allowed = criterionSkillsForSource(attempt.programId, version, blueprint.family, attempt.grade);
    const declared = blueprint.verifiedSkills ?? allowed;
    for (const skill of canonicalSkillLabels(declared).filter(label => allowed.some(value => canonicalSkillKey(value) === canonicalSkillKey(label)))) {
      const resolved = resolveSkill(skill); if (!resolved.id) continue;
      evidence.push({ purpose: "signal_qualification", skill, canonicalSkillId: resolved.id, candidateId: userId,
        attemptId: attempt.id, programId: attempt.programId, programVersion: version, grade: attempt.grade,
        result: 100, date: attempt.submittedAt.toISOString(), criterion: result.criterion,
        criterionId: blueprint.family, templateId: blueprint.templateId ?? null,
        templateVersion: blueprint.templateVersion ?? null, sourceType: "signal_assessment",
        limitation: blueprint.templateId ? null : "Исторический критерий: идентификатор шаблона не сохранялся.",
        practicalPassed: verified && ["structured", "integer"].includes(blueprint.responseType) });
    }
  }
  return { valid: true, version, score: evaluated.score, verified, evidence, criterionDescriptions };
}

/** Pure derivation from immutable attempts. No fresh dates, answer disclosure or sum of partial grades. */
export function getResumeQualification(target: ResumeQualificationTarget, attempts: readonly ResumeQualificationAttempt[], correctedIds: ReadonlySet<number> = new Set(), options: { includeRetainedCriteria?: boolean } = {}): ResumeQualification {
  const expectedProgram = evidenceProgramForSpecialization(target.specialization);
  const applicability: ResumeQualification["applicability"] = [];
  const measured: { attempt: ResumeQualificationAttempt; version: string; score: number; verified: boolean }[] = [];
  const evidence = new Map<string, SafeResumeEvidence>();
  for (const attempt of attempts) {
    if (attempt.userId !== target.userId || attempt.status !== "submitted" || !attempt.submittedAt) continue;
    const sameProgram = Boolean(expectedProgram && attempt.programId === expectedProgram && (!attempt.resumeSpecialization || attempt.resumeSpecialization === target.specialization));
    const reject = (reason: string, reasonCode: string, criteria?: CriterionApplicability[]) => applicability.push({ attemptId: attempt.id, applied: false, reason, reasonCode, ...(criteria ? { criteria } : {}) });
    // Existing matching callers do not need to extract other programs' private
    // source details. Owner reads opt in to retained criterion explanations.
    if (!options.includeRetainedCriteria && !sameProgram && isQualificationAttempt(attempt) && !correctedIds.has(attempt.id)) { reject("Другая специализация или программа: совпадение названия навыка не переносит квалификацию.", "different_program"); continue; }
    const source = describeQualificationAttempt(target.userId, attempt);
    if (!source.valid) { reject(source.reason, source.reasonCode); continue; }
    const revoked = correctedIds.has(attempt.id);
    const details: CriterionApplicability[] = source.evidence.map(value => {
      const decision = resolveCriterionCompatibility(value, target.specialization);
      return { evidenceId: qualificationEvidenceId(value), canonicalSkillId: value.canonicalSkillId, criterionId: value.criterionId,
        ...decision, applied: !revoked && decision.applied, selected: false,
        ...(revoked ? { reasonCode: "revoked", reason: "Результат отозван. Исходное подтверждение и дата сохранены в истории; к резюме оно больше не применяется.", nextStep: "Ознакомьтесь с причиной исправления и пройдите поддерживаемую программу при необходимости." } : {}) };
    });
    if (revoked) { reject("Результат отозван; исходная попытка сохранена.", "revoked", options.includeRetainedCriteria ? details : undefined); continue; }
    if (!sameProgram) { reject("Другая специализация или программа: совпадение названия навыка не переносит квалификацию.", "different_program", options.includeRetainedCriteria ? details : undefined); continue; }
    measured.push({ attempt, version: source.version, score: source.score, verified: source.verified });
    applicability.push({ attemptId: attempt.id, applied: true, reasonCode: "compatible", reason: `Сохранённая программа ${source.version}, ${attempt.grade}: совместимые критерии этой специализации. Грейд требует полного решения программы.`, ...(options.includeRetainedCriteria ? { criteria: details } : {}) });
    for (const value of source.evidence) {
      if (!resolveCriterionCompatibility(value, target.specialization).applied) continue;
      const key = canonicalSkillKey(value.skill);
      const previous = evidence.get(key);
      if (!previous || gradeLevel[value.grade] > gradeLevel[previous.grade] || value.grade === previous.grade && (value.date > previous.date || value.date === previous.date && value.attemptId > previous.attemptId)) evidence.set(key, value);
    }
  }
  const best = measured.filter(item => item.verified).sort((a, b) => gradeLevel[b.attempt.grade] - gradeLevel[a.attempt.grade] || b.attempt.submittedAt!.getTime() - a.attempt.submittedAt!.getTime() || b.attempt.id - a.attempt.id)[0];
  const legacy: SignalLegacyQualification | null = target.legacyQualification;
  const legacyApplicable = legacy && legacy.specialization === target.specialization && legacy.grade && !(legacy.attemptId !== null && correctedIds.has(legacy.attemptId));
  const safeEvidence = [...evidence.values()].sort((a, b) => a.canonicalSkillId.localeCompare(b.canonicalSkillId));
  if (options.includeRetainedCriteria) {
    const selectedIds = new Set(safeEvidence.map(qualificationEvidenceId));
    for (const row of applicability) for (const criterion of row.criteria ?? []) {
      criterion.selected = criterion.applied && selectedIds.has(criterion.evidenceId);
      if (criterion.applied && !criterion.selected) { criterion.reasonCode = "superseded"; criterion.reason = "Подтверждение сохранено и совместимо. Для этого навыка в резюме выбран другой исходный результат более высокого уровня либо более поздний результат того же уровня."; }
    }
  }
  if (legacyApplicable && (!best || gradeLevel[legacy!.grade!] > gradeLevel[best.attempt.grade])) {
    return { verifiedGrade: legacy!.grade, verifiedScore: legacy!.score,
      verifiedSkills: canonicalSkillLabels([...legacy!.skills, ...safeEvidence.map(item => item.skill)]),
      latestAssessmentAt: legacy!.assessedAt ? new Date(legacy!.assessedAt) : null,
      qualificationAttemptId: legacy!.attemptId, programVersion: null, source: "legacy",
      limitation: legacy!.limitation, evidence: safeEvidence, applicability };
  }
  return { verifiedGrade: best?.attempt.grade ?? null, verifiedScore: best?.score ?? null,
    verifiedSkills: safeEvidence.map(item => item.skill), latestAssessmentAt: best?.attempt.submittedAt ?? null,
    qualificationAttemptId: best?.attempt.id ?? null, programVersion: best?.version ?? null,
    source: best ? "assessment" : "none", limitation: best ? null : "Грейд не подтверждён. Пройдите полную программу выбранной специализации.",
    evidence: safeEvidence, applicability };
}
