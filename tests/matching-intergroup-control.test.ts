import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { loadIntergroupDataset, intergroupMetrics, runIntergroupControl, INTERGROUP_CONTROL_SHA256, INTERGROUP_METHODS } from '../scripts/evaluate-intergroup-control';

test('QA01 independent business fixture remains frozen before measured v5 changes',()=>{
  const dataset=loadIntergroupDataset();
  const freeze=JSON.parse(readFileSync(new URL('../outputs/quality/qa-cycle-01/intergroup-control-freeze.json',import.meta.url),'utf8'));
  assert.equal(freeze.fileSha256,INTERGROUP_CONTROL_SHA256);
  assert.equal(createHash('sha256').update(readFileSync(new URL('../outputs/quality/qa-cycle-01/intergroup-control-v1.json',import.meta.url))).digest('hex'),INTERGROUP_CONTROL_SHA256);
  assert.equal(dataset.queries.length,8);
  assert.equal(dataset.queries.reduce((n,q)=>n+q.candidates.length,0),96);
  assert.ok(dataset.queries.every(q=>q.candidates.length===12));
  assert.equal(dataset.queries.filter(q=>q.split==='development').length,3);
  assert.equal(dataset.queries.filter(q=>q.split==='control-holdout').length,5);
  assert.equal(freeze.oldAlgorithmSha256AtFreeze,'8e8dca055c3a0deb9485bb215f70fa44fb61357e7a42e1234d40b67f684564a9');
  assert.equal(createHash('sha256').update(readFileSync(new URL('../artifacts/api-server/src/lib/matching-v4-frozen.ts',import.meta.url))).digest('hex'),freeze.oldAlgorithmSha256AtFreeze);
  assert.match(String(dataset.rubric.provenance),/independently authored synthetic business/);
  for(const query of dataset.queries) {
    assert.equal(Object.keys(query.relevanceLabels).length,12);
    assert.equal(Object.keys(query.labelReasons).length,12);
    assert.equal(query.expectedEligibleIds.length,12);
    assert.ok(Object.values(query.relevanceLabels).every(label=>Number.isInteger(label)&&label>=0&&label<=4));
  }
});

test('QA01 independent metrics preserve short and null denominators, without perfection fill',()=>{
  const metric=intergroupMetrics([1,2,3],{'1':4,'2':2,'3':1},[1,2,3]);
  assert.equal(metric.precisionAt5,2/5);assert.equal(metric.precisionAt5Denominator,5);
  assert.equal(metric.ndcgAt5,1);assert.equal(metric.relevantRecallAt5,1);
  const empty=intergroupMetrics([],{},[]);
  assert.equal(empty.precisionAt5,0);assert.equal(empty.ndcgAt5,null);assert.equal(empty.relevantRecallAt5,null);
  const reversed=intergroupMetrics([3,2,1],{'1':4,'2':2,'3':1},[1,2,3]);
  assert.ok(Math.abs(reversed.ndcgAt5!-(1+3/Math.log2(3)+15/2)/(15+3/Math.log2(3)+1/2))<1e-12);
});

test('QA01 new pool order is permutation stable, opaque-ID invariant and ordinal transitive',()=>{
  const report=runIntergroupControl();
  assert.deepEqual(Object.entries(report.metamorphic.checks).filter(([,passed])=>!passed),[]);
  assert.equal(report.metamorphic.byQuery.reduce((n,q)=>n+q.permutations.cases,0),24);
  assert.equal(report.metamorphic.byQuery.reduce((n,q)=>n+q.transitivity.triples,0),1760);
  assert.equal(report.metamorphic.byQuery.reduce((n,q)=>n+q.transitivity.violations,0),0);
});

test('QA01 comparable result improves order without importing an unavailable profile score',()=>{
  const report=runIntergroupControl();
  const quality=report.metamorphic.quality;
  assert.ok(quality.ranking.indexOf(quality.higherId)<quality.ranking.indexOf(quality.lowerId));
  assert.equal(report.metamorphic.unknownQuality.length,4);
  assert.ok(report.metamorphic.unknownQuality.every(row=>row.profileScore===99&&row.qualityScore===null&&row.qualityStatus==='not_measured'));
  assert.ok(report.diagnostics.qualityRemovalChangesTop5);assert.ok(report.diagnostics.qualityRemovalLowersNdcg);
  assert.ok(report.diagnostics.reverseLowersNdcg);assert.ok(report.diagnostics.randomLowersNdcg);
});

test('QA01 all methods keep same admitted population and reports retain every loss and raw annotation',()=>{
  const report=runIntergroupControl();
  assert.equal(report.summary.admission.pairs,96);assert.equal(report.summary.admission.expectedEligible,96);
  assert.deepEqual(report.summary.admission.falseExclusions,[]);assert.deepEqual(report.summary.admission.falseAdmissions,[]);
  assert.equal(report.summary.admission.privacyNegativeDenominator,0);assert.equal(report.summary.admission.privacyViolationRate,null);
  assert.equal(report.comparisons.oldV4.length,8);
  for(const query of report.byQuery) {
    const population=[...query.expectedEligibleIds].sort((a,b)=>a-b);
    for(const method of INTERGROUP_METHODS)assert.deepEqual([...query.methods[method].runtimeRanking].sort((a,b)=>a-b),population);
    assert.equal(query.pairRows.length,12);assert.ok(query.pairRows.every(row=>row.labelReason.length>10));
    const delta=report.comparisons.oldV4.find(row=>row.queryId===query.queryId)!;
    assert.equal(report.beforeAfterLosses.some(row=>row.queryId===query.queryId),delta.ndcgAt5!==null&&delta.ndcgAt5<0);
  }
  assert.equal(report.humanValidation.status,'not_measured');assert.equal(report.humanValidation.participants,0);
});
