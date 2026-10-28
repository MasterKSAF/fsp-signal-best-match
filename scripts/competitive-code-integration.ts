import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {pool} from '../lib/db/src/index';
import {issueCodePractice,submitCodePractice,claimCodeExecution,publishCodeExecution,executeClaimedCode,readCodePractice,retryCodePractice,cancelCodePractice,publicCodePractice} from '../artifacts/api-server/src/lib/code-practice';
import {CODE_RUNTIME,CODE_TEST_VERSION} from '../artifacts/api-server/src/lib/code-runner';
const target=new URL(process.env.DATABASE_URL??'');assert.ok(['localhost','127.0.0.1'].includes(target.hostname)&&target.port==='55480');
const checks:string[]=[],pass=(s:string)=>{checks.push(s);console.log('PASS',s);},source="import json,sys\na=json.load(sys.stdin)\nprint(json.dumps(list(dict.fromkeys(a))))";
try{
 const userId=(await pool.query(`INSERT INTO signal_users(email,password_hash,role,display_name,email_verified,demo_mode) VALUES($1,'unusable-qa','candidate','Code QA',true,true) RETURNING id`,[`code-${randomUUID()}@example.test`])).rows[0].id;
 const issued=await issueCodePractice(userId,randomUUID()),submitted=await submitCodePractice(userId,issued.id,{revision:issued.revision,source}),repeat=await submitCodePractice(userId,issued.id,{revision:issued.revision,source});assert.equal(repeat.revision,submitted.revision);await assert.rejects(()=>submitCodePractice(userId,issued.id,{revision:submitted.revision,source:'print(1)'}));
 const claims=await Promise.all([claimCodeExecution(),claimCodeExecution()]);assert.equal(claims.filter(Boolean).length,1);const old=claims.find(Boolean)!;assert.equal(old.id,issued.id);
 await pool.query(`UPDATE signal_code_practice SET lease_until=now()-interval '1 second' WHERE id=$1`,[issued.id]);const replacement=await claimCodeExecution();assert.ok(replacement);assert.ok(replacement.fence>old.fence);
 assert.equal(await publishCodeExecution(old,{fence:old.fence,status:'passed',reason:null,imageDigest:null,runtimeVersion:CODE_RUNTIME,testVersion:CODE_TEST_VERSION,passed:6,total:6,finishedAt:new Date().toISOString()}),false);
 assert.equal(await executeClaimedCode(replacement),true);const complete=await readCodePractice(userId,issued.id);assert.equal(complete.status,'passed');assert.equal(complete.history.length,1);assert.match(complete.history[0]!.imageDigest!,/^sha256:/);assert.equal(complete.source,source);assert.ok(!('tests' in publicCodePractice(complete)));
 pass('one claim, expired-fence rejection, immutable one-time submission, real tests and pinned runtime receipt');
 const second=await issueCodePractice(userId,randomUUID());await submitCodePractice(userId,second.id,{revision:second.revision,source});const failedClaim=await claimCodeExecution();assert.ok(failedClaim);const docker=process.env.SIGNAL_DOCKER_BIN;process.env.SIGNAL_DOCKER_BIN='unavailable-synthetic-docker-command';await executeClaimedCode(failedClaim);process.env.SIGNAL_DOCKER_BIN=docker;
 const failed=await readCodePractice(userId,second.id);assert.equal(failed.status,'infrastructure_error');const before={source:failed.source,sourceHash:failed.sourceHash,submittedAt:failed.submittedAt};
 await retryCodePractice(userId,second.id,failed.revision);const retry=await claimCodeExecution();assert.ok(retry);await executeClaimedCode(retry);const restored=await readCodePractice(userId,second.id);assert.equal(restored.status,'passed');assert.equal(restored.history.length,2);assert.deepEqual({source:restored.source,sourceHash:restored.sourceHash,submittedAt:restored.submittedAt},before);
 pass('infrastructure outage retains accepted source and explicit recovery appends a result without a second submission');
 const third=await issueCodePractice(userId,randomUUID());await submitCodePractice(userId,third.id,{revision:third.revision,source});const cancelledClaim=await claimCodeExecution();assert.ok(cancelledClaim);await cancelCodePractice(userId,third.id,cancelledClaim.revision);assert.equal(await publishCodeExecution(cancelledClaim,{fence:cancelledClaim.fence,status:'passed',reason:null,imageDigest:null,runtimeVersion:CODE_RUNTIME,testVersion:CODE_TEST_VERSION,passed:6,total:6,finishedAt:new Date().toISOString()}),false);assert.equal((await readCodePractice(userId,third.id)).status,'cancelled');
 pass('cancellation fences stale completions; hidden tests never enter candidate DTO');
 assert.equal((await pool.query('SELECT count(*)::int n FROM signal_skill_evidence WHERE user_id=$1',[userId])).rows[0].n,0);
 writeFileSync(new URL('../../code-integration.json',import.meta.url),JSON.stringify({status:'passed',synthetic:true,checks,at:new Date().toISOString()},null,2));
}finally{await pool.end();}
