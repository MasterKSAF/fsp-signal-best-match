/** Final bounded readback: retained fixtures only; no new actors, forms, answers or profile writes. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const root='C:/Users/Misha/Documents/ChatGPT/LCT/signal-ui-refinement-workspace-20261008';
const privateFile='C:/Users/Misha/.codex/private/signal-senior-v4-http-actors-20261008.json';
const bundlePath=`${root}/outputs/runtime/ui-refinement-iteration03/dist/index.mjs`;
const expectedBundle='15faf98118cb0e4d3e09496e2c44cf4fe9d8ebb1291afd7e0253af185fd2d435';
const expectedPid=42796;
const previousPath='outputs/verification/ui-refinement-20261008/senior-http/senior-http-v4-receipt.json';
const receiptPath='outputs/verification/ui-refinement-20261008/senior-http/senior-retained-readback-iteration03.json';
const sha=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex');
const bankVersion='signal-skills-2026-10-v4';
const rubricVersion='six-competencies-critical-5of6-senior-outcomes-v1';
const matrixVersion='signal-category-competency-matrix-v2';
const requiredSkills=['backend-engineering','frontend-engineering','python','react','sql','typescript'];
const api='http://localhost:4371',origin='http://localhost:4372';
const actors=JSON.parse(await readFile(privateFile,'utf8')).actors as {id:number;email:string;password:string;role?:string;resumeIds?:number[]}[];
assert.deepEqual(actors.map(a=>a.id).sort((a,b)=>a-b),[1061,1076]);
const previousBytes=await readFile(previousPath);const previous=JSON.parse(previousBytes.toString());
assert.equal(sha(previousBytes),'71fd1672c7e7f8c7cc168965831f91e1435115125a84f19bcce12880d23bfdd4');
assert.equal(previous.passed,true);assert.equal(previous.checks.length,23);
const checks:{name:string;status:'PASS';detail?:unknown}[]=[];
const sessions:{id:number;cookie:string}[]=[];
const contexts:unknown[]=[];const snapshots:unknown[]=[];const catalogs:unknown[]=[];
let passed=false,failure:string|undefined;
let runtime:unknown,source:unknown;
async function request(path:string,method='GET',body?:unknown,cookie?:string){
  const r=await fetch(`${api}/api${path}`,{method,headers:{Origin:origin,...(cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
  const raw=await r.text();assert.equal(r.status,200,`${method} ${path}: status ${r.status}`);
  return{data:raw?JSON.parse(raw):null,cookie:r.headers.getSetCookie().find(c=>c.startsWith('fsp_signal_session='))?.split(';')[0]};
}
const noPrivate=(value:unknown)=>assert.doesNotMatch(JSON.stringify(value),/"(?:oracles|expected|answerKey|seed|passwordHash|password|tokenHash)"\s*:/);
async function step(name:string,run:()=>Promise<unknown>){const detail=await run();checks.push({name,status:'PASS',...(detail===undefined?{}:{detail})});}
try{
  await step('Final iteration03 immutable bundle and listening PID are pinned',async()=>{
    assert.equal(sha(await readFile(bundlePath)),expectedBundle);
    const script="$ProgressPreference = 'SilentlyContinue'; $seniorListeners = @(Get-NetTCPConnection -LocalPort 4371 -State Listen | Select-Object -ExpandProperty OwningProcess -Unique); if ($seniorListeners.Count -ne 1) { throw 'Expected one API listener' }; $seniorApi = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $seniorListeners[0]); @{pid=$seniorApi.ProcessId; commandLine=$seniorApi.CommandLine} | ConvertTo-Json -Compress";
    const process=JSON.parse(execFileSync('C:/Users/Misha/AppData/Local/Programs/PowerShell/7/pwsh.exe',['-NoLogo','-NoProfile','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{encoding:'utf8',timeout:15000}));
    assert.equal(process.pid,expectedPid);const command=process.commandLine.replaceAll('\\','/').toLowerCase();assert.ok(command.includes(bundlePath.toLowerCase())||command.includes(' outputs/runtime/ui-refinement-iteration03/dist/index.mjs'));
    runtime={bundlePath,sha256:expectedBundle,pid:process.pid,api,web:origin};return runtime;
  });
  await step('All four frozen Senior source SHA match the earlier 23-check iteration02 receipt',async()=>{
    const files=await Promise.all(previous.source.map(async(s:{path:string;sha256:string})=>{const actual=sha(await readFile(s.path));assert.equal(actual,s.sha256,s.path);return{path:s.path,sha256:actual};}));assert.equal(files.length,4);source=files;return files;
  });
  for(const actor of actors)await step(`Retained ${actor.id} authenticates through ordinary login`,async()=>{
    const {data,cookie}=await request('/auth/login','POST',{email:actor.email,password:actor.password});assert.ok(cookie);assert.equal(data.user.id,actor.id);assert.equal(data.user.role,actor.id===1061?'candidate':'employer');assert.equal(data.user.demoMode,false);sessions.push({id:actor.id,cookie});return{actorId:actor.id,role:data.user.role};
  });
  const candidate=sessions.find(s=>s.id===1061)!,employer=sessions.find(s=>s.id===1076)!;
  const initial=(await request('/me/skill-matrix','GET',undefined,candidate.cookie)).data;noPrivate(initial);
  await step('Account retains all six valid Senior proofs and the original six submitted forms',async()=>{
    assert.equal(initial.bankVersion,bankVersion);assert.deepEqual(initial.accountEvidence.map((e:any)=>e.skillId).sort(),requiredSkills);
    assert.equal(initial.history.length,6);assert.equal(initial.qualification,null);
    for(const e of initial.accountEvidence){assert.equal(e.level,'Senior');assert.equal(e.programVersion,bankVersion);const old=previous.issued.find((i:any)=>i.actorId===1061&&i.mode==='full'&&i.skillId===e.skillId);assert.equal(e.attemptId,old.attemptId);}
    return{actorId:1061,proofs:initial.accountEvidence.map((e:any)=>({skillId:e.skillId,level:e.level,attemptId:e.attemptId,programVersion:e.programVersion}))};
  });
  await step('Six direct form readbacks keep 45 minutes, independent outcomes, critical maps and original CV context',async()=>{
    for(const h of initial.history){
      const form=(await request(`/me/skill-attempts/${h.id}`,'GET',undefined,candidate.cookie)).data;noPrivate(form);
      const earlier=previous.checks.find((c:any)=>c.detail?.attemptId===h.id&&c.name.includes('full Senior HTTP pass'));
      assert.equal(form.id,h.id);assert.equal(form.resumeId,earlier.detail.originalResumeId);assert.equal(form.level,'Senior');assert.equal(form.programVersion,bankVersion);assert.equal(form.status,'submitted');assert.equal(form.revocation,null);
      assert.equal(form.policy.durationMinutes,45);assert.equal(form.policy.rubricVersion,rubricVersion);assert.equal(Date.parse(form.expiresAt)-Date.parse(form.startedAt),45*60000);assert.equal(form.startedAt,h.startedAt);assert.equal(form.submittedAt,h.submittedAt);assert.deepEqual(form.decision,h.decision);assert.equal(form.decision.score,100);assert.equal(form.decision.passed,true);assert.equal(form.decision.criticalComplete,true);
      assert.equal(form.cases.length,6);assert.deepEqual(form.cases.filter((c:any)=>c.critical).map((c:any)=>c.competencyId),earlier.detail.critical);assert.ok(form.cases.every((c:any)=>c.seniorOutcome&&c.templateId.includes(':Senior:')&&c.templateVersion===1&&c.levelRequirementId.startsWith(`${form.skillId}:senior-outcome-v1:`)&&c.contentFamilyId.startsWith(`skill-senior-content-v1:${form.skillId}:`)));
      snapshots.push({attemptId:form.id,skillId:form.skillId,resumeId:form.resumeId,startedAt:form.startedAt,expiresAt:form.expiresAt,submittedAt:form.submittedAt,policy:form.policy,critical:earlier.detail.critical,publicCasesSha256:sha(JSON.stringify(form.cases)),decisionSha256:sha(JSON.stringify(form.decision))});
    }return snapshots;
  });
  for(const [resumeId,specialization] of [[548,'Backend / Python'],[549,'Frontend / TypeScript']] as const)await step(`CV${resumeId} keeps its three-slot Senior category and actual skill_matrix source`,async()=>{
    const matrix=(await request(`/me/skill-matrix?resumeId=${resumeId}`,'GET',undefined,candidate.cookie)).data;const profile=(await request(`/me/candidate-profile?resumeId=${resumeId}`,'GET',undefined,candidate.cookie)).data;noPrivate(matrix);noPrivate(profile);
    assert.equal(matrix.resume.id,resumeId);assert.equal(matrix.resume.specialization,specialization);assert.equal(matrix.qualification.source,'skill_matrix');assert.equal(matrix.qualification.verifiedGrade,'Senior');assert.equal(matrix.qualification.verifiedScore,null);assert.equal(matrix.qualification.category.matrixVersion,matrixVersion);assert.equal(matrix.qualification.category.specialization,specialization);assert.equal(matrix.qualification.category.grade,'Senior');assert.equal(matrix.qualification.category.requirements.length,3);assert.ok(matrix.qualification.category.requirements.every((r:any)=>r.level==='Senior'&&r.programVersion===bankVersion));assert.equal(profile.verifiedGrade,'Senior');assert.ok(profile.verifiedScore==null,'owner profile has no numeric grade');assert.equal(profile.phone,null);assert.ok(profile.contactEmail===null||profile.contactEmail===actors.find(a=>a.id===1061)!.email,'owner contact is either absent or the retained synthetic address');
    const value={resumeId,specialization,source:matrix.qualification.source,verifiedGrade:matrix.qualification.verifiedGrade,category:matrix.qualification.category,ownerPhoneAbsent:profile.phone===null,ownerSyntheticContactEmailPresent:profile.contactEmail!==null};contexts.push(value);return value;
  });
  for(const resumeId of [548,549])await step(`Employer1076 sees CV${resumeId} with the same Senior category and skill proof chips, without contacts`,async()=>{
    const card=(await request(`/employer/candidates/${resumeId}`,'GET',undefined,employer.cookie)).data;noPrivate(card);
    assert.equal(card.candidateId,1061);assert.equal(card.resumeId,resumeId);assert.equal(card.verifiedGrade,'Senior');assert.equal(card.verifiedScore,null);assert.equal(card.confirmationStatus,'confirmed');assert.equal(card.categoryEvidence.matrixVersion,matrixVersion);assert.equal(card.categoryEvidence.grade,'Senior');assert.equal(card.categoryEvidence.requirements.length,3);assert.ok(card.skillEvidence.every((e:any)=>e.level==='Senior'&&e.programVersion===bankVersion));
    for(const key of ['phone','contactEmail','email','telegram','contacts'])assert.equal(Object.hasOwn(card,key),false,`catalog card exposes ${key}`);
    const owner=contexts.find((c:any)=>c.resumeId===resumeId) as any;assert.deepEqual(card.categoryEvidence,owner.category);
    const value={resumeId,candidateId:card.candidateId,verifiedGrade:card.verifiedGrade,proofSkills:card.skillEvidence.map((e:any)=>({skillId:e.skillId,level:e.level,programVersion:e.programVersion})),categoryEvidence:card.categoryEvidence,contactKeysAbsent:true};catalogs.push(value);return value;
  });
  await step('Employer catalog Senior specialization filters return both retained concrete CVs',async()=>{
    for(const c of contexts as any[]){const params=new URLSearchParams({grade:'Senior',specialization:c.specialization});const list=(await request(`/employer/candidates?${params}`,'GET',undefined,employer.cookie)).data;noPrivate(list);const card=list.candidates.find((v:any)=>v.candidateId===1061);assert.ok(card);assert.equal(card.resumeId,c.resumeId);assert.equal(card.verifiedGrade,'Senior');}return{resumeIds:[548,549],grade:'Senior'};
  });
  await step('Readbacks issue no new forms and preserve the initial history/evidence payload',async()=>{
    const final=(await request('/me/skill-matrix','GET',undefined,candidate.cookie)).data;assert.deepEqual(final.history,initial.history);assert.deepEqual(final.accountEvidence,initial.accountEvidence);return{retainedForms:6,newAttempts:0,newActors:0};
  });
  passed=true;
}catch(error){failure=error instanceof Error?error.message:String(error);throw error;}
finally{
  const logout=await Promise.allSettled(sessions.map(s=>request('/auth/logout','POST',{},s.cookie)));const sessionsClosed=logout.every(r=>r.status==='fulfilled');
  await mkdir('outputs/verification/ui-refinement-20261008/senior-http',{recursive:true});
  await writeFile(receiptPath,JSON.stringify({passed,failure,checks,runtime,source,bankVersion,rubricVersion,matrixVersion,retainedActorIds:[1061,1076],contexts,snapshots,catalogs,sessionsClosed,newActors:0,newAttempts:0,previousFullScenario:{receipt:previousPath,sha256:sha(previousBytes),checks:23,runtime:previous.runtime},lastDelta:'Iteration03 corrects OpenAPI qualificationSource enum matrix → skill_matrix and regenerates clients. All four frozen Senior source hashes match iteration02; no Senior content/scoring/issue changes are claimed. This readback does not relabel the previous 23 checks as rerun.',limitations:['Only retained synthetic account evidence and current public form snapshots are read; prior private oracle immutability is evidenced by the unchanged iteration02 receipt.','Ordinary login/logout creates and revokes only these new readback sessions; no actor/profile/form/evidence write is performed.','This is a bounded final runtime readback, not human or professional Senior calibration.'],measuredAt:new Date().toISOString()},null,2));
  console.log(JSON.stringify({passed,checks:checks.length,receipt:receiptPath,sessionsClosed}));
}
