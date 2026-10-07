import assert from 'node:assert/strict';
import test from 'node:test';
import { aggregateResearchReport, exportResearchAnswer, researchReport, type ResearchMeasurement } from '../artifacts/api-server/src/lib/research-report';

const row = (pseudonym: string, form: 'A' | 'B', score: number, verified: boolean, grade = 'Middle'): ResearchMeasurement => ({
  pseudonym, form, independentGrade: grade, programVersion: 'frozen-example-v1', status: 'submitted', startedAt: new Date('2026-10-05T10:00:00Z'), submittedAt: new Date('2026-10-05T10:02:00Z'),
  result: { score, verified, evidence: ['Python', 'API'].map(skill => ({ skill, score, criterionId: 'contract', templateId: 'contract.v1', templateVersion: 1, programVersion: 'frozen-example-v1' })) },
  responses: [{ caseId: 'q1', answer: '42', activeMs: 30000, skipped: false, ambiguous: form === 'B', firstSavedAt: '2026-10-05T10:01:00Z', lastSavedAt: '2026-10-05T10:01:00Z' }],
});

test('research: no sample means not measured and null, never fake human or perfect rates', () => {
  const report = researchReport([], 'Middle');
  assert.equal(report.status, 'not_measured'); assert.equal(report.humanValidation, 'not_measured');
  assert.equal(report.agreementAB, null); assert.equal(report.scoreChangeBMinusA, null);
  assert.equal(report.independentReference.thresholdAgreement, null); assert.equal(report.expertReview.exactAgreement, null);
  assert.equal(report.timing.serverElapsedMs, null); assert.equal(report.timing.clientReportedActiveMs, null);
});
test('research: manually specified A/B decisions, independent groups and reviewers have exact expected metrics', () => {
  // Expected values are hand-counted, independent of bank generation and grading.
  const rows = [row('P-a', 'A', 90, true), row('P-a', 'B', 80, false), row('P-b', 'A', 100, true, 'Senior'), row('P-b', 'B', 90, true, 'Senior')];
  const experts = [
    { reviewerId: 'external-1', ratings: [{ pseudonym: 'P-a', grade: 'Junior', comment: 'independent basis one' }, { pseudonym: 'P-b', grade: 'Senior', comment: 'independent basis two' }] },
    { reviewerId: 'external-2', ratings: [{ pseudonym: 'P-a', grade: 'Middle', comment: 'a different independent basis' }, { pseudonym: 'P-b', grade: 'Senior', comment: 'independent basis three' }] },
  ];
  const report = researchReport(rows, 'Middle', experts);
  assert.equal(report.agreementAB, .5); assert.equal(report.scoreChangeBMinusA, -10);
  assert.deepEqual(report.transitions, { 'Middle→not_confirmed': 1, 'Middle→Middle': 1 });
  assert.equal(report.independentReference.thresholdAgreement, .75);
  assert.equal(report.items.length, 2); assert.equal(report.items[0]!.n, 2, 'two skill evidences must not double the item sample');
  assert.ok(Math.abs(report.items[0]!.meanCredit! - .85) < 1e-12); assert.equal(report.items[1]!.fullSuccessRate, .5);
  assert.equal(report.expertReview.exactAgreement, .5); assert.equal(report.expertReview.disagreements.length, 1);
  assert.equal(report.expertReview.byReviewer[0]!.thresholdAgreement, .75);
  assert.equal(report.timing.serverElapsedMs, 120000); assert.equal(report.timing.clientReportedActiveMs, 30000);
  assert.equal(report.ambiguous, 2); assert.equal(report.humanValidation, 'not_measured');
  assert.equal(report.groupCounts.Senior!.participants, 1);
  assert.equal(report.groupDifferences.length, 1); assert.ok(Math.abs(report.groupDifferences[0]!.meanCreditHigherMinusLower - .1) < 1e-12);
  assert.equal(report.groupDifferences[0]!.fullSuccessHigherMinusLower, .5);
  const aggregate = aggregateResearchReport(report);
  assert.doesNotMatch(JSON.stringify(aggregate), /P-a|P-b|external-1|independent basis|pseudonym|reviewerId/);
  assert.equal(aggregate.expertReview.disagreementCount, 1);
});
test('research: incomplete pairs and expired attempts do not become A/B observations', () => {
  const pending = { ...row('P-b', 'B', 90, true), status: 'expired', result: null, submittedAt: null };
  const report = researchReport([row('P-a', 'A', 90, true), pending], 'Middle');
  assert.equal(report.counts.completed, 1); assert.equal(report.counts.expired, 1); assert.equal(report.counts.paired, 0);
  assert.equal(report.agreementAB, null); assert.deepEqual(report.transitions, {});
});
test('research: export removes arbitrary text, numeric contact identifiers and unknown option text', () => {
  assert.deepEqual(exportResearchAnswer('42|ok|false'), { tokens: ['42', 'ok', 'false'], redacted: false });
  for (const unsafe of ['name@example.test', '+79991234567', '79991234567', 'John Smith', 'contact: hello']) assert.equal(exportResearchAnswer(unsafe).redacted, true);
  assert.deepEqual(exportResearchAnswer('second', ['first', 'second']), { choiceIndex: 1, indexBase: 0, redacted: false });
  assert.deepEqual(exportResearchAnswer('name@example.test', ['first']), { choiceIndex: null, indexBase: 0, redacted: true });
});

