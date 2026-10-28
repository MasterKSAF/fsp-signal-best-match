import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMatchingFactorLedger } from '../artifacts/api-server/src/lib/matching-factor-ledger';
import { evaluateMatch } from '../artifacts/api-server/src/lib/signal-matching';
import { MATCH_CONTROL_CANDIDATES, MATCH_CONTROL_QUERIES } from '../artifacts/api-server/src/lib/matching-control-fixtures';
const versions = { algorithm: 'test', contextRevision: 2, resumeId: 1, resumeRevision: 3, evidenceFingerprint: 'fixture' };
test('S02 unknown salary is excluded and exact contributions reproduce actual match policy', () => {
  for (const query of MATCH_CONTROL_QUERIES) for (const candidate of MATCH_CONTROL_CANDIDATES) {
    const result = evaluateMatch(query.need, { ...candidate, resumeId: 5, resumeRevision: 9 }, candidate.demoMode, new Date('2026-10-10'));
    const ledger = result.factorLedger!;
    assert.ok(Math.abs(ledger.factors.reduce((sum, f) => sum + f.contribution, 0) - result.rankingScore) < 1e-8);
    assert.deepEqual(ledger.factors.filter(f => f.scope === 'shared_fit').map(f => f.weight), [0.625, 0.1875, 0.0625, 0.125]);
    assert.equal(ledger.factors[0].versions.resumeId, 5);
    if (result.salaryCompatibility === 'unknown') { const salary = ledger.factors.find(f => f.factorId === 'salary_compatibility')!; assert.equal(salary.state, 'unknown'); assert.equal(salary.effectiveWeight, 0); }
    assert.equal(ledger.factors.find(f => f.factorId === 'comparable_assessment_quality')!.contribution, 0);
    assert.equal(ledger.fspIncluded, false);
  }
});
test('S02 missing data is explicit; normalization and one-factor sensitivity are mathematical', () => {
  const input = { factorId: 'a', name: 'A', reason: 'fixture', score: null, weight: 0.5, scope: 'shared_fit' as const };
  assert.equal(buildMatchingFactorLedger([input], versions).state, 'insufficient_data');
  assert.equal(buildMatchingFactorLedger([input], versions).exactScore, null);
  const a = buildMatchingFactorLedger([{ ...input, score: 1 }, { ...input, factorId: 'b', score: 0 }], versions);
  const b = buildMatchingFactorLedger([{ ...input, score: 1 }, { ...input, factorId: 'b', score: 0.2 }], versions);
  assert.equal(a.exactScore, 50); assert.equal(b.exactScore, 60);
  assert.equal(buildMatchingFactorLedger([...a.factors].reverse(), versions).exactScore, a.exactScore);
});
