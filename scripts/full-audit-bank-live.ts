/** Bounded isolated fixture proof. Run only after root supplies immutable runtime SHA/PID.
 * No load loop and no existing human history. Answers from owned private fixtures verify persistence,
 * not level calibration. Operator overrides/audit deliberately remain as reviewed isolated evidence. */
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { and, eq, inArray } from 'drizzle-orm';
import { db,pool,signalUsersTable as users,signalSessionsTable as sessions,signalCandidateResumesTable as resumes,signalSkillAttemptsTable as modules,signalSkillExposuresTable as exposures,signalAssessmentAttemptsTable as legacy,signalBankTemplateOverridesTable as overrides,signalBankAuditTable as audit,signalResearchStudiesTable as studies,signalResearchEnrollmentsTable as enrollments,signalResearchAttemptsTable as researchAttempts } from '../lib/db/src/index';
import { hashPassword } from '../artifacts/api-server/src/lib/signal-auth';
import { historicalSeniorV4RequirementProbe } from '../artifacts/api-server/src/lib/skill-senior-outcomes';
import { skillModuleRegistry,skillContentFamilyId,seniorSkillModulePolicy,SKILL_BANK_VERSION } from '../artifacts/api-server/src/lib/skill-module-bank';
import { assembleManagedAttempt } from '../artifacts/api-server/src/lib/assessment-managed';
import { RESEARCH_PROTOCOL_VERSION,RESEARCH_CONSENT_VERSION } from '../artifacts/api-server/src/lib/research-report';

