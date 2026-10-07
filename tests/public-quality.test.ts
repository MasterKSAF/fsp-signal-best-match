import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from '../artifacts/api-server/node_modules/express/index.js';
import { createQualityRouter } from '../artifacts/api-server/src/routes/signal-quality';
import { loadPublicQualityReport, qualityDigest, verifyQualityManifest } from '../artifacts/api-server/src/lib/public-quality';

const hash = 'a'.repeat(64);
const metric = (value: number | null, defined: number, undefinedCount: number, numerator: number | null = null, denominator: number | null = null) => ({
  value, defined, undefined: undefinedCount, total: defined + undefinedCount, numerator, denominator, aggregation: 'macro mean of defined queries',
});
function manifest() {
  const current = [{id:'synthetic-3:qa',title:'Synthetic control',datasetVersion:'synthetic-3',datasetSha256:'b'.repeat(64),
    algorithmVersion:'algorithm-qa',algorithmSha256:hash,evaluatorVersion:'evaluator-qa',evaluatorSha256:'c'.repeat(64),sourceReportSha256:'d'.repeat(64),
    measuredAt:'2026-10-06T00:00:00.000Z',measurementNotice:'Saved actual measurement',evaluationClock:'2026-10-05T00:00:00.000Z',
    annotationSource:'AI-authored synthetic labels; not human',labelProvenance:'Frozen synthetic judgements',splitPolicy:'2 competitive / 1 empty',k:5,relevantAtLeast:2,
    precisionDenominator:'five per query',ndcgGain:'2^relevance - 1',humanValidation:{status:'not_measured',participants:0,expertReviewers:0,notice:'No human research'},
    slices:[{id:'all',label:'All three',queries:3,admission:{pairs:12,expectedEligible:8,falseExclusions:0,permittedNegative:2,falseAdmissions:0,privacyExcluded:2,privacyViolations:0},
      methods:[{method:'signal',label:'Signal',precisionAt5:metric(8/15,3,0,8,15),ndcgAt5:metric(.9,2,1),relevantRecallAt5:metric(.8,2,1),relevantRecallAll:metric(1,2,1),unexpectedEmpty:0}]}],
    limitations:['Synthetic only; real hiring not measured']}];
  const content = {schemaVersion:'signal-public-quality-v1',aggregateVersion:'qa-fixture',builtAt:'2026-10-06T00:01:00.000Z',current,history:[]};
  return {...content,sha256:qualityDigest(content)};
}
function seal(value: ReturnType<typeof manifest>) { const {sha256:_sha,...content}=value; return {...content,sha256:qualityDigest(content)}; }
function withFile<T>(value: unknown, callback: (path: string) => T): T {
  const folder=mkdtempSync(join(tmpdir(),'signal-quality-'));
  try { const path=join(folder,'public.json');writeFileSync(path,JSON.stringify(value));return callback(path); }
  finally { rmSync(folder,{recursive:true,force:true}); }
}
const load = (path: string, overrides = {}) => loadPublicQualityReport({aggregatePath:path,algorithmVersion:'algorithm-qa',algorithmSha256:hash,renderedAt:new Date('2026-10-06T02:00:00Z'),...overrides});

