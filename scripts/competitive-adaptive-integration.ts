import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {pool} from '../lib/db/src/index';
import {createAdaptiveSession,progressAdaptiveSession,saveAdaptiveAnswer,finishAdaptiveSession,publicAdaptiveSession} from '../artifacts/api-server/src/lib/adaptive-session';
const target=new URL(process.env.DATABASE_URL??'');assert.ok(['localhost','127.0.0.1'].includes(target.hostname)&&target.port==='55480');
const checks:string[]=[],pass=(s:string)=>{checks.push(s);console.log('PASS',s);};
try{
 const owner=(await pool.query(`INSERT INTO signal_users(email,password_hash,role,display_name,email_verified,demo_mode) VALUES($1,'unusable-qa','candidate','Adaptive QA',true,true) RETURNING id`,[`adaptive-${randomUUID()}@example.test`])).rows[0].id;
 const id=randomUUID(),created=await createAdaptiveSession(owner,{id,skillId:'python',level:'Junior'});assert.equal(created.id,(await createAdaptiveSession(owner,{id,skillId:'python',level:'Junior'})).id);
 let a=await progressAdaptiveSession(owner,id);assert.equal(a.state,'active');assert.ok(a.currentItemId);
 const item=a.pool.find(i=>i.id===a.currentItemId)!,input={revision:a.revision,commandKey:randomUUID(),itemId:item.id,answer:item.oracle.expected,skip:false};
 await saveAdaptiveAnswer(owner,id,input);await saveAdaptiveAnswer(owner,id,input);
 const failed=await progressAdaptiveSession(owner,id,()=>{throw new Error('synthetic scoring outage');});assert.equal(failed.answers.length,1);assert.equal(failed.answers[0]!.answer,item.oracle.expected);assert.equal(failed.answers[0]!.passed,null);assert.equal(failed.outcome,'analysis_pending');assert.equal(failed.currentItemId,null);
 a=await progressAdaptiveSession(owner,id);assert.equal(a.answers[0]!.passed,true);assert.equal(a.answers.length,1);assert.ok(a.currentItemId);
 const publicData=JSON.stringify(publicAdaptiveSession(a));assert.ok(!publicData.includes('oracles'));assert.ok(!publicData.includes(a.seed));assert.equal(publicAdaptiveSession(a).qualificationGranted,false);
 pass('answer is durable before model failure; restart recovery and duplicate command preserve one observation; public DTO hides keys');
 while(a.answers.length<12&&a.state==='active'){
  const item=a.pool.find(i=>i.id===a.currentItemId)!;await saveAdaptiveAnswer(owner,id,{revision:a.revision,commandKey:randomUUID(),itemId:item.id,answer:item.oracle.expected,skip:false});a=await progressAdaptiveSession(owner,id);
 }
 assert.equal(a.answers.length,12);assert.equal(new Set(a.answers.map(v=>v.familyId)).size,12);assert.ok(a.topics.every(t=>a.answers.filter(v=>v.competencyId===t).length===2));
 const stopped=await finishAdaptiveSession(owner,id,a.revision);assert.equal(stopped.outcome,'insufficient_data');
 const child=await createAdaptiveSession(owner,{id:randomUUID(),skillId:'python',level:'Junior',parentId:id});assert.deepEqual(child.answers,stopped.answers);assert.equal(+child.deadline,+stopped.deadline);assert.equal(child.procedure,stopped.procedure);
 let c=await progressAdaptiveSession(owner,child.id);while(c.state==='active'&&c.answers.length<24){const item=c.pool.find(i=>i.id===c.currentItemId)!;await saveAdaptiveAnswer(owner,c.id,{revision:c.revision,commandKey:randomUUID(),itemId:item.id,answer:item.oracle.expected,skip:false});c=await progressAdaptiveSession(owner,c.id);}
 assert.ok(c.answers.length<=24);assert.equal(new Set(c.answers.map(v=>v.familyId)).size,c.answers.length);assert.equal((await pool.query(`SELECT count(*)::int n FROM signal_skill_evidence WHERE user_id=$1`,[owner])).rows[0].n,0);
 pass('mandatory coverage, same-version clarification, inherited observations/deadline and bank exhaustion do not mint qualification proofs');
 await assert.rejects(()=>createAdaptiveSession(owner,{id:randomUUID(),skillId:'python',level:'Junior',parentId:id}));
 pass('a refined parent cannot fork another child and double count its answers');
 writeFileSync(new URL('../../adaptive-integration.json',import.meta.url),JSON.stringify({status:'passed',synthetic:true,checks,at:new Date().toISOString()},null,2));
}finally{await pool.end();}
