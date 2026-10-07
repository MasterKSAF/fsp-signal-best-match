import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { competitiveCandidates, competitiveDataset, COMPETITIVE_FROZEN_SHA256 } from '../artifacts/api-server/src/lib/matching-competitive-fixtures';
import { competitiveMetrics, runCompetitiveMatchingQuality, aliasStressNeed } from '../artifacts/api-server/src/lib/matching-competitive-quality';
import { compareRankedMatches, rankMatches, evaluateMatch } from '../artifacts/api-server/src/lib/signal-matching';

test('new explicit AI control is frozen, scenario-split and genuinely competitive', () => {
  const dataset = competitiveDataset();
  const freeze = JSON.parse(readFileSync(new URL('../outputs/quality/matching-competitive-freeze.json',import.meta.url),'utf8'));
  assert.equal(freeze.fileSha256, COMPETITIVE_FROZEN_SHA256);
  assert.equal(createHash('sha256').update(readFileSync(new URL('../artifacts/api-server/src/lib/matching-competitive-data.json',import.meta.url))).digest('hex'),COMPETITIVE_FROZEN_SHA256);
  const pools = dataset.queries.filter(q=>q.kind==='competitive');
  assert.equal(pools.length,6);
  assert.deepEqual(pools.map(q=>q.expectedEligibleIds.length),[14,12,12,16,14,12]);
  assert.equal(pools.filter(q=>q.split==='development').length,3);
  assert.equal(pools.filter(q=>q.split==='control-holdout').length,3);
  assert.equal(new Set(dataset.queries.flatMap(q=>q.populationIds)).size,128);
  assert.equal(dataset.candidates.length,128);
  assert.match(String(dataset.rubric.provenance),/AI-authored synthetic/);
  for(const q of dataset.queries) {
    assert.ok(q.expectedEligibleIds.every(id=>q.privacyPermittedIds.includes(id)));
    assert.equal(Object.keys(q.relevanceLabels).length,q.populationIds.length);
    assert.ok(q.expectedEligibleIds.every(id=>q.relevanceLabels[String(id)]>=1));
  }
});

test('P@5, recall and nDCG keep short and empty denominators explicit', () => {
  const labels = {'1':4,'2':2,'3':1};
  const perfect = competitiveMetrics([1,2,3],labels,[1,2,3]);
  assert.equal(perfect.precisionAt5,2/5);
  assert.equal(perfect.precisionAt5Denominator,5);
  assert.equal(perfect.ndcgAt5,1);
  assert.equal(perfect.relevantRecallAt5,1);
  const reversed = competitiveMetrics([3,2,1],labels,[1,2,3]);
  const expected = (1 + 3/Math.log2(3) + 15/2)/(15 + 3/Math.log2(3) + 1/2);
  assert.ok(Math.abs(reversed.ndcgAt5!-expected)<1e-12);
  const empty = competitiveMetrics([],{},[]);
  assert.equal(empty.precisionAt5,0);
  assert.equal(empty.ndcgAt5,null);
  assert.equal(empty.admissionRecall,null);
  assert.equal(empty.relevantRecallAt5,null);
  assert.equal(empty.actualEmpty,true);
  assert.equal(empty.unexpectedEmpty,false);
});

