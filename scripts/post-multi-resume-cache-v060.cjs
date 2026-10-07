/** Local read-only cache counters, ONLY after both measured phases and exact cleanup. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {assertDeliverySnapshot}=require('./lib/multi-resume-load-delivery-v060.cjs');
const root=process.cwd(),pwsh='C:/Users/Misha/AppData/Local/Programs/PowerShell/7/pwsh.exe';
const sha=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function listeners(port){return Number(execFileSync(pwsh,['-NoLogo','-NoProfile','-Command',`$current=Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue; if($current){$current|Select-Object -First 1 -ExpandProperty OwningProcess};exit 0`],{encoding:'utf8'}).trim())||null;}
async function main(){
  assert.equal(process.env.SIGNAL_V060_LOAD_ACCEPTANCE,'1');
  const stand=JSON.parse(fs.readFileSync(path.join(root,'outputs/local-backup/multi-resume-load-stand-v060/stand.json'),'utf8'));
  assert.equal(stand.owner,'resume_catalog');assert.equal(stand.profile,'dedicated-v060');assert.equal(stand.database,'signal_resume_load_check');assert.equal(stand.apiPort,4315);
  assert.equal(listeners(4315),stand.pid);assert.ok(Number.isSafeInteger(stand.pid)&&stand.pid>0);
  const identity=JSON.parse(execFileSync(pwsh,['-NoLogo','-NoProfile','-Command',`Get-Process -Id ${stand.pid}|Select-Object Id,StartTime,ProcessName|ConvertTo-Json -Compress`],{encoding:'utf8'}));
  assert.equal(identity.StartTime,stand.identity.StartTime);assert.equal(identity.ProcessName,'node');
  const runtime=JSON.parse(fs.readFileSync(stand.runtimeManifestPath,'utf8'));assertDeliverySnapshot(runtime,root);
  assert.equal(runtime.applicationVersion,'0.6.0');assert.equal(runtime.runtimeKind,'normal-delivery');assert.equal(runtime.diagnosticsRegistrationOnly,true);assert.ok(runtime.nodeFlags.every(flag=>!flag.includes('inspect')));
  const owner=JSON.parse(fs.readFileSync(path.join(root,'outputs/local-backup/multi-resume-load-v060-owned.json'),'utf8'));assert.equal(owner.database,stand.database);assert.equal(owner.profile,stand.profile);assert.equal(owner.cleanup,'complete');assert.equal(owner.remaining,0);assert.match(owner.id,/^[a-f0-9]{12}$/);
  const reportPath=path.join(root,`outputs/verification/0.6.0/multi-resume/load-comparison-${owner.id}.json`),report=JSON.parse(fs.readFileSync(reportPath,'utf8'));
  assert.equal(report.executionMode,'acceptance');assert.equal(report.runtimeIdentity.apiBundleSha256,runtime.apiSha256);assert.equal(report.cleanup.remainingUsers,0);assert.equal(report.cleanup.status,'complete');assert.ok(report.cleanup.ownerOnly);
  for(const label of ['baseline','expanded']){const phase=report[label];assert.ok(phase&&phase.execution.mode==='acceptance');assert.equal(phase.execution.warmupSeconds,30);assert.equal(phase.execution.measuredSeconds,180);assert.ok(phase.elapsedSeconds>=180);}
  assert.ok(['PASS','FAIL'].includes(report.status));assert.equal(listeners(9229),null,'No unrelated inspector listener may be reused');
  const activatedAt=new Date().toISOString();process._debugProcess(stand.pid);
  for(let n=0;n<20&&listeners(9229)===null;n++)await new Promise(resolve=>setTimeout(resolve,100));
  assert.equal(listeners(9229),stand.pid,'Inspector activation must resolve to the exact owned PID');
  const targets=await(await fetch('http://127.0.0.1:9229/json/list',{signal:AbortSignal.timeout(5000)})).json();assert.equal(targets.length,1);assert.ok(targets[0].webSocketDebuggerUrl.startsWith('ws://127.0.0.1:9229/'));
  const socket=new WebSocket(targets[0].webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Owned inspector connect timeout')),5000);socket.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true});socket.addEventListener('error',()=>{clearTimeout(timer);reject(new Error('Owned inspector connect failed'));},{once:true});});
  const read=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Owned cache counter read timeout')),5000);socket.addEventListener('message',event=>{const value=JSON.parse(String(event.data));if(value.id===1){clearTimeout(timer);if(value.error||value.result.exceptionDetails)reject(new Error('Owned cache counter read failed'));else resolve(value.result.result?.value);}});socket.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression:"globalThis[Symbol.for('signal.load.cacheDiagnostics')]?.map(cache=>cache.diagnostics())",returnByValue:true}}));});
  socket.close();assert.ok(Array.isArray(read)&&read.length>0);
  const counters=read;
  for(const row of counters){assert.ok(['raw_pool','assessment_metadata','ranking_and_professional_json'].includes(row.name));assert.ok(row.entries<=2);assert.ok(row.retainedEstimatedBytes<=row.budgetBytes);}
  const out=path.join(root,`outputs/verification/0.6.0/multi-resume/post-cache-${stand.buildId}.json`);
  const result={schemaVersion:1,applicationVersion:'0.6.0',mode:'post-measurement-read-only-counters-not-sla',collectedAt:new Date().toISOString(),activatedAt,measuredReportSha256:sha(reportPath),apiBundleSha256:runtime.apiSha256,candidateManifestSha256:runtime.candidateManifestSha256,ownedPid:stand.pid,identityStable:true,inspectorDuringMeasurement:false,registrationDuringMeasurement:true,exactCleanupBeforeInspection:true,counters,limitations:['Cache sizes are implementation estimates, not a V8 total-heap cap.','Counters are collected after both measured phases and exact fixture cleanup; they do not add measurement samples or alter percentiles.','Native measured working-set telemetry is the memory SLA proof; this is additional bounded-retention/fallback evidence.']};
  fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({path:path.relative(root,out).replaceAll('\\','/'),sha256:sha(out),counters}));
}
main().catch(()=>{console.error('Guarded post-measurement cache counter collection failed; no SLA result is rewritten');process.exitCode=1;});
