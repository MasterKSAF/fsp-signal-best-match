/** Newly owned, readable synthetic actors for authorized delivery materials.
 * Does not reset Demo, touch reviewer actors, or alter stored exam decisions. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash,randomBytes,randomUUID,scryptSync} from 'node:crypto';
import pg from '../lib/db/node_modules/pg/lib/index.js';
const runtimePath=process.argv[2];assert.ok(runtimePath?.replaceAll('\\','/').startsWith('C:/Users/Misha/Documents/ChatGPT/LCT/signal-ui-refinement-workspace-20261008/outputs/verification/'),'Pass the current task runtime bundle after the controller restarts it');
const runtimeSha256=createHash('sha256').update(await readFile(runtimePath)).digest('hex');
const env=Object.fromEntries((await readFile('C:/Users/Misha/.codex/private/signal-employer-e-20261008.env','utf8')).split(/\r?\n/).filter(x=>x&&!x.startsWith('#')).map(line=>{const i=line.indexOf('=');return[line.slice(0,i),line.slice(i+1).replace(/^"|"$/g,'')];}));
const database=new URL(env.DATABASE_URL);assert.equal(database.hostname,'127.0.0.1');assert.equal(database.port,'55435');assert.equal(database.pathname,'/signal_employer_e_20261008');
const pool=new pg.Pool({connectionString:env.DATABASE_URL}),runId=randomUUID(),actors=[],actualAttempts=[],receipts=[],contexts=[];
const privateLedger=`C:/Users/Misha/.codex/private/signal-delivery-demo-20261009-${runId}.json`,output='outputs/verification/delivery-demo-20261009';
const base='http://localhost:4413',origin='http://signal-employer.localhost:4414';let passed=false,failure,invitationId;
const checkpoint=()=>writeFile(privateLedger,JSON.stringify({synthetic:true,runId,actors,contexts,invitationId},null,2));
async function request(actor,path,method='GET',body,status=200){const response=await fetch(base+'/api'+path,{method,headers:{Cookie:actor.cookie,Origin:origin,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
  const result=await response.json();receipts.push({path,method,status:response.status,actorId:actor.id});assert.equal(response.status,status,`${method} ${path}: ${result.error??''}`);return result;}
async function makeActor(role,suffix,name){
  const password=randomBytes(24).toString('base64url'),salt=randomBytes(16).toString('hex'),token=randomBytes(32).toString('base64url');const email=`delivery-${runId}-${suffix}@signal-example.test`;
  const user=(await pool.query('INSERT INTO signal_users(email,password_hash,role,display_name,email_verified,demo_mode) VALUES($1,$2,$3,$4,true,false) RETURNING id',[email,`scrypt:${salt}:${scryptSync(password,salt,64).toString('hex')}`,role,name])).rows[0];
  await pool.query("INSERT INTO signal_sessions(token_hash,user_id,expires_at,demo_mode) VALUES($1,$2,now()+interval '7 days',false)",[createHash('sha256').update(token).digest('hex'),user.id]);
  const actor={id:user.id,email,password,cookie:`fsp_signal_session=${token}`,role,suffix,name};
  if(role==='employer')actor.companyId=(await pool.query('INSERT INTO signal_companies(owner_user_id,name,contact_email) VALUES($1,$2,$3) RETURNING id',[user.id,name,'team@signal-example.test'])).rows[0].id;
  actors.push(actor);await checkpoint();return actor;
}
async function candidateProfile(actor,resumeId,fields){const current=await request(actor,`/me/candidate-profile?resumeId=${resumeId}`);
  return request(actor,'/me/candidate-profile','PUT',{...current,resumeId,revision:current.revision,identityRevision:current.identityRevision,professionalAlias:actor.name,
    visibility:'public',consentMatching:true,consentCatalog:true,readyForOffers:true,workFormat:'Удалённо',salaryMin:150000,salaryMax:220000,...fields});}
async function qualify(actor,resumeId){
  for(const skillId of ['python','sql','backend-engineering']){
    const matrix=await request(actor,`/me/skill-matrix?resumeId=${resumeId}`);const issued=await request(actor,'/me/skill-attempts','POST',{resumeId,skillId,level:'Junior',programVersion:matrix.bankVersion},201);const attempt=issued.attempt;
    const stored=(await pool.query('SELECT user_id,cases,oracles FROM signal_skill_attempts WHERE id=$1 AND user_id=$2',[attempt.id,actor.id])).rows[0];assert.equal(stored.user_id,actor.id);
    const answers=Object.fromEntries(stored.cases.map(item=>[item.id,stored.oracles[item.id].expected]));
    const result=(await request(actor,`/me/skill-attempts/${attempt.id}/submit`,'POST',{revision:attempt.revision,answers})).attempt;assert.equal(result.decision.passed,true);assert.equal(result.decision.criticalComplete,true);
    actualAttempts.push({candidateId:actor.id,resumeId,skillId,level:'Junior',attemptId:attempt.id,programVersion:result.programVersion,rubricVersion:result.decision.rubricVersion});
  }
  assert.equal((await request(actor,`/me/skill-matrix?resumeId=${resumeId}`)).qualification.verifiedGrade,'Junior');
}
try{
  await mkdir(output,{recursive:true});assert.equal(Number((await pool.query('SELECT count(*) FROM drizzle.__drizzle_migrations')).rows[0].count),17,'Controller applies optional company INN migration first');
  const employer=await makeActor('employer','team','Команда разработки'),alexey=await makeActor('candidate','alexey','Алексей Орлов'),maria=await makeActor('candidate','maria','Мария Соколова');
  const company=(await request(employer,'/employer/company')).company;assert.equal(company.inn,'');
  await request(employer,'/employer/company','PUT',{name:'Команда разработки',industry:'Разработка программного обеспечения',description:'Создаём внутренние сервисы для команд, работаем с Python, SQL и понятными контрактами API.',inn:'',contactEmail:'team@signal-example.test',contactPhone:null,contactMethod:'Электронная почта'});
  for(const candidate of [alexey,maria]){
    const resume=(await request(candidate,'/me/resumes')).resumes[0];candidate.resumeIds=[resume.id];
    // The ordinary owned resume API supplies names/conditions; no qualification
    // is fabricated through SQL and no real avatar is imported.
    await candidateProfile(candidate,resume.id,{title:'Backend-разработчик · Python',stack:['Python','SQL'],skills:['Python','SQL'],yearsExperience:candidate===alexey?3:4,
      summary:candidate===alexey?'Разрабатываю небольшие сервисы на Python, работаю с SQL и проверяю поведение API. Ищу команду, где можно развивать инженерные навыки.':'Работаю над серверной логикой и данными. Предпочитаю ясные требования, проверяемые решения и спокойное взаимодействие в команде.'});
    await qualify(candidate,resume.id);
  }
  const frontend=await request(alexey,'/me/resumes','POST',{title:'Frontend-разработчик · TypeScript',specialization:'Frontend / TypeScript'},201);alexey.resumeIds.push(frontend.id);
  await candidateProfile(alexey,frontend.id,{title:'Frontend-разработчик · TypeScript',stack:['TypeScript','React'],skills:['TypeScript','React'],yearsExperience:2,
    summary:'Развиваю навыки TypeScript и React, делаю небольшие интерфейсы и уделяю внимание доступности. Эти навыки пока заявлены без модульного подтверждения.'});
  const conditions={title:'Backend-разработчик · Python',specialization:'Backend / Python',grade:'Junior',workFormat:'Удалённо',salaryMin:150000,salaryMax:220000,salaryPeriod:'month',salaryType:'gross'};
  let job=await request(employer,'/employer/jobs','POST',{...conditions,description:'Ищем backend-разработчика для внутренних Python-сервисов. Задачи: работа с SQL, поддержка API и небольшие улучшения под руководством команды.',skills:['Python','SQL'],skillRequirements:[{skill:'Python',level:'Junior'},{skill:'SQL',level:'Junior'}],location:'Москва'},201);
  job=await request(employer,`/employer/jobs/${job.id}/status`,'POST',{status:'published',version:job.version});contexts.push({type:'job',id:job.id,version:job.version});
  const need=await request(employer,'/employer/needs','POST',{...conditions,title:'Запрос: Python и SQL',description:'Приватный запрос команды для поиска backend-разработчика с подтверждёнными основами Python и SQL.',requiredSkills:['Python','SQL'],requiredSkillLevels:{Python:'Junior',SQL:'Junior'},desirableSkills:[]},201);contexts.push({type:'need',id:need.id,version:need.revision});
  for(const context of contexts){
    const selection=await request(employer,`/employer/selection?contextType=${context.type}&contextId=${context.id}`);
    for(const candidate of [alexey,maria]){const item=selection.items.find(row=>row.candidateId===candidate.id);assert.ok(item,`Prepared ${candidate.name} must match the context`);assert.equal(item.publicName,candidate.name);assert.equal(item.resumeId,candidate.resumeIds[0]);}
  }
  const primary=(await request(alexey,`/me/candidate-profile?resumeId=${alexey.resumeIds[0]}`));
  const invitation=await request(employer,'/employer/invitations','POST',{jobId:job.id,contextVersion:job.version,candidateId:alexey.id,resumeId:alexey.resumeIds[0],resumeRevision:primary.revision,
    title:'Backend-разработчик · Python',message:'Алексей, приглашаем обсудить задачи команды и условия сотрудничества.',reason:'Подтверждённые основы Python и SQL соответствуют требованиям вакансии.',salaryMin:150000,salaryMax:220000,salaryPeriod:'month',salaryType:'gross',workFormat:'Удалённо',idempotencyKey:`delivery-${runId}`},201);invitationId=invitation.id;
  assert.equal(invitation.status,'sent');assert.equal(invitation.contactShared,false);await checkpoint();passed=true;
}catch(error){failure={name:error.name,message:error.message};}
finally{
  await checkpoint();await pool.end();
  const report=`${output}/prepare-${runId}.json`;await writeFile(report,JSON.stringify({passed,failure,synthetic:true,oracleAssistedPreparation:true,existingRecordsUntouched:true,runId,database:'signal_employer_e_20261008',port:4413,runtimePath,runtimeSha256,
    actors:actors.map(({id,role,name,resumeIds,companyId})=>({id,role,name,resumeIds,companyId})),contexts,invitationId,actualAttempts,receipts,preparedAt:new Date().toISOString()},null,2));
  console.log(JSON.stringify({passed,failure,report,privateLedger,actualModuleSubmissions:actualAttempts.length}));
}
if(!passed)process.exitCode=1;
