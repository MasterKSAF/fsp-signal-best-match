/** Independent tiny retention controls. No database, API, processes or load. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { FreshJsonPoolCache } from '../artifacts/api-server/src/lib/signal-fresh-pool-cache';
import { FreshRankingCache } from '../artifacts/api-server/src/lib/signal-fresh-ranking-cache';
import type { CatalogResume } from '../artifacts/api-server/src/lib/signal-resume-catalog';
import type { MatchEvaluation } from '../artifacts/api-server/src/lib/signal-matching';

const checks:string[]=[];
{
  const cache=new FreshJsonPoolCache<number>(2,256,'independent_tiny_raw',0);
  const loads:Record<string,number>={};
  const read=(key:string)=>cache.read('raw',key,async()=>{loads[key]=(loads[key]??0)+1;return {fingerprint:key,data:Array.from({length:10},(_,i)=>i)};});
  await read('A');await read('B');await read('A');await read('C');
  assert.equal(loads.A,1);assert.equal(loads.B,1);assert.equal(loads.C,1);
  await read('A');assert.equal(loads.A,1,'Recently used A must remain');
  await read('B');assert.equal(loads.B,2,'Least recently used B must be read again');
  assert.equal(cache.diagnostics().entries,2);assert.ok(cache.diagnostics().retainedEstimatedBytes<=256);
  checks.push('Two raw entries preserve recently used content and reload an evicted key instead of returning another snapshot');
}
{
  const cache=new FreshJsonPoolCache<number>(2,50,'independent_tiny_budget',0);
  let loads=0;
  const read=()=>cache.read('raw','too-large',async()=>{loads++;return {fingerprint:'too-large',data:Array.from({length:50},(_,i)=>i)};});
  const first=await read(),second=await read();
  assert.deepEqual(first,second);assert.notEqual(first,second);assert.equal(loads,2);assert.equal(cache.diagnostics().entries,0);
  assert.ok(Object.isFrozen(first),'An oversized result must remain safe even though it is not retained');
  checks.push('Oversized raw content remains correct and frozen but is reloaded, showing retention is separate from the live result');
}
{
  // These are cache-mechanics fixtures, not qualification or scoring fixtures.
  const row=(resumeId:number)=>({resumeId,userId:resumeId}) as CatalogResume;
  const evaluation={baseScore:1} as MatchEvaluation;
  const cache=new FreshRankingCache(2,4096);
  const a=row(1),b=row(2);let computedB=0;
  const firstA=cache.read('full-current-A',[a],()=>[{candidate:a,evaluation,alternatives:[a]}]);
  cache.read('full-current-B',[b],()=>{computedB++;return [{candidate:b,evaluation,alternatives:[b]}];});
  assert.equal(cache.diagnostics().entries,2);
  const aJson=JSON.stringify([{resumeId:1,title:'A'.repeat(1700)}]);
  assert.equal(cache.serialize(firstA,()=>aJson),aJson);
  assert.equal(cache.diagnostics().facetStores,1);
  assert.equal(cache.diagnostics().entries,1,'Professional JSON can displace the second compact ranking inside the shared byte budget');
  const secondB=cache.read('full-current-B',[b],()=>{computedB++;return [{candidate:b,evaluation,alternatives:[b]}];});
  assert.equal(computedB,2,'Evicted B must recompute');
  assert.equal(cache.serialize(secondB,()=>JSON.stringify([{resumeId:2,title:'Current B'}])),JSON.stringify([{resumeId:2,title:'Current B'}]));
  let aRebuilt=0;
  assert.equal(cache.serialize(firstA,()=>{aRebuilt++;return aJson;}),aJson);
  assert.equal(aRebuilt,1,'A result weak-key may outlive eviction; it must build its own body, not borrow B JSON');
  assert.ok(cache.diagnostics().retainedEstimatedBytes<=4096);
  checks.push('Professional JSON shares the ranking budget, evicts the other key safely, and an old result weak-key never returns another key body');
}
const paths=['artifacts/api-server/src/lib/signal-fresh-pool-cache.ts','artifacts/api-server/src/lib/signal-fresh-ranking-cache.ts','scripts/performance-cache-retention-independent-review.ts'];
const sourceHashes=Object.fromEntries(await Promise.all(paths.map(async path=>[path,createHash('sha256').update(await readFile(path)).digest('hex')])));
const report={passed:true,measuredAt:new Date().toISOString(),checks,sourceHashes,limits:'Three tiny behavioral retention controls only. Diagnostics report estimated retained bytes, not native heap, all SQL work or active request memory; no database, HTTP, garbage-collector assertion or performance SLA.'};
await mkdir('outputs/verification/assessment-purpose',{recursive:true});
const output='outputs/verification/assessment-purpose/performance-cache-retention-independent-review.json';
try{const previous=await readFile(output);await mkdir('outputs/verification/assessment-purpose/history',{recursive:true});await writeFile(`outputs/verification/assessment-purpose/history/retention-review-${createHash('sha256').update(previous).digest('hex').slice(0,12)}.json`,previous,{flag:'wx'});}catch(error:any){if(!['ENOENT','EEXIST'].includes(error.code))throw error;}
await writeFile(output,JSON.stringify(report,null,2));
console.log(JSON.stringify({passed:true,groups:checks.length,output}));
