import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {bindPassportSkill} from '../artifacts/fsp-signal/src/lib/skill-passport-context';
const url=new URL(process.env.DATABASE_URL!);assert.equal(url.pathname,'/signal_ui_refinement_20261008');assert.equal(url.port,'55435');assert.equal(process.env.PORT,'4371');
const fixture=JSON.parse(await readFile('C:/Users/Misha/.codex/private/signal-ui-correction01-context-fixtures-20261008.json','utf8'));
const actor=fixture.actors[0];assert.ok(actor.email.startsWith(fixture.prefix));const [middle,senior]=actor.resumeIds;
let cookie='';const requests:any[]=[],observations:any[]=[];
const hash=(x:any)=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
async function request(route:string,method='GET',body?:unknown,status=200){const response=await fetch('http://127.0.0.1:4371/api'+route,{method,headers:{Origin:fixture.origin,...(cookie?{Cookie:cookie}:{}),'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});assert.equal(response.status,status,`${method} ${route}`);if(route==='/auth/login')cookie=response.headers.getSetCookie()[0].split(';')[0];requests.push({route,method,status:response.status});return response.json();}
try{
 await request('/auth/login','POST',{email:actor.email,password:actor.password,role:'candidate'});
 const before=await request(`/me/skill-matrix?resumeId=${middle}`);assert.match(before.bankVersion,/-v5$/);
 const python=before.accountSkills.find((s:any)=>s.skillId==='python');
 for(const [selected,active,level] of [[middle,senior,'Middle'],[senior,middle,'Senior']] as const){
  const bound=bindPassportSkill(python,String(selected),active)!;assert.equal(bound.targetLevel,level);assert.equal(bound.resumeId,selected);
  const issued=await request('/me/skill-attempts','POST',{resumeId:bound.resumeId,skillId:bound.skillId,level:bound.targetLevel,programVersion:before.bankVersion},201);
  assert.equal(issued.attempt.skillId,'python');assert.equal(issued.attempt.level,level);assert.equal(issued.attempt.resumeId,selected);assert.equal(issued.attempt.programVersion,before.bankVersion);
  observations.push({selectedResumeId:selected,oppositeActiveResumeId:active,level,actualAttemptId:issued.attempt.id,actualResumeId:issued.attempt.resumeId});
 }
 const after=await request(`/me/skill-matrix?resumeId=${middle}`);assert.equal(hash(after.accountEvidence),hash(before.accountEvidence));
 const oldIds=new Set(before.history.map((a:any)=>a.id));assert.equal(hash(after.history.filter((a:any)=>oldIds.has(a.id))),hash(before.history));
 await writeFile('outputs/verification/ui-refinement-correction01-20261008/context/http-issue-iteration04.json',JSON.stringify({status:'PASS',at:new Date().toISOString(),requests,observations,bankVersion:after.bankVersion,oldHistoryAndProofsUnchanged:true,actorId:actor.id},null,2));
 console.log(JSON.stringify({status:'PASS',cases:2,actorId:actor.id}));
}finally{if(cookie)await request('/auth/logout','POST');}
