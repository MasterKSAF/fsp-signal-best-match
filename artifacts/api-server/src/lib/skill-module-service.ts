import { createHash } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, signalSkillCategoriesTable, signalSkillCorrectionsTable, signalSkillEvidenceTable, signalAssessmentAttemptsTable, signalAssessmentCorrectionsTable, type signalCandidateResumesTable } from '@workspace/db';
import { getSkillQualification, type SkillQualificationInputs, type SkillQualificationTarget } from './skill-module-qualification';
import { getResumeQualification } from './signal-resume-qualification';
import type { SafeSkillEvidence } from './signal-matching';
import type { SkillEvidenceProjection } from './skill-module-qualification';
import { middleOutcomeSkillBankVersions, seniorOutcomeSkillBankVersions } from './skill-module-bank';
export const skillModulesEnabled = () => process.env.SIGNAL_SKILL_MODULES_ENABLED === 'true';
export function moduleMatchEvidence(userId: number, skills: readonly SkillEvidenceProjection[]): SafeSkillEvidence[] {
  return skills.map(e => ({ skill: e.label, candidateId: userId, attemptId: e.attemptId, evidenceId: e.evidenceId, level: e.level, programId: `skill:${e.skillId}`, programVersion: e.programVersion,
    templateId: null, templateVersion: null, criterionId: `module:${e.skillId}`, criterion: (seniorOutcomeSkillBankVersions as readonly string[]).includes(e.programVersion) && e.level === 'Senior' ? 'Шесть самостоятельных компетенций Senior: сложные решения, последствия и ограничения; минимум пять результатов и все критические критерии выполнены.' : (middleOutcomeSkillBankVersions as readonly string[]).includes(e.programVersion) && e.level === 'Middle' ? 'Шесть компетенций с обязательными базовыми и дополнительными Middle результатами; порог и критические критерии выполнены.' : 'Шесть компетенций по сохранённой версии программы; порог и критические критерии выполнены.', result: null, date: e.verifiedAt, sourceType: 'signal_skill_module', limitation: e.programVersion === 'signal-skills-2026-10-v1' ? 'Свидетельство исходной модульной программы v1 сохранено. Дополнительные требования v2 им не проверялись; балл не является общим баллом категории.' : 'Балл модуля не является сопоставимым общим баллом категории.' }));
}
type Reader = Pick<typeof db, 'select'>;
type Writer = Pick<typeof db, 'select' | 'insert' | 'execute'>;
export async function loadSkillQualificationInputs(userIds: readonly number[], reader: Reader = db): Promise<SkillQualificationInputs> {
  if (!skillModulesEnabled() || !userIds.length) return { evidence: [], revokedIds: new Set() };
  const evidence = await reader.select().from(signalSkillEvidenceTable).where(sql`${signalSkillEvidenceTable.userId} = any(${sql.param([...new Set(userIds)])}::int[])`);
  const corrections = evidence.length ? await reader.select({ evidenceId: signalSkillCorrectionsTable.evidenceId }).from(signalSkillCorrectionsTable).where(sql`${signalSkillCorrectionsTable.evidenceId} = any(${sql.param(evidence.map(e => e.id))}::int[])`) : [];
  return { evidence, revokedIds: new Set(corrections.map(c => c.evidenceId)) };
}
export async function skillAttemptRevocation(attemptId: number, userId: number, reader: Reader = db) {
  const [row] = await reader.select({ reason: signalSkillCorrectionsTable.reason, date: signalSkillCorrectionsTable.createdAt })
    .from(signalSkillEvidenceTable).innerJoin(signalSkillCorrectionsTable, eq(signalSkillCorrectionsTable.evidenceId, signalSkillEvidenceTable.id))
    .where(and(eq(signalSkillEvidenceTable.userId, userId), eq(signalSkillEvidenceTable.attemptId, attemptId))).limit(1);
  return row ? { reason: row.reason, date: row.date.toISOString() } : null;
}
export async function getCurrentResumeWorkspaceQualification(resume: typeof signalCandidateResumesTable.$inferSelect, reader: Reader = db) {
  const inputs = await loadSkillQualificationInputs([resume.userId], reader);
  const modular = getSkillQualification(resume, inputs);
  const attempts = await reader.select().from(signalAssessmentAttemptsTable).where(and(eq(signalAssessmentAttemptsTable.userId, resume.userId), eq(signalAssessmentAttemptsTable.status, 'submitted')));
  const corrected = attempts.length ? await reader.select({ attemptId: signalAssessmentCorrectionsTable.attemptId }).from(signalAssessmentCorrectionsTable).where(inArray(signalAssessmentCorrectionsTable.attemptId, attempts.map(a => a.id))) : [];
  const historical = getResumeQualification(resume, attempts, new Set(corrected.map(c => c.attemptId)));
  const rank = { Junior: 1, Middle: 2, Senior: 3 };
  const useModular = modular.verifiedGrade && (!historical.verifiedGrade || rank[modular.verifiedGrade] >= rank[historical.verifiedGrade]);
  return { ...modular, category: useModular ? modular.category : null, verifiedGrade: useModular ? modular.verifiedGrade : historical.verifiedGrade, source: useModular ? 'skill_matrix' : historical.source,
    limitation: useModular ? null : historical.verifiedGrade ? 'Историческая квалификация по прежней программе. Она не выдаёт новые отдельные уровни навыков.' : modular.limitation,
    verifiedSkills: [...new Set([...historical.verifiedSkills, ...modular.verifiedSkills])], historical: { verifiedGrade: historical.verifiedGrade, programVersion: historical.programVersion, attemptId: historical.qualificationAttemptId, date: historical.latestAssessmentAt?.toISOString() ?? null } };
}
/** A category is an immutable multi-evidence receipt; recomputation never edits prior receipts. */
export async function recordSkillCategory(target: SkillQualificationTarget & { id: number }, writer: Writer = db) {
  if (!skillModulesEnabled()) return null;
  const qualification = getSkillQualification(target, await loadSkillQualificationInputs([target.userId], writer));
  if (!qualification.category) return null;
  const snapshotHash = createHash('sha256').update(JSON.stringify(qualification.category)).digest('hex');
  const [certificate] = await writer.insert(signalSkillCategoriesTable).values({ userId: target.userId, resumeId: target.id, snapshotHash, snapshot: qualification.category }).onConflictDoNothing().returning();
  return certificate ?? null;
}
/** Administrative correction requires an explicit operator and reason, no suspicion-based automatic action. */
export async function correctSkillEvidence(evidenceId: number, operator: string, reason: string) {
  if (!skillModulesEnabled()) throw new Error('Skill modules are not enabled');
  if (!operator.trim() || reason.trim().length < 12) throw new Error('A named operator and a meaningful correction reason are required');
  return db.transaction(async tx => {
    const [evidence] = await tx.select().from(signalSkillEvidenceTable).where(eq(signalSkillEvidenceTable.id, evidenceId)).limit(1);
    if (!evidence) throw new Error('Evidence not found');
    await tx.execute(sql`SELECT pg_advisory_xact_lock(4410,${evidence.userId})`);
    const [correction] = await tx.insert(signalSkillCorrectionsTable).values({ evidenceId, operator: operator.trim(), reason: reason.trim(), originalDecision: evidence.decision }).onConflictDoNothing().returning();
    const { recomputeCandidateResumes } = await import('./signal-resume');
    await recomputeCandidateResumes(evidence.userId, tx);
    return { correction: correction ?? null, userId: evidence.userId };
  });
}
