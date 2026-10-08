import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {randomUUID,randomBytes,createHash,scryptSync} from 'node:crypto';
import pg from '../lib/db/node_modules/pg/lib/index.js';
const privateRoot='C:/Users/Misha/.codex/private';
const env=Object.fromEntries((await readFile(privateRoot+'/signal-employer-e-20261008.env','utf8')).split(/\r?\n/).filter(line=>line&&!line.startsWith('#')).map(line=>{const i=line.indexOf('=');return[line.slice(0,i),line.slice(i+1).replace(/^"|"$/g,'')];}));
const dbUrl=new URL(env.DATABASE_URL);assert.equal(dbUrl.hostname,'127.0.0.1');assert.equal(dbUrl.port,'55435');assert.equal(dbUrl.pathname,'/signal_employer_e_20261008');
const pool=new pg.Pool({connectionString:env.DATABASE_URL}),runId=randomUUID();
const api='http://localhost:4413/api',origin='http://signal-employer.localhost:4414';
const actors=[],receipts=[],checks=[],ids={};let failure;
const privateFile=privateRoot+`/signal-employer-e-correction-read-${runId}.json`;
const output='outputs/verification/employer-workspace-E01-E16-20261008/correction-01';
const check=(name)=>checks.push({name,status:'PASS'});
async function save(){await writeFile(privateFile,JSON.stringify({runId,synthetic:true,actors,ids},null,2));}
async function request(actor,path,method='GET',body,expected=200){const response=await fetch(api+path,{method,headers:{Origin:origin,...(actor?{Cookie:actor.cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});const json=await response.json();receipts.push({actorId:actor?.id??null,path,method,status:response.status});assert.equal(response.status,expected,`${method} ${path}: ${json.error??response.status}`);return json;}
async function actor(role,label){const token=randomBytes(32).toString('base64url'),password=randomBytes(24).toString('base64url'),salt=randomBytes(16).toString('hex'),email=`correction-read-${runId}-${label}@example.test`;
  const user=(await pool.query('INSERT INTO signal_users(email,password_hash,role,display_name,email_verified,demo_mode) VALUES($1,$2,$3,$4,true,false) RETURNING id',[email,`scrypt:${salt}:${scryptSync(password,salt,64).toString('hex')}`,role,`Проверка C04 ${label}`])).rows[0];
  await pool.query("INSERT INTO signal_sessions(token_hash,user_id,expires_at,demo_mode) VALUES($1,$2,now()+interval '7 days',false)",[createHash('sha256').update(token).digest('hex'),user.id]);
  const row={id:user.id,role,label,email,password,cookie:`fsp_signal_session=${token}`};
  if(role==='employer')row.companyId=(await pool.query('INSERT INTO signal_companies(owner_user_id,name,contact_email) VALUES($1,$2,$3) RETURNING id',[row.id,'Проверка закрытой вакансии C04',email])).rows[0].id;
  else row.resumeId=(await request(row,'/me/resumes')).resumes[0].id;
  actors.push(row);await save();return row;
}
async function profile(user,resumeId,patch){const current=await request(user,`/me/candidate-profile?resumeId=${resumeId}`);return request(user,'/me/candidate-profile','PUT',{...current,resumeId,revision:current.revision,identityRevision:current.identityRevision,...patch});}
try{
  const owner=await actor('employer','owner'),one=await actor('candidate','one'),two=await actor('candidate','two');
  for(const user of [one,two])await profile(user,user.resumeId,{professionalAlias:`Специалист C04 ${user.label}`,stack:['Python','SQL'],skills:['Python'],visibility:'pseudonymous',consentMatching:true,consentCatalog:false,readyForOffers:true,workFormat:'Удалённо',salaryMin:100000,salaryMax:200000});
  const extra=await request(one,'/me/resumes','POST',{title:'Другое резюме C04',specialization:'Backend / Python'},201);ids.extraResume=extra.id;
  await profile(one,extra.id,{stack:['Python'],skills:['Python'],visibility:'pseudonymous',consentMatching:true,consentCatalog:false});
  let job=await request(owner,'/employer/jobs','POST',{title:'Закрытая вакансия C04',description:'Собственная проверка сохранённого списка и точного резюме после закрытия приёма откликов.',specialization:'Backend / Python',grade:'Junior',skills:['Python'],skillRequirements:[{skill:'Python',level:'Junior'}],location:'Москва',workFormat:'Удалённо',salaryMin:100000,salaryMax:200000,salaryPeriod:'month',salaryType:'gross'},201);
  ids.closedJob=job.id;const context={type:'job',id:job.id};
  for(const user of [one,two])await request(owner,'/employer/shortlist','PUT',{context,candidateId:user.id,resumeId:user.resumeId,contextVersion:job.version});
  job=await request(owner,`/employer/jobs/${job.id}/status`,'POST',{status:'published',version:job.version});
  job=await request(owner,`/employer/jobs/${job.id}/status`,'POST',{status:'closed',version:job.version});
  const scope=`contextType=job&contextId=${job.id}&view=shortlisted`;
  const list=await request(owner,`/employer/selection?${scope}`);assert.equal(list.context.readOnly,true);assert.equal(list.total,2);assert.deepEqual(list.items.map(row=>row.resumeId).sort((a,b)=>a-b),[one.resumeId,two.resumeId].sort((a,b)=>a-b));
  const detail=await request(owner,`/employer/selection/resumes/${one.resumeId}?${scope}`);assert.equal(detail.context.readOnly,true);assert.deepEqual(detail.availableResumes.map(row=>row.id),[one.resumeId]);
  await request(owner,`/employer/selection/resumes/${extra.id}?${scope}`,'GET',undefined,404);
  assert.equal((await request(owner,'/employer/selection/compare','POST',{context,view:'shortlisted',resumeIds:[one.resumeId,two.resumeId]})).items.length,2);
  const access=await request(owner,'/employer/selection/access','POST',{context,view:'shortlisted',mode:'catalog',resumeIds:[one.resumeId,two.resumeId,extra.id]});assert.deepEqual(access.items.map(row=>row.resumeId).sort((a,b)=>a-b),[one.resumeId,two.resumeId].sort((a,b)=>a-b));
  check('C04 closed shortlist/detail/compare/access keep only pinned whole CVs with fresh matching purpose');
  await request(owner,`/employer/selection?contextType=job&contextId=${job.id}`,'GET',undefined,404);
  await request(owner,'/employer/shortlist','PUT',{context,candidateId:one.id,resumeId:extra.id},404);
  await request(owner,'/employer/shortlist','DELETE',{context,candidateId:one.id},404);
  await request(owner,'/employer/invitations','POST',{idempotencyKey:runId,jobId:job.id,contextVersion:job.version,candidateId:one.id,resumeId:one.resumeId,title:'Запрещённое приглашение C04',message:'Проверка отказа в новом приглашении закрытой вакансии.',reason:'Сохранённый список не даёт разрешение на новое приглашение.',salaryMin:100000,salaryMax:200000,salaryPeriod:'month',salaryType:'gross',workFormat:'Удалённо'},404);
  check('C04 closed context refuses new pool/save/remove/invite');
  await profile(two,two.resumeId,{consentMatching:false});
  const revoked=await request(owner,`/employer/selection?${scope}`);assert.equal(revoked.total,1);assert.equal(revoked.unavailableShortlistCount,1);
  await request(owner,`/employer/selection/resumes/${two.resumeId}?${scope}`,'GET',undefined,404);
  await request(owner,'/employer/selection/compare','POST',{context,view:'shortlisted',resumeIds:[one.resumeId,two.resumeId]},404);
  assert.equal((await request(owner,'/employer/selection/access','POST',{context,view:'shortlisted',resumeIds:[two.resumeId]})).items.length,0);
  await profile(two,two.resumeId,{consentMatching:true});
  check('C04 revoked matching consent removes old saved data without deleting link/history; restored own fixture for UI');
  const coverage=await request(null,'/skills/coverage?specialization=Frontend%20%2F%20TypeScript&skills=React%2Cts%2CPostgres');
  for(const item of coverage.coverage.slice(0,2)){assert.equal(item.supported,true);assert.deepEqual(item.availableLevels,['Junior','Middle','Senior']);assert.equal(item.programVersion,'signal-skills-2026-10-v6');}
  assert.equal(coverage.coverage[2].supported,false);assert.equal(coverage.coverage.some(row=>row.evidence.includes('Успешная программа')),false);
  check('C07 public coverage agrees with current React/TypeScript skill-level registry and does not invent PostgreSQL programme');
  await save();
}catch(error){failure=error.message;}
finally{await mkdir(output,{recursive:true});await save();const report=output+`/read-coverage-${runId}.json`;await writeFile(report,JSON.stringify({at:new Date().toISOString(),passed:!failure,failure,checks,receipts,privateLedger:privateFile,onlyNewOwnActors:true,ids},null,2));await pool.end();console.log(JSON.stringify({passed:!failure,failure,checks:checks.length,report,privateLedger:privateFile}));if(failure)process.exitCode=1;}
