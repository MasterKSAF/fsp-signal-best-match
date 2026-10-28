/** Isolated B2 fixtures. Contains no credentials; private session output stays outside source. */
import assert from 'node:assert/strict';
import {randomUUID,generateKeyPairSync,createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {pool} from '../lib/db/src/index';
import {assertOwnDatabase,qaUser,qaNeed} from './competitive-fixtures';
import {buildSkillAttempt,scoreSkillAttempt} from '../artifacts/api-server/src/lib/skill-module-bank';
import {pdfFixture} from '../tests/fixtures/pdf-import';
assertOwnDatabase();
const file=new URL('../../browser-candidate-b2-fixtures.json',import.meta.url);
const action=process.argv[2]??'inspect';
async function proof(userId:number,skillId:string){
 const f=buildSkillAttempt(skillId,'Junior',randomUUID());
 const answers=Object.fromEntries(Object.entries(f.oracles).map(([id,o])=>[id,o.expected]));
 const decision=scoreSkillAttempt(f.cases,f.oracles,answers,f.policy);assert.ok(decision.passed);
 const a=(await pool.query(`INSERT INTO signal_skill_attempts(user_id,skill_id,level,program_version,status,cases,oracles,answers,policy,decision,expires_at,submitted_at) VALUES($1,$2,'Junior',$3,'submitted',$4,$5,$6,$7,$8,now(),now()) RETURNING id`,[userId,skillId,f.programVersion,JSON.stringify(f.cases),JSON.stringify(f.oracles),JSON.stringify(answers),JSON.stringify(f.policy),JSON.stringify(decision)])).rows[0];
 await pool.query(`INSERT INTO signal_skill_evidence(user_id,attempt_id,skill_id,level,program_version,competency_ids,verified_at,decision) VALUES($1,$2,$3,'Junior',$4,$5,now(),$6)`,[userId,a.id,skillId,f.programVersion,decision.competencies.filter(c=>c.passed).map(c=>c.id),JSON.stringify(decision)]);return {id:a.id,skillId};
}
try{
 if(action==='setup'){
  const scope=randomUUID(),owner=await qaUser(),foreign=await qaUser(),expert=await qaUser(),empty=await qaUser(),employer=await qaUser('employer'),member=await qaUser('employer');
  for(const u of [owner,foreign,expert,empty,employer,member]){
   await pool.query('UPDATE signal_users SET review_scope_id=$1 WHERE id=$2',[scope,u.id]);await pool.query('UPDATE signal_sessions SET review_scope_id=$1 WHERE user_id=$2',[scope,u.id]);
  }
  await pool.query(`UPDATE signal_candidate_resumes SET title='Python • основной профиль',summary='Исходное описание B2',specialization='Backend / Python',stack=ARRAY['Python','SQL'],skills=ARRAY['Python','SQL'],visibility='public',work_format='Удалённо',years_experience=3 WHERE id=$1`,[owner.resumeId]);
  const second=(await pool.query(`INSERT INTO signal_candidate_resumes(user_id,title,summary,specialization,skills,visibility,consent_matching,consent_catalog) VALUES($1,'SQL • второе резюме','PRIVATE SECOND CV B2','Backend / Python',ARRAY['SQL'],'private',false,false) RETURNING id`,[owner.id])).rows[0];
  await pool.query('DELETE FROM signal_candidate_resumes WHERE id=$1',[empty.resumeId]);empty.resumeId=undefined;
  await pool.query(`INSERT INTO signal_expert_grants(id,user_id,granted_by,authority,expires_at) VALUES($1,$2,'isolated-b2-qa','assessment_review',now()+interval '2 hours')`,[randomUUID(),expert.id]);
  const python=await proof(owner.id,'python'),sql=await proof(owner.id,'sql'),emptyProof=await proof(empty.id,'python');
  const need=await qaNeed(employer.companyId!,'PRIVATE B2 • внутренний запрос Python');
  await pool.query(`UPDATE signal_needs SET required_skills=ARRAY['Python'],skill_requirements='[{"skill":"Python","mode":"declared_or_verified"}]' WHERE id=$1`,[need.id]);
  const job=(await pool.query(`INSERT INTO signal_jobs(company_id,title,description,specialization,grade,grade_mode,skills,work_format,salary_min,salary_max,salary_period,salary_type,status) VALUES($1,'B2 • Python-разработчик','Разработка сервисов. Собеседование по опыту и навыкам.','Backend / Python','Junior','declared_or_verified',ARRAY['Python'],'Удалённо',150000,200000,'month','gross','published') RETURNING id`,[employer.companyId])).rows[0];
  await pool.query(`INSERT INTO signal_job_requirements(job_id,skill_requirements) VALUES($1,'[{"skill":"Python","mode":"declared_or_verified"}]')`,[job.id]);
  const pair=generateKeyPairSync('ed25519'),kid=`b2-${randomUUID()}`,issuer='http://127.0.0.1:4481';
  const keyFile=new URL('../../b2-passport-private.pem',import.meta.url);writeFileSync(keyFile,pair.privateKey.export({type:'pkcs8',format:'pem'}),{mode:0o600});
  await pool.query(`INSERT INTO signal_passport_keys(kid,issuer,public_key_pem,state) VALUES($1,$2,$3,'active')`,[kid,issuer,pair.publicKey.export({type:'spki',format:'pem'}).toString()]);
  writeFileSync(new URL('../../b2-runtime.env',import.meta.url),`NODE_ENV=test\nSIGNAL_PASSPORT_ISSUER=${issuer}\nSIGNAL_PASSPORT_SIGNING_KEY_FILE=${keyFile.pathname.replace(/^\//,'')}\n`);
  const state={scope,owner,foreign,expert,empty,employer,member,second,python,sql,emptyProof,job,need,kid};writeFileSync(file,JSON.stringify(state,null,2));
  writeFileSync(new URL('../../b2-import-visible.pdf',import.meta.url),await pdfFixture());
  writeFileSync(new URL('../../b2-import-scan.pdf',import.meta.url),await pdfFixture('scan'));
  writeFileSync(new URL('../../b2-import-broken.pdf',import.meta.url),Buffer.from('%PDF-broken'));
  console.log(JSON.stringify({status:'prepared',scope,ownerId:owner.id,firstCV:owner.resumeId,secondCV:second.id,pythonAttempt:python.id,jobId:job.id,needId:need.id}));
 }else if(action==='visible-job'){
  const s=JSON.parse(readFileSync(file,'utf8'));s.privateJob=s.job;
  s.job=(await pool.query(`INSERT INTO signal_jobs(company_id,title,description,specialization,grade,grade_mode,skills,work_format,salary_min,salary_max,salary_period,salary_type,status) SELECT company_id,'B2 • Python-разработчик — открытый профиль',description,specialization,grade,grade_mode,skills,work_format,salary_min,salary_max,salary_period,salary_type,status FROM signal_jobs WHERE id=$1 AND company_id=$2 RETURNING id`,[s.job.id,s.employer.companyId])).rows[0];
  await pool.query(`INSERT INTO signal_job_requirements(job_id,skill_requirements) VALUES($1,'[{"skill":"Python","mode":"declared_or_verified"}]')`,[s.job.id]);writeFileSync(file,JSON.stringify(s,null,2));console.log(JSON.stringify({newOwnJob:s.job.id,privateApplicationJob:s.privateJob.id}));
 }else if(action==='audit'){
  const s=JSON.parse(readFileSync(file,'utf8'));
  const {assessmentSource}=await import('../artifacts/api-server/src/lib/assessment-review');
  const {canonicalJson}=await import('../artifacts/api-server/src/lib/canonical-json');
  const source=await assessmentSource('skill',s.python.id);
  const review=(await pool.query(`SELECT d.*,a.status AS appeal_status FROM signal_assessment_review_decisions d JOIN signal_assessment_appeals a ON a.id=d.appeal_id WHERE a.user_id=$1 AND a.attempt_id=$2 ORDER BY d.revision DESC`,[s.owner.id,s.python.id])).rows;
  assert.equal(review.length,1);assert.equal(review[0].action,'confirm');assert.equal(review[0].appeal_status,'resolved');
  assert.equal(review[0].source.sourceHash,createHash('sha256').update(canonicalJson(source)).digest('hex'));
  assert.deepEqual(source.decision,scoreSkillAttempt(source.cases,source.oracles,source.answers,source.policy!));
  const head=(await pool.query(`SELECT revision,validity,decision_id FROM signal_assessment_heads WHERE user_id=$1 AND kind='skill' AND attempt_id=$2`,[s.owner.id,s.python.id])).rows[0];
  assert.equal(head.decision_id,review[0].id);assert.equal(head.revision,review[0].revision);
  const client=await pool.connect();let sourceGuard=false,reviewGuard=false;
  try{await client.query('BEGIN');await client.query('SAVEPOINT source_guard');try{await client.query(`UPDATE signal_skill_attempts SET answers='{}' WHERE id=$1 AND user_id=$2`,[s.python.id,s.owner.id]);}catch(e){sourceGuard=/immutable/.test(String(e));}await client.query('ROLLBACK TO source_guard');await client.query('SAVEPOINT review_guard');try{await client.query(`UPDATE signal_assessment_review_decisions SET explanation='changed by QA' WHERE id=$1`,[review[0].id]);}catch(e){reviewGuard=/immutable|append.only/i.test(String(e));}await client.query('ROLLBACK');}finally{client.release();}
  assert.ok(sourceGuard&&reviewGuard);
  const evidence=(await pool.query(`SELECT skill_id,level,attempt_id,verified_at FROM signal_skill_evidence WHERE user_id=$1 ORDER BY skill_id`,[s.owner.id])).rows;
  assert.ok(evidence.every(e=>e.level==='Junior'));assert.equal(evidence.find(e=>e.skill_id==='sql').attempt_id,s.sql.id);
  assert.ok(new Date(evidence.find(e=>e.skill_id==='python').verified_at).getTime()<new Date(review[0].created_at).getTime());
  const active=(await pool.query(`SELECT count(*)::integer n FROM signal_public_passports WHERE user_id=$1 AND state='active'`,[s.owner.id])).rows[0];assert.equal(active.n,0);
  console.log(JSON.stringify({originalSourceHashMatches:true,originalDecisionRecomputed:true,appendOnlyDecisionCount:review.length,headRevision:head.revision,sourceGuard,reviewGuard,noGradeInflation:true,proofStillDatedBeforeReview:true,unrelatedSQLAttempt:s.sql.id,activeQAPassports:active.n}));
 }else{
  const s=JSON.parse(readFileSync(file,'utf8'));
  const cvs=(await pool.query('SELECT id,title,summary,skills,revision,consent_matching,consent_catalog,visibility FROM signal_candidate_resumes WHERE user_id=$1 ORDER BY id',[s.owner.id])).rows;
  const proofs=(await pool.query('SELECT skill_id,level,attempt_id FROM signal_skill_evidence WHERE user_id=$1 ORDER BY id',[s.owner.id])).rows;
  console.log(JSON.stringify({cvs,proofs}));
 }
}finally{await pool.end();}