test('public aggregate preserves measurement time, render time and own metric denominators', () => {
  const value=manifest();assert.doesNotThrow(()=>verifyQualityManifest(value));
  withFile(value,path=>{
    const report=load(path);assert.equal(report.status,'current');assert.equal(report.current[0].measuredAt,'2026-10-06T00:00:00.000Z');
    assert.equal(report.renderedAt.toISOString(),'2026-10-06T02:00:00.000Z');
    const methods=report.current[0].slices[0].methods;
    assert.deepEqual([methods[0].precisionAt5.numerator,methods[0].precisionAt5.denominator],[8,15]);
    assert.deepEqual([methods[0].ndcgAt5.defined,methods[0].ndcgAt5.undefined,methods[0].ndcgAt5.total],[2,1,3]);
    assert.equal(report.current[0].humanValidation.status,'not_measured');
  });
});
test('changed algorithm version OR bytes moves old results to explicitly historical state', () => withFile(manifest(),path=>{
  for(const overrides of [{algorithmVersion:'algorithm-next'},{algorithmSha256:'e'.repeat(64)}]) {
    const report=load(path,overrides);assert.equal(report.status,'stale');assert.equal(report.current.length,0);assert.equal(report.history.length,1);
  }
}));
test('missing, corrupt, checksum mismatch and private unknown fields cannot show current metrics', () => {
  const absent=load(join(tmpdir(),'signal-quality-absent-'+Date.now()+'.json'));assert.equal(absent.status,'missing');assert.deepEqual(absent.current,[]);
  const corrupt=manifest();corrupt.current[0].slices[0].methods[0].ndcgAt5.value=.7;
  withFile(corrupt,path=>assert.equal(load(path).status,'invalid'));
  const leaked={...manifest(),answerKeys:['never-public'],rawWorks:[{email:'private@example.invalid'}]};
  withFile(leaked,path=>{const report=load(path);assert.equal(report.status,'invalid');assert.equal(JSON.stringify(report).includes('private@example'),false);});
  const nested=manifest() as ReturnType<typeof manifest> & {private?: unknown};
  (nested.current[0] as unknown as Record<string,unknown>).answerKeys=['private'];
  withFile(seal(nested),path=>assert.equal(load(path).status,'invalid'));
});
test('signed wrong denominator or invented zero for undefined metric is rejected', () => {
  const wrong=manifest();wrong.current[0].slices[0].methods[0].precisionAt5.denominator=14;
  assert.throws(()=>verifyQualityManifest(seal(wrong)),/denominator/);
  const undefinedAsZero=manifest();Object.assign(undefinedAsZero.current[0].slices[0].methods[0].ndcgAt5,metric(0,0,3));
  assert.throws(()=>verifyQualityManifest(seal(undefinedAsZero)),/denominator/);
});
test('historical unknown wall-clock and hashes remain null; cannot become current', () => {
  const value=manifest();value.current[0].measuredAt=null as unknown as string;value.current[0].algorithmSha256=null as unknown as string;
  assert.throws(()=>verifyQualityManifest(seal(value)),/provenance/);
  const historical={...value,current:[],history:value.current};
  withFile(seal(historical as ReturnType<typeof manifest>),path=>{const report=load(path);assert.equal(report.status,'missing');assert.equal(report.history[0].measuredAt,null);});
});
test('both public HTTP endpoints serialize the same safe DTO without DB or authentication', async () => {
  const folder=mkdtempSync(join(tmpdir(),'signal-quality-http-'));const path=join(folder,'public.json');writeFileSync(path,JSON.stringify(manifest()));
  const app=express();app.use('/api',createQualityRouter(()=>load(path)));
  const server=app.listen(0,'127.0.0.1');
  try {
    await new Promise<void>(resolve=>server.once('listening',resolve));
    const address=server.address();assert.ok(address&&typeof address==='object');
    let previous: unknown;
    for(const endpoint of ['report','evaluation']) {
      const response=await fetch(`http://127.0.0.1:${address.port}/api/quality/${endpoint}`);
      assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
      const report=await response.json();assert.equal(report.status,'current');assert.equal(report.schemaVersion,'signal-public-quality-v1');
      if(previous)assert.deepEqual(report,previous);previous=report;
    }
  } finally {await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));rmSync(folder,{recursive:true,force:true});}
});
test('deployed public aggregate matches runtime or honestly marks stale; no fixture payload keys', () => {
  const report=loadPublicQualityReport();assert.ok(['current','stale','missing'].includes(report.status));
  const output=JSON.stringify(report);
  for(const key of ['populationIds','expectedEligibleIds','pairRows','rawWorks','answerKeys','runtimeRanking','successfulAttempts','scores']) assert.equal(output.includes('"'+key+'":'),false,key);
  const client=readFileSync('artifacts/fsp-signal/src/components/public-quality-page.tsx','utf8');
  assert.equal(client.includes('matching-competitive-data'),false);assert.equal(client.includes('КАЛИБР'),false);
});
