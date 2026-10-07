import test from 'node:test';
import assert from 'node:assert/strict';
import { runTraceabilityRegression } from '../scripts/evaluate-traceability-regression-historical-v050';

test('QA01b regression retains original pools and detects the prior fixed-ID counterexamples',()=>{
  const report=runTraceabilityRegression();
  assert.equal(report.originalCases.length,3);
  assert.ok(report.checks.originalInputsAndLabelsUntouched);
  assert.ok(report.checks.originalFixedIdsImprove);
  assert.ok(report.checks.detectsBeforeDefect);
  assert.ok(report.originalCases.some((row:any)=>row.pairs.some((pair:any)=>!pair.before.passed)));
  assert.ok(report.originalCases.every((row:any)=>row.pairs.every((pair:any)=>pair.after.passed)));
});
test('QA01b generic business fit stays primary while equal-fit complete provenance improves order',()=>{
  const report=runTraceabilityRegression();
  assert.ok(report.checks.genericBusinessCasesPass);
  assert.ok(report.checks.aliasReversalInvariant);
  assert.ok(report.checks.originalUnknownRemainsNullAndAdmitted);
  const fit=report.newCases.find((row:any)=>row.caseId==='business-fit-before-traceability-fsp')!;
  assert.deepEqual(fit.after,[880001,880002]);
  assert.equal(fit.states.find((row:any)=>row.candidateId===880001)!.qualityScore,null);
  const proof=report.newCases.find((row:any)=>row.caseId==='equal-fit-full-proof-before-legacy-fsp')!;
  assert.deepEqual(proof.after,[880010,880011]);
  assert.equal(proof.states.find((row:any)=>row.candidateId===880011)!.qualityScore,null);
});
test('QA01b FSP effect stays bounded within comparable quality and positive at equal quality',()=>{
  const report=runTraceabilityRegression();
  assert.equal(report.newCases.length,4);
  assert.deepEqual(report.newCases.find((row:any)=>row.caseId==='comparable100-before83-with-fsp')!.after,[880031,880030]);
  assert.deepEqual(report.newCases.find((row:any)=>row.caseId==='fsp-positive-at-equal-fit-complete-proof-result')!.after,[880020,880021]);
  assert.equal(report.boundaryTimingCorrection.status,'authored-semantic-regression-after-patch-before-first-boundary-measurement');
  assert.equal(report.humanValidation.status,'not_measured');assert.equal(report.humanValidation.participants,0);
});
