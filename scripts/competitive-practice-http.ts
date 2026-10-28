import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {pool} from '../lib/db/src/index';
import {assertOwnDatabase,qaUser} from './competitive-fixtures';
assertOwnDatabase();process.env.DEMO_MODE='true';process.env.SIGNAL_ADAPTIVE_EXPERIMENT_ENABLED='true';process.env.SIGNAL_CODE_RUNNER_ENABLED='true';process.env.NODE_ENV='test';
const {default:app}=await import('../artifacts/api-server/src/app');
const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const base=`http://127.0.0.1:${(server.address() as {port:number}).port}/api`;
const checks:string[]=[],pass=(s:string)=>{checks.push(s);console.log('PASS',s);};
async function api(path:string,cookie='',body?:unknown){const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{Cookie:cookie,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,data:await r.json()};}
try{
 const a=await qaUser(),b=await qaUser(),employer=await qaUser('employer');
 assert.equal((await api('/me/adaptive-config')).status,401);assert.equal((await api('/me/adaptive-config',employer.cookie)).status,403);
 const command={id:randomUUID(),skillId:'python',level:'Junior',acceptExperimental:true};
 let r=await api('/me/adaptive-sessions',a.cookie,command);assert.equal(r.status,201,JSON.stringify(r.data));let session=r.data;
 assert.equal((await api('/me/adaptive-sessions',a.cookie,command)).data.id,command.id);
 assert.equal((await api(`/me/adaptive-sessions/${command.id}`,b.cookie)).status,404);
 const answer={revision:session.revision,commandKey:randomUUID(),itemId:session.question.id,answer:'',skip:true};
 r=await api(`/me/adaptive-sessions/${command.id}/answers`,a.cookie,answer);assert.equal(r.status,200,JSON.stringify(r.data));
 assert.equal((await api(`/me/adaptive-sessions/${command.id}/answers`,a.cookie,answer)).data.answerCount,1);
 session=(await api(`/me/adaptive-sessions/${command.id}`,a.cookie)).data;assert.equal(session.savedAnswers[0].skipped,true);assert.equal(session.answerCount,1);assert.equal(session.qualificationGranted,false);
 assert.ok(!JSON.stringify(session).includes('oracle'));assert.ok(!('seed' in session));
 r=await api(`/me/adaptive-sessions/${command.id}/finish`,a.cookie,{revision:session.revision});assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.state,'finished');assert.equal(r.data.qualificationGranted,false);
 pass('adaptive HTTP authentication/ownership, identical start and answer retry, persisted skipped answer/reconnect, explicit finish and no key/qualification');
 const expired={...command,id:randomUUID()};await pool.query("insert into signal_adaptive_sessions(id,user_id,procedure,skill_id,level,bank_release_hash,seed,topics,pool,deadline) select $1,user_id,procedure,skill_id,level,bank_release_hash,seed,topics,pool,now()-interval '1 second' from signal_adaptive_sessions where id=$2",[expired.id,command.id]);r=await api(`/me/adaptive-sessions/${expired.id}`,a.cookie);assert.equal(r.data.state,'finished');assert.equal(r.data.qualificationGranted,false);
 process.env.SIGNAL_ADAPTIVE_EXPERIMENT_ENABLED='false';assert.equal((await api('/me/adaptive-sessions',a.cookie,{...command,id:randomUUID()})).status,503);process.env.SIGNAL_ADAPTIVE_EXPERIMENT_ENABLED='true';pass('adaptive server deadline closes session; disabled experiment rejects issuance');
 const codeId=randomUUID();r=await api('/me/code-practice',a.cookie,{id:codeId,acceptExperimental:true});assert.equal(r.status,201,JSON.stringify(r.data));const draft=r.data;
 assert.equal((await api(`/me/code-practice/${codeId}`,b.cookie)).status,404);assert.equal((await api('/me/code-practice',employer.cookie,{id:randomUUID(),acceptExperimental:true})).status,403);
 const source='import json\nprint(json.dumps([]))';r=await api(`/me/code-practice/${codeId}/submit`,a.cookie,{revision:draft.revision,source});assert.equal(r.status,200,JSON.stringify(r.data));const accepted=r.data;
 assert.equal((await api(`/me/code-practice/${codeId}/submit`,a.cookie,{revision:draft.revision,source})).data.sourceHash,accepted.sourceHash);
 assert.equal((await api(`/me/code-practice/${codeId}/submit`,a.cookie,{revision:accepted.revision,source:source+'\n#changed'})).status,409);
 assert.equal((await api(`/me/code-practice/${codeId}`,a.cookie)).data.source,source);assert.ok(!('tests' in accepted));
 r=await api(`/me/code-practice/${codeId}/cancel`,a.cookie,{revision:accepted.revision});assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.state,'cancelled');assert.equal((await api(`/me/code-practice/${codeId}/cancel`,a.cookie,{revision:r.data.revision})).data.state,'cancelled');
 assert.equal((await api(`/me/code-practice/${codeId}/retry`,a.cookie,{revision:r.data.revision})).status,409);pass('code HTTP ownership/role, immutable on-time source receipt, same-source retry, reconnect, hidden tests and durable cancellation');
 process.env.NODE_ENV='production';assert.equal((await api('/me/code-practice/config',a.cookie)).data.enabled,false);assert.equal((await api('/me/code-practice',a.cookie,{id:randomUUID(),acceptExperimental:true})).status,503);process.env.NODE_ENV='test';pass('production blocks code execution even with feature environment flag true');
 assert.equal((await pool.query('select count(*)::int n from signal_skill_attempts where user_id=$1',[a.id])).rows[0].n,0);
 writeFileSync('../practice-http.json',JSON.stringify({status:'passed',synthetic:true,checks,at:new Date().toISOString()},null,2));
}finally{await new Promise<void>(r=>server.close(()=>r()));await pool.end();}
