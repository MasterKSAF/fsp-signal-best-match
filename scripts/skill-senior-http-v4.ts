/** Bounded owned-fixture HTTP verification. Oracle-assisted submissions are not a human Senior validation. */
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { and, eq, inArray } from 'drizzle-orm';
import { db, pool, signalUsersTable as users, signalSessionsTable as sessions, signalCompaniesTable as companies, signalSkillAttemptsTable as attempts, signalSkillEvidenceTable as evidence, signalSkillExposuresTable as exposures } from '../lib/db/src/index';
import { hashPassword } from '../artifacts/api-server/src/lib/signal-auth';
import { buildSkillAttempt, skillModuleRegistry, SKILL_BANK_VERSION, SENIOR_SKILL_RUBRIC_VERSION } from '../artifacts/api-server/src/lib/skill-module-bank';
const database=new URL(process.env.DATABASE_URL!);
assert.equal(database.hostname,'127.0.0.1');assert.equal(database.port,'55435');assert.equal(database.pathname,'/signal_ui_refinement_20261008');
assert.equal(process.env.SIGNAL_SKILL_MODULES_ENABLED,'true');assert.equal(process.env.NODE_ENV,'test');
const [bundlePath,expectedSha,expectedPid]=process.argv.slice(2);
assert.equal(bundlePath?.replaceAll('\\','/'),'C:/Users/Misha/Documents/ChatGPT/LCT/signal-ui-refinement-workspace-20261008/outputs/runtime/ui-refinement-iteration02/dist/index.mjs');
assert.match(expectedSha??'',/^[a-f0-9]{64}$/);assert.match(expectedPid??'',/^\d+$/);
const sha=createHash('sha256').update(await readFile(bundlePath!)).digest('hex');assert.equal(sha,expectedSha);
const runtimeScript="$ProgressPreference = 'SilentlyContinue'; $seniorListeners = @(Get-NetTCPConnection -LocalPort 4371 -State Listen | Select-Object -ExpandProperty OwningProcess -Unique); if ($seniorListeners.Count -ne 1) { throw 'Expected one API listener' }; $seniorApi = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $seniorListeners[0]); @{pid=$seniorApi.ProcessId; commandLine=$seniorApi.CommandLine} | ConvertTo-Json -Compress";
const actual=JSON.parse(execFileSync('C:/Users/Misha/AppData/Local/Programs/PowerShell/7/pwsh.exe',['-NoLogo','-NoProfile','-EncodedCommand',Buffer.from(runtimeScript,'utf16le').toString('base64')],{encoding:'utf8',timeout:15000}));
assert.equal(actual.pid,Number(expectedPid));const actualCommand=actual.commandLine.replaceAll('\\','/').toLowerCase();assert.ok(actualCommand.includes(bundlePath!.replaceAll('\\','/').toLowerCase())||actualCommand.includes(' outputs/runtime/ui-refinement-iteration02/dist/index.mjs'));
const origin='http://localhost:4371',appOrigin='http://localhost:4372';
const prefix=`senior-v4-http-${randomUUID()}`;const owned:number[]=[];const privateActors:unknown[]=[];
const dir='outputs/verification/ui-refinement-20261008/senior-http';
const checks:{name:string;status:'PASS';detail?:unknown}[]=[];const issued:{actorId:number;attemptId:number;skillId:string;mode:string;score?:number;passed?:boolean}[]=[];
let passed=false,failure:string|undefined;
const retained:number[]=[];
async function fixture(label:string){
  const password=randomUUID();const email=`${prefix}-${owned.length}@example.test`;
  const [u]=await db.insert(users).values({email,passwordHash:await hashPassword(password),displayName:label,role:'candidate',emailVerified:true,demoMode:false}).returning();assert.ok(u);owned.push(u.id);
  const token=randomBytes(32).toString('base64url');await db.insert(sessions).values({userId:u.id,tokenHash:createHash('sha256').update(token).digest('hex'),expiresAt:new Date(Date.now()+24*3600_000),demoMode:false});
  const request=async(path:string,method='GET',body?:unknown)=>{const r=await fetch(origin+'/api'+path,{method,headers:{Cookie:'fsp_signal_session='+token,Origin:appOrigin,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});const raw=await r.text();let data:any;try{data=raw?JSON.parse(raw):undefined;}catch{data={nonJson:true};}return{status:r.status,data};};
  const ok=async(path:string,method='GET',body?:unknown,status=200)=>{const r=await request(path,method,body);assert.equal(r.status,status,`${method} ${path}: ${r.data?.error??''}`);return r.data;};
  const list=await ok('/me/resumes');assert.ok(list.resumes?.[0]);const first=list.resumes[0];
  const other=await ok('/me/resumes','POST',{title:'Frontend-разработчик',specialization:'Frontend / TypeScript'},201);
  privateActors.push({id:u.id,email,password,label,resumeIds:[first.id,other.id]});return{id:u.id,request,ok,resumeId:first.id,otherResumeId:other.id};
}
type Actor=Awaited<ReturnType<typeof fixture>>;
async function profile(a:Actor,resumeId:number,specialization:string,stack:string[]){
  const p=await a.ok(`/me/candidate-profile?resumeId=${resumeId}`);
  await a.ok('/me/candidate-profile','PUT',{...p,resumeId,revision:p.revision,identityRevision:p.identityRevision,specialization,stack,skills:stack,assumedGrade:'Senior',visibility:'private',consentMatching:false,consentCatalog:false});
}
function noKeys(body:unknown){assert.doesNotMatch(JSON.stringify(body),/"(?:oracles|expected|answerKey|seed)"\s*:/);}
async function issue(a:Actor,skillId:string,resumeId=a.resumeId){
  const raw=await a.ok('/me/skill-attempts','POST',{resumeId,skillId,level:'Senior',programVersion:SKILL_BANK_VERSION},201);noKeys(raw);
  const form=raw.attempt;assert.equal(form.skillId,skillId);assert.equal(form.level,'Senior');assert.equal(form.programVersion,SKILL_BANK_VERSION);assert.equal(form.policy.rubricVersion,SENIOR_SKILL_RUBRIC_VERSION);assert.equal(form.policy.durationMinutes,45);assert.equal(Date.parse(form.expiresAt)-Date.parse(form.startedAt),45*60000);
  const module=skillModuleRegistry.find(m=>m.id===skillId)!;assert.equal(form.cases.length,6);assert.deepEqual(form.cases.filter((c:any)=>c.critical).map((c:any)=>c.competencyId),module.competencies.filter(id=>module.seniorCriticalCompetencies.includes(id)));
  assert.ok(form.cases.every((c:any)=>c.templateId.includes(':Senior:')&&c.templateVersion===1&&c.seniorOutcome&&c.levelRequirementId.startsWith(`${skillId}:senior-outcome-v1:`)&&c.contentFamilyId.startsWith(`skill-senior-content-v1:${skillId}:`)));
  assert.deepEqual(form.feedback,[]);return form;
}
async function submit(a:Actor,form:any,mode:'full'|'noncritical'|'critical'){
  assert.ok(owned.includes(a.id));const [stored]=await db.select().from(attempts).where(and(eq(attempts.id,form.id),eq(attempts.userId,a.id)));assert.ok(stored);
  const before=JSON.stringify({cases:stored.cases,oracles:stored.oracles,policy:stored.policy,programVersion:stored.programVersion,startedAt:stored.startedAt,expiresAt:stored.expiresAt});
  const answers=Object.fromEntries(stored.cases.map(c=>[c.id,stored.oracles[c.id]!.expected]));
  const missed=mode==='full'?undefined:stored.cases.find(c=>c.critical===(mode==='critical'))!;
  if(missed)answers[missed.id]=`${stored.oracles[missed.id]!.parts![0]!.expected};wrong invariant plan`;
  const saved=await a.ok(`/me/skill-attempts/${form.id}/answers`,'PUT',{revision:form.revision,answers});noKeys(saved);assert.equal(saved.attempt.decision,null);
  const submitted=await a.ok(`/me/skill-attempts/${form.id}/submit`,'POST',{revision:saved.attempt.revision,answers});noKeys(submitted);
  const decision=submitted.attempt.decision;assert.equal(decision.passed,mode!=='critical');assert.equal(decision.score,mode==='full'?100:83);assert.equal(decision.criticalComplete,mode!=='critical');assert.equal(decision.levelCoverage.length,6);
  const [after]=await db.select().from(attempts).where(eq(attempts.id,form.id));assert.ok(after);assert.equal(JSON.stringify({cases:after.cases,oracles:after.oracles,policy:after.policy,programVersion:after.programVersion,startedAt:after.startedAt,expiresAt:after.expiresAt}),before);
  const proofRows=await db.select().from(evidence).where(and(eq(evidence.userId,a.id),eq(evidence.attemptId,form.id)));assert.equal(proofRows.length,mode==='critical'?0:1);
  const matrix=await a.ok(`/me/skill-matrix?resumeId=${form.resumeId}`);const proof=matrix.accountEvidence.find((e:any)=>e.skillId===form.skillId);assert.equal(Boolean(proof),mode!=='critical');if(proof)assert.equal(proof.level,'Senior');
  if(mode==='noncritical'){assert.equal(proofRows[0]!.competencyIds.length,5);assert.equal(matrix.modules.find((m:any)=>m.id===form.skillId).levels.find((l:any)=>l.level==='Senior').evidence.level,'Senior');}
  issued.push({actorId:a.id,attemptId:form.id,skillId:form.skillId,mode,score:decision.score,passed:decision.passed});return submitted.attempt;
}
async function step(name:string,run:()=>Promise<unknown>){const detail=await run();checks.push({name,status:'PASS',...(detail===undefined?{}:{detail})});}
try{
  const main=await fixture('Синтетическая проверка Senior — все навыки');await profile(main,main.resumeId,'Backend / Python',['Python','SQL']);await profile(main,main.otherResumeId,'Frontend / TypeScript',['TypeScript','React']);
  await step('Exact Senior version is required; mismatched/missing version and unsupported skill create no attempt',async()=>{
    const before=(await db.select({id:attempts.id}).from(attempts).where(eq(attempts.userId,main.id))).length;
    for(const version of [undefined,'signal-skills-2026-10-v3']){const r=await main.request('/me/skill-attempts','POST',{resumeId:main.resumeId,skillId:'python',level:'Senior',...(version?{programVersion:version}:{})});assert.equal(r.status,409);assert.equal(r.data.code,'skill_program_version_conflict');}
    assert.equal((await main.request('/me/skill-attempts','POST',{resumeId:main.resumeId,skillId:'PostgreSQL',level:'Senior',programVersion:SKILL_BANK_VERSION})).status,422);
    assert.equal((await db.select({id:attempts.id}).from(attempts).where(eq(attempts.userId,main.id))).length,before);
  });
  for(const module of skillModuleRegistry){
    const resumeId=['typescript','react','frontend-engineering'].includes(module.id)?main.otherResumeId:main.resumeId;
    await step(`${module.id}: full Senior HTTP pass, frozen45min/version/critical snapshot and account proof`,async()=>{
      const form=await issue(main,module.id,resumeId);
      const restored=await main.ok('/me/skill-attempts','POST',{resumeId:resumeId===main.resumeId?main.otherResumeId:main.resumeId,skillId:module.id,level:'Senior',programVersion:SKILL_BANK_VERSION});assert.equal(restored.attempt.id,form.id);assert.equal(restored.attempt.resumeId,resumeId);noKeys(restored);
      assert.equal((await db.select().from(exposures).where(eq(exposures.attemptId,form.id))).length,6);
      await submit(main,form,'full');
      const retry=await main.request('/me/skill-attempts','POST',{resumeId:resumeId===main.resumeId?main.otherResumeId:main.resumeId,skillId:module.id,level:'Senior',programVersion:SKILL_BANK_VERSION});assert.equal(retry.status,429);assert.equal(retry.data.code,'module_retry');
      return{attemptId:form.id,originalResumeId:resumeId,critical:module.seniorCriticalCompetencies};
    });
  }
  await step('Senior Backend and Frontend categories require all3 independent slots, no digital grade',async()=>{
    for(const resumeId of [main.resumeId,main.otherResumeId]){const matrix=await main.ok(`/me/skill-matrix?resumeId=${resumeId}`);assert.equal(matrix.qualification.verifiedGrade,'Senior');assert.equal(matrix.qualification.verifiedScore,null);assert.equal(matrix.qualification.category.matrixVersion,'signal-category-competency-matrix-v2');assert.equal(matrix.qualification.category.requirements.length,3);assert.equal((await main.ok(`/me/candidate-profile?resumeId=${resumeId}`)).verifiedGrade,'Senior');}
    assert.equal((await main.ok('/me/skill-matrix')).accountEvidence.length,6);return{actorId:main.id,resumeIds:[main.resumeId,main.otherResumeId]};
  });
  for(const module of skillModuleRegistry)for(const mode of ['noncritical','critical'] as const){
    const a=await fixture(`Синтетическая проверка ${module.title} Senior ${mode}`);
    await step(`${module.id}: ${mode} omission83 has the documented pass/proof outcome`,async()=>{
      const form=await issue(a,module.id);await submit(a,form,mode);
      assert.equal((await a.request(`/me/skill-attempts/${issued[0]!.attemptId}`)).status,404);
      return{actorId:a.id,attemptId:form.id,passed:mode==='noncritical',retainedProof:mode==='noncritical'};
    });
  }
  const rotating=await fixture('Синтетическая проверка Senior rotation');
  await step('Expired owned form issues unseen Senior families; the real same-skill daily limit then blocks',async()=>{
    const first=await issue(rotating,'python');
    // Only an owned synthetic active row is expired to reproduce a time boundary, never a submitted/historical user attempt.
    await db.update(attempts).set({status:'expired',expiresAt:new Date(Date.now()-1)}).where(and(eq(attempts.id,first.id),eq(attempts.userId,rotating.id)));
    const second=await issue(rotating,'python');assert.ok(second.cases.every((c:any,i:number)=>c.contentFamilyId!==first.cases[i].contentFamilyId));
    await db.update(attempts).set({status:'expired',expiresAt:new Date(Date.now()-1)}).where(and(eq(attempts.id,second.id),eq(attempts.userId,rotating.id)));
    const third=await rotating.request('/me/skill-attempts','POST',{resumeId:rotating.otherResumeId,skillId:'python',level:'Senior',programVersion:SKILL_BANK_VERSION});assert.equal(third.status,429);assert.equal(third.data.code,'module_issue_limit');
    return{actorId:rotating.id,actualHttpIssued:[first.id,second.id],familiesDiffer:true,fixtureExpirySimulation:true};
  });
  const exhausted=await fixture('Синтетическая проверка Senior exhausted pool');
  await step('Seeded owned historical exposures exhaust all18 Senior families; HTTP refuses without fallback/new form',async()=>{
    const personal=new Map<string,number>();const old=new Date(Date.now()-48*3600000);
    for(let i=0;i<3;i++){
      const form=buildSkillAttempt('sql','Senior',`${prefix}-exhaust-${i}`,{personalExposures:personal});
      const [row]=await db.insert(attempts).values({userId:exhausted.id,resumeId:exhausted.resumeId,skillId:'sql',level:'Senior',...form,status:'expired',startedAt:old,expiresAt:new Date(+old+45*60000)}).returning();assert.ok(row);
      await db.insert(exposures).values(form.cases.map(c=>({userId:exhausted.id,attemptId:row.id,templateId:c.templateId,issuedAt:old})));for(const c of form.cases)personal.set(c.templateId,1);
    }
    const before=(await db.select({id:attempts.id}).from(attempts).where(eq(attempts.userId,exhausted.id))).length;
    const blocked=await exhausted.request('/me/skill-attempts','POST',{resumeId:exhausted.resumeId,skillId:'sql',level:'Senior',programVersion:SKILL_BANK_VERSION});assert.equal(blocked.status,503);assert.equal(blocked.data.code,'skill_bank_unavailable');
    assert.equal((await db.select({id:attempts.id}).from(attempts).where(eq(attempts.userId,exhausted.id))).length,before);
    return{actorId:exhausted.id,seededExpiredSnapshots:3,seededSeenFamilies:18,actualHttpStatus:blocked.status};
  });
  await step('Retain only a normal sign-in synthetic Senior profile and isolated employer for independent browser review',async()=>{
    for(const resumeId of [main.resumeId,main.otherResumeId]){
      const p=await main.ok(`/me/candidate-profile?resumeId=${resumeId}`);
      await main.ok('/me/candidate-profile','PUT',{...p,resumeId,revision:p.revision,identityRevision:p.identityRevision,visibility:'public',consentCatalog:true,consentMatching:true,readyForOffers:true,phone:null,contactEmail:null});
    }
    retained.push(main.id);
    const password=randomUUID(),email=`${prefix}-employer@example.test`;
    const [employer]=await db.insert(users).values({email,passwordHash:await hashPassword(password),displayName:'Синтетическая проверка Senior — работодатель',role:'employer',emailVerified:true,demoMode:false}).returning();assert.ok(employer);owned.push(employer.id);retained.push(employer.id);
    await db.insert(companies).values({ownerUserId:employer.id,name:'Тестовая компания Senior review',contactEmail:email});
    privateActors.push({id:employer.id,email,password,label:'Senior review employer',role:'employer'});
    return{candidateId:main.id,employerId:employer.id,resumeIds:[main.resumeId,main.otherResumeId],credentialsFile:'C:/Users/Misha/.codex/private/signal-senior-v4-http-actors-20261008.json',publicSyntheticCv:true,contactsEmpty:true};
  });
  passed=true;
}catch(error){failure=error instanceof Error?error.message:String(error);throw error;}
finally{
  await mkdir(dir,{recursive:true});
  const sourceFiles=['artifacts/api-server/src/lib/skill-module-bank.ts','artifacts/api-server/src/lib/skill-module-qualification.ts','artifacts/api-server/src/lib/skill-senior-outcomes.ts','artifacts/api-server/src/lib/skill-senior-reviewed-choices.ts'];
  const source=await Promise.all(sourceFiles.map(async path=>({path,sha256:createHash('sha256').update(await readFile(path)).digest('hex')})));
  const cleanupIds=owned.filter(id=>!passed||!retained.includes(id));if(cleanupIds.length)await db.delete(users).where(inArray(users.id,cleanupIds));
  const receipt={passed,failure,checks,issued,ownedActorIds:owned,ownedActorCount:owned.length,retainedActorIds:passed?retained:[],cleanedActorIds:cleanupIds,runtime:{bundlePath,sha256:sha,pid:actual.pid,api:origin,web:appOrigin,database:database.pathname},source,bankVersion:SKILL_BANK_VERSION,rubricVersion:SENIOR_SKILL_RUBRIC_VERSION,assistance:'Full/partial HTTP answers read only private oracle snapshots of owned synthetic fixtures. This verifies routing/scoring/privacy/persistence, not human ability or Senior calibration.',limitations:['Python/SQL/TypeScript oracle content has separate independent runtime evidence; HTTP success alone is not content/hiring validation.','Expiry simulation modifies only owned synthetic active rows; exhausted-pool history is explicitly synthetic seed data.','No existing user/session/proof/attempt is modified.'],measuredAt:new Date().toISOString()};
  await writeFile(`${dir}/senior-http-v4-receipt.json`,JSON.stringify(receipt,null,2));
  await writeFile('C:/Users/Misha/.codex/private/signal-senior-v4-http-actors-20261008.json',JSON.stringify({prefix,actors:privateActors.filter((a:any)=>passed&&retained.includes(a.id))},null,2));
  await pool.end();console.log(JSON.stringify({passed,checks:checks.length,ownedActors:owned.length,receipt:`${dir}/senior-http-v4-receipt.json`}));
}
