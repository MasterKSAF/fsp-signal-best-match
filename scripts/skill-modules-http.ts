/** Owned isolated actors, real HTTP issuance/submission. Private oracle reads are synthetic test assistance, never a human qualification validation. */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, pool, signalUsersTable as users, signalSessionsTable as sessions, signalCompaniesTable as companies, signalSkillAttemptsTable as attempts, signalSkillEvidenceTable as evidence, signalSkillExposuresTable as exposures, signalSkillCategoriesTable as categories } from '../lib/db/src/index';
import { hashPassword } from '../artifacts/api-server/src/lib/signal-auth';
const database=new URL(process.env.DATABASE_URL!); assert.equal(database.hostname,'127.0.0.1');assert.equal(database.port,'55435');assert.equal(database.pathname,'/signal_independent_fixes_20261007');
assert.equal(process.env.SIGNAL_SKILL_MODULES_ENABLED,'true');
const receiptName=process.env.SKILL_HTTP_RECEIPT??'skill-modules-http';assert.ok(['skill-modules-http','skill-modules-correction-02-http'].includes(receiptName));
let runtime:Record<string,unknown>|undefined;
if(receiptName==='skill-modules-correction-02-http') {
 const [bundlePath,expectedSha,expectedPid]=process.argv.slice(2);assert.ok(bundlePath?.replaceAll('\\','/').startsWith('C:/Users/Misha/Documents/ChatGPT/LCT/fsp-signal/outputs/local-backup/'));assert.match(expectedSha??'',/^[a-f0-9]{64}$/);assert.match(expectedPid??'',/^\d+$/);
 const sha=createHash('sha256').update(await readFile(bundlePath!)).digest('hex');assert.equal(sha,expectedSha);
 const script="$taskListeners = @(Get-NetTCPConnection -LocalPort 4367 -State Listen | Select-Object -ExpandProperty OwningProcess -Unique); if ($taskListeners.Count -ne 1) { throw 'Expected one API listener' }; $taskApi = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $taskListeners[0]); @{pid=$taskApi.ProcessId; commandLine=$taskApi.CommandLine} | ConvertTo-Json -Compress";
 const actual=JSON.parse(execFileSync('C:/Users/Misha/AppData/Local/Programs/PowerShell/7/pwsh.exe',['-NoLogo','-NoProfile','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{encoding:'utf8',timeout:15000}));assert.equal(actual.pid,Number(expectedPid));assert.ok(actual.commandLine.replaceAll('\\','/').toLowerCase().includes(bundlePath!.replaceAll('\\','/').toLowerCase()));runtime={bundlePath,sha256:sha,pid:actual.pid};
}
const origin='http://localhost:4367', appOrigin='http://localhost:4368'; const prefix=`skill-http-${randomUUID()}`;const owned:number[]=[];const checks:{name:string;status:'PASS'}[]=[];
const dir='outputs/verification/candidate-workspace-skill-matrix-20261008'; const actors:any[]=[];
const actualAttempts:{id:number;skill:string;level:string;programVersion:string;rubricVersion:string}[]=[];
async function fixture(role:'candidate'|'employer'='candidate',name='Артём Дмитриевич Лебедев') {
 const password=randomUUID();const [u]=await db.insert(users).values({email:`${prefix}-${owned.length}@example.test`,passwordHash:await hashPassword(password),displayName:name,role,emailVerified:true,demoMode:false}).returning();assert.ok(u);owned.push(u.id);
 if(role==='employer')await db.insert(companies).values({ownerUserId:u.id,name:name==='Компания А'?'Ладога Лаб':'Северная Платформа',contactEmail:u.email});
 const token=randomBytes(32).toString('base64url');await db.insert(sessions).values({userId:u.id,tokenHash:createHash('sha256').update(token).digest('hex'),expiresAt:new Date(Date.now()+24*3600_000),demoMode:false});
 const request=async(path:string,method='GET',body?:unknown)=>{const r=await fetch(origin+'/api'+path,{method,headers:{Cookie:'fsp_signal_session='+token,Origin:appOrigin,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20_000)});const raw=await r.text();let data:any;try{data=raw?JSON.parse(raw):undefined;}catch{data={nonJson:true};}return{status:r.status,data};};
 const ok=async(path:string,method='GET',body?:unknown,status=200)=>{const r=await request(path,method,body);assert.equal(r.status,status,`${method} ${path}: ${r.data?.error??''}`);return r.data;};
 actors.push({id:u.id,email:u.email,password,role,displayName:name,token});return{id:u.id,request,ok};
}
type Actor=Awaited<ReturnType<typeof fixture>>;
async function setProfile(a:Actor,resumeId:number,specialization:string,stack:string[],grade='Junior') {
 const p=await a.ok(`/me/candidate-profile?resumeId=${resumeId}`);
 await a.ok('/me/candidate-profile','PUT',{...p,resumeId,revision:p.revision,identityRevision:p.identityRevision,specialization,stack,skills:stack,assumedGrade:grade,visibility:'public',consentMatching:true,consentCatalog:true,readyForOffers:true,phone:'+79990005510',contactEmail:`contacts-${prefix}@example.test`,salaryMin:100000,salaryMax:200000,workFormat:'Удалённо'});
}
async function start(a:Actor,resumeId:number,skillId:string,level='Junior') {const attempt=(await a.ok('/me/skill-attempts','POST',{resumeId,skillId,level},201)).attempt;if(receiptName==='skill-modules-correction-02-http'){assert.equal(attempt.programVersion,'signal-skills-2026-10-v2');assert.equal(attempt.policy.rubricVersion,'six-competencies-critical-5of6-middle-outcomes-v3');}actualAttempts.push({id:attempt.id,skill:skillId,level,programVersion:attempt.programVersion,rubricVersion:attempt.policy.rubricVersion});return attempt;}
async function solve(a:Actor,attempt:any,pass=true) {
 assert.ok(owned.includes(a.id));const [stored]=await db.select().from(attempts).where(and(eq(attempts.id,attempt.id),eq(attempts.userId,a.id)));assert.ok(stored);
 const answers=Object.fromEntries(stored.cases.map(c=>[c.id,pass?stored.oracles[c.id]!.expected:'incorrect synthetic answer']));
 const saved=await a.ok(`/me/skill-attempts/${attempt.id}/answers`,'PUT',{revision:attempt.revision,answers});
 const response=await a.ok(`/me/skill-attempts/${attempt.id}/submit`,'POST',{revision:saved.attempt.revision,answers});
 assert.equal(response.attempt.decision.passed,pass);assert.doesNotMatch(JSON.stringify(response),/"oracles"|"expected"|"seed"|"answerKey"/);return response.attempt;
}
async function step(name:string,run:()=>Promise<void>){await run();checks.push({name,status:'PASS'});}
let passed=false,failure:string|undefined;const fixtureInfo:Record<string,unknown>={};
try{
 const a=await fixture(), foreign=await fixture('candidate','Вера Андреевна Савельева'), limits=await fixture('candidate','Денис Павлович Миронов');const employerA=await fixture('employer','Компания А'),employerB=await fixture('employer','Компания Б');
 const backend=(await a.ok('/me/resumes')).resumes[0];await setProfile(a,backend.id,'Backend / Python',['Python','SQL']);
 const frontend=await a.ok('/me/resumes','POST',{title:'Frontend · интерфейсы продукта',specialization:'Frontend / TypeScript'},201);await setProfile(a,frontend.id,'Frontend / TypeScript',['TypeScript','React']);
 fixtureInfo.candidateId=a.id;fixtureInfo.backendResumeId=backend.id;fixtureInfo.frontendResumeId=frontend.id;fixtureInfo.employerA=employerA.id;fixtureInfo.employerB=employerB.id;
 await step('Matrix is owner-scoped; unavailable Senior and foreign resume never fall back',async()=>{
  const m=await a.ok(`/me/skill-matrix?resumeId=${backend.id}`);assert.equal(m.modules.length,6);assert.ok(m.modules.every((x:any)=>!x.levels.find((l:any)=>l.level==='Senior').available));
  assert.equal((await a.request('/me/skill-attempts','POST',{resumeId:backend.id,skillId:'React',level:'Senior'})).status,422);
  assert.equal((await foreign.request(`/me/skill-matrix?resumeId=${backend.id}`)).status,404);assert.equal((await employerA.request(`/me/skill-matrix?resumeId=${backend.id}`)).status,403);
 });
 let py:any;
 await step('Parallel start and reload issue one frozen account-owned form; exposure counted once',async()=>{
  const body={resumeId:backend.id,skillId:'python',level:'Junior'};
  const pair=await Promise.all([a.request('/me/skill-attempts','POST',body),a.request('/me/skill-attempts','POST',body)]);assert.deepEqual(pair.map(r=>r.status).sort(),[200,201]);assert.equal(pair[0]!.data.attempt.id,pair[1]!.data.attempt.id);py=pair[0]!.data.attempt;
  const restored=(await a.ok('/me/skill-attempts','POST',{...body,resumeId:frontend.id})).attempt;assert.equal(restored.id,py.id);assert.equal(restored.resumeId,backend.id);
  assert.equal((await db.select().from(exposures).where(eq(exposures.attemptId,py.id))).length,6);
  assert.deepEqual((await a.ok(`/me/skill-attempts/${py.id}`)).cases,py.cases);
  for(const suffix of['','/answers','/submit'])assert.equal((await foreign.request(`/me/skill-attempts/${py.id}${suffix}`,suffix===''?'GET':suffix==='/answers'?'PUT':'POST',suffix===''?undefined:{revision:1,answers:{}})).status,404);
 });
 await step('Answer conflict preserves draft; keys never reach browser, then Python Junior succeeds',async()=>{
  const save=await a.ok(`/me/skill-attempts/${py.id}/answers`,'PUT',{revision:py.revision,answers:{q1:'draft'}});
  assert.equal((await a.request(`/me/skill-attempts/${py.id}/answers`,'PUT',{revision:py.revision,answers:{q1:'overwrite'}})).status,409);
  assert.equal((await a.ok(`/me/skill-attempts/${py.id}`)).answers.q1,'draft');py=await solve(a,save.attempt);
  assert.equal((await a.request('/me/skill-attempts','POST',{resumeId:frontend.id,skillId:'python',level:'Junior'})).status,429);
 });
 await step('Distinct Python Junior, SQL Middle and React Junior proofs; no automatic overall grade',async()=>{
  const middle=await solve(a,await start(a,backend.id,'sql','Middle'));assert.equal(middle.decision.levelCoverage.length,6);assert.ok(middle.decision.levelCoverage.every((x:any)=>x.passed));assert.ok(middle.cases.every((c:any)=>c.middleOutcome&&c.levelRequirementId&&c.contentFamilyId));await solve(a,await start(a,frontend.id,'react','Junior'));
  const m=await a.ok(`/me/skill-matrix?resumeId=${backend.id}`);assert.deepEqual(m.accountEvidence.map((x:any)=>[x.skillId,x.level]),[['python','Junior'],['react','Junior'],['sql','Middle']]);assert.equal(m.qualification.verifiedGrade,null);
 });
 await step('Both specialty categories close only after mandatory language/framework and engineering',async()=>{
  await solve(a,await start(a,backend.id,'backend-engineering'));await solve(a,await start(a,frontend.id,'typescript'));await solve(a,await start(a,frontend.id,'frontend-engineering'));
  for(const id of[backend.id,frontend.id]){const m=await a.ok(`/me/skill-matrix?resumeId=${id}`);assert.equal(m.qualification.verifiedGrade,'Junior');assert.equal(m.qualification.verifiedScore,null);assert.equal(m.qualification.category.requirements.length,3);assert.equal((await a.ok(`/me/candidate-profile?resumeId=${id}`)).verifiedGrade,'Junior');}
  assert.equal((await db.select().from(categories).where(eq(categories.userId,a.id))).length,2);
 });
 await step('Failed later SQL Junior leaves earned SQL Middle and both valid categories intact',async()=>{
  await solve(a,await start(a,backend.id,'sql','Junior'),false);
  const m=await a.ok(`/me/skill-matrix?resumeId=${backend.id}`);assert.equal(m.accountEvidence.find((x:any)=>x.skillId==='sql').level,'Middle');assert.equal(m.qualification.verifiedGrade,'Junior');
  assert.equal((await db.select().from(evidence).where(eq(evidence.userId,a.id))).length,6);
 });
 await step('Both specialties: qualification → match → invite → accept → addressed grant → revoke',async()=>{
  for(const [resumeId,specialization,requiredSkills]of[[backend.id,'Backend / Python',['Python','SQL']],[frontend.id,'Frontend / TypeScript',['TypeScript','React']]]as const){
   const need=await employerA.ok('/employer/needs','POST',{title:`Разработчик ${specialization}`,specialization,grade:'Junior',requiredSkills,requiredSkillLevels:{[requiredSkills[0]]:'Junior'},desirableSkills:[],description:'Изолированная проверка профессиональной квалификации и адресного разрешения.',workFormat:'Удалённо',salaryMin:100000,salaryMax:200000,salaryPeriod:'month',salaryType:'gross'},201);
   const matched=await employerA.ok(`/matches?needId=${need.id}`);const rows=Array.isArray(matched)?matched:matched.matches??matched.candidates??[];const row=rows.find((x:any)=>x.candidateId===a.id&&x.resumeId===resumeId);assert.ok(row,`Qualified candidate missing for ${specialization}`);assert.equal(row.ranking.qualityScore,null);
   const invitation=await employerA.ok('/employer/invitations','POST',{idempotencyKey:`${prefix}-${resumeId}`,needId:need.id,candidateId:a.id,resumeId,title:'Обсудим задачи команды',message:'Предложение обсудить проект, условия и подтверждённые навыки.',reason:'Полное покрытие общей категории по самостоятельным модулям.',salaryMin:100000,salaryMax:200000,salaryPeriod:'month',salaryType:'gross',workFormat:'Удалённо'},201);
   assert.notEqual((await employerA.request(`/employer/invitations/${invitation.id}/contacts`)).status,200);
   await a.ok(`/me/invitations/${invitation.id}/decision`,'POST',{decision:'accept'});
   assert.equal((await employerA.request(`/employer/invitations/${invitation.id}/contacts`)).status,200);assert.notEqual((await employerB.request(`/employer/invitations/${invitation.id}/contacts`)).status,200);
   await a.ok(`/me/invitations/${invitation.id}/revoke-contact`,'POST');assert.notEqual((await employerA.request(`/employer/invitations/${invitation.id}/contacts`)).status,200);assert.notEqual((await employerB.request(`/employer/invitations/${invitation.id}/contacts`)).status,200);
  }
 });
 await step('v2 Middle base-only answers fail mandatory advanced critical coverage in actual HTTP',async()=>{
  const ownResume=(await foreign.ok('/me/resumes')).resumes[0];const attempt=await start(foreign,ownResume.id,'sql','Middle');const [stored]=await db.select().from(attempts).where(and(eq(attempts.id,attempt.id),eq(attempts.userId,foreign.id)));assert.ok(stored);const answers=Object.fromEntries(stored.cases.map(c=>[c.id,stored.oracles[c.id]!.parts![0]!.expected]));const result=await foreign.ok(`/me/skill-attempts/${attempt.id}/submit`,'POST',{revision:attempt.revision,answers});assert.equal(result.attempt.decision.passed,false);assert.equal(result.attempt.decision.criticalComplete,false);assert.ok(result.attempt.decision.levelCoverage.every((x:any)=>!x.passed));assert.equal((await foreign.ok(`/me/skill-matrix?resumeId=${ownResume.id}`)).qualification.verifiedGrade,null);
 });
 await step('Target revision guard and stronger goal do not manufacture a category',async()=>{
  const m=await a.ok(`/me/skill-matrix?resumeId=${backend.id}`);
  await a.ok('/me/skill-target','POST',{resumeId:backend.id,revision:m.resume.revision,grade:'Senior'});
  assert.equal((await a.request('/me/skill-target','POST',{resumeId:backend.id,revision:m.resume.revision,grade:'Middle'})).status,409);
  const changed=await a.ok(`/me/skill-matrix?resumeId=${backend.id}`);assert.equal(changed.qualification.verifiedGrade,'Junior');assert.ok(changed.qualification.coverage.every((c:any)=>!c.covered));
  await a.ok('/me/skill-target','POST',{resumeId:backend.id,revision:changed.resume.revision,grade:'Junior'});
 });
 await step('Abandoned/expired issuance counts across resumes and levels; restoration never consumes another slot',async()=>{
  const lr=(await limits.ok('/me/resumes')).resumes[0];const one=await start(limits,lr.id,'python');const replay=(await limits.ok('/me/skill-attempts','POST',{resumeId:lr.id,skillId:'python',level:'Junior'})).attempt;assert.equal(one.id,replay.id);
  await db.update(attempts).set({expiresAt:new Date(Date.now()-1000)}).where(and(eq(attempts.id,one.id),eq(attempts.userId,limits.id)));
  const expired=await limits.request(`/me/skill-attempts/${one.id}/submit`,'POST',{revision:one.revision,answers:{}});assert.equal(expired.status,409);
  const two=await start(limits,lr.id,'python','Middle');await db.update(attempts).set({expiresAt:new Date(Date.now()-1000)}).where(and(eq(attempts.id,two.id),eq(attempts.userId,limits.id)));
  const blocked=await limits.request('/me/skill-attempts','POST',{resumeId:lr.id,skillId:'python',level:'Junior'});assert.equal(blocked.status,429);assert.equal(blocked.data.code,'module_issue_limit');assert.ok(Number.isFinite(Date.parse(blocked.data.retryAt)));
  assert.equal((await db.select().from(exposures).where(eq(exposures.userId,limits.id))).length,12);
 });
 passed=true;
}catch(error){failure=error instanceof Error?error.message:String(error);}
finally{
 await mkdir(dir,{recursive:true});const keep=process.env.KEEP_SKILL_HTTP_FIXTURE==='true';const privatePath=`C:/Users/Misha/.codex/private/${prefix}.json`;
 if(keep)await writeFile(privatePath,JSON.stringify({fixtureId:prefix,origin:appOrigin,provenance:'Owned fictitious ordinary actors; qualification answers assisted privately for deterministic mechanics, not a human pilot.',accounts:actors,...fixtureInfo,createdAt:new Date().toISOString()},null,2));
 else if(owned.length)await db.delete(users).where(inArray(users.id,owned));
 const remaining=keep?null:(owned.length?(await db.select({id:users.id}).from(users).where(inArray(users.id,owned))).length:0);if(!keep)assert.equal(remaining,0);
 const report={passed,checks,failure,origin,runtime,actualAttempts,fixtureInfo,retained:keep,remainingOwnedActors:remaining,privateManifest:keep?privatePath:null,limitations:['Private oracle-assisted synthetic HTTP answers are not human skill or difficulty validation.','Only newly owned expired active fixture clocks were shortened for issuance-limit testing; prior results and historical actors were not modified.','Several-account bank harvesting is an unresolved risk; no IP/device accusation is introduced.'],finishedAt:new Date().toISOString()};await writeFile(`${dir}/${receiptName}.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({passed,checks:checks.length,failure,report:`${dir}/${receiptName}.json`,privateManifest:keep?privatePath:null}));await pool.end();
}if(!passed)process.exitCode=1;
