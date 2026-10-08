/** Focused explicit correction acceptance on a newly owned synthetic actor only. */
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash}from'node:crypto';
import{writeFile}from'node:fs/promises';
import{eq,and}from'drizzle-orm';
import{db,pool,signalUsersTable as users,signalSessionsTable as sessions,signalSkillAttemptsTable as attempts,signalSkillEvidenceTable as evidence,signalSkillCategoriesTable as categories}from'../lib/db/src/index';
import{correctSkillEvidence}from'../artifacts/api-server/src/lib/skill-module-service';
const database=new URL(process.env.DATABASE_URL!);assert.equal(database.pathname,'/signal_independent_fixes_20261007');assert.equal(database.hostname,'127.0.0.1');assert.equal(process.env.SIGNAL_SKILL_MODULES_ENABLED,'true');
const prefix='skill-correction-'+randomUUID();let userId:number|null=null;const checks:string[]=[];let passed=false,failure:string|undefined;
try{
 const[user]=await db.insert(users).values({email:prefix+'@example.test',passwordHash:'unusable-owned-fixture-only',displayName:'Евгений Алексеевич Орлов',role:'candidate',emailVerified:true,demoMode:false}).returning();assert.ok(user);userId=user.id;
 const token=randomBytes(32).toString('base64url');await db.insert(sessions).values({userId,tokenHash:createHash('sha256').update(token).digest('hex'),expiresAt:new Date(Date.now()+3600_000),demoMode:false});
 const ok=async(path:string,method='GET',body?:unknown,status=200)=>{const r=await fetch('http://localhost:4367/api'+path,{method,headers:{Cookie:'fsp_signal_session='+token,Origin:'http://localhost:4368',...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});const d=await r.json();assert.equal(r.status,status,d.error??path);return d;};
 const resume=(await ok('/me/resumes')).resumes[0];const p=await ok(`/me/candidate-profile?resumeId=${resume.id}`);await ok('/me/candidate-profile','PUT',{...p,resumeId:resume.id,revision:p.revision,identityRevision:p.identityRevision,stack:['Python','SQL'],skills:['Python','SQL'],assumedGrade:'Junior'});
 let pythonId:number|undefined;
 for(const skillId of['python','sql','backend-engineering']){
  const started=(await ok('/me/skill-attempts','POST',{resumeId:resume.id,skillId,level:'Junior'},201)).attempt;
  const[row]=await db.select().from(attempts).where(and(eq(attempts.id,started.id),eq(attempts.userId,userId)));assert.ok(row);
  const answers=Object.fromEntries(row.cases.map(c=>[c.id,row.oracles[c.id]!.expected]));await ok(`/me/skill-attempts/${row.id}/submit`,'POST',{revision:row.revision,answers});if(skillId==='python')pythonId=row.id;
 }
 assert.equal((await ok(`/me/candidate-profile?resumeId=${resume.id}`)).verifiedGrade,'Junior');checks.push('Real HTTP modules produced one complete category before explicit correction');
 const receipts=await db.select().from(categories).where(eq(categories.userId,userId));assert.equal(receipts.length,1);const snapshots=JSON.stringify(receipts);
 const[proof]=await db.select().from(evidence).where(and(eq(evidence.userId,userId),eq(evidence.skillId,'python')));assert.ok(proof);const original=await ok(`/me/skill-attempts/${pythonId}`);
 const reason='Изолированная проверка явной коррекции собственного синтетического свидетельства: исходный критерий ошибочен.';
 const correction=await correctSkillEvidence(proof.id,'local-owned-fixture-audit',reason);assert.ok(correction.correction);checks.push('Explicit named operator/reason correction appended original decision without rewriting attempt');
 assert.equal((await ok(`/me/candidate-profile?resumeId=${resume.id}`)).verifiedGrade,null);const m=await ok(`/me/skill-matrix?resumeId=${resume.id}`);assert.equal(m.qualification.verifiedGrade,null);assert.ok(!m.accountEvidence.some((e:any)=>e.skillId==='python'));checks.push('Dependent current category recalculated immediately; revoked proof removed from current coverage');
 const corrected=await ok(`/me/skill-attempts/${pythonId}`);assert.equal(corrected.decision.passed,true);assert.equal(corrected.revocation.reason,reason);assert.equal(corrected.submittedAt,original.submittedAt);assert.equal(JSON.stringify(await db.select().from(categories).where(eq(categories.userId,userId))),snapshots);checks.push('Owner sees correction reason; original passed result/date and immutable category receipt retained');
 const repeated=await correctSkillEvidence(proof.id,'local-owned-fixture-audit',reason);assert.equal(repeated.correction,null);checks.push('Repeated correction is idempotent');passed=true;
}catch(error){failure=error instanceof Error?error.message:String(error);}
finally{if(userId)await db.delete(users).where(eq(users.id,userId));await pool.end();const report={passed,checks,failure,ownedFixtureId:prefix,cleaned:true,measuredAt:new Date().toISOString()};await writeFile('outputs/verification/candidate-workspace-skill-matrix-20261008/skill-revocation-http.json',JSON.stringify(report,null,2));console.log(JSON.stringify({passed,checks:checks.length,failure}));}if(!passed)process.exitCode=1;
