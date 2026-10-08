/** C04: one bounded retest after measured source change; same retained volume/plan. */
import assert from 'node:assert/strict';
import { randomUUID,randomBytes,createHash } from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {execFile,execFileSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {inArray,like} from 'drizzle-orm';
import {db,pool,signalUsersTable as users,signalCandidateResumesTable as resumes,
  signalSkillAttemptsTable as attempts,signalCompaniesTable as companies,
  signalNeedsTable as needs,signalSessionsTable as sessions} from '../lib/db/src/index';
const url=new URL(process.env.DATABASE_URL!);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'55435');assert.equal(url.pathname,'/signal_full_audit_a10_20261008');assert.equal(process.env.PORT,'4393');
const historicalDir='outputs/verification/full-audit-a01-a11-20261008/resources';
const dir='outputs/verification/correction-01-20261008/performance';
const planBytes=await readFile(`${historicalDir}/plan.json`);assert.equal(createHash('sha256').update(planBytes).digest('hex'),'bc880d859752756d30e64ecbb1eb5109feca429fcb885d2ec69278a15eaec4e4');
const plan=JSON.parse(planBytes.toString('utf8'));
const initialBytes=await readFile(`${historicalDir}/load-report.json`);const initialSha=createHash('sha256').update(initialBytes).digest('hex');assert.equal(initialSha,'d09ae9554b0a712ef7adab9d2de8a25fd1db0c199ef009830190b43befe19c33');
const initial=JSON.parse(initialBytes.toString('utf8'));assert.equal(initial.passed,false);assert.deepEqual(initial.plan,plan);
const core=JSON.parse(await readFile('outputs/verification/full-audit-a01-a11-20261008/integration/current-core-http.json','utf8'));assert.equal(core.passed,true);
const [pidArg,bundlePath,bundleSha]=process.argv.slice(2);const pid=Number(pidArg);assert.ok(Number.isInteger(pid)&&pid>0);
const cleanPrefix='C:/Users/Misha/Documents/ChatGPT/LCT/signal-ui-refinement-workspace-20261008/outputs/verification/correction-01-20261008/clean-workspace/artifacts/api-server/dist/';
assert.ok(bundlePath?.replaceAll('\\','/').startsWith(cleanPrefix));assert.match(bundleSha??'',/^[a-f0-9]{64}$/);
assert.equal(createHash('sha256').update(await readFile(bundlePath)).digest('hex'),bundleSha);
const reviewedRuntime={origin:'http://localhost:4393',pid,bundlePath:bundlePath.replaceAll('\\','/'),sha256:bundleSha};
const freshCore=JSON.parse(await readFile('outputs/verification/correction-01-20261008/integration/current-core-http.json','utf8'));assert.equal(freshCore.passed,true);assert.deepEqual(freshCore.runtime,reviewedRuntime);
const guard="$ids=@(Get-NetTCPConnection -LocalPort 4393 -State Listen | Select-Object -ExpandProperty OwningProcess -Unique);if($ids.Count -ne 1){throw 'Expected one audit API'};$p=Get-CimInstance Win32_Process -Filter ('ProcessId = '+$ids[0]);@{pid=$p.ProcessId;commandLine=$p.CommandLine}|ConvertTo-Json -Compress";
const running=JSON.parse(execFileSync('C:/Users/Misha/AppData/Local/Programs/PowerShell/7/pwsh.exe',['-NoLogo','-NoProfile','-EncodedCommand',Buffer.from(guard,'utf16le').toString('base64')],{encoding:'utf8',timeout:30000,windowsHide:true}));
assert.equal(running.pid,pid);assert.ok(running.commandLine.replaceAll('\\','/').toLowerCase().includes(bundlePath.replaceAll('\\','/').toLowerCase()));
const identity=(await pool.query('select current_database() as database,inet_server_port() as port')).rows[0];assert.equal(identity.database,'signal_full_audit_a10_20261008');assert.equal(identity.port,5432);
const prefix=initial.fixtureLedger.prefix;assert.equal(prefix,'a10-volume-da36684b-e596-40de-8199-93557ff63e9d');
assert.equal(initial.fixtureLedger.createdCandidates,500);assert.equal(initial.fixtureLedger.createdResumes,1500);assert.equal(initial.fixtureLedger.createdEmployers,32);
const owned=await db.select({id:users.id,email:users.email,role:users.role,demoMode:users.demoMode,emailVerified:users.emailVerified}).from(users).where(like(users.email,`${prefix}-%@example.invalid`));
assert.equal(owned.length,532);assert.ok(owned.every(u=>u.emailVerified&&!u.demoMode));
const actorRows=owned.filter(u=>u.role==='candidate'),employerRows=owned.filter(u=>u.role==='employer');assert.equal(actorRows.length,500);assert.equal(employerRows.length,32);
assert.deepEqual(actorRows.map(u=>u.email).sort(),Array.from({length:500},(_,i)=>`${prefix}-${i}@example.invalid`).sort());
assert.deepEqual(employerRows.map(u=>u.email).sort(),Array.from({length:32},(_,i)=>`${prefix}-employer-${i}@example.invalid`).sort());
const resumeRows=await db.select({id:resumes.id,userId:resumes.userId}).from(resumes).where(inArray(resumes.userId,actorRows.map(u=>u.id)));assert.equal(resumeRows.length,1500);assert.ok(actorRows.every(u=>resumeRows.filter(r=>r.userId===u.id).length===3));
const companyRows=await db.select({id:companies.id,ownerUserId:companies.ownerUserId}).from(companies).where(inArray(companies.ownerUserId,employerRows.map(u=>u.id)));assert.equal(companyRows.length,32);
const needRows=await db.select({id:needs.id,companyId:needs.companyId}).from(needs).where(inArray(needs.companyId,companyRows.map(c=>c.id)));assert.equal(needRows.length,32);
const volumeAttempts=await db.select({id:attempts.id}).from(attempts).where(inArray(attempts.userId,actorRows.map(u=>u.id)));assert.equal(volumeAttempts.length,initial.fixtureLedger.clonedModularAttempts);
const created:any={users:actorRows.map(u=>u.id),resumes:resumeRows.map(r=>r.id),employers:employerRows.map(u=>u.id),attempts:volumeAttempts.map(a=>a.id)};
const runId=randomUUID();
const sessionLedgerRunId='3e8d0330-1e72-4039-b4a5-a0646559be2e';
const sessionLedger=JSON.parse(await readFile(`C:/Users/Misha/.codex/private/signal-full-audit-resource-after-fix-${sessionLedgerRunId}.json`,'utf8'));
assert.equal(sessionLedger.runId,sessionLedgerRunId);assert.equal(sessionLedger.prefix,prefix);assert.equal(sessionLedger.apiRuntime.sha256,'c19afa3d2f9b29f6153431171658303c82f992fd7e2b5ad09fbafbd9566aee60');
const historicalWorkers:any[]=sessionLedger.workers;assert.equal(historicalWorkers.length,32);assert.equal(new Set(historicalWorkers.map(w=>w.userId)).size,32);
const changeReceiptBytes=await readFile(`${dir}/measured-change-freeze.json`);const changeReceipt=JSON.parse(changeReceiptBytes.toString('utf8'));assert.equal(changeReceipt.measuredWorkReduced,true);assert.equal(changeReceipt.singleBoundedRetestAuthorized,true);assert.equal(changeReceipt.apiSha256,bundleSha);
// Before session rotation, independently bind every historical worker to the retained owned actor/company/need.
for(let i=0;i<32;i++){const worker=historicalWorkers[i]!,u=employerRows.find(u=>u.email===`${prefix}-employer-${i}@example.invalid`)!;assert.equal(worker.userId,u.id);assert.equal(worker.email,u.email);const company=companyRows.filter(c=>c.ownerUserId===u.id);assert.equal(company.length,1);const need=needRows.filter(n=>n.companyId===company[0]!.id);assert.equal(need.length,1);assert.equal(worker.needId,need[0]!.id);}
const workers:any[]=[];
for(const old of historicalWorkers){const token=randomBytes(32).toString('base64url');await db.insert(sessions).values({userId:old.userId,tokenHash:createHash('sha256').update(token).digest('hex'),expiresAt:new Date(Date.now()+3600000),demoMode:false});workers.push({...old,cookie:'fsp_signal_session='+token});}
const privateSessionLedger=`C:/Users/Misha/.codex/private/signal-correction01-resource-${runId}.json`;
await writeFile(privateSessionLedger,JSON.stringify({runId,prefix,apiRuntime:reviewedRuntime,workers},null,2)+'\n',{flag:'wx'});
const sessionHashes=workers.map(w=>{assert.match(w.cookie,/^fsp_signal_session=[A-Za-z0-9_-]{43}$/);return createHash('sha256').update(w.cookie.slice('fsp_signal_session='.length)).digest('hex');});
const reusedSessions=await db.select({userId:sessions.userId,tokenHash:sessions.tokenHash,expiresAt:sessions.expiresAt,demoMode:sessions.demoMode}).from(sessions).where(inArray(sessions.tokenHash,sessionHashes));assert.equal(reusedSessions.length,32);
for(let i=0;i<32;i++){
  const worker=workers[i]!,u=employerRows.find(u=>u.email===`${prefix}-employer-${i}@example.invalid`)!;
  assert.equal(worker.userId,u.id);assert.equal(worker.email,u.email);
  const ownedCompanies=companyRows.filter(c=>c.ownerUserId===u.id);assert.equal(ownedCompanies.length,1);const c=ownedCompanies[0]!;
  const ownedNeeds=needRows.filter(n=>n.companyId===c.id);assert.equal(ownedNeeds.length,1);assert.equal(worker.needId,ownedNeeds[0]!.id);
  const session=reusedSessions.find(s=>s.tokenHash===sessionHashes[i])!;assert.ok(session);assert.equal(session.userId,u.id);assert.equal(session.demoMode,false);assert.ok(session.expiresAt.getTime()>Date.now()+120000);
}
const api='http://127.0.0.1:4393/api';
// First live probe is read-only, exact new owned user identity. It detects a wrong inherited DATABASE_URL before any HTTP write.
const me=await fetch(api+'/me',{headers:{Cookie:workers[0].cookie}});assert.equal(me.status,200);const meBody=await me.json();assert.equal(meBody.user.id,workers[0].userId);assert.ok(meBody.user.email===workers[0].email,'Owned worker email must match');
const catalogRoute='/employer/candidates?page=1&specialization=Backend%20%2F%20Python';
const catalogProbe=await fetch(api+catalogRoute,{headers:{Cookie:workers[0].cookie}});assert.equal(catalogProbe.status,200);await catalogProbe.arrayBuffer();
const exportProbe=await fetch(api+'/public/jobs/export?format=csv',{headers:{Cookie:workers[0].cookie}});assert.equal(exportProbe.status,200);const exportProbeBytes=Buffer.from(await exportProbe.arrayBuffer());
const matches=await fetch(`${api}/matches?needId=${workers[0].needId}`,{headers:{Cookie:workers[0].cookie}});assert.equal(matches.status,200);const list=await matches.json();assert.ok(Array.isArray(list)&&list.length>=500);
const selected=list.find((r:any)=>created.users.includes(r.candidateId));assert.ok(selected);
const memoryScript=`$samples=@();$until=(Get-Date).AddSeconds(43);while((Get-Date)-lt $until){$p=Get-Process -Id ${pid} -ErrorAction Stop;$samples+=@{at=(Get-Date).ToUniversalTime().ToString('o');workingSetBytes=$p.WorkingSet64;privateBytes=$p.PrivateMemorySize64};Start-Sleep -Milliseconds 500};$samples|ConvertTo-Json -Compress`;
const sampler=new Promise<string>((resolve,reject)=>execFile('C:/Users/Misha/AppData/Local/Programs/PowerShell/7/pwsh.exe',['-NoLogo','-NoProfile','-EncodedCommand',Buffer.from(memoryScript,'utf16le').toString('base64')],{maxBuffer:300000,windowsHide:true},(err,stdout)=>err?reject(err):resolve(stdout)));
const records:any[]=[];const errors:any[]=[];
async function phase(seconds:number,measured:boolean){
  const deadline=performance.now()+seconds*1000;
  await Promise.all(workers.map(async(worker,index)=>{
    let i=index;while(performance.now()<deadline){
      const kind=['matches','matches','explanation','catalog'][i++%4];
      const route=kind==='matches'?`/matches?needId=${worker.needId}`:kind==='explanation'?`/matches/explanation?needId=${worker.needId}&candidateId=${selected.candidateId}&resumeId=${selected.resumeId}`:catalogRoute;
      const start=performance.now();try{
        const response=await fetch(api+route,{headers:{Cookie:worker.cookie},signal:AbortSignal.timeout(15000)});await response.arrayBuffer();
        if(response.status!==200)errors.push({measured,kind,status:response.status});if(measured)records.push({kind,ms:performance.now()-start,status:response.status});
      }catch(error){errors.push({measured,kind,error:String(error)});}
      await new Promise(resolve=>setTimeout(resolve,plan.workload.thinkTimeMs));
    }
  }));
}
const startedAt=new Date().toISOString();await phase(10,false);const measuredAt=new Date().toISOString();await phase(30,true);
const samples=JSON.parse(await sampler);const peak=Math.max(...samples.map((s:any)=>s.workingSetBytes));
const percentile=(xs:number[],p:number)=>{const sorted=[...xs].sort((a,b)=>a-b);return sorted[Math.max(0,Math.ceil(sorted.length*p)-1)]??null;};
const perRoute=Object.fromEntries(['matches','explanation','catalog'].map(kind=>{const rows=records.filter(r=>r.kind===kind);const values=rows.map(r=>r.ms);return [kind,{requests:rows.length,p50Ms:percentile(values,.5),p95Ms:percentile(values,.95),p99Ms:percentile(values,.99),maxMs:Math.max(...values)}];}));
const sla=plan.ownThresholds;const passed=errors.length===0&&perRoute.matches.p95Ms!<=sla.listP95Ms&&perRoute.catalog.p95Ms!<=sla.listP95Ms&&perRoute.explanation.p95Ms!<=sla.explanationP95Ms&&peak<=sla.apiPeakWorkingSetBytes;
const report={passed,startedAt,measuredAt,finishedAt:new Date().toISOString(),runId,plan,apiPid:pid,apiRuntime:reviewedRuntime,apiOrigin:api,requests:records.length,errors,perRoute,peakWorkingSetBytes:peak,memorySamples:samples,records,
  measuredChangeReceiptSha256:createHash('sha256').update(changeReceiptBytes).digest('hex'),initialReportSha256:initialSha,initialRuntime:initial.apiRuntime,preflight:{firstMeExactOwnIdentity:true,catalogStatus:catalogProbe.status,exportStatus:exportProbe.status,exportBytes:exportProbeBytes.length,exportSha256:createHash('sha256').update(exportProbeBytes).digest('hex')},
  fixtureLedger:{prefix,reusedCandidates:created.users.length,reusedResumes:created.resumes.length,reusedEmployers:created.employers.length,reusedNeeds:needRows.length,reusedModularAttempts:created.attempts.length,newCandidateRows:0,newResumeRows:0,newEmployerRows:0,newAttemptRows:0,newSessionRows:32,reusedSessionRows:0,sessionLedgerRunId,previousPreflightSessionRows:32,sessionRotationReason:'prior bounded-load sessions expired; same retained actors and permissions',retainedForIndependentRecheck:true,protectedDatabaseUsed:false},
  poolCandidates:list.length,limits:plan.limits};
await writeFile(`${dir}/single-retest-report.json`,JSON.stringify(report,null,2)+'\n',{flag:'wx'});await pool.end();
console.log(JSON.stringify({passed,requests:records.length,errors:errors.length,perRoute,peakWorkingSetBytes:peak}));if(!passed)process.exitCode=1;
