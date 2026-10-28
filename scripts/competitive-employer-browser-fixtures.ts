import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {pool} from '../lib/db/src/index';
import {assertOwnDatabase,qaUser,qaNeed} from './competitive-fixtures';
import {buildSkillAttempt,scoreSkillAttempt} from '../artifacts/api-server/src/lib/skill-module-bank';
import {processSelectionWatch} from '../artifacts/api-server/src/lib/selection-watch';
import {claimOutboxDelivery,deliverClaimedOutbox} from '../artifacts/api-server/src/lib/ats-outbox';
assertOwnDatabase();process.env.DEMO_MODE='true';process.env.SIGNAL_SKILL_MODULES_ENABLED='true';
const file=new URL('../../browser-employer-b1-fixtures.json',import.meta.url),action=process.argv[2]??'inspect';
async function user(scope:string,role:'candidate'|'employer'='candidate'){
 const u=await qaUser(role);await pool.query('UPDATE signal_users SET review_scope_id=$1 WHERE id=$2',[scope,u.id]);await pool.query('UPDATE signal_sessions SET review_scope_id=$1 WHERE user_id=$2',[scope,u.id]);
 if(u.resumeId)await pool.query(`UPDATE signal_candidate_resumes SET title=$2,stack=ARRAY['Python'],skills=ARRAY['Python'],visibility='public',summary='PRIVATE CV NOTE B1',work_format='Удалённо' WHERE id=$1`,[u.resumeId,`Python-разработчик распределённых систем и платформ обработки событий ${u.id}`]);return u;
}
try{
 if(action==='setup'){
  const scope=randomUUID(),employer=await user(scope,'employer'),member=await user(scope,'employer'),candidate=await user(scope),proven=await user(scope);
  await pool.query(`UPDATE signal_users SET display_name='Александра Константинопольская — разработчик систем обработки событий' WHERE id=$1`,[candidate.id]);
  const f=buildSkillAttempt('python','Junior',randomUUID()),answers=Object.fromEntries(Object.entries(f.oracles).map(([id,o])=>[id,o.expected])),decision=scoreSkillAttempt(f.cases,f.oracles,answers,f.policy);
  const attempt=(await pool.query(`INSERT INTO signal_skill_attempts(user_id,skill_id,level,program_version,status,cases,oracles,answers,policy,decision,expires_at,submitted_at) VALUES($1,'python','Junior',$2,'submitted',$3,$4,$5,$6,$7,now(),now()) RETURNING id`,[proven.id,f.programVersion,JSON.stringify(f.cases),JSON.stringify(f.oracles),JSON.stringify(answers),JSON.stringify(f.policy),JSON.stringify(decision)])).rows[0];
  await pool.query(`INSERT INTO signal_skill_evidence(user_id,attempt_id,skill_id,level,program_version,competency_ids,verified_at,decision) VALUES($1,$2,'python','Junior',$3,$4,now(),$5)`,[proven.id,attempt.id,f.programVersion,decision.competencies.filter(c=>c.passed).map(c=>c.id),JSON.stringify(decision)]);
  await pool.query(`INSERT INTO signal_guest_permissions(resume_id,user_id,allowed) VALUES($1,$2,true),($3,$4,true)`,[candidate.resumeId,candidate.id,proven.resumeId,proven.id]);
  const need=await qaNeed(employer.companyId!,'Внутренний запрос на Python-разработчика платформы обработки событий для большой команды');
  await pool.query(`UPDATE signal_needs SET required_skills=ARRAY['Python'],skill_requirements='[{"skill":"Python","mode":"declared_or_verified"}]' WHERE id=$1`,[need.id]);
  const job=(await pool.query(`INSERT INTO signal_jobs(company_id,title,description,specialization,grade,grade_mode,skills,work_format,salary_min,salary_max,salary_period,salary_type,status) VALUES($1,'Python-разработчик инфраструктуры и распределённых систем','Разработка сервисов обработки событий','Backend / Python','Junior','declared_or_verified',ARRAY['Python'],'Удалённо',100000,200000,'month','gross','published') RETURNING id`,[employer.companyId])).rows[0];
  await pool.query(`INSERT INTO signal_job_requirements(job_id,skill_requirements) VALUES($1,'[{"skill":"Python","mode":"declared_or_verified"}]')`,[job.id]);
  const state={scope,employer,member,candidate,proven,need,job};writeFileSync(file,JSON.stringify(state,null,2));
  writeFileSync(new URL('../../browser-employer-b1-bootstrap.js',import.meta.url),`async page => { await page.context().addCookies([{name:'fsp_signal_session',value:${JSON.stringify(employer.cookie.split('=')[1])},url:'http://127.0.0.1:4481'}]); await page.goto('http://127.0.0.1:4481/employer/candidates?contextType=need&contextId=${need.id}&applied=1'); return {needId:${need.id},jobId:${job.id},candidateId:${candidate.id},resumeId:${candidate.resumeId},memberId:${member.id}}; }`);
  console.log(JSON.stringify({status:'prepared',scope,needId:need.id,jobId:job.id,candidateId:candidate.id,resumeId:candidate.resumeId,memberId:member.id}));
 }else{
  const s=JSON.parse(readFileSync(file,'utf8'));
  if(action==='newcomer'){s.newcomer=await user(s.scope);writeFileSync(file,JSON.stringify(s,null,2));}
  if(action==='watch')for(const w of (await pool.query('SELECT id FROM signal_selection_watches WHERE company_id=$1',[s.employer.companyId])).rows)await processSelectionWatch(w.id);
  if(action==='revoke')await pool.query('UPDATE signal_candidate_resumes SET consent_matching=false WHERE id=$1',[s.newcomer.resumeId]);
  if(action==='restore')await pool.query('UPDATE signal_candidate_resumes SET consent_matching=true WHERE id=$1',[s.newcomer.resumeId]);
  if(action==='deliver-fail'||action==='deliver-ok'){
   process.env.NODE_ENV='test';process.env.SIGNAL_ATS_LOCAL_TEST='true';process.env.SIGNAL_ATS_LOCAL_TEST_PORT='4490';
   writeFileSync(new URL('../../browser-employer-b1-receiver-mode.json',import.meta.url),JSON.stringify({status:action==='deliver-fail'?500:200}));
   const endpoint=(await pool.query('SELECT id FROM signal_ats_endpoints WHERE company_id=$1',[s.employer.companyId])).rows[0];assert.ok(endpoint);
   for(let i=0;i<(action==='deliver-fail'?5:10);i++){
    await pool.query(`UPDATE signal_outbox_deliveries SET next_at=now() WHERE endpoint_id=$1 AND state='queued'`,[endpoint.id]);
    const claim=await claimOutboxDelivery(endpoint.id);if(!claim)break;await deliverClaimedOutbox(claim);
   }
  }
  if(action==='expire-share'){
   // Published composition is immutable. Create a separate short-lived QA snapshot;
   // do not weaken the production trigger or mutate an existing shared selection.
   s.expiringShareId=randomUUID();
   const inserted=await pool.query(`INSERT INTO signal_shared_selections(id,company_id,created_by,context_type,context_id,context_revision,public_purpose,items,member_ids,token_hash,expires_at) SELECT $2,company_id,created_by,context_type,context_id,context_revision,'Короткая QA-ссылка',items,member_ids,token_hash,now()+interval '15 seconds' FROM signal_shared_selections WHERE company_id=$1 AND revoked_at IS NULL AND token_hash IS NOT NULL ORDER BY created_at DESC LIMIT 1 RETURNING id`,[s.employer.companyId,s.expiringShareId]);assert.equal(inserted.rowCount,1);writeFileSync(file,JSON.stringify(s,null,2));
   writeFileSync(new URL('../../browser-employer-b1-expiry-check.js',import.meta.url),`async page=>{const original=await page.evaluate(()=>sessionStorage.getItem('b1-expiry-review'));if(!original)throw new Error('Missing own guest link');const token=original.split('#')[1].split('.')[1];const gc=await page.context().browser().newContext();try{const gp=await gc.newPage();await gp.goto('http://127.0.0.1:4481/review#${s.expiringShareId}.'+token);await gp.getByRole('heading',{name:'Специалист 1',exact:true}).waitFor({timeout:5000});await gp.waitForTimeout(16000);await gp.reload();await gp.getByRole('alert').waitFor({timeout:5000});if(await gp.getByRole('heading',{name:'Специалист 1',exact:true}).count())throw new Error('Expired card visible');return {phase:'S12-expiry',liveBeforeDeadline:true,deniedAfterDeadline:true,immutableSnapshotPreserved:true};}finally{await gc.close();}}`);
  }
  const watches=(await pool.query('SELECT id,state,revision FROM signal_selection_watches WHERE company_id=$1',[s.employer.companyId])).rows;
  const deliveries=(await pool.query('SELECT d.id,d.state,d.attempts FROM signal_outbox_deliveries d JOIN signal_ats_endpoints e ON e.id=d.endpoint_id WHERE e.company_id=$1',[s.employer.companyId])).rows;
  console.log(JSON.stringify({status:'done',action,watches,deliveries,...(s.newcomer?{newcomerId:s.newcomer.id,newcomerResumeId:s.newcomer.resumeId}:{})}));
 }
}finally{await pool.end();}
