/** Temporary UI ACL check on our retained synthetic CV only; ordinary owner API, exact DB/actor guards. */
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {eq,and} from 'drizzle-orm';
import {db,pool,signalUsersTable as users,signalCandidateResumesTable as resumes} from '../lib/db/src/index';
const target=new URL(process.env.DATABASE_URL!); assert.equal(target.pathname,'/signal_ui_refinement_20261008'); assert.equal(target.port,'55435'); assert.equal(process.env.PORT,'4371');
const mode=process.argv[2]; assert.ok(mode==='revoke'||mode==='restore');
const fixture=JSON.parse(await readFile('C:/Users/Misha/.codex/private/signal-senior-v4-http-actors-20261008.json','utf8'));
const actor=fixture.actors.find((a:any)=>a.id===1061); assert.ok(actor.email.startsWith(fixture.prefix));
const backup='C:/Users/Misha/.codex/private/signal-ui-preview-revocation-20261008.json'; const origin='http://127.0.0.1:4371/api';
let cookie='';
async function request(route:string,method='GET',body?:unknown){const response=await fetch(origin+route,{method,headers:{'Content-Type':'application/json',Origin:'http://signal-refinement.localhost:4372',...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});assert.equal(response.status,200,`${method} ${route} status`);if(route==='/auth/login')cookie=response.headers.getSetCookie()[0].split(';')[0];return response.status===204?null:response.json();}
try{
 const [user]=await db.select({email:users.email}).from(users).where(eq(users.id,1061));assert.equal(user.email,actor.email);
 const [row]=await db.select().from(resumes).where(and(eq(resumes.id,549),eq(resumes.userId,1061)));assert.ok(row&&!row.deletedAt);
 await request('/auth/login','POST',{email:actor.email,password:actor.password,role:'candidate'});
 if(mode==='revoke'){
  assert.equal(row.visibility,'public'); await writeFile(backup,JSON.stringify({actorId:1061,resumeId:549,visibility:row.visibility,consentCatalog:row.consentCatalog,consentMatching:row.consentMatching,oldRevision:row.revision}));
  await request('/me/resumes/549','PATCH',{revision:row.revision,visibility:'private'});
 }else{
  const before=JSON.parse(await readFile(backup,'utf8'));assert.equal(before.actorId,1061);assert.equal(before.resumeId,549);assert.equal(row.visibility,'private');
  await request('/me/resumes/549','PATCH',{revision:row.revision,visibility:before.visibility,consentCatalog:before.consentCatalog,consentMatching:before.consentMatching});
  const [after]=await db.select().from(resumes).where(eq(resumes.id,549)); for(const key of ['visibility','consentCatalog','consentMatching'] as const)assert.equal(after[key],before[key]);
 }
 console.log(JSON.stringify({passed:true,mode,actorId:1061,resumeId:549,ordinaryOwnerApi:true}));
}finally{if(cookie)await request('/auth/logout','POST');await pool.end();}
