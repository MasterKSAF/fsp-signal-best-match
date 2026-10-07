/** Operator CLI for the existing research API. No account creation, invitations,
 * raw-answer export or profile-grade writes. Cookie and per-person files remain
 * in outputs/local-backup/pilot, outside every submission archive. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const args=process.argv.slice(2), command=args[0];
const value=(key:string,fallback?:string)=>{const index=args.indexOf(`--${key}`);return index>=0?args[index+1]:fallback;};
const privateRoot=path.resolve('outputs/local-backup/pilot');
function privatePath(input:string) {
  const resolved=path.resolve(input),relative=path.relative(privateRoot,resolved);
  assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative),'Private files must be inside outputs/local-backup/pilot');return resolved;
}
function id(key:string) {const result=Number(value(key));assert.ok(Number.isSafeInteger(result)&&result>0,`--${key} must be a positive ID`);return result;}
const grades=['Junior','Middle','Senior'];
function validateReview(input:any) {
  assert.ok(Number.isSafeInteger(input.studyId)&&input.studyId>0);
  assert.equal(input.protocolVersion,'signal-research-v1');assert.ok(typeof input.reviewerId==='string'&&input.reviewerId.trim().length>=3);
  assert.ok(Array.isArray(input.ratings)&&input.ratings.length>0);
  assert.equal(new Set(input.ratings.map((r:any)=>r.pseudonym)).size,input.ratings.length);
  for(const item of input.ratings)assert.ok(typeof item.pseudonym==='string'&&grades.includes(item.grade)&&typeof item.comment==='string'&&item.comment.trim().length>=10,'Every blind rating needs a grade and independent rationale, never placeholder text');
  return input;
}
const usage='research-pilot.ts create --input docs/pilot/study-backend-middle.json | group --study ID --enrollment ID --grade Middle --basis-file outputs/local-backup/pilot/basis.txt | close --study ID | packet --study ID --reviewer reviewer-code --out outputs/local-backup/pilot/reviewer-one.json | import --study ID --input outputs/local-backup/pilot/reviewer-one.json | aggregate --study ID --out outputs/local-backup/pilot/aggregate.json. All API commands use --cookie-file outputs/local-backup/pilot/session.txt (default), --api http://localhost:4310/api (default).';
if(command==='--help'||!command){console.log(usage);process.exit(0);}
if(command==='--self-test') {
  assert.throws(()=>privatePath('outputs/submission/private.json'));assert.throws(()=>validateReview({studyId:1,protocolVersion:'signal-research-v1',reviewerId:'one',ratings:[{pseudonym:'P-SYNTHETIC',grade:null,comment:''}]}));
  validateReview({studyId:1,protocolVersion:'signal-research-v1',reviewerId:'one',ratings:[{pseudonym:'P-SYNTHETIC',grade:'Middle',comment:'Synthetic independent review fixture only.'}]});
  console.log(JSON.stringify({passed:true,scope:'Private-path enforcement, unfilled blind packet rejection, complete review structure; no API request, no human data',checks:3}));process.exit(0);
}
assert.ok(['create','group','close','packet','import','aggregate'].includes(command),usage);
const api=value('api','http://localhost:4310/api')!.replace(/\/$/,''),apiUrl=new URL(api);
assert.ok(['127.0.0.1','localhost','[::1]'].includes(apiUrl.hostname),'This CLI operates the authorized local pilot only');
const cookie=(await readFile(privatePath(value('cookie-file','outputs/local-backup/pilot/session.txt')!),'utf8')).trim();
assert.ok(/^fsp_signal_session=[^\r\n;]+$/.test(cookie),'Expected a private single session cookie, never a token in command arguments');
async function request(endpoint:string,method='GET',body?:unknown) {
  const response=await fetch(`${api}${endpoint}`,{method,headers:{Cookie:cookie,Origin:apiUrl.origin,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw new Error(`Research API ${response.status}: request not accepted. Check operator permission, ownership, frozen pretest, retention and review completeness in /research.`);
  return response.json() as Promise<any>;
}
const access=await request('/research/access');assert.equal(access.operator,true,'A verified personal research operator is required; employer role alone is insufficient');
if(command==='create') {
  const input=JSON.parse(await readFile(value('input')!,'utf8'));
  assert.ok(['backend-python','frontend-typescript'].includes(input.programId)&&grades.includes(input.grade));
  assert.ok(['operator_declared_human','synthetic'].includes(input.measurementOrigin),'Origin must be declared explicitly; human provenance still requires an external protocol');
  const {study}=await request('/research/studies','POST',input);console.log(JSON.stringify({createdStudyId:study.id,programId:study.programId,grade:study.grade,notice:'Study created; no participants or human results exist yet. Participant link /research/'+study.id}));
} else {
  const studyId=id('study'),base=`/research/studies/${studyId}`;
  if(command==='group') {
    const grade=value('grade');assert.ok(grades.includes(grade!));const basis=(await readFile(privatePath(value('basis-file')!),'utf8')).trim();assert.ok(basis.length>=10);
    await request(`${base}/participants/${id('enrollment')}/group`,'PUT',{grade,basis});console.log(JSON.stringify({saved:true,studyId,notice:'Independent group frozen; no result-based reassignment.'}));
  }
  if(command==='close'){await request(`${base}/close`,'POST');console.log(JSON.stringify({closed:true,studyId}));}
  if(command==='packet'||command==='aggregate') {
    const data=await request(`${base}/${command==='packet'?'review-packet':'aggregate-report'}`);
    if(command==='packet') {
      const reviewer=value('reviewer');assert.ok(reviewer&&reviewer.trim().length>=3);data.reviewerId=reviewer;
      for(const item of data.ratings??[]) {delete item.score;delete item.form;delete item.independentGrade;item.grade=null;item.comment='';}
    }
    const output=privatePath(value('out')!);await mkdir(path.dirname(output),{recursive:true});await writeFile(output,JSON.stringify(data,null,2));console.log(JSON.stringify({saved:true,kind:command,notice:'Private output stored. Review privacy before any external disclosure.'}));
  }
  if(command==='import') {
    const review=validateReview(JSON.parse(await readFile(privatePath(value('input')!),'utf8')));assert.equal(review.studyId,studyId);
    await request(`${base}/reviews`,'POST',review);console.log(JSON.stringify({imported:true,studyId,notice:'Original independent judgement retained; do not resolve disagreement by rewriting it.'}));
  }
}
