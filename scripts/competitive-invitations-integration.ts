import assert from 'node:assert/strict';
import { createHash,randomBytes,randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { pool } from '../lib/db/src/index';
import { summarizeInvitationCohort } from '../artifacts/api-server/src/lib/invitation-analytics';
const target=new URL(process.env.DATABASE_URL??'');assert.ok(['localhost','127.0.0.1'].includes(target.hostname)&&target.port==='55480'&&target.pathname==='/signal');
process.env.DEMO_MODE='true';
const {default:app}=await import('../artifacts/api-server/src/app');const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const apiBase=`http://127.0.0.1:${(server.address() as {port:number}).port}/api`;
const checks:string[]=[];const pass=(id:string)=>{checks.push(id);console.log('PASS',id);};
async function account(role:'candidate'|'employer'){
 const email=`invite-${randomUUID()}@example.test`,u=(await pool.query(`insert into signal_users(email,password_hash,role,display_name,email_verified,demo_mode) values($1,'unusable-qa',$2,'Invitation QA',true,true) returning id`,[email,role])).rows[0];
 const token=randomBytes(32).toString('base64url');await pool.query(`insert into signal_sessions(token_hash,user_id,demo_mode,expires_at) values($1,$2,true,now()+interval '1 hour')`,[createHash('sha256').update(token).digest('hex'),u.id]);
 const cookie=`fsp_signal_session=${token}`;
 if(role==='employer'){const company=(await pool.query(`insert into signal_companies(owner_user_id,name,contact_email) values($1,'Isolated invitation QA',$2) returning id`,[u.id,email])).rows[0];return {id:u.id,cookie,companyId:company.id,resumeId:0};}
 await pool.query(`insert into signal_candidate_profiles(user_id,professional_alias,stack) values($1,$2,ARRAY['Python'])`,[u.id,`INV-${randomUUID()}`]);
 const cv=(await pool.query(`insert into signal_candidate_resumes(user_id,title,stack,skills,visibility,consent_matching,consent_catalog) values($1,'Python',ARRAY['Python'],ARRAY['Python'],'pseudonymous',true,true) returning id`,[u.id])).rows[0];return {id:u.id,cookie,resumeId:cv.id,companyId:0};
}
async function api(path:string,cookie:string,body?:unknown){const r=await fetch(`${apiBase}${path}`,{method:body===undefined?'GET':'POST',headers:{Cookie:cookie,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};}
try{
 const employer=await account('employer'),other=await account('employer'),a=await account('candidate'),b=await account('candidate'),dummy=await account('candidate');
 const need=(await pool.query(`insert into signal_needs(company_id,title,specialization,grade,grade_mode,required_skills,skill_requirements,description,work_format,salary_min,salary_max,status) values($1,'SECRET PRIVATE NEED','Backend / Python','Junior','declared_or_verified',ARRAY['Python'],'[{"skill":"Python","mode":"declared_or_verified"}]','SECRET INTERNAL NOTE','Удалённо',100000,180000,'active') returning id,revision`,[employer.companyId])).rows[0];
 const budget=await api('/employer/invitation-analytics',employer.cookie);assert.equal(budget.status,200);const limit=budget.data.budget.limit;assert.ok(limit>=1&&limit<=1000);
 const trigger='qa_budget_'+randomUUID().replaceAll('-','');
 await pool.query(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.company_id=${employer.companyId} THEN RAISE EXCEPTION 'qa_forced_after_budget'; END IF; RETURN NEW; END $$`);
 await pool.query(`CREATE TRIGGER ${trigger} AFTER INSERT ON signal_invitation_budget_consumption FOR EACH ROW EXECUTE FUNCTION ${trigger}()`);
 try{const failed=await api('/employer/invitations',employer.cookie,{needId:need.id,contextVersion:need.revision,candidateId:a.id,resumeId:a.resumeId,title:'Обсудим работу',message:'Приглашаем обсудить предложение.',reason:'Подходящие навыки',salaryMin:100000,salaryMax:160000,salaryPeriod:'month',salaryType:'gross',workFormat:'Удалённо',idempotencyKey:randomUUID()});assert.equal(failed.status,500);for(const table of ['signal_invitations','signal_invitation_budget_consumption','signal_invitation_events','signal_outbox'])assert.equal((await pool.query(`select count(*)::int n from ${table} where company_id=$1`,[employer.companyId])).rows[0].n,0,table);}finally{await pool.query(`DROP TRIGGER ${trigger} ON signal_invitation_budget_consumption`);await pool.query(`DROP FUNCTION ${trigger}()`);}pass('forced HTTP transaction failure after debit leaves no invitation, budget unit, event or outbox');
 const fillers=await pool.query(`insert into signal_invitations(need_id,company_id,candidate_user_id,resume_id,title,message,reason,salary_min,salary_max,salary_period,salary_type,work_format,status) select $1,$2,$3,$4,'QA filler','Synthetic filler','QA',100000,150000,'month','gross','Удалённо','withdrawn' from generate_series(1,$5) returning id`,[need.id,employer.companyId,dummy.id,dummy.resumeId,limit-1]);
 const command=(c:typeof a)=>({needId:need.id,contextVersion:need.revision,candidateId:c.id,resumeId:c.resumeId,title:'Обсудим работу',message:'Приглашаем обсудить предложение.',reason:'Подходящие заявленные навыки',salaryMin:100000,salaryMax:160000,salaryPeriod:'month',salaryType:'gross',workFormat:'Удалённо',idempotencyKey:randomUUID()});
 const ca=command(a),cb=command(b);
 const race=await Promise.all([api('/employer/invitations',employer.cookie,ca),api('/employer/invitations',employer.cookie,cb)]);
 assert.deepEqual(race.map(r=>r.status).sort(),[201,429]);const winnerIndex=race.findIndex(r=>r.status===201),winner=winnerIndex===0?a:b,winningCommand=winnerIndex===0?ca:cb,invitation=race[winnerIndex].data;
 const replay=await api('/employer/invitations',employer.cookie,winningCommand);assert.equal(replay.status,200);assert.equal(replay.data.id,invitation.id);
 assert.equal((await api('/employer/invitation-analytics',employer.cookie)).data.budget.spent,limit);
 pass('two HTTP clients racing last budget unit: exactly one committed invite; same-key replay does not spend');
 const foreign=await api('/employer/invitations',other.cookie,{...winningCommand,idempotencyKey:randomUUID()});assert.equal(foreign.status,404);assert.equal((await api('/employer/invitation-analytics',other.cookie)).data.budget.spent,0);
 const copy=(await pool.query(`insert into signal_candidate_resumes(user_id,title,stack,skills,visibility,consent_matching) values($1,'Alternative',ARRAY['Python'],ARRAY['Python'],'pseudonymous',true) returning id`,[winner.id])).rows[0];
 const differentCv=await api('/employer/invitations',employer.cookie,{...winningCommand,resumeId:copy.id,idempotencyKey:randomUUID()});assert.equal(differentCv.status,409);assert.equal(differentCv.data.code,'PENDING_INVITATION_CONFLICT');
 pass('foreign context charges zero and changing exact CV cannot bypass active person/context dedup');
 const viewed=await api(`/me/invitations/${invitation.id}/view`,winner.cookie,{});assert.equal(viewed.status,200);
 const firstView=(await pool.query(`select occurred_at from signal_invitation_events where invitation_id=$1 and kind='viewed'`,[invitation.id])).rows[0].occurred_at;
 await api(`/me/invitations/${invitation.id}/view`,winner.cookie,{});assert.equal((await pool.query(`select occurred_at from signal_invitation_events where invitation_id=$1 and kind='viewed'`,[invitation.id])).rows[0].occurred_at.toISOString(),firstView.toISOString());
 const decision={decision:'decline',revision:viewed.data.revision,reason:'format',note:'Предпочитаю другой формат.'};
 assert.equal((await api(`/me/invitations/${invitation.id}/decision`,winner.cookie,decision)).status,200);
 assert.equal((await api(`/me/invitations/${invitation.id}/decision`,winner.cookie,decision)).status,200);
 assert.equal((await pool.query(`select count(*)::int n from signal_invitation_events where invitation_id=$1 and kind='declined'`,[invitation.id])).rows[0].n,1);
 assert.equal((await api('/employer/invitation-analytics',employer.cookie)).data.budget.spent,limit);
 const own=await api('/me/invitation-analytics',winner.cookie);assert.equal(own.status,200);assert.equal(own.data.uniqueCompanies,1);assert.ok(!JSON.stringify(own.data).includes('SECRET'));assert.equal(own.data.timelyResponse.denominator,0,'Fresh pending window does not count as failure');
 pass('view/decline first events immutable under retry, optional reason saved, no refund or private-need leak');
 if(fillers.rows.length){await pool.query(`update signal_invitations set status='sent',expires_at=now()-interval '1 second' where id=$1`,[fillers.rows[0].id]);await api('/me/invitation-analytics',dummy.cookie);assert.equal((await pool.query(`select status from signal_invitations where id=$1`,[fillers.rows[0].id])).rows[0].status,'expired');assert.equal((await api('/employer/invitation-analytics',employer.cookie)).data.budget.spent,limit);}
 const foreignMetric=await api(`/employer/invitation-analytics?contextType=need&contextId=${need.id}`,other.cookie);assert.equal(foreignMetric.status,404);
 const filtered=await api(`/employer/invitation-analytics?contextType=need&contextId=${need.id}`,employer.cookie);assert.equal(filtered.status,200);assert.equal(filtered.data.declineReasons,null,'Rare reason suppresses whole breakdown');
 const small=summarizeInvitationCohort([{...invitation,createdAt:new Date(),declineReason:null}] as any,[],new Date(),true);assert.equal(small.counts,null);assert.equal(small.timelyResponse,null);
 pass('expiry keeps budget consumed; analytics enforce ownership, rare-reason and small-cohort suppression');
 writeFileSync(new URL('../../invitation-integration.json',import.meta.url),JSON.stringify({status:'passed',checks,at:new Date().toISOString()},null,2));
}finally{await new Promise<void>(r=>server.close(()=>r()));await pool.end();}
