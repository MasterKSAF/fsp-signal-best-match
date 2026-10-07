import assert from 'node:assert/strict';
import test from 'node:test';
import { QualificationStartBody, QualificationSaveBody, QualificationSubmitBody, qualificationBasis } from '../artifacts/api-server/src/lib/assessment-purpose.ts';
import { assembleManagedAttempt } from '../artifacts/api-server/src/lib/assessment-managed.ts';
import { getResumeQualification, type ResumeQualificationAttempt } from '../artifacts/api-server/src/lib/signal-resume-qualification.ts';
import { snapshotForNeed } from '../artifacts/api-server/src/lib/assessment-context.ts';

const request = { purpose: 'signal_qualification', gradeConfirmed: true, programId: 'backend-python', grade: 'Middle', resumeId: 17 };
test('exam start requires candidate confirmation and refuses company purpose, forged authority, version or context', () => {
  assert.equal(QualificationStartBody.safeParse(request).success, true);
  const { gradeConfirmed: _confirmed, ...unconfirmed } = request;
  const { purpose: _purpose, ...ambiguous } = request;
  for (const body of [unconfirmed, ambiguous, { ...request, gradeConfirmed: false }, { ...request, purpose: 'company_task' },
    ...['programVersion', 'demoMode', 'overviewDemo', 'reviewMode', 'reviewScopeId', 'verifiedGrade', 'targetGrade', 'userId', 'skipCooldown', 'score'].map(key => ({ ...request, [key]: 'forged' })),
    { ...request, contextId: 'api-platform', invitationId: 8 }, { ...request, contextId: 'unknown' }, { ...request, resumeId: 2147483648 }, { ...request, invitationId: 2147483648 }]) {
    assert.equal(QualificationStartBody.safeParse(body).success, false, JSON.stringify(body));
  }
});
test('save and submit cannot relabel the saved attempt or select another program/version/grade', () => {
  assert.equal(QualificationSaveBody.safeParse({ answers: [{ caseId: 'case-1', answer: '12' }], resumeId: 17 }).success, true);
  assert.equal(QualificationSubmitBody.safeParse({ resumeId: 17 }).success, true);
  for (const key of ['purpose', 'programId', 'programVersion', 'grade', 'gradeConfirmed', 'demoMode', 'reviewScopeId', 'contextId', 'invitationId', 'resumeSpecialization']) {
    assert.equal(QualificationSaveBody.safeParse({ answers: [], [key]: 'forged' }).success, false, key);
    assert.equal(QualificationSubmitBody.safeParse({ [key]: 'forged' }).success, false, key);
  }
  assert.equal(QualificationSaveBody.safeParse({ answers: [{ caseId: 'case-1', answer: '12', score: 100 }] }).success, false);
});
test('invited qualification preserves vacancy context while declared candidate level remains independent', () => {
  const snapshot = snapshotForNeed({ title: 'Senior API engineer', description: 'REST API and outbox', specialization: 'Backend / Python', grade: 'Senior', requiredSkills: ['Python', 'SQL', 'Redis'], desirableSkills: [] }, 'Junior');
  assert.equal(snapshot.targetGrade, 'Junior'); assert.equal(snapshot.vacancyGrade, 'Senior');
  assert.equal(snapshot.source, 'invitation'); assert.deepEqual(snapshot.unsupportedRequirements, ['Redis']);
  assert.match(snapshot.reason, /кандидатом уровень Junior/);
});
test('company or unknown-origin rows cannot award platform grade or even skill evidence despite a full copied form', () => {
  const form = assembleManagedAttempt('backend-python', 'Senior', 'purpose-guard');
  const attempt = { id: 7, userId: 17, resumeId: 9, resumeRevision: 1, resumeSpecialization: 'Backend / Python', programId: 'backend-python', programVersion: 'signal-backend-python-v6',
    grade: 'Senior', purpose: 'company_task', purposeOrigin: 'legacy_signal_bank', gradeConfirmedAt: null, status: 'submitted', ...form,
    answers: form.cases.map(item => ({ caseId: item.id, answer: form.oracles[item.id]!.answer })), score: 100, verified: true, gradeChanged: true,
    startedAt: new Date('2026-10-01T09:00:00Z'), dueAt: new Date('2026-10-01T09:45:00Z'), submittedAt: new Date('2026-10-01T09:20:00Z') } as ResumeQualificationAttempt;
  for (const purpose of ['company_task', 'legacy_unknown'] as const) {
    const row = { ...attempt, purpose };
    const qualification = getResumeQualification({ userId: 17, specialization: 'Backend / Python', legacyQualification: null }, [row]);
    assert.equal(qualification.verifiedGrade, null); assert.deepEqual(qualification.evidence, []); assert.equal(qualificationBasis(row), null);
  }
  const legacyBank = { ...attempt, purpose: 'signal_qualification' as const };
  assert.equal(getResumeQualification({ userId: 17, specialization: 'Backend / Python', legacyQualification: null }, [legacyBank]).verifiedGrade, 'Senior');
  assert.equal(qualificationBasis(legacyBank)!.gradeConfirmedAt, null);
  assert.equal(qualificationBasis(legacyBank)!.confirmationOrigin, 'legacy_unrecorded');
  const confirmed = { ...legacyBank, purposeOrigin: 'candidate_confirmed' as const, gradeConfirmedAt: legacyBank.startedAt };
  assert.equal(qualificationBasis(confirmed)!.confirmationOrigin, 'candidate_confirmed');
  assert.equal(qualificationBasis(confirmed)!.gradeConfirmedAt, '2026-10-01T09:00:00.000Z');
});
