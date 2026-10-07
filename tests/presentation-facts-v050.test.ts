import assert from 'node:assert/strict';
import test from 'node:test';
import {validateFullLoadProof,validateCleanSourceProof} from '../scripts/lib/presentation-facts-v050.mjs';

function fullProof(): any {
  const samples=Array.from({length:12},(_,index)=>({Id:12345,StartTime:'2026-10-06T12:00:00Z',at:new Date(Date.UTC(2026,9,6,12,0,index*17)).toISOString(),WorkingSet64:200000000+index,cpuSeconds:50+index}));
  const results=Object.fromEntries(['catalogue','matching','explanation','profile','pdf'].map(route=>[route,{requests:60,errors:0,p95Ms:100,p99Ms:200,passed:true}]));
  const phase={passed:true,datasetStable:true,sourceStable:true,telemetryStable:true,execution:{mode:'acceptance',warmupSeconds:30,measuredSeconds:180},elapsedSeconds:190,telemetryMethod:'native Windows working set; not Docker cgroup/image telemetry',samples,peakAppMemoryBytes:200000011,results,before:{resumes:5000,attempts:5000,sha256:'e'.repeat(64)},after:{resumes:5000,attempts:5000,sha256:'e'.repeat(64)}};
  const functional={catalogueTotal:5000,firstPagesDigest:'a'.repeat(64),matchingOrderDigest:'b'.repeat(64)};
  const proof={status:'PASS',executionMode:'acceptance',target:{key:'dedicated-v1',database:'signal_resume_load_check'},fixture:{people:5000,baselineResumes:1,expandedResumes:5,sessions:32,candidateSessions:16,employerSessions:16,warmupSeconds:30,measuredSeconds:180},limits:{jsonP95Ms:1500,pdfP95Ms:2000,p99Ms:5000,errors:0,minRequestsPerRoute:50,maxAppMemoryBytes:1073741824,minimumValidTelemetrySamples:12},baseline:phase,expanded:structuredClone(phase),baselineFunctional:functional,expandedFunctional:structuredClone(functional),cleanup:{status:'complete',remainingUsers:0,ownerOnly:true,error:null}};
  proof.expanded.before.resumes=25000;proof.expanded.after.resumes=25000;return proof;
}
function cleanProof(): any {
  const sourceSha256='a'.repeat(64),bundleSHA='b'.repeat(64),core='c'.repeat(64),sourceHashes={'artifacts/api-server/src/lib/signal-matching.ts':core};
  const seal={applicationVersion:'0.5.0',sourceSha256,metadata:{matchingAlgorithmSha256:core,acceptedRuntime:{bundleSHA,sourceHashes}}};
  const proof={passed:true,applicationVersion:'0.5.0',sourceSha256,freshDependencies:true,freshEmptyDatabase:true,unitSuite:{status:'PASS',tests:222},cleanup:'complete',protectedRuntimePreserved:true,runtime:{sourceMatchesSealed:true,bundleMatchesAccepted:true,bundleSHA,sourceHashes},http:{status:'PASS',realPdf:true,ordinaryCleanup:true,reviewerProof:{cleanup:true,groups:13}},offlineReproduction:Array.from({length:3},()=>({semanticOutcomesEqual:true,actualSourceSHA:core}))};
  return{proof,seal};
}

test('final presentation accepts only original two-phase profile and explicitly native memory scope',()=> {
  const accepted=validateFullLoadProof(fullProof());assert.equal(accepted.people,5000);assert.deepEqual(accepted.resumes,[1,5]);assert.match(accepted.memoryScope,/not Docker/);
});
test('diagnostic duration, smaller fixture and looser thresholds cannot become final full-load facts',()=> {
  for(const mutate of [(p:any)=>p.executionMode='diagnostic-not-acceptance',(p:any)=>p.fixture.people=1000,(p:any)=>p.fixture.sessions=16,(p:any)=>p.baseline.execution.measuredSeconds=15,(p:any)=>p.expanded.elapsedSeconds=20,(p:any)=>p.limits.jsonP95Ms=2000]){const p=fullProof();mutate(p);assert.throws(()=>validateFullLoadProof(p));}
});
test('declared PASS cannot hide route loss, errors or exceeded JSON/PDF p95/p99',()=> {
  for(const mutate of [(p:any)=>delete p.baseline.results.pdf,(p:any)=>p.expanded.results.profile.errors=1,(p:any)=>p.baseline.results.matching.requests=49,(p:any)=>p.expanded.results.explanation.p95Ms=1501,(p:any)=>p.baseline.results.pdf.p95Ms=2001,(p:any)=>p.baseline.results.profile.p99Ms=5001]){const p=fullProof();mutate(p);assert.throws(()=>validateFullLoadProof(p));}
});
test('invalid or reused telemetry, too-short sampling and understated peak cannot hide RAM failure',()=> {
  for(const mutate of [(p:any)=>p.baseline.samples[0].WorkingSet64=null,(p:any)=>p.expanded.samples[1].Id=54321,(p:any)=>p.baseline.samples=p.baseline.samples.slice(0,11),(p:any)=>p.baseline.samples[11].at=p.baseline.samples[0].at,(p:any)=>p.baseline.samples[5].at=p.baseline.samples[0].at,(p:any)=>p.expanded.samples[5].cpuSeconds=1,(p:any)=>p.baseline.peakAppMemoryBytes=1,(p:any)=>p.baseline.samples[0].WorkingSet64=1073741825]){const p=fullProof();mutate(p);assert.throws(()=>validateFullLoadProof(p));}
});
test('added copies must preserve attempts/dedup order and cleanup must actually finish',()=> {
  for(const mutate of [(p:any)=>p.expanded.before.attempts=5001,(p:any)=>{delete p.baseline.before.attempts;delete p.expanded.before.attempts;},(p:any)=>p.expanded.after.sha256='f'.repeat(64),(p:any)=>delete p.baseline.after,(p:any)=>p.expandedFunctional.matchingOrderDigest='d'.repeat(64),(p:any)=>delete p.baselineFunctional.firstPagesDigest,(p:any)=>p.cleanup.remainingUsers=1,(p:any)=>p.cleanup.ownerOnly=false,(p:any)=>p.cleanup.error='failed deletion']){const p=fullProof();mutate(p);assert.throws(()=>validateFullLoadProof(p));}
});
test('fresh-source proof links real PDF, own cleanup, current unit suite and exact source/bundle',()=> {
  const{proof,seal}=cleanProof();assert.equal(validateCleanSourceProof(proof,seal).unitTests,222);
});
test('old seal, changed bundle/source, missing PDF/reviewer cleanup and weaker offline proof are rejected',()=> {
  for(const mutate of [(p:any)=>p.applicationVersion='0.4.1',(p:any)=>p.sourceSha256='d'.repeat(64),(p:any)=>p.runtime.bundleSHA='d'.repeat(64),(p:any)=>p.runtime.sourceHashes={},(p:any)=>p.http.realPdf=false,(p:any)=>p.http.reviewerProof.cleanup=false,(p:any)=>p.unitSuite.status='FAIL',(p:any)=>p.offlineReproduction.pop(),(p:any)=>p.protectedRuntimePreserved=false]){const{proof,seal}=cleanProof();mutate(proof);assert.throws(()=>validateCleanSourceProof(proof,seal));}
});
