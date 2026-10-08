/** Correction C05/C06: isolated synthetic actors only, ordinary HTTP lifecycle.
 * Initial synthetic identity/session setup is confined to the dedicated E DB.
 * Only our freshly issued attempt's frozen oracle is read for test submission;
 * answers, credentials and private protocols are never written to evidence. */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomBytes, randomUUID, createHash, scryptSync } from 'node:crypto';
import pg from '../lib/db/node_modules/pg/lib/index.js';
const privateRoot='C:/Users/Misha/.codex/private';
const env=Object.fromEntries((await readFile(`${privateRoot}/signal-employer-e-20261008.env`,'utf8')).split(/\r?\n/).filter(line=>line&&!line.startsWith('#')).map(line=>{const i=line.indexOf('=');return [line.slice(0,i),line.slice(i+1).replace(/^"|"$/g,'')];}));
const address=new URL(env.DATABASE_URL);assert.equal(address.hostname,'127.0.0.1');assert.equal(address.port,'55435');assert.equal(address.pathname,'/signal_employer_e_20261008');
const origin='http://localhost:4413',uiOrigin='http://signal-employer.localhost:4414';
const runId=randomUUID(),actors=[],ids={jobs:[],applications:[],attempts:[]},checks=[],receipts=[];
const base='outputs/verification/employer-workspace-E01-E16-20261008/correction-01';
const output=`${base}/applications-${runId}`,privateFile=`${privateRoot}/signal-employer-correction01-applications-${runId}.json`;
const runtimeHash=createHash('sha256').update(await readFile(`${base}/runtime/api-01/index.mjs`)).digest('hex');
assert.equal(runtimeHash,'538960896f4011ce361242569db12e3c622520f4f526570162da9984694d2fd5');
const pool=new pg.Pool({connectionString:env.DATABASE_URL});let failure;
async function savePrivate(){await writeFile(privateFile,JSON.stringify({synthetic:true,runId,apiOrigin:origin,uiOrigin,actors,ids},null,2));}
async function request(actor,path,method='GET',body,expected=200){const response=await fetch(origin+'/api'+path,{method,headers:{Cookie:actor.cookie,Origin:uiOrigin,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});const value=await response.json();receipts.push({actorId:actor.id,path,method,status:response.status,privateNoStore:response.headers.get('cache-control')?.includes('no-store')??false});assert.equal(response.status,expected,`${method} ${path}: ${value.error??response.status}`);return value;}
function check(name){checks.push({name,status:'PASS'});}
async function newActor(role,label){
  const password=randomBytes(24).toString('base64url'),salt=randomBytes(16).toString('hex'),token=randomBytes(32).toString('base64url'),email=`correction01-${runId}-${label}@example.test`;
  const row=(await pool.query('INSERT INTO signal_users(email,password_hash,role,display_name,email_verified,demo_mode) VALUES($1,$2,$3,$4,true,false) RETURNING id',[email,`scrypt:${salt}:${scryptSync(password,salt,64).toString('hex')}`,role,`Синтетический C01 ${label} ${runId.slice(0,8)}`])).rows[0];
  await pool.query("INSERT INTO signal_sessions(token_hash,user_id,expires_at,demo_mode) VALUES($1,$2,now()+interval '7 days',false)",[createHash('sha256').update(token).digest('hex'),row.id]);
  const actor={id:row.id,email,password,cookie:`fsp_signal_session=${token}`,role,label};
  if(role==='employer')actor.companyId=(await pool.query('INSERT INTO signal_companies(owner_user_id,name,contact_email) VALUES($1,$2,$3) RETURNING id',[row.id,`Компания correction01 ${label} ${runId.slice(0,8)}`,email])).rows[0].id;
  actors.push(actor);await savePrivate();return actor;
}
async function profile(actor,resumeId,patch){const current=await request(actor,`/me/candidate-profile?resumeId=${resumeId}`);return request(actor,'/me/candidate-profile','PUT',{...current,resumeId,revision:current.revision,identityRevision:current.identityRevision,...patch});}
async function job(owner,title,specialization='Backend / Python',skills=['Python']){let row=await request(owner,'/employer/jobs','POST',{title,description:'Синтетическая вакансия для проверки correction-01. Исторические условия и сообщения сохраняются.',specialization,grade:'Junior',skills,skillRequirements:skills.map(skill=>({skill})),location:'Москва',workFormat:'Удалённо',salaryMin:100000,salaryMax:200000,salaryPeriod:'month',salaryType:'gross'},201);row=await request(owner,`/employer/jobs/${row.id}/status`,'POST',{version:row.version,status:'published'});ids.jobs.push(row.id);await savePrivate();return row;}
async function apply(actor,owner,job,resumeId,message){const row=await request(actor,`/jobs/${job.id}/applications`,'POST',{companyId:owner.companyId,jobVersion:job.version,resumeId,consentDisclosure:true,message},201);ids.applications.push(row.id);await savePrivate();return row;}
try{
  const owner=await newActor('employer','owner'),foreign=await newActor('employer','foreign'),candidate=await newActor('candidate','candidate');
  candidate.resumeId=(await request(candidate,'/me/resumes')).resumes[0].id;
  await profile(candidate,candidate.resumeId,{professionalAlias:`C01Alias-${runId.slice(0,8)}`,title:'Backend-разработчик correction-01',stack:['Python','SQL'],skills:['FastAPI','PostgreSQL'],assumedGrade:'Middle',visibility:'public',consentMatching:true,consentCatalog:false,readyForOffers:true,workFormat:'Удалённо',salaryMin:100000,salaryMax:200000});
  candidate.otherResumeId=(await request(candidate,'/me/resumes','POST',{title:'Frontend-разработчик correction-01',specialization:'Frontend / TypeScript'},201)).id;
  await profile(candidate,candidate.otherResumeId,{stack:['TypeScript','React'],skills:[],visibility:'pseudonymous',consentMatching:true,consentCatalog:false,readyForOffers:true,workFormat:'Удалённо',salaryMin:100000,salaryMax:200000});
  await savePrivate();
  const backendJob=await job(owner,'Backend-разработчик C05'),frontendJob=await job(owner,'Frontend-разработчик exact CV','Frontend / TypeScript',['TypeScript']);
  const cover=`Историческое сопроводительное сообщение correction-01 ${runId}`;
  const application=await apply(candidate,owner,backendJob,candidate.resumeId,cover),otherApplication=await apply(candidate,owner,frontendJob,candidate.otherResumeId,'Сопроводительное сообщение другого резюме');
  let list=await request(owner,`/employer/applications?jobId=${backendJob.id}&status=sent`);assert.equal(list.total,1);assert.deepEqual(list.counts,{all:1,new:1,shortlisted:0});
  let detail=await request(owner,`/employer/applications/${application.id}`);assert.equal(detail.status,'sent');assert.equal(detail.message,cover);assert.equal(detail.professionalSkills.resumeId,candidate.resumeId);assert.ok(detail.professionalSkills.items.every(item=>item.status==='declared'));
  await request(owner,`/employer/applications/${application.id}/status`,'POST',{status:'viewed'});
  list=await request(owner,`/employer/applications?jobId=${backendJob.id}&status=sent`);assert.equal(list.total,0);assert.deepEqual(list.counts,{all:1,new:0,shortlisted:0});
  detail=await request(owner,`/employer/applications/${application.id}`);assert.equal(detail.status,'viewed');assert.equal(detail.message,cover);assert.ok(detail.candidate);assert.equal(detail.resumeId,candidate.resumeId);
  check('C05 sent filter becomes empty and new counter decreases; independently authorized selected detail remains viewed/readable');
  await request(owner,`/employer/applications/${application.id}/status`,'POST',{status:'shortlisted'});
  list=await request(owner,`/employer/applications?jobId=${backendJob.id}&status=viewed`);assert.equal(list.total,0);assert.deepEqual(list.counts,{all:1,new:0,shortlisted:1});
  detail=await request(owner,`/employer/applications/${application.id}`);assert.equal(detail.status,'shortlisted');assert.equal(detail.message,cover);
  check('C05 another status transition excludes the row without losing selected history or resetting viewed');
  await request(foreign,`/employer/applications/${application.id}`,'GET',undefined,404);await request(owner,'/employer/applications/2147483647','GET',undefined,404);await request(owner,'/employer/applications/invalid','GET',undefined,400);
  check('Direct application detail is strictly owned/scoped and rejects foreign, absent and invalid identifiers');
  for(const [skillId,level] of [['python','Junior'],['sql','Middle']]){
    const issued=(await request(candidate,'/me/skill-attempts','POST',{resumeId:candidate.resumeId,skillId,level},201)).attempt;
    assert.equal(issued.resumeId,candidate.resumeId);ids.attempts.push(issued.id);await savePrivate();
    const frozen=(await pool.query('SELECT oracles FROM signal_skill_attempts WHERE id=$1 AND user_id=$2 AND resume_id=$3',[issued.id,candidate.id,candidate.resumeId])).rows[0];assert.ok(frozen);
    const answers=Object.fromEntries(Object.entries(frozen.oracles).map(([id,value])=>[id,value.expected]));
    const submitted=(await request(candidate,`/me/skill-attempts/${issued.id}/submit`,'POST',{revision:issued.revision,answers})).attempt;assert.equal(submitted.decision.passed,true);
  }
  detail=await request(owner,`/employer/applications/${application.id}`);
  assert.deepEqual(detail.professionalSkills.items.filter(item=>item.status==='verified').map(item=>[item.label,item.level]),[['Python','Junior'],['SQL','Middle']]);
  assert.ok(detail.professionalSkills.items.some(item=>item.label==='FastAPI'&&item.status==='declared'));assert.ok(detail.professionalSkills.items.some(item=>item.label==='PostgreSQL'&&item.status==='declared'));
  assert.equal(detail.message,cover);assert.ok(!JSON.stringify(detail.professionalSkills).includes('oracles'));assert.ok(!JSON.stringify(detail.professionalSkills).includes('attemptId'));
  check('C06 real HTTP module submission updates fresh exact-CV chips; Python Junior/SQL Middle green, FastAPI/PostgreSQL gray; historical cover unchanged');
  const otherDetail=await request(owner,`/employer/applications/${otherApplication.id}`);assert.equal(otherDetail.professionalSkills.resumeId,candidate.otherResumeId);assert.deepEqual(otherDetail.professionalSkills.items,[{label:'TypeScript',status:'declared'},{label:'React',status:'declared'}]);assert.equal(otherDetail.candidate.publicName,null);
  check('C06 another CV of the same candidate does not borrow Python/SQL proof; pseudonymous identity remains hidden');
  await profile(candidate,candidate.resumeId,{consentMatching:false});detail=await request(owner,`/employer/applications/${application.id}`);assert.equal(detail.invitationAllowed,false);assert.ok(detail.candidate);assert.equal(detail.professionalSkills.items.filter(item=>item.status==='verified').length,2);assert.equal(detail.message,cover);
  check('Fresh application disclosure remains separate from matching consent; invitation preparation closes when matching is revoked');
  await profile(candidate,candidate.resumeId,{visibility:'private'});detail=await request(owner,`/employer/applications/${application.id}`);assert.equal(detail.candidate,null);assert.equal(detail.resumeSnapshot,null);assert.equal(detail.professionalSkills,null);assert.equal(detail.message,'');assert.equal(detail.status,'shortlisted');await request(owner,`/employer/applications/${application.id}/contacts`,'GET',undefined,403);
  check('Private exact CV removes all professional chips, snapshot, cover and contacts while preserving application lifecycle');
  await profile(candidate,candidate.resumeId,{visibility:'public',consentMatching:true});
  await request(candidate,`/me/applications/${otherApplication.id}/withdraw`,'POST');detail=await request(owner,`/employer/applications/${application.id}`);assert.equal(detail.candidate,null);assert.equal(detail.professionalSkills,null);assert.equal(detail.message,'');assert.equal(detail.status,'shortlisted');
  check('Fresh disclosure withdrawal removes direct-detail professional information without removing history');
  const freshJob=await job(owner,'Backend-разработчик · визуальная проверка отклика'),fresh=await apply(candidate,owner,freshJob,candidate.resumeId,'Новый тестовый отклик для проверки сохранения деталей и общих статусов навыков.');
  ids.visualApplicationId=fresh.id;ids.visualJobId=freshJob.id;
  detail=await request(owner,`/employer/applications/${fresh.id}`);assert.equal(detail.status,'sent');assert.equal(detail.invitationAllowed,true);assert.equal(detail.professionalSkills.items.filter(item=>item.status==='verified').length,2);
  check('Fresh sent application with actual proofs is left for parent visual acceptance');
}catch(error){failure=error instanceof Error?error.message:String(error);}finally{
  await savePrivate();await mkdir(output,{recursive:true});await writeFile(`${output}/receipt.json`,JSON.stringify({synthetic:true,runId,apiOrigin:origin,uiOrigin,runtimeHash,actors:actors.map(({id,role,label,companyId,resumeId,otherResumeId})=>({id,role,label,companyId,resumeId,otherResumeId})),ids,checks,receipts,status:failure?'FAIL':'PASS',failure:failure??null},null,2));await pool.end();
  console.log(JSON.stringify({status:failure?'FAIL':'PASS',checks:checks.length,output,privateFile,ids,failure:failure??null}));if(failure)process.exitCode=1;
}
