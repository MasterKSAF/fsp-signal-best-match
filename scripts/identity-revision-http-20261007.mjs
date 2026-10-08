/** Bounded ordinary HTTP regression. No SQL, earned grades, or public credentials. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash,randomBytes} from 'node:crypto';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const privateManifest='C:/Users/Misha/.codex/private/signal-independent-ordinary-aab38c3f.json';
const privateEnv='C:/Users/Misha/.codex/private/signal-independent-fixes-20261007.env';
const origin='http://127.0.0.1:4367',appOrigin='http://localhost:4368';
const output=join(root,'outputs/verification/identity-revision-fixes-20261007/http.json');
const nonce=randomBytes(5).toString('hex');
const recoveryPath=`C:/Users/Misha/.codex/private/signal-identity-revision-${nonce}.json`;
const fields=['displayName','professionalAlias','identityRevision','specialization','assumedGrade','stack','skills','yearsExperience','workFormat','salaryMin','salaryMax','salaryPeriod','salaryType','visibility','consentMatching','phone','contactEmail','resumeId','title','revision','consentCatalog','readyForOffers'];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const checks=[],requests=[],overlaps=[];
let activeStep='guard',candidate,employer,initial,latest,baselineList,createdIds=[],runtimeBefore,usedExisting=false;
const receipt={schemaVersion:1,type:'candidate-shared-identity-and-cv-revision-http',synthetic:true,humanCompetenceValidated:false,qualificationPreset:false,directSqlReads:false,directSqlWrites:false,runtimeKind:'normal-compiled',applicationVersion:'0.6.2',startedAt:new Date().toISOString(),status:'FAIL',passed:false,checks,requests,overlaps};
const pick=profile=>Object.fromEntries(fields.filter(k=>profile[k]!==undefined).map(k=>[k,structuredClone(profile[k])]));
const identity=p=>({displayName:p.displayName,professionalAlias:p.professionalAlias,phone:p.phone,contactEmail:p.contactEmail});
const qualification=p=>({verifiedGrade:p.verifiedGrade,verifiedScore:p.verifiedScore??null,verifiedSkills:p.verifiedSkills,latestAssessmentAt:p.latestAssessmentAt,qualificationAttemptId:p.qualificationAttemptId??null});
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function marker(tag){return {displayName:`Synthetic identity ${nonce} ${tag}`,professionalAlias:`Synthetic alias ${nonce} ${tag}`,phone:'+70000000001',contactEmail:`identity-${nonce}-${tag.toLowerCase()}@example.test`};}
async function step(name,run){activeStep=name;await run();checks.push({name,passed:true});}
class Client{
  cookie='';label;
  constructor(label){this.label=label;}
  async call(path,method='GET',body){
    assert.ok(requests.length<50,'HTTP request budget exhausted');
    const record={actor:this.label,method,path,status:null,startMs:performance.now(),endMs:null};requests.push(record);
    const response=await fetch(origin+'/api'+path,{method,headers:{Accept:'application/json',Origin:appOrigin,Cookie:this.cookie,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
    for(const value of response.headers.getSetCookie())this.cookie=value.split(';')[0];
    const data=await response.json();record.status=response.status;record.endMs=performance.now();
    return {status:response.status,data,record};
  }
}
async function pair(){const a=await candidate.call(`/me/candidate-profile?resumeId=${initial[0].resumeId}`),b=await candidate.call(`/me/candidate-profile?resumeId=${initial[1].resumeId}`);assert.equal(a.status,200);assert.equal(b.status,200);assert.equal(a.data.identityRevision,b.data.identityRevision);return [a.data,b.data];}
function unchanged(a,b){assert.ok(equal(a,b),'Rejected requests must not partially change either visible profile');}
function assertShared(p,expected){assert.ok(equal(identity(p[0]),expected)&&equal(identity(p[1]),expected),'Both CVs must show one complete shared identity winner');}
async function save(body,client=candidate){return client.call('/me/candidate-profile','PUT',body);}
async function overlap(bodies,sameCv){
  let open;const gate=new Promise(r=>{open=r});
  const jobs=bodies.map(body=>gate.then(()=>save(body)));open();
  const results=await Promise.all(jobs);
  assert.ok(Math.max(...results.map(r=>r.record.startMs))<Math.min(...results.map(r=>r.record.endMs)),'Both HTTP requests must overlap in flight');
  assert.ok(equal(results.map(r=>r.status).sort(),[200,409]),'Exactly one overlapping write wins');
  const winner=results.findIndex(r=>r.status===200),loser=1-winner;
  assert.equal(results[loser].data.code,sameCv?'RESUME_REVISION_CONFLICT':'CANDIDATE_IDENTITY_REVISION_CONFLICT');
  latest=await pair();assertShared(latest,identity(bodies[winner]));
  const target=latest.find(p=>p.resumeId===bodies[winner].resumeId);assert.equal(target.title,bodies[winner].title);
  if(!sameCv)assert.notEqual(latest[loser].title,bodies[loser].title);
  overlaps.push({sameCv,clientInFlightOverlap:true,statuses:results.map(r=>r.status),winnerOrdinal:winner,loserConflictCode:results[loser].data.code,serverLockWaitTimingMeasured:false});
}
async function runtime(){
  const pwsh='C:/Users/Misha/AppData/Local/Programs/PowerShell/7/pwsh.exe';
  const text=execFileSync(pwsh,['-NoLogo','-NoProfile','-Command',"$l=Get-NetTCPConnection -LocalPort 4367 -State Listen -ErrorAction Stop|Select-Object -First 1;$p=Get-Process -Id $l.OwningProcess;$c=Get-CimInstance Win32_Process -Filter ('ProcessId='+$p.Id);[pscustomobject]@{pid=$p.Id;startedAt=$p.StartTime;name=$p.ProcessName;command=$c.CommandLine}|ConvertTo-Json -Compress"],{encoding:'utf8',maxBuffer:1024*1024});
  const state=JSON.parse(text);assert.equal(state.name,'node');assert.ok(!/--inspect|--require|--import/.test(state.command));
  const args=[...state.command.matchAll(/(?:^|\s)(?:"([^"]*index\.mjs)"|([^\s"]*index\.mjs))(?=\s|$)/g)];assert.equal(args.length,1);
  const entry=resolve(args[0][1]??args[0][2]);assert.equal(entry,join(root,'outputs/local-backup/v062-identity-revision-normal/dist/index.mjs'));
  const bytes=await readFile(entry);assert.equal(sha(bytes),process.env.SIGNAL_IDENTITY_REVISION_API_SHA);
  return {pid:state.pid,processStartedAt:state.startedAt,bundleSha256:sha(bytes),normalEntry:true};
}
async function main(){
  await mkdir(dirname(output),{recursive:true});
  try{
    assert.equal(process.env.SIGNAL_IDENTITY_REVISION_HTTP,'owned-isolated');assert.match(process.env.SIGNAL_IDENTITY_REVISION_API_SHA??'',/^[a-f0-9]{64}$/);
    const env=Object.fromEntries((await readFile(privateEnv,'utf8')).split(/\r?\n/).filter(x=>/^[A-Z0-9_]+=/.test(x)).map(x=>{const i=x.indexOf('=');return [x.slice(0,i),x.slice(i+1).replace(/^['"]|['"]$/g,'')]}));
    const target=new URL(env.DATABASE_URL);assert.equal(target.hostname,'127.0.0.1');assert.equal(target.port,'55435');assert.equal(target.pathname,'/signal_independent_fixes_20261007');
    const manifest=JSON.parse(await readFile(privateManifest,'utf8'));assert.equal(manifest.database,target.pathname.slice(1));assert.equal(manifest.runId,'aab38c3f');
    const actor=manifest.accounts.find(a=>a.role==='candidate'),emp=manifest.accounts.find(a=>a.role==='employer');assert.ok(actor&&emp);assert.ok(actor.email.startsWith(manifest.prefix)&&emp.email.startsWith(manifest.prefix));
    runtimeBefore=await runtime();receipt.runtimeBefore=runtimeBefore;
    candidate=new Client('ordinary-candidate');employer=new Client('ordinary-employer');
    for(const [client,account]of [[candidate,actor],[employer,emp]]){const r=await client.call('/auth/login','POST',{email:account.email,password:account.password});assert.equal(r.status,200);assert.equal(r.data.user.id,account.id);assert.equal(r.data.user.demoMode,false);assert.equal(r.data.user.reviewMode,false);}
    const listed=await candidate.call('/me/resumes');assert.equal(listed.status,200);baselineList=listed.data.resumes;
    let ids;
    if(listed.data.limit-listed.data.count>=2){
      ids=[];for(const tag of ['A','B']){const r=await candidate.call('/me/resumes','POST',{title:`Synthetic identity ${nonce} ${tag}`,specialization:'Backend / Python'});assert.equal(r.status,201);ids.push(r.data.id);createdIds.push(r.data.id);}
    }else{assert.ok(baselineList.length>=2);ids=baselineList.slice(0,2).map(r=>r.id);usedExisting=true;}
    initial=[];for(const id of ids){const r=await candidate.call(`/me/candidate-profile?resumeId=${id}`);assert.equal(r.status,200);assert.match(r.data.identityRevision,/^[a-f0-9]{64}$/);initial.push(r.data);}
    assert.equal(initial[0].identityRevision,initial[1].identityRevision);latest=structuredClone(initial);
    await writeFile(recoveryPath,JSON.stringify({synthetic:true,actorId:actor.id,createdIds,initialProfiles:initial,recovery:'Use fresh GET tokens to intentionally restore these original visible fields; no grade/attempt edits'},null,2));
    await step('A changes shared identity; stale B with fresh CV revision gets409 and no partial writes',async()=>{
      const old=structuredClone(latest),body={...pick(old[0]),...marker('A1'),title:`Synthetic ${nonce} A winner`};const ok=await save(body);assert.equal(ok.status,200);assert.ok(equal(identity(ok.data),identity(body)));const fresh=await candidate.call(`/me/candidate-profile?resumeId=${old[1].resumeId}`);assert.equal(fresh.status,200);
      const stale={...pick(old[1]),revision:fresh.data.revision,title:`Synthetic ${nonce} B rejected`,yearsExperience:old[1].yearsExperience===60?59:old[1].yearsExperience+1};const r=await save(stale);assert.equal(r.status,409);assert.equal(r.data.code,'CANDIDATE_IDENTITY_REVISION_CONFLICT');const after=await pair();unchanged([ok.data,fresh.data],after);latest=after;
    });
    await step('B changes shared identity; stale A with fresh CV revision gets409 and no partial writes',async()=>{
      const old=structuredClone(latest),body={...pick(old[1]),...marker('B1'),title:`Synthetic ${nonce} B winner`};const ok=await save(body);assert.equal(ok.status,200);const fresh=await candidate.call(`/me/candidate-profile?resumeId=${old[0].resumeId}`);assert.equal(fresh.status,200);const r=await save({...pick(old[0]),revision:fresh.data.revision,title:`Synthetic ${nonce} A rejected`});assert.equal(r.status,409);assert.equal(r.data.code,'CANDIDATE_IDENTITY_REVISION_CONFLICT');const after=await pair();unchanged([fresh.data,ok.data],after);latest=after;
    });
    await step('Two CV writes overlap through Promise.all: one200/one409 and one complete identity',()=>overlap(latest.map((p,i)=>({...pick(p),...marker('C'+i),title:`Synthetic ${nonce} CV${i} concurrent`})),false));
    await step('Same CV writes overlap through Promise.all: one200/one409 and no mixed identity',()=>overlap([0,1].map(i=>({...pick(latest[0]),...marker('D'+i),title:`Synthetic ${nonce} sameCV${i}`})),true));
    await step('Missing/malformed identity/revision and missing explicit resumeId all400 without changes',async()=>{
      const snapshot=structuredClone(latest),valid=pick(latest[0]);
      const missing=(field)=>{const value={...valid};delete value[field];return value;};
      for(const body of [missing('identityRevision'),{...valid,identityRevision:'invalid'},missing('revision'),{...valid,revision:1.5},missing('resumeId')]){const r=await save(body);assert.equal(r.status,400);}
      latest=await pair();unchanged(snapshot,latest);
    });
    await step('Fresh read and intentional contact change200; PUT/GET use live name and equal cross-CV token',async()=>{
      const body={...pick(latest[0]),contactEmail:`intentional-${nonce}@example.test`};const r=await save(body);assert.equal(r.status,200);latest=await pair();assertShared(latest,identity(body));assert.equal(r.data.displayName,latest[0].displayName);assert.equal(r.data.identityRevision,latest[1].identityRevision);
    });
    await step('Employer role403 and real foreign CV404 preserve the owned profiles',async()=>{
      const snapshot=structuredClone(latest),catalogue=await employer.call('/employer/candidates');assert.equal(catalogue.status,200);const foreign=catalogue.data.candidates.find(p=>p.candidateId!==actor.id);assert.ok(foreign?.resumeId,'Real visible foreign CV required; missing coverage is not a fabricated404 control');const denied=await save({...pick(latest[0]),resumeId:foreign.resumeId});assert.equal(denied.status,404);const role=await save(pick(latest[0]),employer);assert.equal(role.status,403);latest=await pair();unchanged(snapshot,latest);
    });
    receipt.status='PASS';receipt.passed=true;
  }catch(error){receipt.failure={step:activeStep,errorType:error?.name??'Error'};process.exitCode=1;}
  finally{
    if(initial?.length===2&&candidate){
      try{
        activeStep='restore own visible shared identity and professional fields using fresh versions';const current=await pair();
        const a=await save({...pick(initial[0]),revision:current[0].revision,identityRevision:current[0].identityRevision});assert.equal(a.status,200);
        const b=await save({...pick(initial[1]),revision:current[1].revision,identityRevision:a.data.identityRevision});assert.equal(b.status,200);
        const restored=await pair();assertShared(restored,identity(initial[0]));
        for(let i=0;i<2;i++){const actual=pick(restored[i]),expected=pick(initial[i]);delete actual.revision;delete expected.revision;assert.ok(equal(actual,expected));}
        const final=await candidate.call('/me/resumes');assert.equal(final.status,200);
        for(const original of baselineList){const now=final.data.resumes.find(r=>r.id===original.id);assert.ok(now&&equal(qualification(original),qualification(now)),'Previously earned qualifications must remain unchanged');}
        for(const original of initial){const now=restored.find(r=>r.resumeId===original.resumeId);assert.ok(equal({grade:original.verifiedGrade,skills:original.verifiedSkills,at:original.latestAssessmentAt},{grade:now.verifiedGrade,skills:now.verifiedSkills,at:now.latestAssessmentAt}));}
        receipt.restoration={visibleOriginalFieldsRestored:true,qualificationUnchanged:true,preexistingCvCount:baselineList.length,createdCvCount:createdIds.length,createdCvsRetained:true,usedExistingCvs:usedExisting,cvRevisionsIntentionallyAdvanced:true};
      }catch(error){receipt.restoration={failed:true,errorType:error?.name??'Error'};receipt.status='FAIL';receipt.passed=false;process.exitCode=1;}
    }
    for(const client of [candidate,employer])if(client?.cookie&&requests.length<50){try{const r=await client.call('/auth/logout','POST');assert.equal(r.status,200);}catch{receipt.logoutFailed=true;receipt.status='FAIL';receipt.passed=false;process.exitCode=1;}}
    try{const after=await runtime();assert.ok(equal(runtimeBefore,after));receipt.runtimeAfter=after;receipt.runtimeStable=true;}catch(error){receipt.runtimeStable=false;receipt.status='FAIL';receipt.passed=false;process.exitCode=1;}
    receipt.finishedAt=new Date().toISOString();receipt.httpRequestCount=requests.length;receipt.requestBudget=50;receipt.sourceSha256=sha(await readFile(fileURLToPath(import.meta.url)));
    receipt.limits=['Synthetic ordinary actors from private manifest; tests do not validate human competence','No SQL reads/writes, resets, seeded grades, mail purge, load, stage4313/4314 or unrelated process actions','HTTP in-flight overlap is observed; PostgreSQL lock wait timing is not measured','Existing CVs are not deleted; original visible identity/professional fields restored, revision/update time advances remain','No names, contacts, login/password/session values or profile snapshots in public receipt'];
    try{const prior=await readFile(output);await writeFile(join(dirname(output),`http-history-${sha(prior).slice(0,16)}.json`),prior);}catch(error){if(error?.code!=='ENOENT')throw error;}
    await writeFile(output,JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify({status:receipt.status,passed:receipt.passed,checks:checks.length,requests:requests.length,runtimeStable:receipt.runtimeStable,restoration:receipt.restoration,failure:receipt.failure??null,output:'outputs/verification/identity-revision-fixes-20261007/http.json'}));
  }
}
main().catch(()=>{console.error('Identity revision regression could not complete; no private values printed.');process.exitCode=1;});
