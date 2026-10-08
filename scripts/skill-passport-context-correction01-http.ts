/** C01: private, owned fixtures only. Keep one actor for browser review; no accepted actor/history writes. */
import assert from 'node:assert/strict';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {and,eq} from 'drizzle-orm';
import {db,pool,signalUsersTable as users,signalSkillAttemptsTable as attempts,signalCandidateResumesTable as resumes} from '../lib/db/src/index';
import {hashPassword,ensureCandidateProfile} from '../artifacts/api-server/src/lib/signal-auth';
import {bindPassportSkill} from '../artifacts/fsp-signal/src/lib/skill-passport-context';
const target=new URL(process.env.DATABASE_URL!);
assert.equal(target.pathname,'/signal_ui_refinement_20261008');assert.equal(target.port,'55435');assert.ok(['localhost','127.0.0.1'].includes(target.hostname));assert.equal(process.env.PORT,'4371');
const origin='http://127.0.0.1:4371/api',appOrigin='http://signal-refinement.localhost:4372';
const prefix=`ui-context-c01-${randomUUID()}-`,directory='outputs/verification/ui-refinement-correction01-20261008/context';
await mkdir(directory,{recursive:true});const checks:string[]=[],requests:any[]=[];let user:any,cookie='',success=false;
const stable=(x:any)=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
async function request(route:string,method='GET',body?:unknown,status=200){const response=await fetch(origin+route,{method,headers:{Origin:appOrigin,...(cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});requests.push({route,method,status:response.status});assert.equal(response.status,status,`${method} ${route}`);if(route==='/auth/login')cookie=response.headers.getSetCookie()[0].split(';')[0];return response.status===204?null:response.json();}
try{
 const email=`${prefix}owner@example.invalid`,password=randomBytes(24).toString('base64url');
 [user]=await db.insert(users).values({email,passwordHash:await hashPassword(password),displayName:'Даниил Смирнов',role:'candidate',demoMode:false,emailVerified:true}).returning();assert.ok(user.email.startsWith(prefix));await ensureCandidateProfile(user);
 await request('/auth/login','POST',{email,password,role:'candidate'});
 const initial=await request('/me/resumes');const middle=initial.resumes[0];assert.ok(middle);
 // New disposable fixture declaration only; target selection itself uses the ordinary owner API.
 await db.update(resumes).set({stack:['Python']}).where(and(eq(resumes.id,middle.id),eq(resumes.userId,user.id)));
 await request(`/me/resumes/${middle.id}`,'PATCH',{revision:middle.revision,title:'Backend · цель Middle'});
 const middleCurrent=await request(`/me/resumes/${middle.id}`);
 await request('/me/skill-target','POST',{resumeId:middle.id,revision:middleCurrent.revision,grade:'Middle'});
 const senior=await request('/me/resumes','POST',{title:'Backend · цель Senior',specialization:'Backend / Python'},201);
 await db.update(resumes).set({stack:['Python']}).where(and(eq(resumes.id,senior.id),eq(resumes.userId,user.id)));
 await request('/me/skill-target','POST',{resumeId:senior.id,revision:senior.revision,grade:'Senior'});
 const front=await request('/me/resumes','POST',{title:'Временный контекст React',specialization:'Frontend / TypeScript'},201);
 const m=await request(`/me/skill-matrix?resumeId=${middle.id}`);assert.match(m.bankVersion,/-v5$/);
 const proofIssued=await request('/me/skill-attempts','POST',{resumeId:front.id,skillId:'react',level:'Junior',programVersion:m.bankVersion},201);
 const [saved]=await db.select().from(attempts).where(eq(attempts.id,proofIssued.attempt.id));assert.equal(saved.userId,user.id);
 const answers=Object.fromEntries(saved.cases.map(c=>[c.id,saved.oracles[c.id]!.expected]));
 assert.equal((await request(`/me/skill-attempts/${saved.id}/submit`,'POST',{revision:saved.revision,answers})).attempt.decision.passed,true);
 await request(`/me/resumes/${front.id}`,'DELETE',undefined,204);
 const fromMiddle=await request(`/me/skill-matrix?resumeId=${middle.id}`),fromSenior=await request(`/me/skill-matrix?resumeId=${senior.id}`);
 assert.deepEqual(fromMiddle.accountEvidence,fromSenior.accountEvidence);assert.equal(fromMiddle.accountEvidence.find((p:any)=>p.skillId==='react').level,'Junior');
 const historyBefore=stable(fromMiddle.history),proofBefore=stable(fromMiddle.accountEvidence);
 const python=fromMiddle.accountSkills.find((s:any)=>s.skillId==='python');assert.deepEqual(python.contexts.map((c:any)=>[c.resumeId,c.targetLevel]),[[middle.id,'Middle'],[senior.id,'Senior']]);
 const observations:any[]=[];
 for(const [filter,active,level] of [[middle.id,senior.id,'Middle'],[senior.id,middle.id,'Senior']] as const){
  const bound=bindPassportSkill(python,String(filter),active)!;assert.equal(bound.targetLevel,level);assert.equal(bound.resumeId,filter);
  observations.push({filterResumeId:filter,oppositeActiveResumeId:active,level,resolvedSkillId:bound.skillId,resolvedResumeId:bound.resumeId});
 }
 const all=bindPassportSkill(python,'all',middle.id)!;assert.equal(all.targetLevel,'Senior');assert.equal(all.resumeId,senior.id);
 const final=await request(`/me/skill-matrix?resumeId=${middle.id}`);assert.equal(stable(final.accountEvidence),proofBefore);
 const retained=final.history.filter((a:any)=>a.id===saved.id);assert.equal(stable(retained),historyBefore);assert.equal(retained[0].resumeId,front.id);
 checks.push('Same specialization, opposite active CV: live projection retains distinct targets; resolver binds each exact filter for subsequent browser/start review.');
 checks.push('All-CV maximum binds a Senior-target CV; global React Junior survives both CV contexts and deletion of its original temporary CV. Original attempt context/snapshot preserved.');
 const privateFile='C:/Users/Misha/.codex/private/signal-ui-correction01-context-fixtures-20261008.json';
 await writeFile(privateFile,JSON.stringify({prefix,origin:appOrigin,actors:[{id:user.id,email,password,label:'two-targets',resumeIds:[middle.id,senior.id],temporaryDeletedResumeId:front.id}]}));
 await writeFile(`${directory}/http-prepare-iteration04.json`,JSON.stringify({status:'PASS',at:new Date().toISOString(),db:target.pathname,checks,requests,observations,actorId:user.id,resumeIds:[middle.id,senior.id],bankVersion:final.bankVersion,declarationStackFixtureSeed:true,targetsViaOrdinaryApi:true,proofAndOldHistoryUnchanged:true,retainedForBrowser:true,privateCredentialFile:privateFile},null,2));
 success=true;console.log(JSON.stringify({status:'PASS',checks:checks.length,actorId:user.id,resumeIds:[middle.id,senior.id]}));
}finally{
 if(cookie)await request('/auth/logout','POST');
 if(!success && user){assert.ok(user.email.startsWith(prefix));await db.delete(users).where(eq(users.id,user.id));}
 await pool.end();
}
