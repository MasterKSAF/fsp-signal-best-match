import assert from 'node:assert/strict';

/** Validates reported fields, not official SLA, human grade validity or production scale. */
export function validateFullLoadProof(report) {
  assert.equal(report.applicationVersion,'0.6.0');assert.equal(report.runtimeIdentity?.runtimeKind,'normal-delivery');assert.match(report.runtimeIdentity?.apiBundleSha256??'',/^[a-f0-9]{64}$/);assert.match(report.runtimeIdentity?.candidateManifestSha256??'',/^[a-f0-9]{64}$/);
  assert.equal(report.status,'PASS');assert.equal(report.executionMode,'acceptance');
  assert.equal(report.target?.key,'dedicated-v060');assert.equal(report.target?.database,'signal_resume_load_check');
  const required={people:5000,baselineResumes:1,expandedResumes:5,sessions:32,candidateSessions:16,employerSessions:16,warmupSeconds:30,measuredSeconds:180};
  for(const [key,value]of Object.entries(required))assert.equal(report.fixture?.[key],value,`Original full fixture ${key}`);
  const limits={jsonP95Ms:1500,pdfP95Ms:2000,p99Ms:5000,errors:0,minRequestsPerRoute:50,maxAppMemoryBytes:1073741824,minimumValidTelemetrySamples:12};
  for(const [key,value]of Object.entries(limits))assert.equal(report.limits?.[key],value,`Original acceptance limit ${key}`);
  const phases=[report.baseline,report.expanded],routes=['catalogue','explanation','matching','pdf','profile'];
  for(const phase of phases) {
    assert.equal(phase.passed,true);assert.equal(phase.datasetStable,true);assert.equal(phase.sourceStable,true);assert.equal(phase.telemetryStable,true);
    assert.equal(phase.execution?.mode,'acceptance');assert.equal(phase.execution?.warmupSeconds,30);assert.equal(phase.execution?.measuredSeconds,180);assert.ok(typeof phase.elapsedSeconds==='number'&&Number.isFinite(phase.elapsedSeconds)&&phase.elapsedSeconds>=180);
    assert.match(phase.telemetryMethod??'',/native Windows.*not Docker/i);
    assert.ok(Array.isArray(phase.samples)&&phase.samples.length>=12);
    for(const [index,sample]of phase.samples.entries()){assert.ok(Number.isInteger(sample.Id)&&sample.Id>0);assert.ok(Number.isFinite(Date.parse(sample.StartTime)));assert.ok(Number.isFinite(Date.parse(sample.at))&&Date.parse(sample.at)>=Date.parse(sample.StartTime));assert.ok(typeof sample.WorkingSet64==='number'&&Number.isFinite(sample.WorkingSet64)&&sample.WorkingSet64>0);assert.ok(typeof sample.cpuSeconds==='number'&&Number.isFinite(sample.cpuSeconds)&&sample.cpuSeconds>=0);if(index){assert.ok(Date.parse(sample.at)>Date.parse(phase.samples[index-1].at));assert.ok(sample.cpuSeconds>=phase.samples[index-1].cpuSeconds);}}
    assert.ok((Date.parse(phase.samples.at(-1).at)-Date.parse(phase.samples[0].at))/1000>=179);
    assert.equal(new Set(phase.samples.map(s=>`${s.Id}/${s.StartTime}`)).size,1);
    assert.equal(phase.peakAppMemoryBytes,Math.max(...phase.samples.map(s=>s.WorkingSet64)));assert.ok(phase.peakAppMemoryBytes<=1073741824);
    assert.deepEqual(Object.keys(phase.results??{}).sort(),routes);
    for(const [route,result]of Object.entries(phase.results)){assert.ok(Number.isInteger(result.requests)&&result.requests>=50);assert.equal(result.errors,0);assert.equal(result.passed,true);assert.ok(typeof result.p95Ms==='number'&&Number.isFinite(result.p95Ms)&&result.p95Ms>=0&&result.p95Ms<=(route==='pdf'?2000:1500));assert.ok(typeof result.p99Ms==='number'&&Number.isFinite(result.p99Ms)&&result.p99Ms>=result.p95Ms&&result.p99Ms<=5000);}
  }
  assert.equal(report.fixtureHash,'695c473f94f8b6c7cef779626e5d5000c2be084765bd21c4ce4ff153d4b05608','Original fixture declaration must remain exact');assert.equal(report.baseline.samples[0].Id,report.expanded.samples[0].Id);assert.equal(report.baseline.samples[0].StartTime,report.expanded.samples[0].StartTime);
  assert.equal(report.baseline.before.resumes,5000);assert.equal(report.expanded.before.resumes,25000);
  for(const phase of phases){assert.equal(phase.before.attempts,5000);assert.equal(phase.after?.resumes,phase.before.resumes);assert.equal(phase.after?.attempts,phase.before.attempts);assert.match(phase.before.sha256??'',/^[a-f0-9]{64}$/);assert.equal(phase.after?.sha256,phase.before.sha256);}
  for(const key of ['catalogueTotal','firstPagesDigest','matchingOrderDigest'])assert.equal(report.baselineFunctional?.[key],report.expandedFunctional?.[key]);
  for(const key of ['firstPagesDigest','matchingOrderDigest'])assert.match(report.baselineFunctional?.[key]??'',/^[a-f0-9]{64}$/);
  assert.equal(report.baselineFunctional?.catalogueTotal,5000);assert.equal(report.cleanup?.status,'complete');assert.equal(report.cleanup?.remainingUsers,0);assert.equal(report.cleanup?.ownerOnly,true);assert.ok(report.cleanup?.error==null);
  return {people:5000,resumes:[1,5],sessions:32,phases:2,memoryScope:'native Windows working set, not Docker cgroup'};
}