test('competitive report uses production total order and remains stable after input permutations', () => {
  const dataset = competitiveDataset();
  const candidates = competitiveCandidates(dataset);
  const report = runCompetitiveMatchingQuality();
  for(const query of dataset.queries) {
    const entries = candidates.filter(c=>query.populationIds.includes(c.userId)).map(candidate=>({candidate,evaluation:evaluateMatch(query.need,candidate,true,new Date(dataset.evaluatedAt))})).filter(x=>x.evaluation.eligible);
    const expected = report.byQuery.find(q=>q.queryId===query.id)!.methods.signal.runtimeRanking;
    const normal = rankMatches(entries).map(x=>x.candidate.userId);
    const reverse = rankMatches([...entries].reverse()).map(x=>x.candidate.userId);
    const rotated = rankMatches([...entries.slice(3),...entries.slice(0,3)]).map(x=>x.candidate.userId);
    assert.deepEqual(normal,expected);
    assert.deepEqual(reverse,expected);
    assert.deepEqual(rotated,expected);
    // Total order over every admitted triple prevents conditional-group cycles.
    const ordered = rankMatches(entries);
    for(let i=0;i<ordered.length;i++)for(let j=i+1;j<ordered.length;j++)for(let k=j+1;k<ordered.length;k++) {
      assert.ok(compareRankedMatches(ordered[i],ordered[j])<0);
      assert.ok(compareRankedMatches(ordered[j],ordered[k])<0);
      assert.ok(compareRankedMatches(ordered[i],ordered[k])<0);
    }
  }
});

test('explicit competitive admission labels detect forbidden score100 profiles separately from privacy', () => {
  const report = runCompetitiveMatchingQuality();
  assert.equal(report.summary.admission.pairs,128);
  assert.equal(report.summary.admission.expectedEligible,87);
  assert.equal(report.summary.admission.permittedNegative,21);
  assert.equal(report.summary.admission.hidden,20);
  assert.deepEqual(report.summary.admission.falseExclusions,[]);
  assert.deepEqual(report.summary.admission.falseAdmissions,[]);
  assert.deepEqual(report.summary.admission.privacyViolations,[]);
  assert.equal(report.summary.methods.signal.ndcgAt5.undefined,1);
  assert.equal(report.summary.methods.signal.ndcgAt5.total,9);
  assert.ok(report.byQuery.every(q=>!q.methods.signal.endToEnd.unexpectedEmpty));
  assert.equal(report.humanValidation.status,'not_measured');
});

test('frozen sensitivity controls notice quality removal, reverse/random order and alias regression', () => {
  const report = runCompetitiveMatchingQuality();
  assert.ok(Object.values(report.diagnostics.checks).every(Boolean));
  assert.ok(report.diagnostics.aliasRegressionFalseExclusions.length>0);
  assert.ok(report.summary.methods['without-test-result'].ndcgAt5.value!<report.summary.methods.signal.ndcgAt5.value!);
  // Equivalence stress uses production admission and never obtains new labels.
  const dataset = competitiveDataset();
  const candidates = competitiveCandidates(dataset);
  for(const q of dataset.queries)for(const c of candidates.filter(c=>q.populationIds.includes(c.userId))) {
    assert.equal(evaluateMatch(q.need,c,true,new Date(dataset.evaluatedAt)).eligible,evaluateMatch(aliasStressNeed(q.need),c,true,new Date(dataset.evaluatedAt)).eligible);
  }
});

test('all baselines share admission and all per-query losses/nulls are retained', () => {
  const report = runCompetitiveMatchingQuality();
  for(const q of report.byQuery) {
    const expected = [...q.methods.signal.runtimeRanking].sort((a,b)=>a-b);
    for(const method of Object.values(q.methods)) assert.deepEqual([...method.runtimeRanking].sort((a,b)=>a-b),expected);
  }
  assert.equal(report.comparisons.oldV3.length,9);
  assert.equal(report.comparisons.keywordBaseline.length,9);
  assert.equal(report.comparisons.oldV3.filter(q=>q.ndcgAt5===null).length,1);
  assert.equal(report.comparisons.oldV4.length,9);
  const historical=JSON.parse(readFileSync(new URL('../outputs/quality/matching-competitive-v1-report.json',import.meta.url),'utf8'));
  assert.ok(historical.comparisons.oldV3.some((q:{ndcgAt5:number|null})=>q.ndcgAt5!==null&&q.ndcgAt5<0));
  assert.equal(report.strata.split.length,2);
  assert.equal(report.strata.fsp.length,2);
  assert.equal(report.strata.provenance.length,2);
});
