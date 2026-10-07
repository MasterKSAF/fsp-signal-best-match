import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {validatedLoadTarget} from '../scripts/multi-resume-load-target-v060';

const exact={SIGNAL_CATALOG_TEST_ISOLATED:'1',SIGNAL_V060_LOAD_ACCEPTANCE:'1',SIGNAL_LOAD_PROFILE:'dedicated-v060',DATABASE_URL:'postgresql://fixture:unused@127.0.0.1:55435/signal_resume_load_check',LOAD_API_ORIGIN:'http://127.0.0.1:4315',INTEGRATION_APP_ORIGIN:'http://127.0.0.1:4316'};
test('0.6 load guard permits only the exact previously-owned dedicated DB/ports with two explicit flags',()=>{
  assert.equal(validatedLoadTarget(exact).key,'dedicated-v060');
  for(const changes of [{SIGNAL_LOAD_PROFILE:'stage-v1'},{SIGNAL_LOAD_PROFILE:'dedicated-v1'},{SIGNAL_LOAD_PROFILE:'__proto__'},{SIGNAL_LOAD_PROFILE:undefined},{SIGNAL_V060_LOAD_ACCEPTANCE:undefined},{SIGNAL_CATALOG_TEST_ISOLATED:'0'},{DATABASE_URL:'postgresql://fixture:unused@127.0.0.1:55435/signal_resume_v060_check'},{DATABASE_URL:'postgresql://fixture:unused@192.168.1.1:55435/signal_resume_load_check'},{LOAD_API_ORIGIN:'http://127.0.0.1:4313'},{INTEGRATION_APP_ORIGIN:'http://127.0.0.1:4314'}])assert.throws(()=>validatedLoadTarget({...exact,...changes}));
  assert.throws(()=>validatedLoadTarget({...exact,DATABASE_URL:'postgresql://fixture:unused@127.0.0.1:55433/signal'},false),'Cleanup cannot bypass database ownership');
});

function constants(file:string,name:string){const text=readFileSync(file,'utf8'),capture=text.match(new RegExp(`const ${name} = (\\{[\\s\\S]*?\\n\\});`));assert.ok(capture,'Fixed harness declarations');return JSON.parse(JSON.stringify(runInNewContext(`(${capture[1]})`,{}, {timeout:100})));}
test('0.6 full fixture and limits remain byte-equivalent semantic declarations to the accepted 0.5 harness',()=>{
  const old='scripts/multi-resume-load-stage.ts',current='scripts/multi-resume-load-stage-v060.ts';
  for(const key of ['fixture','limits'])assert.deepEqual(constants(current,key),constants(old,key));
  const f=constants(current,'fixture');assert.deepEqual([f.people,f.baselineResumes,f.expandedResumes,f.sessions,f.candidateSessions,f.employerSessions,f.warmupSeconds,f.measuredSeconds],[5000,1,5,32,16,16,30,180]);
  const limits=constants(current,'limits');assert.deepEqual([limits.jsonP95Ms,limits.pdfP95Ms,limits.p99Ms,limits.errors,limits.minRequestsPerRoute,limits.maxAppMemoryBytes,limits.minimumValidTelemetrySamples],[1500,2000,5000,0,50,1073741824,12]);
  const source=readFileSync(current,'utf8');assert.ok(source.includes('outputs/verification/0.6.0/multi-resume'));assert.ok(source.includes('multi-resume-load-v060-owned'));assert.ok(source.includes('v060-multi-load-'));
});
