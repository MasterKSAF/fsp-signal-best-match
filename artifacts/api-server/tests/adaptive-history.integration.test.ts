import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {resolve,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import express from 'express';
import cookieParser from 'cookie-parser';
import {pool} from '../../../lib/db/src/index';
import router from '../src/routes/signal-adaptive';
import {saveAdaptiveAnswer} from '../src/lib/adaptive-session';

// Explicit integration invocation only: never targets an existing application/QA database.
test('ON→OFF: own adaptive history remains read-only, private, and independent of issuance/scoring',async()=>{
 const url=new URL(process.env.DATABASE_URL??'');
 assert.ok(['localhost','127.0.0.1'].includes(url.hostname));
 assert.match(url.pathname,/^\/signal_adaptive_history_test_[a-z0-9_]+$/);
 assert.equal(process.env.SIGNAL_ADAPTIVE_HISTORY_TEST_DATABASE,url.pathname.slice(1));
 assert.equal((await pool.query('SELECT count(*)::int n FROM signal_adaptive_sessions')).rows[0].n,0,'Use a fresh dedicated test database');
 const priorFlag=process.env.SIGNAL_ADAPTIVE_EXPERIMENT_ENABLED;
 const app=express();app.use(express.json());app.use(cookieParser());app.use('/api',router);
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
 const address=server.address();assert.ok(address&&typeof address!=='string');
 const base=`http://127.0.0.1:${address.port}/api`;
 const api=async(path:string,cookie?:string,body?:unknown)=>{
  const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{...(cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  return {status:response.status,headers:response.headers,data:await response.json()};
 };
 const makeUser=async(role:'candidate'|'employer')=>{
  const user=(await pool.query(`INSERT INTO signal_users(email,password_hash,role,display_name,email_verified,demo_mode) VALUES($1,'unusable-integration-password',$2,'Adaptive history test',true,false) RETURNING id`,[`adaptive-history-${randomUUID()}@example.test`,role])).rows[0];
  const token=randomBytes(32).toString('base64url');
  await pool.query(`INSERT INTO signal_sessions(token_hash,user_id,demo_mode,expires_at) VALUES($1,$2,false,now()+interval '1 hour')`,[createHash('sha256').update(token).digest('hex'),user.id]);
  if(role==='candidate')await pool.query(`INSERT INTO signal_candidate_profiles(user_id,professional_alias) VALUES($1,'History test')`,[user.id]);
  return {id:user.id as number,cookie:`fsp_signal_session=${token}`};
 };
 const snapshot=async()=>{
  const tables=['signal_adaptive_sessions','signal_adaptive_exposures','signal_skill_exposures','signal_skill_evidence','signal_qualification_projection_events','signal_assessment_review_decisions','signal_skill_bank_releases'];
  const result=[];for(const table of tables){const rows=(await pool.query(`SELECT * FROM ${table}`)).rows;result.push({table,count:rows.length,sha256:createHash('sha256').update(rows.map(r=>JSON.stringify(r)).sort().join('\n')).digest('hex')});}return result;
 };
 try{
  const owner=await makeUser('candidate'),other=await makeUser('candidate'),employer=await makeUser('employer');
  process.env.SIGNAL_ADAPTIVE_EXPERIMENT_ENABLED='true';
  const create=async()=>{const r=await api('/me/adaptive-sessions',owner.cookie,{id:randomUUID(),skillId:'python',level:'Junior',acceptExperimental:true});assert.equal(r.status,201,JSON.stringify(r.data));assert.ok(r.data.question);return r.data;};
  const finished=await create();
  const answered=await api(`/me/adaptive-sessions/${finished.id}/answers`,owner.cookie,{revision:finished.revision,commandKey:randomUUID(),itemId:finished.question.id,answer:'saved-history-test-answer',skip:false});assert.equal(answered.status,200);
  const stop=await api(`/me/adaptive-sessions/${finished.id}/finish`,owner.cookie,{revision:answered.data.revision});assert.equal(stop.status,200);assert.equal(stop.data.state,'finished');assert.equal(stop.data.answerCount,1);
  const activeTemplate=await create(),pending=await create();
  await saveAdaptiveAnswer(owner.id,pending.id,{revision:pending.revision,commandKey:randomUUID(),itemId:pending.question.id,answer:'saved-before-scoring',skip:false});
  // A disabled GET must not finish a timed-out session or recover an ungraded answer.
  // Insert a backdated fixture: production guards correctly forbid changing an existing deadline.
  const active={...activeTemplate,id:randomUUID()};
  await pool.query(`INSERT INTO signal_adaptive_sessions(id,user_id,procedure,skill_id,level,bank_release_hash,seed,topics,pool,answers,revision,current_item_id,state,created_at,deadline)
   SELECT $1,user_id,procedure,skill_id,level,bank_release_hash,seed,topics,pool,answers,revision,current_item_id,state,now()-interval '2 hours',now()-interval '1 hour' FROM signal_adaptive_sessions WHERE id=$2`,[active.id,activeTemplate.id]);
  const before=await snapshot();
  process.env.SIGNAL_ADAPTIVE_EXPERIMENT_ENABLED='false';
  const config=await api('/me/adaptive-config',owner.cookie);assert.equal(config.data.enabled,false);assert.equal(config.data.experimental,true);assert.equal(config.data.qualificationGranted,false);
  for(const saved of [finished,active,pending]){
   for(let repeat=0;repeat<2;repeat++){
    const history=await api(`/me/adaptive-sessions/${saved.id}`,owner.cookie);assert.equal(history.status,200);assert.match(history.headers.get('cache-control')??'',/no-store/);assert.match(history.headers.get('cache-control')??'',/private/);
    assert.equal(history.data.experimental,true);assert.equal(history.data.qualificationGranted,false);assert.equal(history.data.id,saved.id);
    assert.ok(!('pool' in history.data)&&!('seed' in history.data)&&!('oracles' in history.data));
    if(saved.id===finished.id){assert.deepEqual(history.data.savedAnswers,stop.data.savedAnswers);assert.equal(history.data.revision,stop.data.revision);assert.equal(history.data.state,'finished');}
    if(saved.id===active.id){assert.equal(history.data.state,'active');assert.equal(history.data.revision,active.revision);}
    if(saved.id===pending.id){assert.equal(history.data.analysisPending,true);assert.equal(history.data.savedAnswers[0].answer,'saved-before-scoring');}
   }
   const denied=await api(`/me/adaptive-sessions/${saved.id}`,other.cookie);assert.equal(denied.status,404);assert.equal(denied.data.code,'SESSION_NOT_FOUND');assert.match(denied.headers.get('cache-control')??'',/no-store/);assert.ok(!JSON.stringify(denied.data).includes(saved.id));
   for(const [suffix,body] of [['answers',{revision:saved.revision,commandKey:randomUUID(),itemId:saved.question.id,answer:'must-not-save',skip:false}],['finish',{revision:saved.revision}]] as const){
    const blocked=await api(`/me/adaptive-sessions/${saved.id}/${suffix}`,owner.cookie,body);assert.equal(blocked.status,503);assert.equal(blocked.data.code,'ADAPTIVE_EXPERIMENT_DISABLED');
   }
  }
  assert.equal((await api(`/me/adaptive-sessions/${randomUUID()}`,owner.cookie)).status,404);
  assert.equal((await api(`/me/adaptive-sessions/${finished.id}`)).status,401);
  assert.equal((await api(`/me/adaptive-sessions/${finished.id}`,employer.cookie)).status,403);
  for(const parentId of [undefined,finished.id]){
   const denied=await api('/me/adaptive-sessions',owner.cookie,{id:randomUUID(),skillId:'python',level:'Junior',...(parentId?{parentId}:{}),acceptExperimental:true});assert.equal(denied.status,503);assert.equal(denied.data.code,'ADAPTIVE_EXPERIMENT_DISABLED');
  }
  assert.deepEqual(await snapshot(),before,'OFF reads and denied writes must leave every stored session/answer/exposure/proof/history byte unchanged');
  const persisted=(await pool.query('SELECT answers FROM signal_adaptive_sessions WHERE id=$1',[pending.id])).rows[0];assert.equal(persisted.answers[0].passed,null);
  const privateState=process.env.SIGNAL_ADAPTIVE_HISTORY_PRIVATE_STATE;
  if(privateState){const target=resolve(privateState),root=fileURLToPath(new URL('../../../',import.meta.url));assert.ok(relative(root,target).startsWith('..'),'Private browser state must stay outside source');writeFileSync(target,JSON.stringify({owner,other,finished:finished.id,active:active.id,pending:pending.id,before}),{mode:0o600});}
  console.log(JSON.stringify({passed:true,onToOff:true,historyStates:['finished','expired-active','analysis-pending'],foreignUser404:true,unauthenticated401:true,employer403:true,writes503:true,cache:'no-store, private',immutableTables:before.length,qualificationGranted:false}));
 }finally{
  if(priorFlag===undefined)delete process.env.SIGNAL_ADAPTIVE_EXPERIMENT_ENABLED;else process.env.SIGNAL_ADAPTIVE_EXPERIMENT_ENABLED=priorFlag;
  await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));await pool.end();
 }
});
