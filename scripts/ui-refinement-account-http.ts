/** U15: own bounded UUID fixtures, isolated DB/API; no other actor or production source mutation. */
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {eq,and,inArray} from 'drizzle-orm';
import {db,pool,signalUsersTable as users,signalSessionsTable as sessions,signalCandidateProfilesTable as profiles} from '../lib/db/src/index';
const target=new URL(process.env.DATABASE_URL!);assert.equal(target.pathname,'/signal_ui_refinement_20261008');assert.equal(target.port,'55435');assert.ok(['localhost','127.0.0.1'].includes(target.hostname));assert.equal(process.env.PORT,'4371');assert.equal(process.env.SIGNAL_WORKSPACE_ENABLED,'true');
const origin='http://127.0.0.1:4371',appOrigin='http://localhost:4372',prefix=`ui-account-${randomUUID()}-`,owned:number[]=[],checks:string[]=[],requests:any[]=[],observations:any={};
const directory='outputs/verification/ui-refinement-20261008/account';await mkdir(directory,{recursive:true});
const runLabel=process.argv[2]??'iteration01';assert.match(runLabel,/^[a-zA-Z0-9_-]+$/);
let failure:string|null=null;
type Actor={id:number;cookie:string;email:string;displayName:string;alias:string|null;createdAt:string;verified:boolean};
const hash=(data:string|Buffer)=>createHash('sha256').update(data).digest('hex');
async function session(userId:number,options:{expiresAt?:Date;demoMode?:boolean}={}){const token=randomBytes(32).toString('base64url');await db.insert(sessions).values({userId,tokenHash:hash(token),expiresAt:options.expiresAt??new Date(Date.now()+1800000),demoMode:options.demoMode??false});return `fsp_signal_session=${token}`;}
async function actor(role:'candidate'|'employer',label:string,verified=true):Promise<Actor>{
 const displayName=`Тестовый ${label} аккаунт`,email=`${prefix}${label}@example.test`,createdAt=new Date('2026-10-01T12:34:56.000Z');
 const [user]=await db.insert(users).values({role,email,displayName,passwordHash:'unusable-owned-account-fixture-only',emailVerified:verified,demoMode:false,createdAt}).returning();owned.push(user.id);
 const alias=role==='candidate'?`Псевдоним ${label}`:null;if(alias)await db.insert(profiles).values({userId:user.id,professionalAlias:alias,contactEmail:`contact-${email}`,phone:'+79990001122'});
 return {id:user.id,email,displayName,alias,createdAt:user.createdAt.toISOString(),verified,cookie:await session(user.id)};
}
async function request(actor:Actor|null,path:string,method='GET',body?:unknown,cookieOverride?:string){
 const response=await fetch(`${origin}/api${path}`,{method,headers:{Origin:appOrigin,...(actor||cookieOverride?{Cookie:cookieOverride??actor!.cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(10000)});
 const text=await response.text(),json=text&&response.headers.get('content-type')?.includes('json')?JSON.parse(text):null;
 requests.push({actorId:actor?.id??null,path,method,status:response.status,bytes:Buffer.byteLength(text)});return {status:response.status,json,text,headers:Object.fromEntries(response.headers)};
}
async function ok(actor:Actor|null,path:string,method='GET',body?:unknown,status=200,cookieOverride?:string){const result=await request(actor,path,method,body,cookieOverride);assert.equal(result.status,status,`${method} ${path}: ${JSON.stringify(result.json)}`);return result;}
const keys=['id','displayName','email','emailVerified','role','demoMode','reviewMode','createdAt','professionalAlias'].sort();
function dto(value:any,actor:Actor){assert.deepEqual(Object.keys(value).sort(),keys);assert.equal(value.id,actor.id);assert.equal(value.email,actor.email);assert.equal(value.emailVerified,actor.verified);assert.equal(value.createdAt,actor.createdAt);assert.equal(value.demoMode,false);assert.equal(value.reviewMode,false);for(const key of ['passwordHash','tokenHash','reviewScopeId','phone','contactEmail'])assert.equal(key in value,false);}
async function stored(actor:Actor){const [user]=await db.select().from(users).where(eq(users.id,actor.id));const [profile]=await db.select().from(profiles).where(eq(profiles.userId,actor.id));assert.ok(user?.email.startsWith(prefix));return {name:user.displayName,alias:profile?.professionalAlias??null,email:user.email,verified:user.emailVerified,createdAt:user.createdAt.toISOString()};}
try{
 const owner=await actor('candidate','владелец'),foreign=await actor('candidate','чужой'),employer=await actor('employer','работодатель'),unverified=await actor('candidate','неподтвержденный',false);
 observations.ownedIds=[...owned];
 const initial=await ok(owner,'/me/account');dto(initial.json,owner);assert.equal(initial.json.displayName,owner.displayName);assert.equal(initial.json.professionalAlias,owner.alias);assert.equal(initial.headers['cache-control'],'no-store');observations.initialOwner=initial.json;
 const employerResult=await ok(employer,'/me/account');dto(employerResult.json,employer);assert.equal(employerResult.json.professionalAlias,null);
 checks.push('Owner account DTO has exact actual email/emailVerified/createdAt, candidate alias and employer null alias; no password/session/pool/profile contacts; GET no-store');
 await ok(null,'/me/account','GET',undefined,401);await ok(null,'/me/account','PATCH',{displayName:'Чужая попытка',expectedDisplayName:owner.displayName},401);
 await ok(owner,'/me/account','GET',undefined,401,'fsp_signal_session=invalid-owned-test-token');
 await ok(unverified,'/me/account','GET',undefined,401);assert.equal((await db.select().from(sessions).where(eq(sessions.userId,unverified.id))).length,0);
 const expired=await session(owner.id,{expiresAt:new Date(Date.now()-1000)});await ok(owner,'/me/account','GET',undefined,401,expired);
 const mismatched=await session(owner.id,{demoMode:true});await ok(owner,'/me/account','GET',undefined,401,mismatched);assert.equal((await db.select().from(sessions).where(eq(sessions.tokenHash,hash(mismatched.split('=')[1]!)))).length,0);
 checks.push('Anonymous/invalid/expired/unverified/mismatched-pool sessions deny 401 without account leaks; unverified/mismatched session revoked');
 const foreignView=await ok(foreign,`/me/account?userId=${owner.id}&id=${owner.id}`);dto(foreignView.json,foreign);assert.ok(!foreignView.text.includes(owner.email));assert.ok(!foreignView.text.includes(owner.displayName));
 await ok(foreign,`/me/account/${owner.id}`,'GET',undefined,404);
 const initialStored=await stored(owner);
 for(const extra of [{email:'forged@example.test'},{emailVerified:false},{createdAt:'2099-01-01T00:00:00Z'},{role:'employer'},{id:foreign.id},{userId:foreign.id},{expectedEmail:owner.email},{passwordHash:'forged'}])await ok(owner,'/me/account','PATCH',{displayName:'Попытка подмены',expectedDisplayName:owner.displayName,...extra},400);
 await ok(foreign,'/me/account','PATCH',{displayName:'Попытка чужого изменения',expectedDisplayName:owner.displayName,userId:owner.id},400);assert.deepEqual(await stored(owner),initialStored);
 checks.push('Foreign query/path/body cannot select another account; strict whitelist rejects email/emailVerified/createdAt/role/id/userId/expectedEmail/passwordHash 400 and preserves rows');
 const updated=await ok(owner,'/me/account','PATCH',{displayName:'  Алексей Сергеевич Соколов  ',expectedDisplayName:owner.displayName,professionalAlias:'  Инженер сервисов  ',expectedProfessionalAlias:owner.alias});dto(updated.json,owner);assert.equal(updated.json.displayName,'Алексей Сергеевич Соколов');assert.equal(updated.json.professionalAlias,'Инженер сервисов');assert.equal(updated.headers['cache-control'],'no-store');
 const stable={name:'Алексей Сергеевич Соколов',alias:'Инженер сервисов',email:owner.email,verified:true,createdAt:owner.createdAt};assert.deepEqual(await stored(owner),stable);
 const fresh=await session(owner.id);const reload=await ok(owner,'/me/account','GET',undefined,200,fresh);assert.deepEqual(reload.json,updated.json);observations.persistedOwner=reload.json;
 checks.push('Name and alias trimmed, updated atomically with expected values, persisted in actual rows and fresh session GET; PATCH no-store');
 const stale=await ok(owner,'/me/account','PATCH',{displayName:'Устаревшее имя',expectedDisplayName:owner.displayName,professionalAlias:'Устаревший псевдоним',expectedProfessionalAlias:owner.alias},409);assert.equal(stale.json.code,'account_revision_conflict');
 await ok(owner,'/me/account','PATCH',{displayName:'Имя при ошибочном alias',expectedDisplayName:stable.name,professionalAlias:'Новый псевдоним',expectedProfessionalAlias:owner.alias},409);assert.deepEqual(await stored(owner),stable);
 for(const invalid of [{displayName:'',expectedDisplayName:stable.name},{displayName:'  ',expectedDisplayName:stable.name},{displayName:'x'.repeat(121),expectedDisplayName:stable.name},{displayName:'Другое имя',expectedDisplayName:stable.name,professionalAlias:'Одинокий alias'},{displayName:'Другое имя',expectedDisplayName:stable.name,expectedProfessionalAlias:stable.alias}])await ok(owner,'/me/account','PATCH',invalid,400);
 await ok(employer,'/me/account','PATCH',{displayName:'Имя работодателя',expectedDisplayName:employer.displayName,professionalAlias:'Неподходящий псевдоним',expectedProfessionalAlias:''},409);assert.equal((await stored(employer)).name,employer.displayName);
 checks.push('Stale expected name/alias returns exact 409 code and no partial changes; invalid/bounds/unpaired alias 400; employer alias cannot mutate account');
 const competing=await Promise.all(['Первая конкурентная запись','Вторая конкурентная запись'].map(displayName=>request(owner,'/me/account','PATCH',{displayName,expectedDisplayName:stable.name,professionalAlias:`Alias ${displayName}`,expectedProfessionalAlias:stable.alias})));
 assert.deepEqual(competing.map(result=>result.status).sort(),[200,409]);const winner=competing.find(result=>result.status===200)!;assert.deepEqual((await ok(owner,'/me/account')).json,winner.json);assert.equal((await stored(owner)).name,winner.json.displayName);assert.equal((await stored(owner)).alias,winner.json.professionalAlias);
 checks.push('Two concurrent writes with identical expected state produce one committed 200 and one 409, consistent name/alias on reload');
 const foreignAfter=await ok(foreign,'/me/account');dto(foreignAfter.json,foreign);assert.equal(foreignAfter.json.displayName,foreign.displayName);assert.equal(foreignAfter.json.professionalAlias,foreign.alias);assert.ok(!foreignAfter.text.includes(owner.email));assert.ok(!foreignAfter.text.includes(winner.json.displayName));
 await ok(owner,'/auth/logout','POST',{},200);await ok(owner,'/me/account','GET',undefined,401);await ok(owner,'/me/account','PATCH',{displayName:'После выхода',expectedDisplayName:winner.json.displayName},401);
 checks.push('Foreign account remains isolated throughout owner edits; logout denies reused session for GET/PATCH');
}catch(error){failure=(error as Error).stack??String(error);process.exitCode=1;}
finally{
 const rows=owned.length?await db.select({id:users.id,email:users.email}).from(users).where(inArray(users.id,owned)):[];assert.equal(rows.length,owned.length);assert.ok(rows.every(row=>row.email.startsWith(prefix)));
 if(owned.length)await db.delete(users).where(and(inArray(users.id,owned)));const remaining=owned.length?(await db.select({id:users.id}).from(users).where(inArray(users.id,owned))).length:0;
 const remainingSessions=owned.length?(await db.select({userId:sessions.userId}).from(sessions).where(inArray(sessions.userId,owned))).length:0;
 const receipt={status:failure===null&&remaining===0&&remainingSessions===0?'PASS':'FAIL',checkedAt:new Date().toISOString(),runLabel,origin,db:target.pathname,scope:'Actual HTTP U15 own account with disposable synthetic actors only',checks,requests,observations,failure,cleanup:{ownedIds:owned,remaining,remainingSessions,exactIdAndPrefixGuard:true},sourceSha256:hash(await readFile('artifacts/api-server/src/routes/signal-auth.ts')),bundleSha256:hash(await readFile('artifacts/api-server/dist/index.mjs')),limits:['Synthetic transport/API validation; visual account interaction is checked separately by root.','No root UI actor, accepted user, existing source/historical evidence, qualification, or proof mutated.','The DTO requires an authenticated verified user; unverified session is denied rather than exposing an unverified account DTO.']};
 await writeFile(`${directory}/http-${runLabel}.json`,JSON.stringify(receipt,null,2));console.log(JSON.stringify({status:receipt.status,checks:checks.length,failure,cleanup:receipt.cleanup}));await pool.end();
}
