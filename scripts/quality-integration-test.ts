import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { loadPublicQualityReport } from '../artifacts/api-server/src/lib/public-quality';

const base = process.env.QA_QUALITY_BASE_URL;
if (!base) throw new Error('QA_QUALITY_BASE_URL must name the isolated rebuilt app explicitly');
const expected = JSON.parse(JSON.stringify(loadPublicQualityReport()));
assert.equal(expected.status, 'current', 'Generate stable current aggregate before built HTTP verification');
const checks: Array<{id:string;passed:boolean;detail:string}> = [];
const check = (id: string, detail: string, run: () => void) => { run(); checks.push({id,passed:true,detail}); };
const responses = await Promise.all(['report','evaluation'].map(async endpoint => {
  const response=await fetch(`${base}/api/quality/${endpoint}`);
  assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
  return response.json();
}));
const actual=responses[0];
const withoutRenderingTime = ({renderedAt:_time,...report}: typeof actual) => report;
check('both-endpoints-safe-current','Both rebuilt runtime endpoints return the same current DTO; request rendering time is excluded from comparison',()=>{
  assert.deepEqual(withoutRenderingTime(responses[0]),withoutRenderingTime(responses[1]));assert.equal(actual.status,'current');
});
check('exact-deployed-aggregate','Runtime algorithm SHA and aggregate SHA, actual measurements and all aggregate bytes match expected safe data',()=>{
  assert.deepEqual(withoutRenderingTime(actual),withoutRenderingTime(expected));
});
check('current-and-historical-separated','Current controls differ from explicitly historical v4 competitive and legacy eight-query controls',()=>{
  assert.equal(actual.current.length,2);assert.equal(actual.history.length,2);
  assert.ok(actual.current.every((report: any)=>report.algorithmVersion===actual.runtimeAlgorithmVersion));
  assert.ok(actual.history.every((report: any)=>report.algorithmVersion!==actual.runtimeAlgorithmVersion));
  const legacy=actual.history.find((report: any)=>report.id==='historical-small-control-v1');
  assert.equal(legacy.measuredAt,null);assert.equal(legacy.algorithmSha256,null);
});
check('explicit-slices-denominators','Every slice/method preserves query-specific defined/undefined counts and P@5 numerator/denominator; pools never merge silently',()=>{
  for(const report of actual.current) {
    for(const id of ['all','kind-competitive','kind-short','kind-empty','split-development','split-control-holdout']) assert.ok(report.slices.some((slice:any)=>slice.id===id));
    for(const slice of report.slices)for(const method of slice.methods)for(const name of ['precisionAt5','ndcgAt5','relevantRecallAt5','relevantRecallAll']) {
      const metric=method[name];assert.equal(metric.total,slice.queries);assert.equal(metric.defined+metric.undefined,metric.total);
      if(metric.denominator!==null)assert.equal(metric.denominator,5*slice.queries);
    }
  }
});
check('empty-is-null','The existing empty competitive-control query contributes 0/5 P@5 but undefined nDCG, not an invented perfect score',()=>{
  const empty=actual.current.find((r:any)=>r.datasetVersion.includes('competitive')).slices.find((s:any)=>s.id==='kind-empty');
  assert.equal(empty.queries,1);for(const m of empty.methods){assert.equal(m.ndcgAt5.value,null);assert.equal(m.ndcgAt5.undefined,1);assert.equal(m.precisionAt5.value,0);assert.equal(m.precisionAt5.denominator,5);}
});
check('zero-privacy-denominator','Ranking-only intergroup control records zero negative privacy examples; it cannot claim measured 0% risk',()=>{
  const intergroup=actual.current.find((r:any)=>r.datasetVersion.includes('intergroup'));assert.ok(intergroup);
  const all=intergroup.slices.find((s:any)=>s.id==='all');assert.equal(all.admission.privacyExcluded,0);assert.equal(all.admission.privacyViolations,0);
  assert.ok(intergroup.limitations.some((text:string)=>text.includes('privacy-negative')));
});
check('actual-time-and-synthetic-labels','Actual saved measurement timestamps and independent synthetic label provenance remain separate from current render time; no people or experts claimed',()=>{
  for(const report of actual.current) {
    assert.ok(report.measuredAt!==actual.renderedAt);assert.equal(report.humanValidation.status,'not_measured');
    assert.equal(report.humanValidation.participants,0);assert.equal(report.humanValidation.expertReviewers,0);
    assert.match(report.annotationSource,/AI/);
  }
});
check('no-private-data','Public payload contains aggregate counts only; raw fixture identities, ranks, answers, keys and research works are absent',()=>{
  const json=JSON.stringify(actual);for(const key of ['populationIds','expectedEligibleIds','pairRows','rawWorks','answerKeys','runtimeRanking','successfulAttempts','scores','candidateId','answers']) assert.equal(json.includes('"'+key+'":'),false,key);
  assert.equal(json.includes('КАЛИБР'),false);
});
await mkdir('outputs/verification',{recursive:true});
const report={id:'qa-cycle-01-quality-http',checkedAt:new Date().toISOString(),passed:true,groups:checks.length,
  baseUrl:base,image:process.env.QA_TESTED_IMAGE??'not_recorded_by_runner',algorithmVersion:actual.runtimeAlgorithmVersion,algorithmSha256:actual.runtimeAlgorithmSha256,
  aggregateSha256:actual.aggregateSha256,aggregateFileSha256:createHash('sha256').update(await readFile('artifacts/api-server/src/lib/quality-public-report.json')).digest('hex'),
  checks,limitations:['Real rebuilt HTTP response verified; this runner does not establish browser rendering, human research or real hiring accuracy.','Missing/stale/invalid states are exercised separately in source unit/HTTP regression tests.']};
await writeFile('outputs/verification/qa-cycle-01-quality-http.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({passed:true,groups:checks.length,aggregateSha256:actual.aggregateSha256}));
