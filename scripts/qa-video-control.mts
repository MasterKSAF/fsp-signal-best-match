/** Private local fixture support. UI performs all registration/verification/submission actions. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { eq, desc, inArray } from 'drizzle-orm';
import { db, pool, signalUsersTable as users, signalAssessmentAttemptsTable as attempts, signalCandidateProfilesTable as profiles } from '../lib/db/src/index';
import { assessmentBankVersion } from '../artifacts/api-server/src/lib/assessment-bank';
const database = new URL(process.env.DATABASE_URL ?? '');
assert.ok(['localhost','127.0.0.1'].includes(database.hostname) && database.port==='55433' && database.pathname==='/signal');
const privatePath='outputs/local-backup/qa-cycle-02-video-fixture.json';
const fixture=JSON.parse(await readFile(privatePath,'utf8'));
assert.match(fixture.fixtureId,/^qa-video-20261006-[0-9a-f-]{36}$/);
assert.equal(fixture.origin,'http://127.0.0.1:4310');
const mode=process.argv[2], role=process.argv[3]??'candidate';
assert.ok(['candidate','employer'].includes(role));
const identity=fixture[role];
assert.match(identity.email,/^(nikita|anna)\.[0-9a-f]{8}@example\.invalid$/);
const sha=(bytes:string)=>createHash('sha256').update(bytes).digest('hex');
try {
 const [user]=await db.select({id:users.id,email:users.email,role:users.role,verified:users.emailVerified,demo:users.demoMode,createdAt:users.createdAt}).from(users).where(eq(users.email,identity.email));
 if(user){assert.equal(user.role,role);assert.equal(user.demo,false);assert.ok(user.createdAt.getTime()>=new Date(fixture.createdAt).getTime()-5000);identity.id=user.id;}
 if(mode==='mail-code') {
  assert.ok(user,'Registration must already exist');
  const response=await fetch('http://127.0.0.1:8026/api/v1/search?query='+encodeURIComponent('to:'+identity.email));
  assert.equal(response.status,200);const listing=await response.json() as any;
  let found=false;
  for(const item of listing.messages??[]){
   if(!(item.To??[]).some((to:any)=>to.Address===identity.email))continue;
   const message=await (await fetch('http://127.0.0.1:8026/api/v1/message/'+encodeURIComponent(item.ID))).json() as any;
   const code=String(message.Text||message.HTML||'').match(/\b(\d{6})\b/)?.[1];
   if(!code)continue;identity.verificationCode=code;identity.localMailReceipt={messageIdSha256:sha(item.ID),observedAt:new Date().toISOString()};found=true;break;
  }
  assert.ok(found,'Exact synthetic recipient must receive local verification mail');
  await writeFile(privatePath,JSON.stringify(fixture,null,2));console.log(JSON.stringify({registered:true,ordinary:true,localMailReceived:true,role,secretPrinted:false}));
 } else if(mode==='attempt-answers') {
  assert.ok(user?.verified);assert.equal(role,'candidate');
  const [attempt]=await db.select().from(attempts).where(eq(attempts.userId,user.id)).orderBy(desc(attempts.id)).limit(1);
  assert.ok(attempt && attempt.status==='in_progress');
  const programVersion=assessmentBankVersion(attempt.cases,attempt.oracles);
  assert.equal(programVersion,'signal-backend-python-v6');
  fixture.attempt={id:attempt.id,programVersion,grade:attempt.grade,answers:attempt.cases.map(item=>({caseId:item.id,answer:attempt.oracles[item.id].answer}))};
  fixture.answerProvenance='Constructed synthetic demonstration answers from the owned attempt stored oracle; actual UI save/submit/scorer. Not independent reference labels or human performance.';
  await writeFile(privatePath,JSON.stringify(fixture,null,2));console.log(JSON.stringify({ownedAttempt:true,cases:attempt.cases.length,programVersion,answersPrinted:false}));
 } else if(mode==='verified-state') {
  assert.ok(user?.verified);await writeFile(privatePath,JSON.stringify(fixture,null,2));
  console.log(JSON.stringify({role,ordinary:!user.demo,emailVerified:user.verified,ownIdCaptured:true}));
 } else if(mode==='workflow-proof') {
  assert.ok(fixture.candidate.id && fixture.employer.id);
  const candidate=fixture.candidate.id, employer=fixture.employer.id;
  const accounts=await pool.query('SELECT role,email_verified,demo_mode FROM signal_users WHERE id=ANY($1::int[]) ORDER BY role',[[candidate,employer]]);
  assert.equal(accounts.rows.length,2);assert.ok(accounts.rows.every(row=>row.email_verified&&!row.demo_mode));
  const profile=await pool.query('SELECT assumed_grade,verified_grade,verified_score,visibility,consent_matching,has_fsp_history FROM signal_candidate_profiles WHERE user_id=$1',[candidate]);
  assert.equal(profile.rows[0]?.verified_grade,'Middle');assert.equal(profile.rows[0]?.verified_score,100);
  const assessment=await pool.query('SELECT status,grade,score,verified FROM signal_assessment_attempts WHERE id=$1 AND user_id=$2',[fixture.attempt.id,candidate]);
  assert.equal(assessment.rows[0]?.status,'submitted');
  const invitations=await pool.query('SELECT i.status,i.salary_min,i.salary_max,i.salary_type,i.salary_period FROM signal_invitations i JOIN signal_companies c ON c.id=i.company_id WHERE i.candidate_user_id=$1 AND c.owner_user_id=$2',[candidate,employer]);
  assert.equal(invitations.rows.length,1);assert.equal(invitations.rows[0].status,'accepted');
  const applications=await pool.query('SELECT a.status,a.disclosure_version,(a.snapshot->>\'version\')::int AS original_terms_version,j.status AS job_status FROM signal_applications a JOIN signal_companies c ON c.id=a.company_id JOIN signal_jobs j ON j.id=a.job_id WHERE a.candidate_user_id=$1 AND c.owner_user_id=$2',[candidate,employer]);
  assert.equal(applications.rows.length,1);assert.equal(applications.rows[0].status,'shortlisted');
  const grants=await pool.query('SELECT (g.invitation_id IS NOT NULL) AS invitation_basis,(g.application_id IS NOT NULL) AS application_basis,(g.revoked_at IS NULL) AS active FROM signal_contact_grants g JOIN signal_companies c ON c.id=g.company_id WHERE g.candidate_user_id=$1 AND c.owner_user_id=$2',[candidate,employer]);
  assert.equal(grants.rows.length,2);assert.ok(grants.rows.every(row=>row.active));
  const captures=JSON.parse(await readFile('outputs/verification/qa-cycle-02-video-captures.json','utf8'));
  const safe={schemaVersion:'signal-qa06-ordinary-ui-workflow-v1',observedAt:new Date().toISOString(),passed:true,localSyntheticData:true,ordinaryAccounts:accounts.rows,localEmailReceipts:['candidate','employer'].map(role=>({role,...fixture[role].localMailReceipt})),profile:profile.rows[0],assessment:{...assessment.rows[0],programVersion:fixture.attempt.programVersion,answerProvenance:fixture.answerProvenance},invitations:invitations.rows,applications:applications.rows,contactGrants:grants.rows,uiActionsObserved:['registration','local-email-confirmation','profile-save','six-answer-questionnaire','assessment-start-save-submit','employer-need','matching','salary-invitation','candidate-acceptance','company-scoped-contacts','job-publish','voluntary-application-consent','employer-application-review'],captureProof:'outputs/verification/qa-cycle-02-video-captures.json',captureProofSha256:sha(JSON.stringify(captures)),cleanupPending:true};
  await writeFile('outputs/verification/qa-cycle-02-ordinary-ui-workflow.json',JSON.stringify(safe,null,2));console.log(JSON.stringify({passed:true,ordinaryAccounts:2,verifiedMiddle:true,invitationAccepted:true,applicationShortlisted:true,scopedGrants:2,secretsExported:false}));
 } else if(mode==='cleanup') {
  const ids:number[]=[];
  for(const key of ['candidate','employer']){const own=fixture[key];if(!own.id)continue;const [row]=await db.select({id:users.id,email:users.email,demo:users.demoMode,createdAt:users.createdAt}).from(users).where(eq(users.id,own.id));assert.ok(row&&row.email===own.email&&!row.demo&&row.createdAt.getTime()>=new Date(fixture.createdAt).getTime()-5000);ids.push(own.id);}
  assert.ok(ids.length>0);await db.delete(users).where(inArray(users.id,ids));fixture.cleanedAt=new Date().toISOString();await writeFile(privatePath,JSON.stringify(fixture,null,2));
  const safePath='outputs/verification/qa-cycle-02-ordinary-ui-workflow.json';const safe=JSON.parse(await readFile(safePath,'utf8'));safe.cleanupPending=false;safe.cleanup={exactCapturedAccounts:ids.length,completedAt:fixture.cleanedAt,protectedRootAccountsUntouched:true};await writeFile(safePath,JSON.stringify(safe,null,2));
  console.log(JSON.stringify({cleanup:true,exactCapturedAccounts:ids.length,protectedRootAccountsUntouched:true}));
 } else throw new Error('Unknown private control mode');
} finally {await pool.end();}
