/** Real HTTP lifecycle on own synthetic actors, using only their saved oracles. */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash, randomBytes, randomUUID, scryptSync } from 'node:crypto';
import pg from '../lib/db/node_modules/pg/lib/index.js';
const env=Object.fromEntries((await readFile('C:/Users/Misha/.codex/private/signal-employer-e-20261008.env','utf8')).split(/\r?\n/).filter(line=>line&&!line.startsWith('#')).map(line=>{const i=line.indexOf('=');return[line.slice(0,i),line.slice(i+1).replace(/^"|"$/g,'')];}));
const database=new URL(env.DATABASE_URL);assert.equal(database.hostname,'127.0.0.1');assert.equal(database.port,'55435');assert.equal(database.pathname,'/signal_employer_e_20261008');
const ledger=JSON.parse(await readFile('C:/Users/Misha/.codex/private/signal-employer-e-20261008-fixtures.json','utf8'));
const origin='http://localhost:4413',appOrigin='http://signal-employer.localhost:4414';
const owner=ledger.actors.find(a=>a.suffix==='owner'),foreign=ledger.actors.find(a=>a.suffix==='foreign'),main=ledger.actors.find(a=>a.suffix==='two');
const pool=new pg.Pool({connectionString:env.DATABASE_URL});
const checks=[],receipts=[],actualAttempts=[];const runId=randomUUID();
const output='outputs/verification/employer-workspace-E01-E16-20261008/backend';
let qa,passed=false,failure;
async function request(actor,path,method='GET',body){const response=await fetch(origin+'/api'+path,{method,headers:{Cookie:actor.cookie,Origin:appOrigin,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
  const text=await response.text();let json;try{json=JSON.parse(text);}catch{}
  receipts.push({path,method,status:response.status,actorId:actor.id});return{status:response.status,json,text,headers:response.headers};}
async function ok(actor,path,method='GET',body,status=200){const result=await request(actor,path,method,body);assert.equal(result.status,status,`${method} ${path}: ${result.json?.error??result.text.slice(0,90)}`);return result.json;}
function step(name){checks.push({name,status:'PASS'});}
async function profile(actor,resumeId,patch){const current=await ok(actor,`/me/candidate-profile?resumeId=${resumeId}`);return ok(actor,'/me/candidate-profile','PUT',{...current,resumeId,revision:current.revision,identityRevision:current.identityRevision,...patch});}
async function qualify(actor,resumeId){
  const matrix=await ok(actor,`/me/skill-matrix?resumeId=${resumeId}`);
  if(matrix.qualification.verifiedGrade==='Junior')return;
  for(const skillId of ['python','sql','backend-engineering']){
    const issued=await request(actor,'/me/skill-attempts','POST',{resumeId,skillId,level:'Junior'});assert.ok([200,201].includes(issued.status),issued.json?.error);
    const attempt=issued.json.attempt;
    const stored=(await pool.query('SELECT user_id,oracles,cases FROM signal_skill_attempts WHERE id=$1 AND user_id=$2',[attempt.id,actor.id])).rows[0];assert.equal(stored.user_id,actor.id);
    const answers=Object.fromEntries(stored.cases.map(c=>[c.id,stored.oracles[c.id].expected]));
    const result=(await ok(actor,`/me/skill-attempts/${attempt.id}/submit`,'POST',{revision:attempt.revision,answers})).attempt;
    assert.equal(result.decision.passed,true);assert.equal(result.decision.criticalComplete,true);
    actualAttempts.push({actorId:actor.id,resumeId,skillId,attemptId:attempt.id,programVersion:result.programVersion,rubricVersion:result.decision.rubricVersion});
  }
  assert.equal((await ok(actor,`/me/skill-matrix?resumeId=${resumeId}`)).qualification.verifiedGrade,'Junior');
}
const needBody={title:'Backend-разработчик HTTP E',specialization:'Backend / Python',grade:'Junior',requiredSkills:['Python'],requiredSkillLevels:{Python:'Junior'},desirableSkills:['SQL'],description:'Приватный запрос для самостоятельной HTTP проверки нового кабинета.',workFormat:'Удалённо',salaryMin:100000,salaryMax:200000,salaryPeriod:'month',salaryType:'gross'};
const jobBody={title:'Backend-разработчик HTTP E',description:'Опубликованная вакансия для самостоятельной HTTP проверки нового кабинета.',specialization:'Backend / Python',grade:'Junior',skills:['Python'],skillRequirements:[{skill:'Python',level:'Junior'}],location:'Москва',workFormat:'Удалённо',salaryMin:100000,salaryMax:200000,salaryPeriod:'month',salaryType:'gross'};
try{
  assert.equal((await ok(owner,'/me')).user.id,owner.id);
  assert.equal(Number((await pool.query('SELECT count(*) FROM drizzle.__drizzle_migrations')).rows[0].count),16);
  const mainResume=main.resumeIds[0];await qualify(main,mainResume);
  step('Three actual oracle-assisted HTTP modules confirm matching-only main CV as Junior; synthetic history is not reused as proof');
  const password=randomBytes(24).toString('base64url'),salt=randomBytes(16).toString('hex'),token=randomBytes(32).toString('base64url');
  const email=`employer-E-http-${runId}@example.test`.toLowerCase();
  const user=(await pool.query("INSERT INTO signal_users(email,password_hash,role,display_name,email_verified,demo_mode) VALUES($1,$2,'candidate','Синтетический HTTP специалист E',true,false) RETURNING id",[email,`scrypt:${salt}:${scryptSync(password,salt,64).toString('hex')}`])).rows[0];
  await pool.query("INSERT INTO signal_sessions(token_hash,user_id,expires_at,demo_mode) VALUES($1,$2,now()+interval '7 days',false)",[createHash('sha256').update(token).digest('hex'),user.id]);
  qa={id:user.id,email,password,cookie:`fsp_signal_session=${token}`,role:'candidate',suffix:'http-'+runId};
  const qaResume=(await ok(qa,'/me/resumes')).resumes[0].id;qa.resumeIds=[qaResume];
  await profile(qa,qaResume,{professionalAlias:'HTTP специалист E',stack:['Python','SQL'],skills:['Python','SQL'],visibility:'pseudonymous',consentMatching:true,consentCatalog:true,readyForOffers:true,salaryMin:100000,salaryMax:200000,workFormat:'Удалённо'});
  await qualify(qa,qaResume);
  step('A separate own HTTP actor earns actual qualification without historical offers for practice scheduling');
  let need=await ok(owner,'/employer/needs','POST',needBody,201);
  assert.equal(need.revision,1);assert.equal(need.status,'active');assert.equal(need.shortlistCount,0);
  const changed=await ok(owner,`/employer/needs/${need.id}`,'PUT',{revision:need.revision,title:'Изменённый приватный запрос E'});
  assert.equal(changed.salaryMax,need.salaryMax);assert.deepEqual(changed.requiredSkills,need.requiredSkills);assert.equal(changed.revision,2);need=changed;
  await ok(owner,`/employer/needs/${need.id}`,'PUT',{revision:1,title:'Старая параллельная редакция'},409);
  await ok(foreign,`/employer/needs/${need.id}`,'PUT',{revision:need.revision,title:'Чужое изменение'},404);
  const concurrent=await Promise.all([request(owner,`/employer/needs/${need.id}`,'PUT',{revision:need.revision,title:'Конкурентное сохранение A'}),request(owner,`/employer/needs/${need.id}`,'PUT',{revision:need.revision,title:'Конкурентное сохранение B'})]);
  assert.deepEqual(concurrent.map(row=>row.status).sort(),[200,409]);need=concurrent.find(row=>row.status===200).json;
  step('Need partial CRUD preserves fields and levels, rejects foreign ownership and serializes two concurrent CAS writes');
  let job=await ok(owner,'/employer/jobs','POST',jobBody,201);
  job=await ok(owner,`/employer/jobs/${job.id}`,'PUT',{version:job.version,title:'Изменённая вакансия E'});
  assert.equal(job.salaryMax,200000);assert.equal(job.location,'Москва');assert.deepEqual(job.skillRequirements,[{skill:'Python',level:'Junior'}]);
  await ok(owner,`/employer/jobs/${job.id}`,'PUT',{version:1,title:'Старая версия вакансии'},409);
  await ok(foreign,`/employer/jobs/${job.id}`,'DELETE',{version:job.version},404);
  job=await ok(owner,`/employer/jobs/${job.id}/status`,'POST',{status:'published',version:job.version});
  assert.ok((await ok(main,'/public/jobs')).some(item=>item.id===job.id));
  const jobs=await ok(owner,'/employer/jobs');assert.equal(jobs.find(item=>item.id===job.id).applicationCount,0);
  step('Job partial CAS preserves optional requirements and publishes explicitly with real zero counters');
  const contexts=await ok(owner,'/employer/selection/contexts');assert.ok(contexts.contexts.some(item=>item.type==='need'&&item.id===need.id));assert.ok(contexts.contexts.some(item=>item.type==='job'&&item.id===job.id));
  for(const context of [{type:'need',id:need.id},{type:'job',id:job.id}])for(let retry=0;retry<2;retry++)assert.equal((await ok(owner,'/employer/shortlist','PUT',{context,candidateId:main.id,resumeId:mainResume})).shortlistCount,1);
  await ok(foreign,`/employer/shortlist?contextType=need&contextId=${need.id}`,'GET',undefined,404);
  const catalogOnly=ledger.actors.find(a=>a.suffix==='one');
  await ok(owner,'/employer/shortlist','PUT',{context:{type:'need',id:need.id},candidateId:catalogOnly.id,resumeId:catalogOnly.resumeIds[1]},404);
  const alternate=await ok(main,'/me/resumes','POST',{title:'Другое Backend резюме E',specialization:'Backend / Python'},201);main.resumeIds.push(alternate.id);
  await profile(main,alternate.id,{professionalAlias:'Синтетический специалист two',stack:['Python','SQL'],skills:['Python','SQL'],visibility:'pseudonymous',consentMatching:true,consentCatalog:false,readyForOffers:true,salaryMin:300000,salaryMax:400000});
  assert.equal((await ok(owner,'/employer/shortlist','PUT',{context:{type:'need',id:need.id},candidateId:main.id,resumeId:alternate.id})).shortlistCount,1);
  const saved=await ok(owner,`/employer/shortlist?contextType=need&contextId=${need.id}`);assert.equal(saved.items[0].resumeId,alternate.id);assert.equal(saved.total,1);
  await ok(owner,'/employer/shortlist','DELETE',{context:{type:'job',id:job.id},candidateId:main.id});
  assert.equal((await ok(owner,`/employer/shortlist?contextType=need&contextId=${need.id}`)).total,1);
  step('Persistent shortlist remains unique under retries and CV replacement, uses matching consent, isolates typed contexts and employers');
  const currentMain=await ok(main,`/me/candidate-profile?resumeId=${mainResume}`);
  const inviteBody={idempotencyKey:'E-'+runId,jobId:job.id,contextVersion:job.version,candidateId:main.id,resumeId:mainResume,resumeRevision:currentMain.revision,title:'Приглашение от вакансии E',message:'Предлагаем обсудить самостоятельные backend задачи команды.',reason:'Квалификация подтверждена самостоятельными модулями.',salaryMin:100000,salaryMax:200000,salaryPeriod:'month',salaryType:'gross',workFormat:'Удалённо'};
  const invite=await ok(owner,'/employer/invitations','POST',inviteBody,201);assert.equal(invite.jobId,job.id);assert.equal(invite.needId,null);assert.equal(invite.resumeId,mainResume);
  assert.equal((await ok(owner,'/employer/invitations','POST',inviteBody)).id,invite.id);
  await ok(owner,'/employer/invitations','POST',{...inviteBody,idempotencyKey:'E-xor-'+runId,needId:need.id},400);
  await ok(owner,'/employer/invitations','POST',{...inviteBody,idempotencyKey:'E-stale-'+runId,contextVersion:job.version-1},409);
  const sentSnapshot=JSON.stringify(invite.contextSnapshot);
  job=await ok(owner,`/employer/jobs/${job.id}`,'PUT',{version:job.version,salaryMax:250000});
  assert.equal(JSON.stringify((await ok(owner,'/employer/invitations')).find(item=>item.id===invite.id).contextSnapshot),sentSnapshot);
  await ok(owner,`/employer/invitations/${invite.id}/contacts`,'GET',undefined,403);
  step('Job invitation has XOR source, exact CV/version, idempotent receipt, immutable sent conditions and closed contacts');
  const onlyJob=await ok(foreign,'/employer/jobs','POST',jobBody,201);
  assert.equal((await pool.query('SELECT count(*) FROM signal_needs WHERE company_id=$1',[foreign.companyId])).rows[0].count,'0');
  const document=await ok(foreign,`/resumes/${mainResume}/document-preview`);assert.equal(document.contactsAllowed,false);
  assert.equal((await pool.query('SELECT count(*) FROM signal_needs WHERE company_id=$1',[foreign.companyId])).rows[0].count,'0');
  await ok(foreign,`/employer/jobs/${onlyJob.id}/status`,'POST',{status:'archived',version:onlyJob.version});
  await ok(foreign,`/resumes/${mainResume}/document-preview`,'GET',undefined,404);
  step('Matching-only exact CV documents work through an owned job without a hidden need; archiving removes that document permission');
  await ok(qa,'/me/microtasks/preferences','PUT',{enabled:true});
  const rubric=[{id:'old-http',label:'Сохранённый критерий HTTP',maxPoints:5}];
  let template=await ok(owner,'/employer/microtasks','POST',{title:'Практика HTTP E',competency:'Python',specialization:'Backend / Python',scenario:'Учебный сценарий проверки API и идемпотентности. Производственных данных и задач здесь нет.',expectedMinutes:15,intervalDays:7,deadlineDays:3,educationalOnly:true,rubric},201);
  await ok(owner,`/employer/microtasks/${template.id}/subscriptions`,'POST',{candidateId:qa.id,resumeId:qaResume});
  const offerRow=(await pool.query('SELECT o.id,o.snapshot FROM signal_micro_offers o JOIN signal_micro_subscriptions s ON s.id=o.subscription_id WHERE s.template_id=$1 AND o.candidate_user_id=$2',[template.id,qa.id])).rows[0];assert.ok(offerRow);
  await ok(qa,`/me/microtasks/${offerRow.id}/decision`,'POST',{decision:'accept',consentCompanyReview:true});
  await ok(qa,`/me/microtasks/${offerRow.id}/submit`,'POST',{answer:'Сначала проверяем ключ запроса, затем сохраняем результат атомарно, повтор возвращает сохранённый результат без дублирования.'});
  let templateList=await ok(owner,'/employer/microtasks');assert.equal(templateList.find(t=>t.id===template.id).answerCount,1);assert.equal(templateList.find(t=>t.id===template.id).newAnswerCount,1);
  const patch={...template,version:template.version,rubric:[{id:'new-http',label:'Новый критерий',maxPoints:3}]};for(const key of ['id','companyId','createdAt','active'])delete patch[key];
  template=await ok(owner,`/employer/microtasks/${template.id}`,'PUT',patch);
  await ok(owner,`/employer/microtasks/${template.id}`,'PUT',patch,409);
  const evaluated=await ok(owner,`/employer/microtasks/offers/${offerRow.id}/evaluate`,'POST',{scores:[{criterionId:'old-http',points:4,comment:'Корректный разбор сохранённого условия.'}],feedback:'Оценка по исходной рубрике задания, которая была выдана кандидату.'});
  assert.equal(evaluated.result.templateVersion,1);assert.equal(evaluated.result.max,5);assert.equal(evaluated.result.qualificationEffect,'none');
  const answers=await ok(owner,`/employer/microtasks/offers?templateId=${template.id}&submittedOnly=1`);assert.equal(answers.length,1);assert.ok(answers[0].answer);assert.equal(answers[0].result.total,4);
  await ok(foreign,`/employer/microtasks/offers?templateId=${template.id}&submittedOnly=1`,'GET',undefined,404);
  templateList=await ok(owner,'/employer/microtasks');assert.equal(templateList.find(t=>t.id===template.id).evaluatedAnswerCount,1);
  assert.equal((await ok(qa,`/me/skill-matrix?resumeId=${qaResume}`)).qualification.verifiedGrade,'Junior');
  step('Actual practice offer→accept→answer→evaluation uses the issued old rubric after template CAS edit, real answer counts and no qualification effect');
  await profile(main,alternate.id,{consentMatching:false});
  const revoked=await ok(owner,`/employer/shortlist?contextType=need&contextId=${need.id}`);assert.equal(revoked.items[0].available,false);assert.equal(revoked.items[0].candidate,null);assert.equal(revoked.items[0].match,null);
  await ok(owner,'/employer/shortlist','PUT',{context:{type:'need',id:need.id},candidateId:main.id,resumeId:alternate.id},404);
  await profile(main,alternate.id,{consentMatching:true});
  await pool.query('INSERT INTO signal_company_blocks(candidate_user_id,company_id,active) VALUES($1,$2,true) ON CONFLICT(candidate_user_id,company_id) DO UPDATE SET active=true',[main.id,owner.companyId]);
  assert.equal((await ok(owner,`/employer/shortlist?contextType=need&contextId=${need.id}`)).items[0].candidate,null);
  await pool.query('UPDATE signal_company_blocks SET active=false,unblocked_at=now() WHERE candidate_user_id=$1 AND company_id=$2',[main.id,owner.companyId]);
  await profile(qa,qaResume,{consentMatching:false});
  assert.equal((await ok(owner,`/employer/microtasks/offers?templateId=${template.id}&submittedOnly=1`)).length,0);
  const hiddenOffers=await ok(owner,`/employer/microtasks/offers?templateId=${template.id}`);assert.equal(hiddenOffers[0].answer,null);assert.equal(hiddenOffers[0].result,null);assert.equal(hiddenOffers[0].resumeContext,null);
  assert.equal((await ok(owner,'/employer/microtasks')).find(t=>t.id===template.id).answerCount,0);
  await profile(qa,qaResume,{consentMatching:true});
  step('Current consent revocation and company block immediately mask saved CV and task answer/result/context with honest counters');
  const history=(await pool.query('SELECT (SELECT count(*) FROM signal_invitations WHERE need_id=$1)::int AS invitations,(SELECT count(*) FROM signal_contact_grants WHERE company_id=$2)::int AS grants,(SELECT count(*) FROM signal_applications WHERE job_id=$3)::int AS applications',[ledger.ids.need,owner.companyId,ledger.ids.job])).rows[0];
  await ok(owner,`/employer/needs/${ledger.ids.need}`,'DELETE',{revision:1});
  await ok(owner,`/employer/jobs/${ledger.ids.job}`,'DELETE',{version:1});
  const afterHistory=(await pool.query('SELECT (SELECT count(*) FROM signal_invitations WHERE need_id=$1)::int AS invitations,(SELECT count(*) FROM signal_contact_grants WHERE company_id=$2)::int AS grants,(SELECT count(*) FROM signal_applications WHERE job_id=$3)::int AS applications',[ledger.ids.need,owner.companyId,ledger.ids.job])).rows[0];assert.deepEqual(afterHistory,history);
  await ok(owner,`/employer/needs/${need.id}`,'DELETE',{revision:need.revision});
  await ok(owner,`/employer/needs/${need.id}`,'DELETE',{revision:need.revision});
  assert.equal(Number((await pool.query("SELECT count(*) FROM signal_shortlist WHERE company_id=$1 AND context_type='need' AND context_id=$2",[owner.companyId,need.id])).rows[0].count),0);
  assert.ok((await ok(main,'/me/resumes')).resumes.some(r=>r.id===mainResume));
  assert.ok((await ok(owner,'/employer/invitations')).some(i=>i.id===ledger.ids.invitation));
  step('Soft deleting original need/job and new need preserves historical invitations, grants, applications and people/CVs; only own shortlist is removed');
  passed=true;
}catch(error){failure=error.message;}
finally{
  await mkdir(output,{recursive:true});
  const privatePath=`C:/Users/Misha/.codex/private/signal-employer-e-20261008-http-${runId}.json`;
  await writeFile(privatePath,JSON.stringify({synthetic:true,actors:qa?[qa]:[],mainActorId:main.id,mainResumeIds:main.resumeIds},null,2),{flag:'wx'});
  await writeFile(`${output}/http-${runId}.json`,JSON.stringify({passed,failure,synthetic:true,oracleAssistedMechanicalTest:true,checks,receipts,actualAttempts,privateLedger:privatePath,measuredAt:new Date().toISOString()},null,2),{flag:'wx'});
  await pool.end();console.log(JSON.stringify({passed,checks:checks.length,failure,actualAttempts:actualAttempts.length,report:`${output}/http-${runId}.json`,privateLedger:privatePath}));
}
if(!passed)process.exitCode=1;
