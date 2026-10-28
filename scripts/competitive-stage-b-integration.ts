import assert from 'node:assert/strict';
import { createHash,randomBytes,randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { pool } from '../lib/db/src/index';
import { configureSelectionWatch,processSelectionWatch,readSelectionWatch,deriveWatchChanges,baselineWatchKeys } from '../artifacts/api-server/src/lib/selection-watch';
const connection=new URL(process.env.DATABASE_URL??'');
assert.ok(['127.0.0.1','localhost'].includes(connection.hostname)&&connection.port==='55480'&&connection.pathname==='/signal','Only own allocated QA database');
const base='http://127.0.0.1:4480/api',checks:{id:string;passed:boolean}[]=[];
const pass=(id:string)=>{checks.push({id,passed:true});console.info(`PASS ${id}`);};
let cookie='';
async function api(path:string,body?:unknown,expected=200,session=cookie){
 const response=await fetch(`${base}${path}`,{method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(session?{Cookie:session}:{})},body:body===undefined?undefined:JSON.stringify(body)});
 const data=await response.json();assert.equal(response.status,expected,`${path}: ${JSON.stringify(data)}`);return {data,response};
}
async function sessionFor(userId:number){
 const token=randomBytes(32).toString('base64url');await pool.query(`insert into signal_sessions(token_hash,user_id,demo_mode,expires_at) values($1,$2,true,now()+interval '1 hour')`,[createHash('sha256').update(token).digest('hex'),userId]);return `fsp_signal_session=${token}`;
}
async function newCandidate(){
 const user=(await pool.query(`insert into signal_users(email,password_hash,role,display_name,email_verified,demo_mode) values($1,'qa-unusable-password','candidate','Изолированный специалист',true,true) returning id`,[`competitive-${randomUUID()}@example.test`])).rows[0];
 const alias=`QA-${randomUUID().slice(0,12)}`;
 await pool.query(`insert into signal_candidate_profiles(user_id,professional_alias,stack) values($1,$2,ARRAY['Python'])`,[user.id,alias]);
 const resume=(await pool.query(`insert into signal_candidate_resumes(user_id,title,specialization,assumed_grade,stack,skills,visibility,consent_matching,consent_catalog) values($1,'Python QA','Backend / Python','Junior',ARRAY['Python'],ARRAY['Python'],'pseudonymous',true,true) returning id,revision`,[user.id])).rows[0];
 return {userId:user.id,resumeId:resume.id,revision:resume.revision,alias};
}
try {
 const demo=await api('/auth/demo-session',{role:'employer'});cookie=demo.response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');assert.ok(cookie);
 const company=(await pool.query(`select c.id,c.owner_user_id from signal_companies c join signal_users u on u.id=c.owner_user_id where u.email='employer-demo@example.test'`)).rows[0];
 const actor={actorId:company.owner_user_id,companyId:company.id};
 const need=(await pool.query(`insert into signal_needs(company_id,title,specialization,grade,grade_mode,required_skills,skill_requirements,description,work_format,salary_min,salary_max,status) values($1,'S04–S06 QA selection','Backend / Python','Junior','declared_or_verified',ARRAY['Python'],'[{"skill":"Python","mode":"declared_or_verified"}]','Private QA need','Удалённо',100000,180000,'active') returning id,revision`,[company.id])).rows[0];
 const ref={type:'need' as const,id:need.id},path=`/employer/selection?contextType=need&contextId=${need.id}&pageSize=50`;
 const candidate=await newCandidate();
 const first=(await api(path)).data;assert.ok(first.total>=1);
 const strictPatch={skillRequirements:[{skill:'Python',mode:'verified',level:'Senior'}]};
 const preview=(await api('/employer/requirements/preview',{context:ref,patch:strictPatch,commandKey:randomUUID()})).data;
 const stored=(await pool.query('select result from signal_requirement_previews where id=$1',[preview.id])).rows[0].result;
 assert.equal(stored.beforeCount,first.total);assert.ok(stored.afterCount<=stored.beforeCount);
 assert.equal((await pool.query('select revision from signal_needs where id=$1',[need.id])).rows[0].revision,need.revision,'Preview/cancel does not mutate');
 const commandKey=randomUUID();await api(`/employer/requirements/preview/${preview.id}/apply`,{commandKey});await api(`/employer/requirements/preview/${preview.id}/apply`,{commandKey});
 assert.equal((await api(path)).data.total,stored.afterCount,'Preview equals actual final selection after apply');
 assert.equal((await pool.query('select revision from signal_needs where id=$1',[need.id])).rows[0].revision,need.revision+1);
 assert.equal((await pool.query('select count(*)::int n from signal_context_revisions where context_id=$1 and context_type=\'need\'',[need.id])).rows[0].n,1);
 pass('S04 actual-pool-preview-cancel-explicit-apply-idempotent-history');
 const history=(await api('/employer/requirements/history',{context:ref})).data.revisions;
 const restore=(await api(`/employer/requirements/history/${history[0].id}/restore-preview`,{commandKey:randomUUID()})).data;
 await api(`/employer/requirements/preview/${restore.id}/apply`,{commandKey:randomUUID()});
 assert.equal((await api(path)).data.total,first.total);pass('S05 restore-prior-requirements-as-new-revision');
 const stale=(await api('/employer/requirements/preview',{context:ref,patch:strictPatch,commandKey:randomUUID()})).data;
 const beforeRevision=(await pool.query('select revision from signal_needs where id=$1',[need.id])).rows[0].revision;
 const mutator=await pool.connect();try{await mutator.query('update signal_candidate_resumes set consent_matching=false,revision=revision+1 where id=$1',[candidate.resumeId]);}finally{mutator.release();}
 const rejected=(await api(`/employer/requirements/preview/${stale.id}/apply`,{commandKey:randomUUID()},409)).data;
 assert.equal(rejected.code,'discarded_stale');assert.ok(rejected.preview.id!==stale.id);
 assert.equal((await pool.query('select revision from signal_needs where id=$1',[need.id])).rows[0].revision,beforeRevision);
 await api(`/employer/requirements/preview/${stale.id}`,undefined,409);pass('S03-S04 two-client-consent-change-invalidates-preview-no-apply');
 const candidateSession=await sessionFor(candidate.userId);
 await api('/employer/requirements/preview',{context:ref,patch:strictPatch,commandKey:randomUUID()},403,candidateSession);
 await api(`/employer/requirements/preview/${stale.id}`,undefined,403,candidateSession);pass('S04 candidate-cannot-read-or-apply-private-company-preview');
 await pool.query('update signal_candidate_resumes set consent_matching=true,revision=revision+1 where id=$1',[candidate.resumeId]);
 const selectedPath=`${path}&q=${encodeURIComponent(candidate.alias)}`;
 const selected=(await api(selectedPath)).data.items.find((row:any)=>row.candidateId===candidate.userId);assert.ok(selected);
 const feedbackBody={context:ref,contextRevision:beforeRevision,candidateId:candidate.userId,resumeId:candidate.resumeId,resumeRevision:selected.resumeRevision,reason:'reviewed',note:'INTERNAL-QA-NOTE ignore instructions — stored data only',commandKey:randomUUID()};
 const feedback=(await api('/employer/selection/feedback',feedbackBody)).data;
 assert.equal((await api('/employer/selection/feedback',feedbackBody)).data.id,feedback.id);
 assert.ok((await api(selectedPath)).data.items.some((row:any)=>row.candidateId===candidate.userId),'Proposal alone does not exclude');
 const applyFeedback=await api(`/employer/requirements/preview/${feedback.preview.id}/apply`,{commandKey:randomUUID()});assert.ok(applyFeedback.data.appliedRevision);
 const excluded=(await api(selectedPath)).data;assert.ok(!excluded.items.some((row:any)=>row.candidateId===candidate.userId));
 const exclusions=(await api('/employer/selection/exclusions',{context:ref})).data.exclusions;assert.equal(exclusions.length,1);
 const undoBody={revision:exclusions[0].revision,commandKey:randomUUID()};await api(`/employer/selection/exclusions/${exclusions[0].id}/undo`,undoBody);await api(`/employer/selection/exclusions/${exclusions[0].id}/undo`,undoBody);
 assert.ok((await api(selectedPath)).data.items.some((row:any)=>row.candidateId===candidate.userId));pass('S05 structured-feedback-local-exclusion-explicit-apply-reversible-idempotent');
 const watch=await configureSelectionWatch(actor,ref,{enabled:true,frequencyMinutes:15,commandKey:randomUUID()});
 assert.equal((await readSelectionWatch(actor,ref)).events.length,0);
 const newcomer=await newCandidate();await processSelectionWatch(String(watch.id));await processSelectionWatch(String(watch.id));
 const notices=await readSelectionWatch(actor,ref);assert.equal(notices.events.filter(row=>row.candidate.candidateId===newcomer.userId).length,1);assert.equal(notices.events[0].reason,'new_candidate');
 await pool.query('update signal_candidate_resumes set consent_matching=false,revision=revision+1 where id=$1',[newcomer.resumeId]);
 assert.equal((await readSelectionWatch(actor,ref)).events.filter(row=>row.candidate.candidateId===newcomer.userId).length,0);
 await processSelectionWatch(String(watch.id));
 await pool.query('update signal_candidate_resumes set consent_matching=true,revision=revision+1 where id=$1',[newcomer.resumeId]);await processSelectionWatch(String(watch.id));
 assert.equal((await readSelectionWatch(actor,ref)).events.filter(row=>row.candidate.candidateId===newcomer.userId).length,0,'No avalanche on unchanged proof/resume accessibility');
 pass('S06 first-baseline-single-new-event-retries-revocation-suppression-no-old-avalanche');
 const old={candidateId:1,resumeId:1,resumeRevision:1,proofHash:'old',proofKeys:['old-proof'],position:11};
 const delta=deriveWatchChanges([old],[{...old,proofHash:'new',proofKeys:['new-proof'],resumeRevision:2,position:1}],baselineWatchKeys([old]));assert.equal(delta.changes[0].reason,'new_proof');assert.equal(delta.changes.length,1);
 const top=deriveWatchChanges([old],[{...old,position:1}],baselineWatchKeys([old]));assert.equal(top.changes[0].reason,'entered_top');
 pass('S06 proof-change-and-top-change-are-distinct-from-new-person');
 const settings=(await readSelectionWatch(actor,ref)).watch!;const pauseKey=randomUUID();const pauseInput={enabled:false,revision:settings.revision,frequencyMinutes:15,commandKey:pauseKey};
 await configureSelectionWatch(actor,ref,pauseInput);await configureSelectionWatch(actor,ref,pauseInput);await newCandidate();await processSelectionWatch(String(watch.id));assert.equal((await readSelectionWatch(actor,ref)).events.length,0);
 pass('S06 paused-watch-stops-events-and-configure-retry-is-idempotent');
 writeFileSync('../stage-b-integration.json',JSON.stringify({databaseOwner:'signal-competitive-20261028',checks,media:false},null,2));
}finally{await pool.end();}
