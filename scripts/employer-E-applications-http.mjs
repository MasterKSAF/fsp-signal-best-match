/** Independent ordinary applications flow on separately created synthetic actors only. */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomBytes, randomUUID, createHash, scryptSync } from 'node:crypto';
import pg from '../lib/db/node_modules/pg/lib/index.js';
const privateRoot='C:/Users/Misha/.codex/private';
const env=Object.fromEntries((await readFile(`${privateRoot}/signal-employer-e-20261008.env`,'utf8')).split(/\r?\n/).filter(line=>line&&!line.startsWith('#')).map(line=>{const i=line.indexOf('=');return [line.slice(0,i),line.slice(i+1).replace(/^"|"$/g,'')];}));
const address=new URL(env.DATABASE_URL);assert.equal(address.hostname,'127.0.0.1');assert.equal(address.port,'55435');assert.equal(address.pathname,'/signal_employer_e_20261008');
const shared=JSON.parse(await readFile(`${privateRoot}/signal-employer-e-20261008-fixtures.json`,'utf8'));assert.equal(shared.synthetic,true);
const origin='http://localhost:4413',appOrigin='http://signal-employer.localhost:4414';
assert.equal(shared.apiOrigin,origin);
const pool=new pg.Pool({connectionString:env.DATABASE_URL});
const runId=randomUUID(),actors=[],checks=[],receipts=[],ids={};
const output=`outputs/verification/employer-workspace-E01-E16-20261008/applications-${runId}`;
const privateFile=`${privateRoot}/signal-employer-e-applications-${runId}.json`;
let failure;
async function savePrivate(){await writeFile(privateFile,JSON.stringify({synthetic:true,runId,origin,actors,ids},null,2));}
async function request(actor,path,method='GET',body,expected=200){const response=await fetch(origin+'/api'+path,{method,headers:{Cookie:actor.cookie,Origin:appOrigin,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});const json=await response.json();receipts.push({actorId:actor.id,path,method,status:response.status});assert.equal(response.status,expected,`${method} ${path}: ${json.error ?? response.status}`);return json;}
function check(name){checks.push({name,status:'PASS'});}
async function newActor(role,label){
  const password=randomBytes(24).toString('base64url'),salt=randomBytes(16).toString('hex'),token=randomBytes(32).toString('base64url');
  const email=`applications-E-${runId}-${label}@example.test`;
  const row=(await pool.query('INSERT INTO signal_users(email,password_hash,role,display_name,email_verified,demo_mode) VALUES($1,$2,$3,$4,true,false) RETURNING id',[email,`scrypt:${salt}:${scryptSync(password,salt,64).toString('hex')}`,role,`Синтетическое имя E ${label} ${runId.slice(0,8)}`])).rows[0];
  await pool.query("INSERT INTO signal_sessions(token_hash,user_id,expires_at,demo_mode) VALUES($1,$2,now()+interval '7 days',false)",[createHash('sha256').update(token).digest('hex'),row.id]);
  const actor={id:row.id,email,password,cookie:`fsp_signal_session=${token}`,role,label};
  if(role==='employer') actor.companyId=(await pool.query('INSERT INTO signal_companies(owner_user_id,name,contact_email) VALUES($1,$2,$3) RETURNING id',[row.id,`Синтетическая компания applications E ${runId.slice(0,8)}`,email])).rows[0].id;
  actors.push(actor);await savePrivate();return actor;
}
async function profile(actor,patch){const current=await request(actor,`/me/candidate-profile?resumeId=${actor.resumeId}`);return request(actor,'/me/candidate-profile','PUT',{...current,resumeId:actor.resumeId,revision:current.revision,identityRevision:current.identityRevision,...patch});}
try{
  const owner=await newActor('employer','owner'),one=await newActor('candidate','public'),two=await newActor('candidate','anonymous');
  for(const candidate of [one,two]){candidate.resumeId=(await request(candidate,'/me/resumes')).resumes[0].id;candidate.alias=`AliasE-${candidate.label}-${runId.slice(0,8)}`;candidate.displayName=`Синтетическое имя E ${candidate.label} ${runId.slice(0,8)}`;await profile(candidate,{displayName:candidate.displayName,professionalAlias:candidate.alias,title:`Резюме E ${candidate.label}`,stack:['Python'],skills:['Python'],visibility:candidate===one?'public':'pseudonymous',consentMatching:true,consentCatalog:false,readyForOffers:true,workFormat:'Удалённо',salaryMin:100000,salaryMax:200000});}
  await savePrivate();check('Separate ordinary actors and exact candidate CVs; matching consent enabled, catalog consent disabled');
  const jobBody={title:'Backend-разработчик applications E',description:'Синтетическая вакансия для адресной проверки откликов и сохранения их исходных условий.',specialization:'Backend / Python',grade:'Junior',skills:['Python'],skillRequirements:[{skill:'Python',level:'Junior'}],location:'Москва',workFormat:'Удалённо',salaryMin:100000,salaryMax:200000,salaryPeriod:'month',salaryType:'gross'};
  const jobs=[];
  for(let i=0;i<2;i++){let job=await request(owner,'/employer/jobs','POST',{...jobBody,title:`${jobBody.title} ${i+1}`},201);job=await request(owner,`/employer/jobs/${job.id}/status`,'POST',{version:job.version,status:'published'});jobs.push(job);}
  ids.jobs=jobs.map(job=>job.id);await savePrivate();
  const applications=[];
  for(const job of jobs)for(const candidate of [one,two]){const application=await request(candidate,`/jobs/${job.id}/applications`,'POST',{companyId:owner.companyId,jobVersion:job.version,resumeId:candidate.resumeId,consentDisclosure:true,message:`Отправленное сообщение ${candidate.label} ${runId}`},201);applications.push(application);}
  ids.applications=applications.map(item=>item.id);await savePrivate();
  const list=await request(owner,'/employer/applications');assert.equal(list.total,4);assert.deepEqual(list.counts,{all:4,new:4,shortlisted:0});assert.equal(new Set(list.items.map(item=>item.id)).size,4);assert.ok(list.items.every(item=>!('candidateUserId' in item)));
  for(const job of jobs){const filtered=await request(owner,`/employer/applications?jobId=${job.id}`);assert.equal(filtered.total,2);assert.deepEqual(filtered.counts,{all:2,new:2,shortlisted:0});assert.ok(filtered.items.every(item=>item.jobId===job.id));}
  check('Real applications and per-job counters agree across a four-application ordinary dataset');
  for(const candidate of [one,two])assert.equal((await request(owner,`/employer/applications?q=${encodeURIComponent(candidate.alias)}`)).total,2);
  assert.equal((await request(owner,`/employer/applications?q=${encodeURIComponent(one.displayName)}`)).total,2);
  assert.equal((await request(owner,`/employer/applications?q=${encodeURIComponent(two.displayName)}`)).total,0);
  assert.ok(list.items.filter(item=>item.resumeId===two.resumeId).every(item=>item.candidate.publicName===null));
  check('Public identity is searchable by both name and alias; hidden real name never affects results or total');
  const paged=[];for(let page=1;page<=4;page++){const result=await request(owner,`/employer/applications?sort=created_desc&pageSize=1&page=${page}`);assert.equal(result.total,4);assert.equal(result.page,page);paged.push(result.items[0].id);}
  assert.deepEqual(paged,list.items.map(item=>item.id));assert.equal(new Set(paged).size,4);
  for(const sort of ['created_asc','name_asc','status_asc']){const result=await request(owner,`/employer/applications?sort=${sort}`);assert.deepEqual(result.items.map(item=>item.id).sort((a,b)=>a-b),paged.slice().sort((a,b)=>a-b));}
  const now=new Date(),today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(now),tomorrow=new Date(Date.parse(today+'T12:00:00Z')+86400000).toISOString().slice(0,10);
  assert.equal((await request(owner,`/employer/applications?dateFrom=${today}&dateTo=${today}`)).total,4);
  assert.equal((await request(owner,`/employer/applications?dateFrom=${tomorrow}`)).total,0);
  for(const path of ['/employer/applications?dateFrom=2026-02-30','/employer/applications?dateFrom=2026-10-09&dateTo=2026-10-08','/employer/applications?status=sent&status=viewed','/employer/applications?pageSize=100'])await request(owner,path,'GET',undefined,400);
  check('Whole-result pagination, all sort modes, date boundaries and invalid filters behave predictably');
  const app=applications[0];await request(owner,`/employer/applications/${app.id}/status`,'POST',{status:'viewed'});await request(owner,`/employer/applications/${app.id}/status`,'POST',{status:'shortlisted'});
  const short=await request(owner,'/employer/applications?status=shortlisted');assert.equal(short.total,1);assert.equal(short.items[0].id,app.id);assert.deepEqual(short.counts,{all:4,new:3,shortlisted:1});
  const foreign=shared.actors.find(actor=>actor.suffix==='foreign');assert.ok(foreign);
  assert.equal((await request(foreign,`/employer/applications?jobId=${jobs[0].id}`)).total,0);await request(foreign,`/employer/applications/${app.id}/status`,'POST',{status:'declined'},409);await request(foreign,`/employer/applications/${app.id}/contacts`,'GET',undefined,403);
  check('Status updates persist in results and counters; a foreign company cannot change or read the application');
  const contacts=await request(owner,`/employer/applications/${app.id}/contacts`);assert.equal(contacts.email,one.email);
  const current=short.items[0];assert.equal(current.candidate.id,one.id);assert.equal(current.resumeId,one.resumeId);assert.equal(current.invitationAllowed,true);
  const beforeInvites=Number((await pool.query('SELECT count(*) FROM signal_invitations WHERE company_id=$1',[owner.companyId])).rows[0].count);
  const detail=await request(owner,`/employer/selection/resumes/${one.resumeId}?contextType=job&contextId=${jobs[0].id}`);assert.equal(detail.candidate.resumeId,one.resumeId);assert.equal(detail.candidate.candidateId,one.id);assert.equal(detail.context.type,'job');assert.equal(detail.context.id,jobs[0].id);
  assert.equal(Number((await pool.query('SELECT count(*) FROM signal_invitations WHERE company_id=$1',[owner.companyId])).rows[0].count),beforeInvites);
  check('Invitation preparation opens the exact matching-only CV and job context without sending an invitation');
  await profile(one,{consentMatching:false});let changed=await request(owner,'/employer/applications?status=shortlisted');assert.equal(changed.items[0].invitationAllowed,false);assert.ok(changed.items[0].candidate);assert.equal((await request(owner,`/employer/applications/${app.id}/contacts`)).email,one.email);
  await request(owner,`/employer/selection/resumes/${one.resumeId}?contextType=job&contextId=${jobs[0].id}`,'GET',undefined,404);
  check('Revoked matching consent closes selection and invitation preparation while the separate application disclosure stays valid');
  await profile(one,{visibility:'private'});changed=await request(owner,'/employer/applications?status=shortlisted');assert.equal(changed.items[0].candidate,null);assert.equal(changed.items[0].resumeSnapshot,null);assert.equal(changed.items[0].message,'');assert.equal(changed.items[0].invitationAllowed,false);assert.equal(changed.items[0].status,'shortlisted');
  assert.equal((await request(owner,`/employer/applications?q=${encodeURIComponent(one.alias)}`)).total,0);await request(owner,`/employer/applications/${app.id}/contacts`,'GET',undefined,403);
  check('A hidden exact CV removes professional data, cover message, searchable identity and contact access while preserving lifecycle');
  const anonymousApp=applications.find(item=>item.jobId===jobs[0].id&&item.resumeId===two.resumeId);await request(two,`/me/applications/${anonymousApp.id}/withdraw`,'POST');const withdrawn=await request(owner,'/employer/applications?status=withdrawn');assert.equal(withdrawn.total,1);assert.equal(withdrawn.items[0].id,anonymousApp.id);assert.equal(withdrawn.items[0].candidate,null);assert.equal(withdrawn.items[0].message,'');assert.equal((await request(owner,`/employer/applications?q=${encodeURIComponent(two.alias)}`)).total,0);
  check('Withdrawal preserves the application and closes the company disclosure across this candidate’s applications');
  const updatedJob=await request(owner,`/employer/jobs/${jobs[0].id}`,'PUT',{version:jobs[0].version,title:'Изменённая вакансия applications E'});assert.equal((await request(owner,`/employer/applications?jobId=${jobs[0].id}`)).items.find(item=>item.id===app.id).snapshot.title,jobs[0].title);
  await request(owner,`/employer/jobs/${jobs[0].id}`,'DELETE',{version:updatedJob.version});assert.equal((await request(owner,`/employer/applications?jobId=${jobs[0].id}`)).total,2);assert.equal(Number((await pool.query('SELECT count(*) FROM signal_applications WHERE company_id=$1',[owner.companyId])).rows[0].count),4);
  check('Editing and soft-deleting the job retain original application conditions and all application records');
}catch(error){failure=error instanceof Error?error.message:String(error);}finally{
  await savePrivate();await mkdir(output,{recursive:true});await writeFile(`${output}/receipt.json`,JSON.stringify({synthetic:true,runId,apiOrigin:origin,ordinaryActors:actors.map(({id,role,label,companyId,resumeId})=>({id,role,label,companyId,resumeId})),ids,checks,receipts,status:failure?'FAIL':'PASS',failure:failure??null},null,2));await pool.end();
  console.log(JSON.stringify({status:failure?'FAIL':'PASS',checks:checks.length,output,failure:failure??null}));if(failure)process.exitCode=1;
}
