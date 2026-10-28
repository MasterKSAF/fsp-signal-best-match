import assert from 'node:assert/strict';
import { createHash,randomBytes,randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { pool } from '../lib/db/src/index';
import { buildSkillAttempt,scoreSkillAttempt } from '../artifacts/api-server/src/lib/skill-module-bank';
import { loadSkillQualificationInputs } from '../artifacts/api-server/src/lib/skill-module-service';
import { selectAccountSkillEvidence } from '../artifacts/api-server/src/lib/skill-module-qualification';
const target=new URL(process.env.DATABASE_URL??'');assert.ok(['localhost','127.0.0.1'].includes(target.hostname)&&target.port==='55480'&&target.pathname==='/signal');
const checks:string[]=[],pass=(s:string)=>{checks.push(s);console.log('PASS',s);};
async function user(role='candidate'){const u=(await pool.query(`INSERT INTO signal_users(email,password_hash,role,display_name,email_verified,demo_mode) VALUES($1,'unusable-qa',$2,'Appeal QA',true,true) RETURNING id`,[`appeal-${randomUUID()}@example.test`,role])).rows[0];if(role==='candidate')await pool.query(`INSERT INTO signal_candidate_profiles(user_id,professional_alias) VALUES($1,$2)`,[u.id,`Appeal-${randomUUID()}`]);const token=randomBytes(32).toString('base64url');await pool.query(`INSERT INTO signal_sessions(token_hash,user_id,demo_mode,expires_at) VALUES($1,$2,true,now()+interval '1 hour')`,[createHash('sha256').update(token).digest('hex'),u.id]);return {id:u.id,cookie:`fsp_signal_session=${token}`};}
async function api(path:string,cookie:string,body?:unknown){const r=await fetch(`http://127.0.0.1:4480/api${path}`,{method:body?'POST':'GET',headers:{Cookie:cookie,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};}
async function fixture(userId:number,skillId:string){const f=buildSkillAttempt(skillId,'Junior',randomUUID()),answers=Object.fromEntries(Object.entries(f.oracles).map(([id,o])=>[id,o.expected])),decision=scoreSkillAttempt(f.cases,f.oracles,answers,f.policy);assert.ok(decision.passed);const a=(await pool.query(`INSERT INTO signal_skill_attempts(user_id,skill_id,level,program_version,status,cases,oracles,answers,policy,decision,expires_at,submitted_at) VALUES($1,$2,'Junior',$3,'submitted',$4,$5,$6,$7,$8,now(),now()) RETURNING id`,[userId,skillId,f.programVersion,JSON.stringify(f.cases),JSON.stringify(f.oracles),JSON.stringify(answers),JSON.stringify(f.policy),JSON.stringify(decision)])).rows[0];await pool.query(`INSERT INTO signal_skill_evidence(user_id,attempt_id,skill_id,level,program_version,competency_ids,verified_at,decision) VALUES($1,$2,$3,'Junior',$4,$5,now(),$6)`,[userId,a.id,skillId,f.programVersion,decision.competencies.filter(c=>c.passed).map(c=>c.id),JSON.stringify(decision)]);return {...a,...f,answers};}
try{
 const owner=await user(),foreign=await user(),expertA=await user(),expertB=await user(),company=await user('employer');
 for(const e of [expertA,expertB])await pool.query(`INSERT INTO signal_expert_grants(id,user_id,granted_by,authority,expires_at) VALUES($1,$2,'isolated-qa','assessment_review',now()+interval '1 hour')`,[randomUUID(),e.id]);
 const python=await fixture(owner.id,'python'),sqlSkill=await fixture(owner.id,'sql');
 const sourceBefore=(await pool.query('SELECT cases,oracles,answers,policy,decision,bank_release_hash,provenance FROM signal_skill_attempts WHERE id=$1',[python.id])).rows[0];
 let opened=await api('/me/assessment-appeals',owner.cookie,{kind:'skill',attemptId:python.id,reason:'Проверьте результат по сохранённым исходным ответам.'});assert.equal(opened.status,201,JSON.stringify(opened.data));const appealId=opened.data.id;
 assert.equal((await api('/me/assessment-appeals',foreign.cookie,{kind:'skill',attemptId:python.id,reason:'Пытаюсь открыть чужую проверку.'})).status,404);
 assert.equal((await api(`/me/assessment-appeals/${appealId}`,foreign.cookie)).status,404);
 assert.equal((await api(`/expert/assessment-appeals/${appealId}`,company.cookie)).status,403);
 const start=await api(`/expert/assessment-appeals/${appealId}/start`,expertA.cookie,{revision:opened.data.revision});assert.equal(start.status,200,JSON.stringify(start.data));
 const screen=await api(`/expert/assessment-appeals/${appealId}`,expertA.cookie);assert.equal(screen.status,200);assert.deepEqual(screen.data.source.answers,python.answers);
 pass('exact source ownership, expert grants and original answers are enforced');
 const command={commandKey:randomUUID(),appealRevision:start.data.revision,decisionRevision:screen.data.headRevision,action:'invalidate',explanation:'Пересмотрено только подтверждение Python по этой попытке.',internalNote:'PRIVATE_REVIEW_NOTE',caseReviews:[]};
 const race=await Promise.all([api(`/expert/assessment-appeals/${appealId}/resolve`,expertA.cookie,command),api(`/expert/assessment-appeals/${appealId}/resolve`,expertB.cookie,{...command,commandKey:randomUUID()})]);assert.deepEqual(race.map(r=>r.status).sort(),[200,409],JSON.stringify(race));const winner=race[0].status===200?expertA:expertB,winnerCommand=race[0].status===200?command:null;
 if(winnerCommand){const replay=await api(`/expert/assessment-appeals/${appealId}/resolve`,winner.cookie,winnerCommand);assert.equal(replay.status,200);assert.equal(replay.data.replayed,true);}
 const remaining=selectAccountSkillEvidence({userId:owner.id,specialization:'Backend / Python',assumedGrade:'Junior',stack:['Python','SQL'],skills:[]},await loadSkillQualificationInputs([owner.id]));assert.ok(!remaining.some(e=>e.skillId==='python'));assert.ok(remaining.some(e=>e.skillId==='sql'));
 const publicView=await api(`/me/assessment-appeals/${appealId}`,owner.cookie);assert.equal(publicView.status,200);assert.ok(!JSON.stringify(publicView.data).includes('PRIVATE_REVIEW_NOTE'));assert.ok(!('oracles' in publicView.data.source));
 assert.deepEqual((await pool.query('SELECT cases,oracles,answers,policy,decision,bank_release_hash,provenance FROM signal_skill_attempts WHERE id=$1',[python.id])).rows[0],sourceBefore);
 pass('two reviewers yield one decision; unrelated SQL and immutable source survive; internal materials stay private');
 assert.equal((await api('/me/assessment-appeals',owner.cookie,{kind:'skill',attemptId:python.id,reason:'Проверьте результат по сохранённым исходным ответам.',revision:publicView.data.appeal.revision})).status,409);
 opened=await api('/me/assessment-appeals',owner.cookie,{kind:'skill',attemptId:python.id,reason:'Новое основание: каждый сохранённый ответ совпадает с исходной рубрикой.',revision:publicView.data.appeal.revision});assert.equal(opened.status,201);
 const begun=await api(`/expert/assessment-appeals/${appealId}/start`,expertA.cookie,{revision:opened.data.revision});assert.equal(begun.status,200);
 const fresh=await api(`/expert/assessment-appeals/${appealId}`,expertA.cookie);
 const corrected={commandKey:randomUUID(),appealRevision:begun.data.revision,decisionRevision:fresh.data.headRevision,action:'correct',explanation:'Исходные ответы повторно сопоставлены с сохранённой рубрикой. Подтверждение восстановлено.',internalNote:'',caseReviews:python.cases.map(c=>({caseId:c.id,passed:true,basis:'Сохранённый ответ совпадает с эталоном этого исходного задания.'}))};
 const saved=await api(`/expert/assessment-appeals/${appealId}/resolve`,expertA.cookie,corrected);assert.equal(saved.status,200,JSON.stringify(saved.data));assert.equal((await api(`/expert/assessment-appeals/${appealId}/resolve`,expertA.cookie,corrected)).data.replayed,true);
 const restored=selectAccountSkillEvidence({userId:owner.id,specialization:'Backend / Python',assumedGrade:'Junior',stack:['Python','SQL'],skills:[]},await loadSkillQualificationInputs([owner.id]));assert.ok(restored.some(e=>e.skillId==='python'));assert.ok(restored.some(e=>e.skillId==='sql'));
 const history=(await api(`/me/assessment-appeals/${appealId}`,owner.cookie)).data.decisions;assert.equal(history.length,2);assert.equal(history[1].supersedes,history[0].id);assert.equal((await pool.query('SELECT count(*)::int n FROM signal_qualification_projection_events WHERE user_id=$1',[owner.id])).rows[0].n,2);
 pass('new grounds allow controlled reopen; explicit per-answer restoration appends lineage and one projection event per decision');
 await pool.query('UPDATE signal_expert_grants SET revoked_at=now() WHERE user_id=$1',[expertA.id]);assert.equal((await api(`/expert/assessment-appeals/${appealId}`,expertA.cookie)).status,403);
 pass('revoking expert authority immediately closes internal material access');
 writeFileSync(new URL('../../appeals-integration.json',import.meta.url),JSON.stringify({status:'passed',synthetic:true,checks,at:new Date().toISOString()},null,2));
}finally{await pool.end();}
