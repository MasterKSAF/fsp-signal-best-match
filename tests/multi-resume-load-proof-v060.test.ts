import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
// @ts-expect-error bounded runtime-only audit helper
import {validateFullLoadProof} from '../scripts/lib/multi-resume-load-proof-v060.mjs';
const historical=JSON.parse(readFileSync('outputs/verification/multi-resume/load-comparison-cf5f76e84655.json','utf8'));
// Artificial guard input: historical metrics are NOT reclassified as current acceptance.
const fixture=()=>({...structuredClone(historical),applicationVersion:'0.6.0',target:{...historical.target,key:'dedicated-v060'}});
test('v060 reported-facts guard retains every original fixture/latency/error/telemetry/cleanup bound',()=>{
  assert.equal(validateFullLoadProof(fixture()).people,5000);
  for(const mutate of [(r:any)=>r.fixture.measuredSeconds=30,(r:any)=>r.expanded.execution.warmupSeconds=5,(r:any)=>r.expanded.results.matching.errors=1,(r:any)=>r.baseline.results.pdf.p95Ms=2000.01,(r:any)=>r.expanded.results.explanation.p99Ms=5000.01,(r:any)=>r.expanded.before.attempts=25000,(r:any)=>r.cleanup.remainingUsers=1,(r:any)=>r.expanded.peakAppMemoryBytes=1073741825]){const report=fixture();mutate(report);assert.throws(()=>validateFullLoadProof(report));}
});
test('v060 audit rejects history, diagnostic binary, changed fixture SHA and a different PID between phases',()=>{
  for(const mutate of [(r:any)=>r.applicationVersion='0.5.0',(r:any)=>r.target.key='dedicated-v1',(r:any)=>r.runtimeIdentity.runtimeKind='custom-diagnostic',(r:any)=>r.fixtureHash='0'.repeat(64),(r:any)=>r.expanded.samples.forEach((row:any)=>row.Id++)]){const report=fixture();mutate(report);assert.throws(()=>validateFullLoadProof(report));}
});
