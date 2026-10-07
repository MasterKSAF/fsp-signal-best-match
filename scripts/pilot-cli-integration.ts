/** Real local research API + operator CLI, scoped synthetic accounts. Does not
 * send mail/invitations or claim recruitment/human results. */
import assert from 'node:assert/strict';
import { randomBytes,randomUUID,createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir,writeFile,readFile,rm } from 'node:fs/promises';
import path from 'node:path';
import { inArray } from 'drizzle-orm';
import { db,pool,signalUsersTable as users,signalSessionsTable as sessions } from '../lib/db/src/index';
import router from '../artifacts/api-server/src/routes/signal-research';
import { assessmentPrograms } from '../artifacts/api-server/src/lib/assessment-managed';

assert.ok(['localhost','127.0.0.1','[::1]'].includes(new URL(process.env.DATABASE_URL!).hostname));
const requireApi=createRequire(new URL('../artifacts/api-server/package.json',import.meta.url));
const app=requireApi('express')();app.use(requireApi('express').json(),requireApi('cookie-parser')());app.use('/api',router);
const server=app.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address!=='string');
const api=`http://127.0.0.1:${address.port}/api`,runId=`pilot-cli-${randomUUID()}`,ids:number[]=[],checks:string[]=[],started=Date.now();
const privateRoot=path.resolve('outputs/local-backup/pilot'),runRoot=path.resolve(privateRoot,runId);assert.ok(path.relative(privateRoot,runRoot)===runId);
await mkdir(runRoot,{recursive:true});
const command=promisify(execFile);
async function fixture(role:'candidate'|'employer') {
  const [user]=await db.insert(users).values({email:`${runId}-${ids.length}@example.test`,passwordHash:'unusable-scoped-fixture',displayName:'Synthetic pilot CLI control',role,emailVerified:true,demoMode:false}).returning();assert.ok(user);ids.push(user.id);
  const token=randomBytes(32).toString('base64url');await db.insert(sessions).values({userId:user.id,tokenHash:createHash('sha256').update(token).digest('hex'),demoMode:false,expiresAt:new Date(Date.now()+3600000)});
  return {id:user.id,cookie:`fsp_signal_session=${token}`};
}
async function request(cookie:string,endpoint:string,method='GET',body?:unknown) {
  const response=await fetch(`${api}${endpoint}`,{method,headers:{Cookie:cookie,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
  assert.ok(response.ok,`${method} ${endpoint}: ${response.status}`);return response.json() as Promise<any>;
}
const cookieFile=path.join(runRoot,'session.txt');
async function cli(args:string[]) {
  const result=await command(process.execPath,['--import','tsx','scripts/research-pilot.ts',...args,'--api',api,'--cookie-file',cookieFile],{cwd:process.cwd(),timeout:25000});
  assert.doesNotMatch(result.stdout,/fsp_signal_session=|@example\.test/);return JSON.parse(result.stdout.trim());
}
let passed=false;
try {
  const operator=await fixture('employer'),a=await fixture('candidate'),b=await fixture('candidate');process.env.SIGNAL_RESEARCH_OPERATOR_IDS=String(operator.id);await writeFile(cookieFile,operator.cookie);
  const input=path.join(runRoot,'synthetic-study.json');await writeFile(input,JSON.stringify({title:'Synthetic operator CLI protocol check',programId:'frontend-typescript',grade:'Middle',retentionDays:1,measurementOrigin:'synthetic'}));
  const created=await cli(['create','--input',input]);const sid=created.createdStudyId,base=`/research/studies/${sid}`;
  assert.equal((await request(operator.cookie,`${base}/aggregate-report`)).status,'not_measured');checks.push('CLI create over authenticated research API; explicit synthetic origin and empty report not_measured');
  const enrollments=[];
  for(const person of [a,b]) {
    const detail=await request(person.cookie,base);const enrolled=await request(person.cookie,`${base}/enroll`,'POST',{consent:true,consentVersion:detail.consentVersion});enrollments.push(enrolled);
    const basis=path.join(runRoot,`basis-${enrolled.enrollmentId}.txt`);await writeFile(basis,'Synthetic independent preset, not a human evaluation.');
    await cli(['group','--study',String(sid),'--enrollment',String(enrolled.enrollmentId),'--grade','Middle','--basis-file',basis]);
    for(let index=0;index<2;index++) {
      const attempt=await request(person.cookie,`${base}/attempts/start`,'POST');await request(person.cookie,`/research/attempts/${attempt.attemptId}/submit`,'POST');
    }
  }
  assert.deepEqual(enrollments.map(e=>e.order),['AB','BA']);checks.push('CLI freezes independent group before attempts; synthetic participants complete assigned AB/BA with all skips, no oracle used');
  await cli(['close','--study',String(sid)]);
  for(const reviewer of ['synthetic-one','synthetic-two']) {
    const file=path.join(runRoot,`${reviewer}.json`);await cli(['packet','--study',String(sid),'--reviewer',reviewer,'--out',file]);
    const packet=JSON.parse(await readFile(file,'utf8'));assert.doesNotMatch(JSON.stringify(packet.ratings),/score|form|independentGrade|userId/);assert.equal(packet.ratings.length,2);
    await assert.rejects(cli(['import','--study',String(sid),'--input',file]));
    for(const item of packet.ratings){item.grade=reviewer==='synthetic-one'?'Middle':'Senior';item.comment='Synthetic review import fixture; no external expert or human participant.';}
    await writeFile(file,JSON.stringify(packet));await cli(['import','--study',String(sid),'--input',file]);
  }
  checks.push('CLI downloads private blind packets, rejects blanks, imports two complete synthetic independent files with disagreement retained');
  const aggregateFile=path.join(runRoot,'aggregate.json');await cli(['aggregate','--study',String(sid),'--out',aggregateFile]);
  const report=JSON.parse(await readFile(aggregateFile,'utf8'));assert.equal(report.counts.paired,2);assert.equal(report.humanValidation,'not_measured');assert.equal(report.expertReview.exactAgreement,0);assert.doesNotMatch(JSON.stringify(report),/P-|reviewerId|Synthetic review import/);
  await assert.rejects(cli(['aggregate','--study',String(sid),'--out','outputs/submission/private-pilot.json']));checks.push('CLI aggregate remains synthetic/not_measured for humans; identifiers excluded and unsafe output location rejected');
  passed=true;
} finally {
  await new Promise<void>((resolve,reject)=>server.close((error:Error|undefined)=>error?reject(error):resolve()));
  if(ids.length)await db.delete(users).where(inArray(users.id,ids));
  assert.ok(path.relative(privateRoot,runRoot)===runId);await rm(runRoot,{recursive:true,force:true});
  await mkdir('outputs/verification',{recursive:true});
  await writeFile('outputs/verification/pilot-cli-http.json',JSON.stringify({generatedAt:new Date().toISOString(),passed,groups:checks.length,checks,durationMs:Date.now()-started,command:'node --env-file-if-exists=.env --import tsx scripts/pilot-cli-integration.ts',programVersions:Object.fromEntries(assessmentPrograms.map(p=>[p.id,p.version])),provenance:'Scoped synthetic local HTTP/DB/CLI mechanics; not human validation, no recruitment, no expert participation',sourceHashes:Object.fromEntries(await Promise.all(['scripts/research-pilot.ts','scripts/pilot-cli-integration.ts','artifacts/api-server/src/routes/signal-research.ts'].map(async file=>[file,createHash('sha256').update(await readFile(file)).digest('hex')]))),cleanup:'Only exact created user IDs and their cascading study/session/response/rating records removed; only verified UUID private helper directory removed; no source answers or user mapping exported.'},null,2));
  await pool.end();
}
assert.ok(passed);console.log(JSON.stringify({passed,groups:checks.length,scope:'Synthetic real HTTP/DB and CLI, not human observations'}));
