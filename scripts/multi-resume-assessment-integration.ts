/** Isolated HTTP acceptance. Oracle reads serve synthetic fixture assertions only;
 * no answers, keys, or credentials enter the public result. */
import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { eq, inArray } from 'drizzle-orm';
import { db, pool, signalUsersTable as users, signalSessionsTable as sessions, signalAssessmentAttemptsTable as attempts, signalCandidateResumesTable as resumes } from '../lib/db/src/index';
import { emptyResume } from '../artifacts/api-server/src/lib/signal-resume-contract';
const database = new URL(process.env.DATABASE_URL!);
assert.equal(database.hostname,'127.0.0.1'); assert.equal(database.port,'55435'); assert.equal(database.pathname,'/signal_resume_stage');
const origin = 'http://127.0.0.1:4313';
const prefix='resume-assessment-'+randomUUID(), ids:number[]=[], checks:string[]=[];
async function fixture() {
 const [user]=await db.insert(users).values({email:`${prefix}-${ids.length}@example.test`,passwordHash:'unusable-synthetic-only',displayName:'Синтетический кандидат',role:'candidate',emailVerified:true,demoMode:false}).returning(); ids.push(user!.id);
 const token=randomBytes(32).toString('base64url'); await db.insert(sessions).values({userId:user!.id,tokenHash:createHash('sha256').update(token).digest('hex'),expiresAt:new Date(Date.now()+3600000),demoMode:false});
 const request=async(path:string,method='GET',body?:any)=>{const r=await fetch(origin+'/api'+path,{method,headers:{Cookie:'fsp_signal_session='+token,Origin:'http://127.0.0.1:4314',...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});const raw=await r.text();return {status:r.status,data:raw?JSON.parse(raw):undefined};};
 const ok=async(path:string,method='GET',body?:any,status=200)=>{const r=await request(path,method,body);assert.equal(r.status,status,`${method} ${path}: ${r.data?.error??''}`);return r.data;};
 return {id:user!.id,request,ok};
}
let passed=false, failure:string|undefined;
try {
 const a=await fixture(), b=await fixture();
 const first=(await a.ok('/me/resumes')).resumes[0], foreign=(await b.ok('/me/resumes')).resumes[0];
 const profile=await a.ok(`/me/candidate-profile?resumeId=${first.id}`);
 const saved=await a.ok('/me/candidate-profile','PUT',{...profile,resumeId:first.id,revision:profile.revision,title:'Backend numeric save',specialization:'Backend / Python'});
 assert.equal(saved.resumeId,first.id); assert.equal(saved.title,'Backend numeric save');
 assert.equal((await a.request('/me/candidate-profile','PUT',{...saved,resumeId:first.id,revision:profile.revision,title:'Stale overwrite'})).status,409);
 assert.equal((await a.request('/me/candidate-profile','PUT',{...saved,resumeId:foreign.id})).status,404);
 assert.equal((await a.request(`/me/candidate-profile?resumeId=${first.id}`,'PUT',{...saved,resumeId:foreign.id})).status,400);
 checks.push('Numeric JSON selected resume save, foreign/conflicting ID rejection and stale draft revision protection');
 const copy=await a.ok(`/me/resumes/${first.id}/copy`,'POST',undefined,201);
 const target=await a.ok(`/me/resumes/${first.id}`);
 const content=emptyResume('Backend / Python'); for(const key of Object.keys(content.questionnaire.answers)) (content.questionnaire.answers as any)[key]=2;
 await a.ok(`/me/resumes/${first.id}`,'PUT',{...content,revision:target.revision});
 const attempt=await a.ok('/assessments/attempts','POST',{purpose:'signal_qualification',gradeConfirmed:true,programId:'backend-python',grade:'Middle',resumeId:first.id},201);
 assert.equal(attempt.resumeId,first.id);
 const replay=await a.ok('/assessments/attempts','POST',{purpose:'signal_qualification',gradeConfirmed:true,programId:'backend-python',grade:'Middle',resumeId:first.id}); assert.equal(replay.id,attempt.id);
 for(const suffix of ['', '/answers','/submit']) {
  const method=suffix==='/answers'?'PUT':suffix==='/submit'?'POST':'GET';
  assert.equal((await a.request(`/assessments/attempts/${attempt.id}${suffix}?resumeId=${foreign.id}`,method,method==='PUT'?{answers:[]}:undefined)).status,404);
 }
 checks.push('Start fixes numeric resumeID; exact replay stable; supplied foreign target rejected on read,save,submit');
 const beforeChange=await a.ok(`/me/candidate-profile?resumeId=${first.id}`);
 await a.ok('/me/candidate-profile','PUT',{...beforeChange,resumeId:first.id,revision:beforeChange.revision,specialization:'Frontend / TypeScript'});
 const immutable=await a.ok(`/assessments/attempts/${attempt.id}?resumeId=${first.id}`); assert.equal(immutable.programId,'backend-python');
 await a.ok(`/me/resumes/${first.id}`,'DELETE',undefined,204);
 const [stored]=await db.select().from(attempts).where(eq(attempts.id,attempt.id)); assert.ok(stored);
 const answers=stored.cases.map(task=>({caseId:task.id,answer:stored.oracles[task.id]!.answer}));
 await a.ok(`/assessments/attempts/${attempt.id}/answers?resumeId=${first.id}`,'PUT',{answers});
 const result=await a.ok(`/assessments/attempts/${attempt.id}/submit?resumeId=${first.id}`,'POST');
 assert.equal(result.verified,true); assert.equal(result.score,100); assert.equal(result.resumeId,first.id);
 const current=(await a.ok('/me/resumes')).resumes; assert.ok(!current.some((r:any)=>r.id===first.id));
 assert.equal(current.find((r:any)=>r.id===copy.id).verifiedGrade,'Middle');
 assert.ok((await db.select().from(resumes).where(eq(resumes.id,first.id)))[0]!.deletedAt);
 assert.equal((await db.select().from(attempts).where(eq(attempts.userId,a.id))).length,1);
 assert.doesNotMatch(JSON.stringify(result),/"oracles"|"answer"|"blueprint"/);
 checks.push('Issued Backend attempt survives target specialization change/deletion; immutable proof updates compatible copy without resurrection');
 const replacement=await a.ok('/me/resumes','POST',{title:'New Backend without reset',specialization:'Backend / Python'},201);
 const replacementFull=await a.ok(`/me/resumes/${replacement.id}`);
 await a.ok(`/me/resumes/${replacement.id}`,'PUT',{...content,revision:replacementFull.revision});
 const cooldown=await a.request('/assessments/attempts','POST',{purpose:'signal_qualification',gradeConfirmed:true,programId:'backend-python',grade:'Senior',resumeId:replacement.id});
 assert.equal(cooldown.status,409); assert.match(cooldown.data.error,/90|измен|категор|период|дней/i);
 assert.equal((await db.select().from(attempts).where(eq(attempts.userId,a.id))).length,1);
 const repeated=await a.ok(`/assessments/attempts/${attempt.id}/submit?resumeId=${first.id}`,'POST'); assert.equal(repeated.score,result.score);
 checks.push('Candidate/program cooldown survives new resume and deleted target; immutable submitted decision replays without another attempt');
 passed=true;
} catch(error) {failure=error instanceof Error?error.message:String(error);}
finally {
 if(ids.length) await db.delete(users).where(inArray(users.id,ids));
 await pool.end(); await mkdir('outputs/verification/multi-resume',{recursive:true});
 const report=`outputs/verification/multi-resume/assessment-http-${prefix}.json`;
 await writeFile(report,JSON.stringify({passed,origin,database:'signal_resume_stage',checks,failure,measuredAt:new Date().toISOString(),notice:'Synthetic mechanics only; no human difficulty or independent skill validation claim.'},null,2));
 console.log(JSON.stringify({passed,checks:checks.length,failure,report}));
}
if(!passed) process.exitCode=1;