const [bundlePath,bundlePin,pid,mode='on',operatorIdText=''] = process.argv.slice(2);
const database=new URL(process.env.DATABASE_URL!);
assert.equal(database.hostname,'127.0.0.1');assert.equal(database.pathname,'/signal_full_audit_a10_20261008');assert.equal(process.env.NODE_ENV,'test');
assert.ok(['on','off'].includes(mode));assert.equal(process.env.SIGNAL_SKILL_MODULES_ENABLED,mode==='on'?'true':'false');
assert.match(bundlePin??'',/^[a-f0-9]{64}$/);assert.match(pid??'',/^\d+$/);
const normalized=bundlePath?.replaceAll('\\','/')??'';
const allowedCleanBundle='C:/Users/Misha/Documents/ChatGPT/LCT/signal-ui-refinement-workspace-20261008/outputs/verification/full-audit-a01-a11-20261008/clean-workspace/artifacts/api-server/dist/index.mjs';
assert.ok(normalized.startsWith('C:/Users/Misha/Documents/ChatGPT/LCT/signal-ui-refinement-workspace-20261008/outputs/runtime/full-audit-') || normalized===allowedCleanBundle);
assert.ok(normalized.endsWith('/dist/index.mjs'));assert.equal(createHash('sha256').update(await readFile(bundlePath!)).digest('hex'),bundlePin);
const port=mode==='on'?4383:4385;
const ps=`$ProgressPreference='SilentlyContinue'; $ErrorActionPreference='Stop'; $auditListeners = @(Get-NetTCPConnection -LocalPort ${port} -State Listen | Select-Object -ExpandProperty OwningProcess -Unique); if ($auditListeners.Count -ne 1) { throw 'Expected one isolated API listener' }; $auditProcess = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $auditListeners[0]); @{pid=$auditProcess.ProcessId;commandLine=$auditProcess.CommandLine} | ConvertTo-Json -Compress`;
const processInfo=JSON.parse(execFileSync('C:/Users/Misha/AppData/Local/Programs/PowerShell/7/pwsh.exe',['-NoLogo','-NoProfile','-EncodedCommand',Buffer.from(ps,'utf16le').toString('base64')],{encoding:'utf8'}));
assert.equal(processInfo.pid,Number(pid));assert.ok(processInfo.commandLine.replaceAll('\\','/').includes(normalized));
const api=`http://localhost:${port}`,web=new URL(process.env.PUBLIC_URL??'http://localhost:4384').origin;
assert.ok(['http://localhost:4384','http://127.0.0.1:4384','http://signal-full-audit.localhost:4384'].includes(web));
const prefix=`bank-a10-${mode}-${randomUUID()}`,owned:number[]=[],checks:any[]=[],fixtureHashes:any[]=[],changedIds:string[]=[];
const directory='outputs/verification/full-audit-a01-a11-20261008/bank';let passed=false,failure:string|undefined;
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const privateHash=(row:any)=>hash({programVersion:row.programVersion,cases:row.cases,oracles:row.oracles,policy:row.policy,startedAt:row.startedAt,expiresAt:row.expiresAt,dueAt:row.dueAt});
const noKeys=(value:unknown)=>assert.doesNotMatch(JSON.stringify(value),/"(?:oracles|expected|answerKey|seed)"\s*:/);
async function actor(fixedId?:number){
 if(fixedId)assert.equal((await db.select({id:users.id}).from(users).where(eq(users.id,fixedId))).length,0,'Reserved synthetic operator id must not exist');
 const [user]=await db.insert(users).values({...(fixedId?{id:fixedId}:{}),email:`${prefix}-${owned.length}@example.test`,passwordHash:await hashPassword(randomUUID()),displayName:'Изолированная проверка банка A10',role:'candidate',emailVerified:true,demoMode:false}).returning();assert.ok(user);owned.push(user.id);
 const token=randomBytes(32).toString('base64url');await db.insert(sessions).values({userId:user.id,tokenHash:createHash('sha256').update(token).digest('hex'),expiresAt:new Date(Date.now()+3600_000),demoMode:false});
 const request=async(path:string,method='GET',body?:unknown)=>{const response=await fetch(`${api}/api${path}`,{method,headers:{Cookie:`fsp_signal_session=${token}`,Origin:web,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});return{status:response.status,data:await response.json() as any};};
 const result=await request('/me/resumes');assert.equal(result.status,200);const resumeId=result.data.resumes[0].id;
 await db.update(resumes).set({specialization:'Backend / Python',questionnaire:{version:'backend-python-v1',industry:'Информационные технологии',specialization:'Backend / Python',answers:{python:3,databases:3,api:3,testing:3,reliability:3,ownership:3}}}).where(and(eq(resumes.id,resumeId),eq(resumes.userId,user.id)));
 return{id:user.id,resumeId,request};
}
type Actor=Awaited<ReturnType<typeof actor>>;
async function historicalModule(a:Actor,s:number,status:'active'|'expired'){
 const module=skillModuleRegistry.find(m=>m.id==='python')!,programVersion='signal-skills-2026-10-v4';
 const cases:any[]=[],oracles:any={};
 for(let c=0;c<6;c++){
  const task=historicalSeniorV4RequirementProbe('python',c,s,5,true),id=`q${c+1}`,templateId=`${programVersion}:python:Senior:${module.competencies[c]}:s${s+1}`;
  cases.push({id,competencyId:module.competencies[c],title:task.title,prompt:task.parts.map((part,i)=>`Часть ${i+1}\n${part.prompt}${part.choices?'\n'+part.choices.map((v,j)=>`${j+1}. ${v}`).join('\n'):''}`).join('\n\n'),responseType:'text',critical:module.seniorCriticalCompetencies.includes(module.competencies[c]!),templateId,contentFamilyId:skillContentFamilyId(templateId),templateVersion:1,seniorOutcome:task.outcome,levelRequirementId:task.requirementId});
  oracles[id]={expected:task.parts.map(p=>p.expected).join(';'),parts:task.parts.map(p=>({expected:p.expected,responseType:p.responseType})),explanation:'Fixture from preserved historical v4 probe; not a reissued human attempt',rubricVersion:seniorSkillModulePolicy.rubricVersion,points:1};
 }
 const startedAt=new Date(Date.now()-(status==='expired'?48*3600_000:0));
 const [row]=await db.insert(modules).values({userId:a.id,resumeId:a.resumeId,skillId:'python',level:'Senior',programVersion,status,cases,oracles,policy:seniorSkillModulePolicy,startedAt,expiresAt:new Date(+startedAt+45*60000)}).returning();assert.ok(row);
 await db.insert(exposures).values(cases.map(c=>({userId:a.id,attemptId:row.id,templateId:c.templateId,issuedAt:startedAt})));fixtureHashes.push({type:'synthetic-historical-v4',id:row.id,hash:privateHash(row)});return row;
}
function cli(command:string,templateId?:string){
 const args=['--env-file=C:/Users/Misha/.codex/private/signal-full-audit-a10-20261008.env','--import','tsx','scripts/manage-assessment-bank.ts',command];
 if(templateId)args.push('--template',templateId,'--operator',prefix,'--reason',`${prefix}: reviewed stable-family ${command}; disposable isolated proof only`);
 return JSON.parse(execFileSync(process.execPath,args,{cwd:process.cwd(),encoding:'utf8',timeout:20000}));
}
async function moduleProof(){
 const active=await actor(),frozen=await historicalModule(active,0,'active'),fresh=await actor(),exhausted=await actor();
 for(let s=0;s<3;s++)await historicalModule(exhausted,s,'expired');
 const oldIds=[1,2,3].map(s=>`signal-skills-2026-10-v4:python:Senior:collections:s${s}`),families=oldIds.map(skillContentFamilyId);
 const previous=(await db.select().from(overrides)).filter(row=>families.includes(skillContentFamilyId(row.templateId)));
 // A retained failed fixture run may have restored its own active aliases. Never touch another
 // operator's overrides, and never treat a pre-existing disabled family as a disposable fixture.
 assert.ok(previous.every(row=>row.status==='active'&&/^bank-a10-on-[a-f0-9-]{36}$/.test(row.operator)&&row.reason.includes('disposable isolated proof only')),'Do not modify non-owned/pre-existing disabled tested-family overrides');
 if(previous.length){const priorAudits=(await db.select().from(audit)).filter(row=>families.includes(String((row.details as any).contentFamilyId)));assert.ok(priorAudits.every(row=>/^bank-a10-on-[a-f0-9-]{36}$/.test(row.operator)));checks.push({name:'Retained prior fixture active aliases are owned and audited; no other operator state reused',status:'PASS'});}
 for(const id of oldIds){cli('disable',id);changedIds.push(id);}
 const inventory=cli('inventory');const entries=inventory.filter((row:any)=>row.id.startsWith(SKILL_BANK_VERSION+':python:Senior:collections:'));
 assert.equal(entries.length,3);assert.ok(entries.every((r:any)=>r.status==='disabled'&&r.issued>=1));checks.push({name:'CLI old-v4 disable resolves current stable families and aggregate exposure',status:'PASS',entries:entries.map((r:any)=>({id:r.id,status:r.status,issued:r.issued}))});
 const matrix=await fresh.request(`/me/skill-matrix?resumeId=${fresh.resumeId}`);assert.equal(matrix.status,200);noKeys(matrix.data);
 const getLevel=(data:any)=>data.modules.find((m:any)=>m.id==='python').levels.find((l:any)=>l.level==='Senior');assert.equal(getLevel(matrix.data).available,false);
 const denied=await fresh.request('/me/skill-attempts','POST',{resumeId:fresh.resumeId,skillId:'python',level:'Senior',programVersion:SKILL_BANK_VERSION});assert.equal(denied.status,503);assert.equal(denied.data.code,'skill_bank_unavailable');
 const restored=await active.request('/me/skill-attempts','POST',{resumeId:active.resumeId,skillId:'python',level:'Senior',programVersion:SKILL_BANK_VERSION});assert.equal(restored.status,200);assert.equal(restored.data.attempt.id,frozen.id);noKeys(restored.data);
 const answers=Object.fromEntries(frozen.cases.map(c=>[c.id,frozen.oracles[c.id]!.expected]));
 const saved=await active.request(`/me/skill-attempts/${frozen.id}/answers`,'PUT',{revision:restored.data.attempt.revision,answers});assert.equal(saved.status,200);
 const submitted=await active.request(`/me/skill-attempts/${frozen.id}/submit`,'POST',{revision:saved.data.attempt.revision,answers});assert.equal(submitted.status,200);noKeys(submitted.data);assert.equal(submitted.data.attempt.decision.passed,true);
 const [after]=await db.select().from(modules).where(eq(modules.id,frozen.id));assert.equal(privateHash(after),privateHash(frozen));checks.push({name:'GET/start deny disabled current issuance, existing frozen v4 finishes with unchanged snapshot',status:'PASS'});
 for(const id of oldIds)cli('enable',id);
 const aliases=await db.select().from(overrides);assert.ok(aliases.filter(r=>families.includes(skillContentFamilyId(r.templateId))).every(r=>r.status==='active'));
 const auditRows=await db.select().from(audit).where(eq(audit.operator,prefix));assert.equal(auditRows.length,6);assert.ok(auditRows.every(r=>(r.details as any).policy==='new_attempts_only_stable_content_family'));
 const ready=await fresh.request(`/me/skill-matrix?resumeId=${fresh.resumeId}`);assert.equal(getLevel(ready.data).available,true);
 const issued=await fresh.request('/me/skill-attempts','POST',{resumeId:fresh.resumeId,skillId:'python',level:'Senior',programVersion:SKILL_BANK_VERSION});assert.equal(issued.status,201);noKeys(issued.data);
 const exhaustedMatrix=await exhausted.request(`/me/skill-matrix?resumeId=${exhausted.resumeId}`);assert.equal(getLevel(exhaustedMatrix.data).available,false);
 const exhaustedStart=await exhausted.request('/me/skill-attempts','POST',{resumeId:exhausted.resumeId,skillId:'python',level:'Senior',programVersion:SKILL_BANK_VERSION});assert.equal(exhaustedStart.status,503);
 checks.push({name:'Explicit audited CLI enable clears historical aliases; old-v4 exhausted families remain exhausted under v6',status:'PASS',auditRows:auditRows.map(r=>({id:r.id,action:r.action,contentFamilyId:(r.details as any).contentFamilyId}))});
}
async function legacyProof(){
 const a=await actor(),body={purpose:'signal_qualification',gradeConfirmed:true,programId:'backend-python',grade:'Junior',resumeId:a.resumeId};
 const registry=await a.request('/assessments/programs');assert.equal(registry.status,200);assert.ok(registry.data.every((p:any)=>p.available===false));
 const denied=await a.request('/assessments/attempts','POST',body);assert.equal(denied.status,409);assert.equal(denied.data.code,'SKILL_MODULE_QUALIFICATION_REQUIRED');
 assert.equal((await db.select({id:legacy.id}).from(legacy).where(eq(legacy.userId,a.id))).length,0);
 const fixture=assembleManagedAttempt('backend-python','Junior',`${prefix}-legacy-fixture`,{programVersion:'signal-backend-python-v5',forcedVariant:0});
 const startedAt=new Date(),[row]=await db.insert(legacy).values({userId:a.id,purpose:'signal_qualification',purposeOrigin:'legacy_signal_bank',resumeId:a.resumeId,resumeRevision:1,resumeSpecialization:'Backend / Python',programVersion:'signal-backend-python-v5',programId:'backend-python',grade:'Junior',status:'in_progress',...fixture,startedAt,dueAt:new Date(+startedAt+45*60000)}).returning();assert.ok(row);const before=privateHash(row);
 const restored=await a.request('/assessments/attempts','POST',body);assert.equal(restored.status,200);assert.equal(restored.data.id,row.id);noKeys(restored.data);
 const read=await a.request(`/assessments/attempts/${row.id}`);assert.equal(read.status,200);noKeys(read.data);
 const answers=fixture.cases.map(c=>({caseId:c.id,answer:fixture.oracles[c.id]!.answer}));
 const saved=await a.request(`/assessments/attempts/${row.id}/answers`,'PUT',{resumeId:a.resumeId,answers});assert.equal(saved.status,200);
 const submitted=await a.request(`/assessments/attempts/${row.id}/submit`,'POST',{resumeId:a.resumeId});assert.equal(submitted.status,200);noKeys(submitted.data);
 const [after]=await db.select().from(legacy).where(eq(legacy.id,row.id));assert.equal(privateHash(after),before);assert.equal(after!.status,'submitted');
 fixtureHashes.push({type:'synthetic-legacy-v5',id:row.id,hash:before});checks.push({name:`Legacy ${mode}: registry issuance closed; fresh start409; existing read/save/submit intact`,status:'PASS'});
}
async function researchGateProof(){
 if(!operatorIdText){checks.push({name:'Research operator study creation',status:'NOT_RUN',reason:'No reserved isolated operator supplied; must not use existing real operator'});return;}
 const fixed=Number(operatorIdText);assert.equal(fixed,900008301);const op=await actor(fixed);const access=await op.request('/research/access');assert.equal(access.status,200);assert.equal(access.data.operator,true);
 const deny=await op.request('/research/studies','POST',{title:'Изолированная проверка retired-bank issuance',programId:'backend-python',grade:'Junior',retentionDays:1});assert.equal(deny.status,409);
 const fixture=assembleManagedAttempt('backend-python','Junior',`${prefix}-research-fixture`,{programVersion:'signal-backend-python-v5',forcedVariant:0});
 const version='signal-backend-python-v5',forms={A:{...fixture,templateIds:[]},B:{...fixture,templateIds:[]}};
 const [study]=await db.insert(studies).values({ownerUserId:op.id,title:`${prefix}-fixture`,programId:'backend-python',grade:'Junior',retentionDays:1,protocolVersion:RESEARCH_PROTOCOL_VERSION,protocolSnapshot:{frozenAt:new Date().toISOString(),programVersion:version,scoreThreshold:67,criticalCriteriaRequired:true,forms}}).returning();assert.ok(study);
 const candidate=await actor(),enroll=await candidate.request(`/research/studies/${study.id}/enroll`,'POST',{consent:true,consentVersion:RESEARCH_CONSENT_VERSION});assert.equal(enroll.status,409);
 const [enrollment]=await db.insert(enrollments).values({studyId:study.id,userId:candidate.id,pseudonym:`P-${prefix}`,order:'AB',consentVersion:RESEARCH_CONSENT_VERSION,expiresAt:new Date(Date.now()+3600_000),independentGrade:'Junior',independentBasis:'Synthetic declared fixture group only; no human inference',groupAssignedAt:new Date()}).returning();assert.ok(enrollment);
 const startedAt=new Date(),[row]=await db.insert(researchAttempts).values({enrollmentId:enrollment.id,form:'A',programVersion:version,...fixture,startedAt,dueAt:new Date(+startedAt+45*60000)}).returning();assert.ok(row);const before=privateHash(row);
 const existingEnroll=await candidate.request(`/research/studies/${study.id}/enroll`,'POST',{consent:true,consentVersion:RESEARCH_CONSENT_VERSION});assert.equal(existingEnroll.status,200);assert.equal(existingEnroll.data.enrollmentId,enrollment.id);
 const restored=await candidate.request(`/research/studies/${study.id}/attempts/start`,'POST',{});assert.equal(restored.status,200);assert.equal(restored.data.attemptId,row.id);
 const read=await candidate.request(`/research/attempts/${row.id}`);assert.equal(read.status,200);noKeys(read.data);
 const saved=await candidate.request(`/research/attempts/${row.id}/answers`,'PUT',{responses:fixture.cases.map(c=>({caseId:c.id,answer:fixture.oracles[c.id]!.answer,activeMs:500,skipped:false,ambiguous:false}))});assert.equal(saved.status,200);
 const submitted=await candidate.request(`/research/attempts/${row.id}/submit`,'POST',{});assert.equal(submitted.status,200);assert.equal(submitted.data.profileChanged,false);noKeys(submitted.data);
 const [after]=await db.select().from(researchAttempts).where(eq(researchAttempts.id,row.id));assert.equal(privateHash(after),before);
 const newForm=await candidate.request(`/research/studies/${study.id}/attempts/start`,'POST',{});assert.equal(newForm.status,409);
 fixtureHashes.push({type:'synthetic-research-v5',id:row.id,hash:before});checks.push({name:'Research new study/new enrollment/new form denied; existing enrollment and frozen attempt read/save/submit preserved',status:'PASS',studyId:study.id});
}
try{
 if(mode==='on')await moduleProof();else{const a=await actor();const disabled=await a.request('/me/skill-matrix');assert.equal(disabled.status,503);assert.equal(disabled.data.code,'skill_modules_disabled');checks.push({name:'Module flag off is truthfully unavailable',status:'PASS'});}
 await legacyProof();await researchGateProof();passed=true;
}catch(error){failure=error instanceof Error?error.stack:String(error);throw error;}
finally{
 // Family enable is explicit and audited; never silently erase audit history. Restore owned bans on failure.
 if(changedIds.length&&!passed)for(const id of changedIds)try{cli('enable',id);}catch{}
 if(owned.length)await db.delete(users).where(inArray(users.id,owned));
 const remainingActors=owned.length?(await db.select({id:users.id}).from(users).where(inArray(users.id,owned))).length:0;
 const remainingSessions=owned.length?(await db.select({id:sessions.userId}).from(sessions).where(inArray(sessions.userId,owned))).length:0;
 const remainingModuleAttempts=owned.length?(await db.select({id:modules.id}).from(modules).where(inArray(modules.userId,owned))).length:0;
 const remainingLegacyAttempts=owned.length?(await db.select({id:legacy.id}).from(legacy).where(inArray(legacy.userId,owned))).length:0;
 const researchIds=fixtureHashes.filter(f=>f.type==='synthetic-research-v5').map(f=>f.id);
 const remainingResearchAttempts=researchIds.length?(await db.select({id:researchAttempts.id}).from(researchAttempts).where(inArray(researchAttempts.id,researchIds))).length:0;
 await mkdir(directory,{recursive:true});const receipt=`${directory}/live-bank-${mode}-${prefix}.json`;
 await writeFile(receipt,JSON.stringify({passed:passed&&remainingActors===0&&remainingSessions===0&&remainingModuleAttempts===0&&remainingLegacyAttempts===0&&remainingResearchAttempts===0,failure,checks,fixtureHashes,runtime:{bundlePath:normalized,bundleSha256:bundlePin,pid:Number(pid),api,web,database:database.pathname,mode},ownedActorIds:owned,cleanup:{remainingActors,remainingSessions,remainingModuleAttempts,remainingLegacyAttempts,remainingResearchAttempts,operatorOverrides:'active restored by explicit audited enable; isolated append-only audit retained'},measuredAt:new Date().toISOString(),limitations:['Bounded disposable fixtures only; no human calibration or load test.','Historical versions are synthetic fixtures built from preserved historical generators; no pre-existing attempt was altered or regenerated.','Private oracle-assisted answers only verify snapshot persistence and compatibility, not professional skill.']},null,2));await pool.end();console.log(JSON.stringify({passed,checks:checks.length,remainingActors,remainingSessions,remainingModuleAttempts,remainingLegacyAttempts,remainingResearchAttempts,receipt}));
}
