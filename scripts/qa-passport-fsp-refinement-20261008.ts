import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { db, pool, signalUsersTable, signalCandidateProfilesTable, signalCandidateResumesTable, signalSkillAttemptsTable, signalSkillEvidenceTable } from '@workspace/db';
import { hashPassword, ensureCandidateProfile } from '../artifacts/api-server/src/lib/signal-auth';
const origin='http://127.0.0.1:4371';
const url=new URL(process.env.DATABASE_URL!); assert.equal(url.hostname,'127.0.0.1'); assert.equal(url.port,'55435'); assert.equal(url.pathname,'/signal_ui_refinement_20261008');
const output=path.resolve('outputs/verification/ui-refinement-20261008/passport-fsp'); await fs.mkdir(output,{recursive:true});
const results:any[]=[]; const actors:any[]=[];
const stable=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const snapshot = async(userId:number) => ({evidence:await db.select().from(signalSkillEvidenceTable).where(eq(signalSkillEvidenceTable.userId,userId)),attempts:await db.select().from(signalSkillAttemptsTable).where(eq(signalSkillAttemptsTable.userId,userId))});
async function request(cookie:string,method:string,route:string,body?:unknown, expected=200) {
  const response=await fetch(origin+'/api'+route,{method,headers:{'Content-Type':'application/json',Cookie:cookie,Origin:'http://127.0.0.1:4372'},body:body===undefined?undefined:JSON.stringify(body)});
  assert.equal(response.status,expected,`${method} ${route} expected ${expected}, actual ${response.status}`);
  const value=response.status===204?null:await response.json(); assert.ok(!JSON.stringify(value).includes('passwordHash')); return value;
}
async function actor(label:string,demoMode:boolean) {
  const email=`ui-passport-${label}-${Date.now()}@example.invalid`; const password=randomBytes(24).toString('base64url');
  const [user]=await db.insert(signalUsersTable).values({email,passwordHash:await hashPassword(password),displayName:demoMode?'Дарья Орлова':'Павел Никитин',role:'candidate',demoMode,emailVerified:true}).returning(); assert.ok(user);
  await ensureCandidateProfile(user);
  const login=await fetch(origin+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})}); assert.equal(login.status,200);
  const cookie=login.headers.getSetCookie()[0]?.split(';')[0]; assert.ok(cookie);
  const item={label,id:user.id,email,password,cookie,demoMode}; actors.push(item); return item;
}
async function prove(a:any,resumeId:number,skillId:string) {
  const matrix=await request(a.cookie,'GET',`/me/skill-matrix?resumeId=${resumeId}`);
  const issued=await request(a.cookie,'POST','/me/skill-attempts',{resumeId,skillId,level:'Junior',programVersion:matrix.bankVersion},201);
  assert.equal(issued.attempt.skillId,skillId); assert.equal(issued.attempt.level,'Junior'); assert.equal(issued.attempt.programVersion,matrix.bankVersion);
  assert.equal(issued.attempt.feedback.length,0); assert.equal(issued.attempt.oracles,undefined);
  const [row]=await db.select().from(signalSkillAttemptsTable).where(eq(signalSkillAttemptsTable.id,issued.attempt.id)); assert.equal(row.userId,a.id);
  // These are explicitly QA actors. Saved server oracles validate the HTTP scoring/persistence path, not professional accuracy.
  const answers=Object.fromEntries(row.cases.map(c=>[c.id,row.oracles[c.id]!.expected]));
  const submitted=await request(a.cookie,'POST',`/me/skill-attempts/${row.id}/submit`,{revision:row.revision,answers}); assert.equal(submitted.attempt.decision.passed,true);
  return row.id;
}
try {
  await request('','GET','/me/skill-matrix',undefined,401);
  const a=await actor('no-cv',false); const b=await actor('demo-cvs',true);
  const aList=await request(a.cookie,'GET','/me/resumes'); const aBackend=aList.resumes[0]; assert.ok(aBackend);
  const aFront=await request(a.cookie,'POST','/me/resumes',{title:'Frontend-разработчик',specialization:'Frontend / TypeScript'},201);
  await prove(a,aBackend.id,'python'); await prove(a,aFront.id,'react');
  const aMatrix=await request(a.cookie,'GET',`/me/skill-matrix?resumeId=${aBackend.id}`); assert.deepEqual(aMatrix.accountEvidence.map((e:any)=>e.skillId).sort(),['python','react']);
  const before=await snapshot(a.id); const beforeHash=stable(before);
  await request(a.cookie,'DELETE',`/me/resumes/${aBackend.id}`,undefined,204); await request(a.cookie,'DELETE',`/me/resumes/${aFront.id}`,undefined,204);
  const noCv=await request(a.cookie,'GET','/me/skill-matrix'); assert.equal(noCv.resume,null); assert.deepEqual(noCv.skillContexts,[]); assert.deepEqual(noCv.accountSkills,[]); assert.deepEqual(noCv.accountEvidence,aMatrix.accountEvidence); assert.equal(noCv.history.length,2);
  const registry=await request(a.cookie,'GET','/me/evidence/registry'); assert.deepEqual(registry.resumes,[]);
  for (const proof of noCv.accountEvidence) assert.equal((await request(a.cookie,'GET',`/me/skill-attempts/${proof.attemptId}`)).resumeId,before.attempts.find(t=>t.id===proof.attemptId)!.resumeId);
  assert.equal(stable(await snapshot(a.id)),beforeHash); assert.equal((await request(a.cookie,'GET','/me/resumes')).resumes.length,0);
  await request(a.cookie,'GET',`/me/skill-matrix?resumeId=${aBackend.id}`,undefined,404);
  results.push({id:'U10-account-no-cv',passed:true,userId:a.id,proofIds:noCv.accountEvidence.map((e:any)=>e.evidenceId),historyIds:noCv.history.map((e:any)=>e.id),immutableProofAndAttemptSha256:beforeHash});
  const bList=await request(b.cookie,'GET','/me/resumes'); const bBackend=bList.resumes[0];
  await db.update(signalCandidateResumesTable).set({title:'Backend-разработчик',stack:['Py','Python','PostgreSQL','FastAPI'],assumedGrade:'Middle'}).where(eq(signalCandidateResumesTable.id,bBackend.id));
  const bFront=await request(b.cookie,'POST','/me/resumes',{title:'Frontend-разработчик',specialization:'Frontend / TypeScript'},201);
  await db.update(signalCandidateResumesTable).set({stack:['TypeScript','React'],assumedGrade:'Middle'}).where(eq(signalCandidateResumesTable.id,bFront.id));
  await prove(b,bBackend.id,'python');
  const bMatrix=await request(b.cookie,'GET',`/me/skill-matrix?resumeId=${bBackend.id}`);
  assert.equal(bMatrix.accountEvidence.find((p:any)=>p.skillId==='python').level,'Junior');
  assert.equal(bMatrix.accountSkills.filter((s:any)=>s.skillId==='python').length,1); assert.equal(bMatrix.accountSkills.find((s:any)=>s.skillId==='python').verifiedLevel,'Junior');
  assert.equal(bMatrix.accountSkills.find((s:any)=>s.label==='PostgreSQL').state,'declared'); assert.equal(bMatrix.accountSkills.find((s:any)=>s.label==='FastAPI').state,'declared');
  assert.deepEqual(bMatrix.accountSkills.find((s:any)=>s.skillId==='react').resumeIds,[bFront.id]);
  await request(a.cookie,'GET',`/me/skill-matrix?resumeId=${bBackend.id}`,undefined,404);
  results.push({id:'U05-U10-all-cv-dedup',passed:true,userId:b.id,resumeIds:[bBackend.id,bFront.id],pythonLevel:'Junior',postgresqlState:'declared',fastApiState:'declared',skillContexts:bMatrix.skillContexts});
  for (const owner of [a,b]) {
    const original=stable(await snapshot(owner.id));
    for (const fspId of [`ID-${owner.id}-ONE`,`ID-${owner.id}-TWO`,'FSP-DEMO-2026']) {
      const saved=await request(owner.cookie,'PUT','/me/fsp-connection',{fspId}); assert.equal(saved.fspId,fspId); assert.equal(saved.verifiedAt,null); assert.equal(saved.importedAt,null); assert.equal(saved.consentedAt,null); assert.equal(saved.hasHistory,false); assert.equal(saved.fspSignal.bonus,0); assert.deepEqual(saved.achievements,[]);
      const reloaded=await request(owner.cookie,'GET','/me/fsp-connection'); assert.equal(reloaded.fspId,fspId); assert.equal(reloaded.fspSignal.bonus,0);
    }
    await request(owner.cookie,'PUT','/me/fsp-connection',{fspId:'ID-WITH-CONSENT',consentImport:true},400);
    await request(owner.cookie,'POST','/me/fsp-connection/import',{consentImport:false},400);
    const unavailable=await request(owner.cookie,'POST','/me/fsp-connection/import',{consentImport:true},503); assert.equal(unavailable.code,'registry_not_configured');
    const afterFailedImport=await request(owner.cookie,'GET','/me/fsp-connection'); assert.equal(afterFailedImport.verifiedAt,null); assert.equal(afterFailedImport.consentedAt,null); assert.equal(afterFailedImport.fspSignal.bonus,0);
    const unlinked=await request(owner.cookie,'DELETE','/me/fsp-connection'); assert.equal(unlinked.fspId,null); assert.equal(unlinked.status,'unlinked'); assert.equal(unlinked.fspSignal.bonus,0);
    const [profile]=await db.select().from(signalCandidateProfilesTable).where(eq(signalCandidateProfilesTable.userId,owner.id)); assert.equal(profile.hasFspHistory,false);
    assert.equal(stable(await snapshot(owner.id)),original);
    results.push({id:'U14-save-change-reload-unlink-no-false-import',passed:true,userId:owner.id,demoMode:owner.demoMode,attemptAndEvidenceUnchangedSha256:original});
  }
  // Keep two fixture actors for independent live review, with credentials only outside the workspace.
  const privateFile='C:/Users/Misha/.codex/private/signal-ui-refinement-passport-fixtures-20261008.json'; await fs.writeFile(privateFile,JSON.stringify({origin:'http://127.0.0.1:4372',actors},null,2));
  const receipt={status:'PASS',at:new Date().toISOString(),apiOrigin:origin,database:url.pathname.slice(1),results,fixtureActors:actors.map(({password,cookie,...safe})=>safe),privateCredentialFile:privateFile,professionalValidityClaimed:false};
  await fs.writeFile(path.join(output,'http-receipt.json'),JSON.stringify(receipt,null,2)); console.log(JSON.stringify({status:receipt.status,tests:results.length,actors:receipt.fixtureActors.map(a=>({label:a.label,id:a.id})),receipt:path.join(output,'http-receipt.json')}));
} finally { await pool.end(); }

