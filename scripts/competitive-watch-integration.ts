import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {pool} from '../lib/db/src/index';
import {assertOwnDatabase,qaUser,qaNeed} from './competitive-fixtures';
import {processSelectionWatch,deriveWatchChanges,baselineWatchKeys} from '../artifacts/api-server/src/lib/selection-watch';
import {buildSkillAttempt,scoreSkillAttempt} from '../artifacts/api-server/src/lib/skill-module-bank';
assertOwnDatabase();process.env.DEMO_MODE='true';process.env.SIGNAL_SKILL_MODULES_ENABLED='true';
const {default:app}=await import('../artifacts/api-server/src/app');
const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
const base=`http://127.0.0.1:${(server.address() as {port:number}).port}/api`,scope=randomUUID(),checks:string[]=[];
writeFileSync(new URL('../../watch-integration.json',import.meta.url),JSON.stringify({status:'running',at:new Date().toISOString()}));
const pass=(s:string)=>{checks.push(s);console.log('PASS',s);};
type Ref={type:'need'|'job';id:number};
async function account(role:'candidate'|'employer'='candidate',poolScope=scope){
 const user=await qaUser(role);await pool.query('UPDATE signal_users SET review_scope_id=$1 WHERE id=$2',[poolScope,user.id]);
 await pool.query('UPDATE signal_sessions SET review_scope_id=$1 WHERE user_id=$2',[poolScope,user.id]);return user;
}
async function candidate(kind='Python',poolScope=scope){const user=await account('candidate',poolScope);await pool.query(`UPDATE signal_candidate_resumes SET title=$2,specialization=$3,stack=ARRAY[$4]::text[],skills=ARRAY[$4]::text[] WHERE id=$1`,[user.resumeId,`${kind} ${user.id}`,kind==='TypeScript'?'Frontend / TypeScript':'Backend / Python',kind]);return user;}
async function pythonNeed(companyId:number){const need=await qaNeed(companyId);await pool.query(`UPDATE signal_needs SET required_skills=ARRAY['Python'],skill_requirements='[{"skill":"Python","mode":"declared_or_verified"}]' WHERE id=$1`,[need.id]);return need;}
async function api(path:string,cookie:string|undefined,body?:unknown,expected=200){const r=await fetch(`${base}${path}`,{method:body===undefined?'GET':'POST',headers:{...(cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});const data=await r.json();assert.equal(r.status,expected,`${path}: ${JSON.stringify(data)}`);return data;}
const read=(cookie:string,context:Ref,status=200)=>api('/employer/selection/watch/read',cookie,{context},status);
const configure=(cookie:string,context:Ref,enabled=true,revision?:number)=>api('/employer/selection/watch/configure',cookie,{context,enabled,revision,frequencyMinutes:15,commandKey:randomUUID()});
async function rawWatch(id:string){return (await pool.query('SELECT * FROM signal_selection_watches WHERE id=$1',[id])).rows[0];}
async function events(id:string){return (await pool.query('SELECT * FROM signal_selection_watch_events WHERE watch_id=$1 ORDER BY created_at,id',[id])).rows;}
async function proof(userId:number,level:'Junior'|'Middle'){
 const f=buildSkillAttempt('python',level,randomUUID()),answers=Object.fromEntries(Object.entries(f.oracles).map(([id,o])=>[id,o.expected])),decision=scoreSkillAttempt(f.cases,f.oracles,answers,f.policy);assert.equal(decision.passed,true);
 const attempt=(await pool.query(`INSERT INTO signal_skill_attempts(user_id,skill_id,level,program_version,status,cases,oracles,answers,policy,decision,expires_at,submitted_at) VALUES($1,'python',$2,$3,'submitted',$4,$5,$6,$7,$8,now(),now()) RETURNING id`,[userId,level,f.programVersion,JSON.stringify(f.cases),JSON.stringify(f.oracles),JSON.stringify(answers),JSON.stringify(f.policy),JSON.stringify(decision)])).rows[0];
 return (await pool.query(`INSERT INTO signal_skill_evidence(user_id,attempt_id,skill_id,level,program_version,competency_ids,verified_at,decision) VALUES($1,$2,'python',$3,$4,$5,now(),$6) RETURNING id`,[userId,attempt.id,level,f.programVersion,decision.competencies.filter(c=>c.passed).map(c=>c.id),JSON.stringify(decision)])).rows[0].id;
}
try{
 const employer=await account('employer'),foreign=await account('employer'),initial=await candidate(),initialTs=await candidate('TypeScript');
 const need=await qaNeed(employer.companyId!);await pool.query(`UPDATE signal_needs SET required_skills=ARRAY['Python'],skill_requirements='[{"skill":"Python","mode":"declared_or_verified"}]' WHERE id=$1`,[need.id]);const ref:Ref={type:'need',id:need.id};
 const job=(await pool.query(`INSERT INTO signal_jobs(company_id,title,description,specialization,grade,grade_mode,skills,work_format,salary_min,salary_max,salary_period,salary_type,status) VALUES($1,'TypeScript QA','PRIVATE JOB DESCRIPTION','Frontend / TypeScript','Junior','declared_or_verified',ARRAY['TypeScript'],'Удалённо',100000,200000,'month','gross','published') RETURNING id`,[employer.companyId])).rows[0],jobRef:Ref={type:'job',id:job.id};
 await pool.query(`INSERT INTO signal_job_requirements(job_id,skill_requirements) VALUES($1,'[{"skill":"TypeScript","mode":"declared_or_verified"}]')`,[job.id]);
 const watch=await configure(employer.cookie,ref),jobWatch=await configure(employer.cookie,jobRef);
 assert.deepEqual((await read(employer.cookie,ref)).events,[]);assert.deepEqual((await read(employer.cookie,jobRef)).events,[]);
 assert.deepEqual((await rawWatch(watch.id)).baseline.map((e:any)=>e.resumeId),[initial.resumeId]);assert.deepEqual((await rawWatch(jobWatch.id)).baseline.map((e:any)=>e.resumeId),[initialTs.resumeId]);
 await api('/employer/selection/watch/read',undefined,{context:ref},401);await read(initial.cookie,ref,403);await read(foreign.cookie,ref,403);
 await api('/employer/selection/watch/configure',foreign.cookie,{context:ref,enabled:true,frequencyMinutes:15,commandKey:randomUUID()},403);
 pass('first enable captures exact-CV baseline without old notifications; independent need/job pools; unauthenticated/candidate/foreign company denied');

 const newcomer=await candidate(),newTs=await candidate('TypeScript'),wrong=await candidate('SQL'),hidden=await candidate(),revoked=await candidate();
 await pool.query(`UPDATE signal_candidate_resumes SET visibility='private' WHERE id=$1`,[hidden.resumeId]);await pool.query('UPDATE signal_candidate_resumes SET consent_matching=false WHERE id=$1',[revoked.resumeId]);
 const racing=await Promise.allSettled(Array.from({length:4},()=>processSelectionWatch(watch.id)));
 for(const result of racing)if(result.status==='rejected')assert.ok(['watch_processing','discarded_stale'].includes((result.reason as any).code),String(result.reason));
 await processSelectionWatch(watch.id);await processSelectionWatch(watch.id);await processSelectionWatch(jobWatch.id);
 const notice=(await read(employer.cookie,ref)).events;assert.equal(notice.length,1);assert.equal(notice[0].candidate.resumeId,newcomer.resumeId);assert.equal(notice[0].reason,'new_candidate');
 assert.equal((await events(watch.id)).length,1);assert.deepEqual((await read(employer.cookie,jobRef)).events.map((e:any)=>e.candidate.resumeId),[newTs.resumeId]);
 for(const forbidden of [wrong,hidden,revoked,newTs])assert.ok(!notice.some((e:any)=>e.candidate.candidateId===forbidden.id));
 assert.ok(!JSON.stringify(notice).includes('PRIVATE-DESCRIPTION-QA'));
 pass('four competing workers plus retries persist one exact-CV event; hidden/revoked/nonmatching absent from text and count; job history remains separate');

 const alternative=(await pool.query(`INSERT INTO signal_candidate_resumes(user_id,title,specialization,stack,skills,visibility,consent_matching,consent_catalog) VALUES($1,'Other exact CV','Frontend / TypeScript',ARRAY['TypeScript'],ARRAY['TypeScript'],'pseudonymous',true,true) RETURNING id`,[newcomer.id])).rows[0];
 await pool.query(`UPDATE signal_candidate_resumes SET title=title||' edited',revision=revision+1 WHERE id=$1`,[newcomer.resumeId]);await processSelectionWatch(watch.id);assert.equal((await events(watch.id)).length,1);
 const junior=await proof(newcomer.id,'Junior');await processSelectionWatch(watch.id);let current=(await read(employer.cookie,ref)).events;
 assert.equal(current.length,1);assert.equal(current[0].reason,'new_proof');assert.equal(current[0].candidate.resumeId,newcomer.resumeId);assert.notEqual(current[0].candidate.resumeId,alternative.id);
 const middle=await proof(newcomer.id,'Middle');await processSelectionWatch(watch.id);await processSelectionWatch(watch.id);current=(await read(employer.cookie,ref)).events;
 assert.equal(current.length,1);assert.equal(current[0].reason,'new_proof');assert.equal((await events(watch.id)).filter(e=>e.reason==='new_candidate').length,1);
 await pool.query(`INSERT INTO signal_skill_corrections(evidence_id,reason,operator,original_decision) SELECT id,'Own QA revoke','own-qa',decision FROM signal_skill_evidence WHERE id=ANY($1::int[])`,[[junior,middle]]);const beforeRevoke=(await events(watch.id)).length;
 await processSelectionWatch(watch.id);assert.equal((await events(watch.id)).length,beforeRevoke,'Revocation must not announce new proof');assert.equal((await read(employer.cookie,ref)).events.length,0);
 await pool.query('UPDATE signal_candidate_resumes SET consent_matching=false WHERE id=$1',[newcomer.resumeId]);await processSelectionWatch(watch.id);
 await proof(newcomer.id,'Junior');await pool.query('UPDATE signal_candidate_resumes SET consent_matching=true WHERE id=$1',[newcomer.resumeId]);await processSelectionWatch(watch.id);
 const returned=(await read(employer.cookie,ref)).events;assert.equal(returned.length,1);assert.equal(returned[0].reason,'new_proof');assert.equal(returned[0].candidate.resumeId,newcomer.resumeId);
 await pool.query('UPDATE signal_candidate_resumes SET consent_matching=false WHERE id=$1',[newcomer.resumeId]);await processSelectionWatch(watch.id);await read(employer.cookie,ref);
 pass('saved/scored Junior then Middle module proofs yield new_proof on the matching exact CV; title-only edit/retry/revocation never masquerade as new confirmation');

 for(const mode of ['revoke','hidden','blocked','no_match'] as const){
  const person=await candidate();await processSelectionWatch(watch.id);assert.ok((await events(watch.id)).some(e=>e.candidate_id===person.id&&e.state==='pending'));
  if(mode==='revoke')await pool.query('UPDATE signal_candidate_resumes SET consent_matching=false WHERE id=$1',[person.resumeId]);
  if(mode==='hidden')await pool.query(`UPDATE signal_candidate_resumes SET visibility='private' WHERE id=$1`,[person.resumeId]);
  if(mode==='blocked')await pool.query(`INSERT INTO signal_company_blocks(candidate_user_id,company_id,active) VALUES($1,$2,true)`,[person.id,employer.companyId]);
  if(mode==='no_match')await pool.query(`UPDATE signal_candidate_resumes SET specialization='Frontend / TypeScript',stack=ARRAY['TypeScript'],skills=ARRAY['TypeScript'] WHERE id=$1`,[person.resumeId]);
  const visible=(await read(employer.cookie,ref)).events;assert.ok(!visible.some((e:any)=>e.candidate.candidateId===person.id));assert.equal((await events(watch.id)).find(e=>e.candidate_id===person.id).state,'suppressed');
  // The actual detail used by the notification rechecks current consent, independently of notification delivery.
  if(mode!=='no_match')await api(`/employer/selection/resumes/${person.resumeId}?contextType=need&contextId=${ref.id}`,employer.cookie,undefined,404);
 }
 const href=new URL(notice[0].href,'http://local.test');await pool.query('UPDATE signal_candidate_resumes SET consent_matching=false WHERE id=$1',[newcomer.resumeId]);
 await api(`/employer/selection/resumes/${href.searchParams.get('resumeId')}?contextType=need&contextId=${ref.id}`,employer.cookie,undefined,404);
 pass('delivery suppresses pending events after revoke/hide/block/nonmatch; even previously delivered notification cannot reopen revoked exact CV');

 let state=(await read(employer.cookie,ref)).watch;const pauseBody={context:ref,enabled:false,revision:state.revision,frequencyMinutes:15,commandKey:randomUUID()};
 await api('/employer/selection/watch/configure',employer.cookie,pauseBody);await api('/employer/selection/watch/configure',employer.cookie,pauseBody);
 const pausedNew=await candidate();await processSelectionWatch(watch.id);assert.deepEqual((await read(employer.cookie,ref)).events,[]);
 state=(await read(employer.cookie,ref)).watch;await configure(employer.cookie,ref,true,state.revision);await processSelectionWatch(watch.id);assert.equal((await read(employer.cookie,ref)).events.length,0);
 assert.ok((await rawWatch(watch.id)).baseline.some((e:any)=>e.resumeId===pausedNew.resumeId));
 const afterResume=await candidate();await processSelectionWatch(watch.id);assert.deepEqual((await read(employer.cookie,ref)).events.map((e:any)=>e.candidate.resumeId),[afterResume.resumeId]);
 await pool.query(`UPDATE signal_needs SET specialization='Frontend / TypeScript',required_skills=ARRAY['TypeScript'],skill_requirements='[{"skill":"TypeScript","mode":"declared_or_verified"}]',revision=revision+1 WHERE id=$1`,[ref.id]);
 await processSelectionWatch(watch.id);assert.equal((await read(employer.cookie,ref)).events.length,0);assert.ok((await rawWatch(watch.id)).baseline.some((e:any)=>e.resumeId===initialTs.resumeId));
 assert.ok((await events(watch.id)).filter(e=>e.state==='pending').length===0);
 pass('pause/replayed pause suppress delivery; resume and requirement edit establish fresh baselines without announcing the old pool');

 const pendingTs=await candidate('TypeScript');await processSelectionWatch(jobWatch.id);assert.ok((await events(jobWatch.id)).some(e=>e.candidate_id===pendingTs.id&&e.state==='pending'));
 await pool.query(`UPDATE signal_jobs SET status='closed',version=version+1 WHERE id=$1`,[job.id]);await processSelectionWatch(jobWatch.id);assert.equal((await rawWatch(jobWatch.id)).state,'closed');assert.equal((await events(jobWatch.id)).filter(e=>e.state==='pending').length,0);await read(employer.cookie,jobRef,403);
 await candidate('TypeScript');await processSelectionWatch(watch.id);await pool.query(`UPDATE signal_needs SET status='archived',revision=revision+1 WHERE id=$1`,[ref.id]);await processSelectionWatch(watch.id);assert.equal((await rawWatch(watch.id)).state,'closed');assert.equal((await events(watch.id)).filter(e=>e.state==='pending').length,0);await read(employer.cookie,ref,403);
 const ownerNeed=await pythonNeed(employer.companyId!),ownerRef:Ref={type:'need',id:ownerNeed.id},ownerWatch=await configure(employer.cookie,ownerRef);await candidate();await processSelectionWatch(ownerWatch.id);assert.ok((await events(ownerWatch.id)).some(e=>e.state==='pending'));
 const newOwner=await account('candidate');await pool.query(`UPDATE signal_users SET role='employer' WHERE id=$1`,[newOwner.id]);await pool.query('UPDATE signal_companies SET owner_user_id=$1 WHERE id=$2',[newOwner.id,employer.companyId]);await processSelectionWatch(ownerWatch.id);assert.equal((await rawWatch(ownerWatch.id)).state,'closed');assert.equal((await events(ownerWatch.id)).filter(e=>e.state==='pending').length,0);await read(employer.cookie,ownerRef,403);
 pass('closed vacancy, archived need and revoked owner close watches and suppress queued events; old owner HTTP read denied');

 const backlogScope=randomUUID(),backlogOwner=await account('employer',backlogScope),backlogCandidate=await candidate('Python',backlogScope),backlogNeed=await pythonNeed(backlogOwner.companyId!),backlogRef:Ref={type:'need',id:backlogNeed.id},backlog=await configure(backlogOwner.cookie,backlogRef),stored=await rawWatch(backlog.id),entry=stored.baseline.find((e:any)=>e.resumeId===backlogCandidate.resumeId);assert.ok(entry);
 // Persisted backlog fixture: same authorized CV, distinct stored event keys. This is not a claim of 206 real people.
 await pool.query(`INSERT INTO signal_selection_watch_events(id,watch_id,candidate_id,resume_id,event_key,reason,context_revision,proof_hash,state,created_at,delivered_at) SELECT gen_random_uuid(),$1,$2,$3,'old-delivered:'||n,'new_candidate',$4,$5,'delivered',now()-interval '1 minute',now() FROM generate_series(1,100) n`,[backlog.id,backlogCandidate.id,backlogCandidate.resumeId,stored.context_revision,entry.proofHash]);
 await pool.query(`INSERT INTO signal_selection_watch_events(id,watch_id,candidate_id,resume_id,event_key,reason,context_revision,proof_hash,created_at) SELECT gen_random_uuid(),$1,$2,$3,'pending:'||n,'new_candidate',$4,$5,now()-interval '1 day'+n*interval '1 second' FROM generate_series(1,205) n`,[backlog.id,backlogCandidate.id,backlogCandidate.resumeId,stored.context_revision,entry.proofHash]);
 const drained=new Set<string>();for(let page=0;page<3;page++)for(const item of (await read(backlogOwner.cookie,backlogRef)).events)drained.add(item.id);
 assert.equal((await events(backlog.id)).filter(e=>e.state==='pending').length,0);assert.equal((await events(backlog.id)).filter(e=>e.event_key.startsWith('pending:')&&drained.has(e.id)).length,205);
 const newestId=randomUUID();await pool.query(`INSERT INTO signal_selection_watch_events(id,watch_id,candidate_id,resume_id,event_key,reason,context_revision,proof_hash) VALUES($1,$2,$3,$4,'newest','new_candidate',$5,$6)`,[newestId,backlog.id,backlogCandidate.id,backlogCandidate.resumeId,stored.context_revision,entry.proofHash]);assert.ok((await read(backlogOwner.cookie,backlogRef)).events.some((e:any)=>e.id===newestId));
 pass('100 delivered rows cannot starve 205 older pending events: three bounded HTTP reads drain all; newest event also appears');

 const topScope=randomUUID(),topOwner=await account('employer',topScope),people=[];for(let i=0;i<12;i++)people.push(await candidate('Python',topScope));const topNeed=await pythonNeed(topOwner.companyId!),topRef:Ref={type:'need',id:topNeed.id},topWatch=await configure(topOwner.cookie,topRef),baseline=(await rawWatch(topWatch.id)).baseline;
 assert.equal(baseline.length,12);const first=baseline.find((e:any)=>e.position===1),eleventh=baseline.find((e:any)=>e.position===11);
 await pool.query(`INSERT INTO signal_company_blocks(candidate_user_id,company_id,active) VALUES($1,$2,true)`,[first.candidateId,topOwner.companyId]);await processSelectionWatch(topWatch.id);const topEvents=(await read(topOwner.cookie,topRef)).events;
 assert.equal(topEvents.length,1);assert.equal(topEvents[0].candidate.resumeId,eleventh.resumeId);assert.equal(topEvents[0].reason,'entered_top');await processSelectionWatch(topWatch.id);assert.equal((await events(topWatch.id)).length,1);
 const old={candidateId:1,resumeId:1,resumeRevision:1,proofHash:'a',proofKeys:['proof-a'],position:1};assert.equal(deriveWatchChanges([old],[{...old,proofHash:'b',proofKeys:[]}],baselineWatchKeys([old])).changes.length,0);
 const legacy={...old,proofKeys:undefined};assert.equal(deriveWatchChanges([legacy],[{...old,proofHash:'b',proofKeys:['proof-b']}],baselineWatchKeys([legacy])).changes.length,0);
 pass('actual rank 11 to rank 10 produces entered_top once; proof removal and legacy baseline upgrade do not invent new proof');
 writeFileSync(new URL('../../watch-integration.json',import.meta.url),JSON.stringify({status:'passed',checks,at:new Date().toISOString(),databaseOwner:'signal-competitive-20261028',notes:['Direct DB writes create isolated UUID-scoped fixtures; commands and deliveries exercised through real HTTP.','Workers use production processSelectionWatch with concurrent calls; no external mail/webhook.','Backlog fixture has 205 stored events for one authorized CV, not 205 human subjects.']},null,2));
}catch(error){writeFileSync(new URL('../../watch-integration.json',import.meta.url),JSON.stringify({status:'failed',checks,at:new Date().toISOString()},null,2));throw error;
}finally{await new Promise<void>(r=>server.close(()=>r()));await pool.end();}
