/** Actual cold/warm byte/ACL acceptance, manifest-owned load API/DB only. */
import assert from 'node:assert/strict';
import { randomBytes,createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { eq,inArray } from 'drizzle-orm';
import { db,pool,signalUsersTable as users,signalSessionsTable as sessions,signalCandidateProfilesTable as profiles,signalCompaniesTable as companies,signalNeedsTable as needs,signalCandidateResumesTable as resumes,signalAssessmentAttemptsTable as attempts,signalAssessmentCorrectionsTable as corrections,signalCompanyBlocksTable as blocks } from '../lib/db/src/index';
import { GetMatchesResponse } from '../lib/api-zod/src/index';
import { rankedResumePool } from '../artifacts/api-server/src/lib/signal-resume-matching';
import { availableResumeSummary } from '../artifacts/api-server/src/lib/signal-resume-catalog';
import { emptyResume } from '../artifacts/api-server/src/lib/signal-resume-contract';
import { assembleManagedAttempt,verifiedSkillsForAttempt } from '../artifacts/api-server/src/lib/assessment-managed';
import { scoreAttempt,assessmentBankVersion } from '../artifacts/api-server/src/lib/assessment-bank';
import { validatedLoadTarget } from './multi-resume-load-target';
assert.equal(validatedLoadTarget(process.env).key,'dedicated-v1');
const nonce=randomBytes(6).toString('hex'),owned:number[]=[],checks:string[]=[];
let failure:string|null=null;
type Actor={id:number;cookie:string;tokenHash:string;companyId?:number};
async function actor(role:'candidate'|'employer',index:number):Promise<Actor> {
  const [user]=await db.insert(users).values({role,email:`multi-load-cache-${nonce}-${index}@example.test`,displayName:'Synthetic cache HTTP',passwordHash:'unusable-synthetic-fixture',emailVerified:true,demoMode:false}).returning();owned.push(user.id);
  const token=randomBytes(32).toString('base64url'),tokenHash=createHash('sha256').update(token).digest('hex');
  await db.insert(sessions).values({userId:user.id,tokenHash,expiresAt:new Date(Date.now()+600000),demoMode:false});
  let companyId:number|undefined;
  if(role==='employer') {const [company]=await db.insert(companies).values({ownerUserId:user.id,name:'Synthetic cache HTTP company',contactEmail:user.email}).returning();companyId=company.id;}
  else await db.insert(profiles).values({userId:user.id,professionalAlias:`CACHE-${nonce}-${index}`});
  return{id:user.id,cookie:`fsp_signal_session=${token}`,tokenHash,companyId};
}
async function request(path:string,actor:Actor,body?:object) {
  const response=await fetch(`${process.env.LOAD_API_ORIGIN}/api${path}`,{method:body?'POST':'GET',headers:{Origin:process.env.INTEGRATION_APP_ORIGIN!,Cookie:actor.cookie,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10000)});
  return{status:response.status,type:response.headers.get('content-type'),text:await response.text()};
}
try {
  const candidate=await actor('candidate',0),employer=await actor('employer',1),foreign=await actor('employer',2);
  const at=new Date('2026-10-05T12:00:00Z'),form=assembleManagedAttempt('backend-python','Middle',`cache-${nonce}`),answers=form.cases.map(row=>({caseId:row.id,answer:form.oracles[row.id]!.answer})),result=scoreAttempt(form.cases,form.oracles,answers),skills=verifiedSkillsForAttempt(form.cases,form.oracles,result.evidence);
  const [resume]=await db.insert(resumes).values({...emptyResume('Backend / Python'),userId:candidate.id,title:'Original cache title',specialization:'Backend / Python',isPrimary:true,verifiedGrade:'Middle',verifiedScore:100,verifiedSkills:skills,stack:skills,skills,visibility:'pseudonymous',consentMatching:true,consentCatalog:true,latestAssessmentAt:at,salaryMin:160000,salaryMax:240000}).returning();
  const [attempt]=await db.insert(attempts).values({userId:candidate.id,resumeId:resume.id,resumeSpecialization:'Backend / Python',programId:'backend-python',programVersion:assessmentBankVersion(form.cases,form.oracles),grade:'Middle',status:'submitted',verified:true,score:100,cases:form.cases,oracles:form.oracles,answers,startedAt:at,dueAt:new Date(at.getTime()+60000),submittedAt:at,purpose:'signal_qualification'}).returning();
  const needInput={specialization:'Backend / Python',grade:'Middle' as const,requiredSkills:['Python','SQL'],desirableSkills:[],workFormat:'Удалённо',salaryMin:150000,salaryMax:250000,salaryPeriod:'month' as const,salaryType:'gross' as const};
  const [need]=await db.insert(needs).values({...needInput,companyId:employer.companyId!,title:'Synthetic cache HTTP need',description:'Synthetic cache HTTP fixture'}).returning();
  const url=`/matches?needId=${need.id}`;
  // Reproduce the original uncached whitelist/parse/extension order exactly.
  const oldBytes=async()=>{
    const ranked=await rankedResumePool(needInput,false);
    const core=GetMatchesResponse.parse(ranked.map(({candidate:c,evaluation:e})=>({candidateId:c.userId,resumeId:c.resumeId,resumeRevision:c.resumeRevision,title:c.title,alias:c.alias,specialization:c.specialization,verifiedGrade:c.verifiedGrade,score:e.baseScore,fspBonus:e.fspBonus,stack:[...c.stack],strengths:e.strengths,gaps:e.gaps,evidenceDate:c.latestAssessmentAt?.toISOString()??null,fspHistory:c.hasFspHistory})));
    return JSON.stringify(core.map((match,index)=>({...match,resumeId:ranked[index]!.candidate.resumeId,resumeRevision:ranked[index]!.candidate.resumeRevision,title:ranked[index]!.candidate.title,availableResumes:ranked[index]!.alternatives.map(availableResumeSummary),baseScore:ranked[index]!.evaluation.baseScore,rankingScore:ranked[index]!.evaluation.rankingScore,salaryCompatibility:ranked[index]!.evaluation.salaryCompatibility,ranking:ranked[index]!.evaluation.ranking})));
  };
  const cold=await request(url,employer),warm=await request(url,employer);assert.equal(cold.status,200);assert.equal(warm.status,200);assert.equal(cold.text,await oldBytes());assert.equal(warm.text,cold.text);assert.equal(cold.type,'application/json; charset=utf-8');checks.push('Actual cold/warm HTTP bytes exactly equal original full whitelist/Zod/JSON output, with JSON UTF8 Content-Type');
  const own=(text:string)=>JSON.parse(text).find((row:any)=>row.resumeId===resume.id);
  assert.ok(own(cold.text));assert.ok(!/(poolContentDigest|correctAnswer|oracles|passwordHash|contactEmail)/.test(cold.text));checks.push('Presentation facet preserves full array and never exposes internal digest/contact/answer fields');
  const exactDefault=await request(`${url}&resumeId=${resume.id}`,employer);assert.equal(exactDefault.status,200);assert.equal(exactDefault.text,cold.text);checks.push('Actual explicitly requested default winner has byte-identical complete ranking and selected résumé IDs');
  const bankUrl=`/employer/candidates?q=CACHE-${nonce}&grade=Middle&skills=Python,SQL`;
  const bankCold=await request(bankUrl,employer),bankWarm=await request(bankUrl,employer);assert.equal(bankCold.status,200);assert.equal(bankWarm.text,bankCold.text);assert.equal(JSON.parse(bankCold.text).total,1);checks.push('Actual cold/warm catalogue complete filters/counts/cards are byte-identical with fresh page evidence');
  await db.update(resumes).set({title:'Fresh cache title'}).where(eq(resumes.id,resume.id));const title=await request(url,employer);assert.equal(title.status,200);assert.equal(own(title.text).title,'Fresh cache title');assert.equal(title.text,await oldBytes());checks.push('Warm HTTP presentation immediately reflects changed title without revision increment');
  assert.equal(JSON.parse((await request(bankUrl,employer)).text).candidates[0].title,'Fresh cache title');checks.push('Actual warm catalogue immediately invalidates current professional title without a revision shortcut');
  await db.update(resumes).set({visibility:'private'}).where(eq(resumes.id,resume.id));assert.equal(own((await request(url,employer)).text),undefined);await db.update(resumes).set({visibility:'pseudonymous'}).where(eq(resumes.id,resume.id));assert.ok(own((await request(url,employer)).text));checks.push('Warm HTTP presentation immediately hides/restores exact résumé');
  await db.update(resumes).set({consentCatalog:false}).where(eq(resumes.id,resume.id));assert.equal(JSON.parse((await request(bankUrl,employer)).text).total,0);await db.update(resumes).set({consentCatalog:true}).where(eq(resumes.id,resume.id));assert.equal(JSON.parse((await request(bankUrl,employer)).text).total,1);checks.push('Actual warm catalogue opt-out immediately removes count and card, restoration reads current exact pool');
  await db.update(attempts).set({score:67}).where(eq(attempts.id,attempt.id));const scored=await request(url,employer);assert.equal(own(scored.text).ranking.qualityScore,67);assert.equal(scored.text,await oldBytes());checks.push('Warm HTTP presentation immediately reflects fresh saved score');
  await db.update(attempts).set({submittedAt:new Date(at.getTime()+1)}).where(eq(attempts.id,attempt.id));assert.equal(own((await request(url,employer)).text).ranking.qualityScore,null);await db.update(attempts).set({submittedAt:at}).where(eq(attempts.id,attempt.id));assert.equal(own((await request(url,employer)).text).ranking.qualityScore,67);checks.push('Warm HTTP presentation immediately reflects exact evidence date linkage');
  await db.update(attempts).set({verified:false}).where(eq(attempts.id,attempt.id));assert.equal(own((await request(url,employer)).text).ranking.qualityScore,null);await db.update(attempts).set({verified:true}).where(eq(attempts.id,attempt.id));assert.equal(own((await request(url,employer)).text).ranking.qualityScore,67);checks.push('Warm HTTP presentation cannot resurrect unverified evidence');
  const beforeBlock=(await request(url,employer)).text;
  await db.insert(blocks).values({candidateUserId:candidate.id,companyId:employer.companyId!});assert.equal((await request(url,employer)).text,beforeBlock);
  const blocked=await request('/employer/invitations',employer,{candidateId:candidate.id,resumeId:resume.id,needId:need.id,title:'Synthetic cache guard offer',message:'Synthetic cache guard check',reason:'Synthetic confirmed skills in selected resume',salaryMin:150000,salaryMax:250000,salaryPeriod:'month',salaryType:'gross',workFormat:'Удалённо',idempotencyKey:`cache-${nonce}`});assert.equal(blocked.status,403);assert.ok(/company_blocked|blocked_by_candidate/i.test(blocked.text));checks.push('Existing block keeps professional matching semantics while invitation action guard remains fresh after warm facet');
  assert.equal((await request(url,foreign)).status,404);assert.equal((await request(url,candidate)).status,403);checks.push('Warm facet never bypasses owned-need or candidate-role HTTP authorization');
  await db.update(users).set({role:'candidate'}).where(eq(users.id,employer.id));assert.equal((await request(url,employer)).status,403);await db.update(users).set({role:'employer'}).where(eq(users.id,employer.id));checks.push('Warm facet immediately respects live account role change');
  await db.update(sessions).set({expiresAt:new Date(Date.now()-1000)}).where(eq(sessions.tokenHash,employer.tokenHash));assert.equal((await request(url,employer)).status,401);await db.update(sessions).set({expiresAt:new Date(Date.now()+600000)}).where(eq(sessions.tokenHash,employer.tokenHash));checks.push('Warm facet immediately respects session expiration');
  await db.insert(corrections).values({attemptId:attempt.id,reason:'Synthetic cache HTTP correction',operator:'cache-http-acceptance',originalDecision:{score:67,verified:true,status:'submitted'}});const corrected=await request(url,employer);assert.equal(corrected.status,200);assert.equal(own(corrected.text),undefined);assert.equal(corrected.text,await oldBytes());checks.push('Warm HTTP presentation immediately drops fresh revoked qualification with exact original bytes');
  assert.equal(JSON.parse((await request(bankUrl,employer)).text).total,0);checks.push('Actual warm catalogue verified AND filters cannot keep revoked qualifications');
} catch(error) {failure=((error as {cause?:Error}).cause?.message??(error as Error).message).slice(0,500);process.exitCode=1;}
finally {
  if(owned.length)await db.delete(users).where(inArray(users.id,owned));const remaining=owned.length?(await db.select({id:users.id}).from(users).where(inArray(users.id,owned))).length:0;
  const report={status:failure===null&&remaining===0?'PASS':'FAIL',checks,failure,runtimeManifest:process.env.SIGNAL_LOAD_RUNTIME_MANIFEST,cleanup:{createdUsers:owned.length,remainingUsers:remaining,ownerOnly:true}};
  await writeFile(`outputs/verification/multi-resume/cache-http-${nonce}.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));await pool.end();
}
