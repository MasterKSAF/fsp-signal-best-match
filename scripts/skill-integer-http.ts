import assert from 'node:assert/strict';
import{randomUUID,randomBytes,createHash}from'node:crypto';
import{writeFile}from'node:fs/promises';
import{eq,and}from'drizzle-orm';
import{db,pool,signalUsersTable as users,signalSessionsTable as sessions,signalSkillAttemptsTable as attempts}from'../lib/db/src/index';
const database=new URL(process.env.DATABASE_URL!);assert.equal(database.pathname,'/signal_independent_fixes_20261007');assert.equal(database.hostname,'127.0.0.1');let userId:number|null=null;let passed=false,failure:string|undefined;let rubric:string|undefined;
try{
 const[user]=await db.insert(users).values({email:'skill-integer-'+randomUUID()+'@example.test',passwordHash:'unusable-owned-fixture-only',displayName:'Алексей Сергеевич Волков',role:'candidate',emailVerified:true,demoMode:false}).returning();assert.ok(user);userId=user.id;
 const token=randomBytes(32).toString('base64url');await db.insert(sessions).values({userId,tokenHash:createHash('sha256').update(token).digest('hex'),expiresAt:new Date(Date.now()+3600_000),demoMode:false});
 const ok=async(path:string,method='GET',body?:unknown,status=200)=>{const r=await fetch('http://localhost:4367/api'+path,{method,headers:{Cookie:'fsp_signal_session='+token,Origin:'http://localhost:4368',...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});const d=await r.json();assert.equal(r.status,status,d.error??path);return d;};
 const resume=(await ok('/me/resumes')).resumes[0];const attempt=(await ok('/me/skill-attempts','POST',{resumeId:resume.id,skillId:'sql',level:'Junior'},201)).attempt;
 rubric=attempt.policy.rubricVersion;assert.equal(rubric,'six-competencies-critical-5of6-canonical-integer-v2');
 const[row]=await db.select().from(attempts).where(and(eq(attempts.id,attempt.id),eq(attempts.userId,userId)));assert.ok(row);const first=row.cases[0]!;assert.equal(first.responseType,'integer');assert.equal(first.critical,true);const expected=row.oracles[first.id]!.expected;assert.match(expected,/^\d+$/);
 const answers=Object.fromEntries(row.cases.map(c=>[c.id,c.id===first.id?`+00${expected}`:row.oracles[c.id]!.expected]));const result=(await ok(`/me/skill-attempts/${row.id}/submit`,'POST',{revision:row.revision,answers})).attempt;
 assert.equal(result.decision.passed,true);assert.equal(result.decision.criticalComplete,true);assert.equal(result.decision.rubricVersion,rubric);passed=true;
}catch(error){failure=error instanceof Error?error.message:String(error);}
finally{if(userId)await db.delete(users).where(eq(users.id,userId));await pool.end();await writeFile('outputs/verification/candidate-workspace-skill-matrix-20261008/skill-integer-http.json',JSON.stringify({passed,failure,rubric,checks:['New attempt stores v2 policy','Equivalent +00 integer passes a critical criterion over real HTTP','Decision stores v2 provenance'],cleaned:true,measuredAt:new Date().toISOString()},null,2));console.log(JSON.stringify({passed,failure,rubric}));}if(!passed)process.exitCode=1;
