/** Targeted section7 HTTP regression, strictly the named disposable stand.
 * Solves ONLY this script's synthetic owned fixtures using private saved keys;
 * this is a routing/rubric/immutability check, not observed candidate reasoning. */
import assert from 'node:assert/strict';
import { createHash,randomBytes,randomUUID } from 'node:crypto';
import { mkdir,readFile,writeFile } from 'node:fs/promises';
import { and,eq,inArray,sql } from 'drizzle-orm';
import { assembleManagedAttempt,assessmentPrograms,type ProgramId } from '../artifacts/api-server/src/lib/assessment-managed';
import { emptyResume } from '../artifacts/api-server/src/lib/signal-resume-contract';
const url=new URL(process.env.DATABASE_URL??'postgresql://invalid');
assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'55435');assert.equal(url.pathname,'/signal_independent_fixes_20261007');
const origin='http://127.0.0.1:4367',appOrigin='http://localhost:4368';
assert.equal(process.env.API_ORIGIN,origin);assert.equal(process.env.PUBLIC_URL,appOrigin);
const {db,pool,signalUsersTable:users,signalSessionsTable:sessions,signalAssessmentAttemptsTable:attempts}=await import('../lib/db/src/index');
assert.equal((await db.execute(sql`select current_database() as name`)).rows[0]?.name,url.pathname.slice(1));
const prefix='assessment-audit-'+randomUUID().slice(0,8),owned:number[]=[],checks:string[]=[];
const paths=['artifacts/api-server/src/lib/assessment-bank.ts','artifacts/api-server/src/lib/assessment-managed.ts','artifacts/api-server/src/lib/assessment-semantic-variants.ts','artifacts/api-server/src/lib/signal-evidence-compatibility.ts'];
const sha=(b:string|Buffer)=>createHash('sha256').update(b).digest('hex');
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>[p,sha(await readFile(p))])));const beforeSources=await hashes();
let passed=false,failure:string|null=null,cleanup=false;
async function actor(program:ProgramId){
 const [user]=await db.insert(users).values({email:`${prefix}-${owned.length}@example.test`,passwordHash:'unusable-owned-audit-fixture',displayName:'Синтетический контроль рубрики',role:'candidate',emailVerified:true,demoMode:false}).returning();assert.ok(user);owned.push(user.id);
 const token=randomBytes(32).toString('base64url');await db.insert(sessions).values({userId:user.id,tokenHash:sha(token),expiresAt:new Date(Date.now()+3600000),demoMode:false});
 const request=async(path:string,method='GET',body?:unknown)=>{const response=await fetch(origin+'/api'+path,{method,headers:{Cookie:'fsp_signal_session='+token,Origin:appOrigin,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});const text=await response.text();let data:any;try{data=JSON.parse(text);}catch{}return{status:response.status,data};};
 const ok=async(path:string,method='GET',body?:unknown,status=200)=>{const r=await request(path,method,body);assert.equal(r.status,status,`${method} ${path}: ${r.data?.error??''}`);return r.data;};
 const initial=(await ok('/me/resumes')).resumes[0];const resume=program==='backend-python'?initial:await ok('/me/resumes','POST',{title:'Синтетический Frontend',specialization:'Frontend / TypeScript'},201);
 const full=await ok(`/me/resumes/${resume.id}`);const body=emptyResume(program==='backend-python'?'Backend / Python':'Frontend / TypeScript');for(const key of Object.keys(body.questionnaire.answers))(body.questionnaire.answers as Record<string,number|null>)[key]=2;
 await ok(`/me/resumes/${resume.id}`,'PUT',{...body,revision:full.revision});return {id:user.id,resumeId:resume.id,request,ok};
}
try{
 const programs=await fetch(origin+'/api/assessments/programs').then(r=>r.json());
 assert.ok(JSON.stringify(programs).includes('signal-backend-python-v7'));assert.ok(JSON.stringify(programs).includes('signal-frontend-typescript-v3'));checks.push('Public current programs report server v7/v3');
 for(const program of ['backend-python','frontend-typescript'] as const){
  const a=await actor(program);const grade='Junior' as const;const historical=assembleManagedAttempt(program,grade,prefix,{forcedVariant:1,programVersion:program==='backend-python'?'signal-backend-python-v6':'signal-frontend-typescript-v2'});
  const now=new Date(Date.now()-35*86400000);const [saved]=await db.insert(attempts).values({userId:a.id,resumeId:a.resumeId,resumeRevision:1,resumeSpecialization:program==='backend-python'?'Backend / Python':'Frontend / TypeScript',programId:program,programVersion:historical.oracles[historical.cases[0]!.id]!.blueprint.version,grade,purpose:'signal_qualification',purposeOrigin:'legacy_signal_bank',...historical,status:'submitted',answers:historical.cases.map(c=>({caseId:c.id,answer:historical.oracles[c.id]!.answer})),score:100,verified:true,gradeChanged:true,startedAt:now,dueAt:new Date(now.getTime()+35*60000),submittedAt:new Date(now.getTime()+20*60000)}).returning();assert.ok(saved);const historyHash=sha(JSON.stringify(saved));
  const start={purpose:'signal_qualification',gradeConfirmed:true,resumeId:a.resumeId,programId:program,grade};
  for(const extra of [{programVersion:saved.programVersion},{forcedVariant:2},{answerComparison:'canonical_integer_v1'}])assert.equal((await a.request('/assessments/attempts','POST',{...start,...extra})).status,400);checks.push(`${program}: client cannot select historical version, form or scoring policy`);
  const negative=await actor(program);const negativeStart={...start,resumeId:negative.resumeId};
  const invalid=await negative.ok('/assessments/attempts','POST',negativeStart,201);assert.equal(invalid.programVersion,assessmentPrograms.find(p=>p.id===program)!.version);assert.doesNotMatch(JSON.stringify(invalid.cases),/"oracles"|"answerComparison"|"blueprint"/);
  const [invalidRow]=await db.select().from(attempts).where(and(eq(attempts.id,invalid.id),eq(attempts.userId,negative.id)));assert.ok(invalidRow);
  const wrong=invalidRow.cases.map((c,i)=>({caseId:c.id,answer:i===1?invalidRow.oracles[c.id]!.answer+'.0':invalidRow.oracles[c.id]!.answer}));
  await negative.ok(`/assessments/attempts/${invalid.id}/answers`,'PUT',{answers:wrong});const failed=await negative.ok(`/assessments/attempts/${invalid.id}/submit`,'POST',{});assert.equal(failed.verified,false);checks.push(`${program}: decimal-fraction notation cannot pass critical integer criterion`);
  const current=await a.ok('/assessments/attempts','POST',start,201);const [row]=await db.select().from(attempts).where(and(eq(attempts.id,current.id),eq(attempts.userId,a.id)));assert.ok(row);
  const correct=row.cases.map((c,i)=>({caseId:c.id,answer:i===1?'+000'+row.oracles[c.id]!.answer:row.oracles[c.id]!.answer}));await a.ok(`/assessments/attempts/${current.id}/answers`,'PUT',{answers:correct});const result=await a.ok(`/assessments/attempts/${current.id}/submit`,'POST',{});assert.equal(result.score,100);assert.equal(result.verified,true);checks.push(`${program}: ordinary HTTP +leading-zero integer confirms under captured new rubric`);
  const registry=await a.ok('/me/evidence/registry');assert.ok(JSON.stringify(registry).includes(current.programVersion));assert.doesNotMatch(JSON.stringify(registry),/"answerComparison"|"oracles"|"answers"/);
  const [after]=await db.select().from(attempts).where(eq(attempts.id,saved.id));assert.equal(sha(JSON.stringify(after)),historyHash);checks.push(`${program}: old completed version, score, keys, answers and dates remain byte-equivalent; owner evidence retains new source`);
 }
 assert.deepEqual(await hashes(),beforeSources);passed=true;
}catch(error){failure=error instanceof Error?error.message:String(error);}
finally{
 if(owned.length){await db.delete(users).where(inArray(users.id,owned));const left=await db.select({id:users.id}).from(users).where(inArray(users.id,owned));assert.equal(left.length,0);}cleanup=true;
 const output=`outputs/quality/assessment-audit-2026-10-07/http-${prefix}.json`;await mkdir('outputs/quality/assessment-audit-2026-10-07',{recursive:true});await writeFile(output,JSON.stringify({passed,checks,failure,cleanup,ownedActors:owned.length,sourceHashes:beforeSources,sourceUnchanged:JSON.stringify(await hashes())===JSON.stringify(beforeSources),scope:'Only named disposable DB/API4367; synthetic owned immutable keys are a routing/rubric control, not learner reasoning. Stage4313/4314 untouched.'},null,2)+'\n');console.log(JSON.stringify({passed,checks:checks.length,failure,cleanup,proof:output}));await pool.end();
}
if(!passed)process.exitCode=1;
