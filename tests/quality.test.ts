import test from 'node:test';
import assert from 'node:assert/strict';
import { precisionAtK, ndcgAtK, runControlEvaluation, controlQueries, EVALUATION_AT } from '../artifacts/api-server/src/lib/quality-evaluation';
import { evaluateMatch } from '../artifacts/api-server/src/lib/signal-matching';

test('ranking metrics: known perfect, reversed, missing and zero-gain examples', () => {
  const labels = { 1: 3, 2: 2, 3: 0 };
  assert.equal(precisionAtK([1, 2, 3], labels, 2), 1);
  assert.equal(precisionAtK([1], labels, 2), 0.5);
  assert.equal(ndcgAtK([1, 2, 3], labels, [1, 2, 3]), 1);
  assert.ok(ndcgAtK([3, 2, 1], labels, [1, 2, 3]) < 1);
  assert.equal(ndcgAtK([], {}, []), 0);
});
test('both rankings use the same eligible set, with no private, unverified or cross-pool candidates', () => {
  const report = runControlEvaluation();
  const queries = controlQueries();
  for (const [index, row] of report.byQuery.entries()) {
    const query = queries[index];
    for (const id of [...row.signalRanking, ...row.baselineRanking]) {
      assert.ok(evaluateMatch(query.need, query.candidates.find(candidate => candidate.userId === id)!, true, EVALUATION_AT).eligible);
    }
    assert.equal(row.eligibleCount, 10);
  }
  assert.deepEqual(report, runControlEvaluation());
  assert.equal(report.annotationSource, 'team-control');
});
