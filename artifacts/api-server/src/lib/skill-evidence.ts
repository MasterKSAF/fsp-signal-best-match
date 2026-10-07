import { and, eq } from 'drizzle-orm';
import { db, signalAssessmentAttemptsTable as attempts, signalAssessmentCorrectionsTable as corrections } from '@workspace/db';
import { scoreAttempt } from './assessment-bank';
import { canonicalSkillKey } from './skill-catalog';
import type { MatchCandidate, SafeSkillEvidence } from './signal-matching';

const criterionSkills: Record<string, string[]> = {
  'API-контракты': ['API contracts'], 'SQL и данные': ['SQL'],
  'Диагностика инцидента': ['Incident diagnosis'], 'Идемпотентность': ['Idempotency'],
  'Выбор архитектуры': ['Architecture'], 'Изменение условия': ['Replay safety'],
};
/** Private server read. Return a whitelist, never cases, answers, or oracle keys. */
export async function loadSkillEvidence(candidate: Pick<MatchCandidate, 'userId' | 'verifiedGrade' | 'verifiedSkills' | 'specialization' | 'latestAssessmentAt' | 'demoMode'>): Promise<SafeSkillEvidence[]> {
  const legacy = (skill: string): SafeSkillEvidence => ({ skill, candidateId: candidate.userId, attemptId: null, programId: null, programVersion: null, templateId: null, templateVersion: null, criterionId: null, criterion: null, result: null, date: candidate.latestAssessmentAt?.toISOString() ?? null, sourceType: candidate.demoMode ? 'demo_example' : 'legacy_record', limitation: 'В сохранённой записи нет связи с критерием попытки. Новые сведения ей не приписываются.' });
  if (!candidate.latestAssessmentAt || !candidate.verifiedGrade) return candidate.verifiedSkills.map(legacy);
  // Exact timestamp + grade ties the proof to the decision that populated this
  // profile. A later failed or lower-grade attempt cannot refresh this evidence.
  const [attempt] = await db.select().from(attempts).where(and(eq(attempts.userId, candidate.userId), eq(attempts.verified, true), eq(attempts.grade, candidate.verifiedGrade), eq(attempts.submittedAt, candidate.latestAssessmentAt))).limit(1);
  if (!attempt || !(candidate.specialization === 'Backend / Python' ? attempt.programId.includes('backend-python') : candidate.specialization === 'Frontend / TypeScript' ? attempt.programId.includes('frontend-typescript') : false)) return candidate.verifiedSkills.map(legacy);
  const [correction] = await db.select({ id: corrections.id }).from(corrections).where(eq(corrections.attemptId, attempt.id)).limit(1);
  if (correction) return [];
  const evaluated = scoreAttempt(attempt.cases, attempt.oracles, attempt.answers);
  return candidate.verifiedSkills.map(skill => {
    const criterion = evaluated.evidence.find(item => item.score === 100 && [item.skill, item.criterionId ?? "", ...(criterionSkills[item.skill] ?? [])].some(label => canonicalSkillKey(label) === canonicalSkillKey(skill)));
    const isProgram = canonicalSkillKey(skill) === canonicalSkillKey(candidate.specialization === 'Backend / Python' ? 'Python' : 'TypeScript');
    if (!criterion && !isProgram) return legacy(skill);
    const metadata = criterion as typeof criterion & { criterionId?: string; programVersion?: string; templateId?: string; templateVersion?: string | number };
    return { skill, candidateId: candidate.userId, attemptId: attempt.id, programId: attempt.programId, programVersion: metadata?.programVersion ?? (isProgram ? evaluated.evidence[0]?.programVersion ?? null : null), templateId: metadata?.templateId ?? null, templateVersion: metadata?.templateVersion ?? null, criterionId: metadata?.criterionId ?? (isProgram ? 'programme-decision' : null), criterion: criterion?.criterion ?? 'Итоговое решение по программе и критичным критериям', result: criterion?.score ?? attempt.score, date: attempt.submittedAt!.toISOString(), sourceType: candidate.demoMode ? 'demo_example' : 'signal_assessment', limitation: metadata?.templateId || isProgram ? null : 'Историческая попытка: версия шаблона не сохранялась.' };
  });
}
