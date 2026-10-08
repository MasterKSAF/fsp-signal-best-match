/** U07/U08/U09: own bounded UUID fixtures only, isolated DB and API. No user grade/proof writes. */
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {eq,inArray} from 'drizzle-orm';
import {db,pool,signalUsersTable as users,signalSessionsTable as sessions,signalCandidateProfilesTable as profiles,signalCandidateResumesTable as resumes,signalCompaniesTable as companies,signalNeedsTable as needs,signalInvitationsTable as invitations,signalContactGrantsTable as grants,signalResumeWorkPreferencesTable as preferences} from '../lib/db/src/index';
import {emptyResume} from '../artifacts/api-server/src/lib/signal-resume-contract';
const dbTarget=new URL(process.env.DATABASE_URL!);assert.equal(dbTarget.pathname,'/signal_ui_refinement_20261008');assert.equal(dbTarget.port,'55435');assert.ok(['localhost','127.0.0.1'].includes(dbTarget.hostname));assert.equal(process.env.PORT,'4371');assert.equal(process.env.SIGNAL_WORKSPACE_ENABLED,'true');
const origin='http://127.0.0.1:4371',appOrigin='http://localhost:4372',prefix=`ui-export-${randomUUID()}-`,owned:number[]=[],checks:string[]=[],requests:any[]=[],observations:any={};
const directory='outputs/verification/ui-refinement-20261008/documents-http';await mkdir(directory,{recursive:true});
let failure:string|null=null;
type Actor={id:number;cookie:string;email:string;companyId?:number};
async function actor(role:'candidate'|'employer',label:string):Promise<Actor>{
 const email=`${prefix}${label}@example.test`;const [user]=await db.insert(users).values({role,email,displayName:role==='candidate'?'Кирилл Сергеевич Орлов':`Представитель ${label}`,passwordHash:'unusable-ui-export-own-fixture',emailVerified:true,demoMode:false}).returning();owned.push(user.id);
 const token=randomBytes(32).toString('base64url');await db.insert(sessions).values({userId:user.id,tokenHash:createHash('sha256').update(token).digest('hex'),expiresAt:new Date(Date.now()+1800000),demoMode:false});
 let companyId:number|undefined;if(role==='candidate')await db.insert(profiles).values({userId:user.id,professionalAlias:'Инженер сервисов',phone:'+79991112233',contactEmail:email});else{const [company]=await db.insert(companies).values({ownerUserId:user.id,name:`Компания ${label}`,contactEmail:email}).returning();companyId=company.id;}
 return {id:user.id,email,cookie:`fsp_signal_session=${token}`,companyId};
}
async function request(actor:Actor|null,path:string,method='GET',body?:unknown){
 const response=await fetch(`${origin}/api${path}`,{method,headers:{Origin:appOrigin,...actor?{Cookie:actor.cookie}:{},...body?{'Content-Type':'application/json'}:{}},...body?{body:JSON.stringify(body)}:{},signal:AbortSignal.timeout(15000)});
 const bytes=Buffer.from(await response.arrayBuffer());const json=bytes.length&&response.headers.get('content-type')?.includes('json')?JSON.parse(bytes.toString('utf8')):null;
 requests.push({actorId:actor?.id??null,path,method,status:response.status,bytes:bytes.length});return {status:response.status,bytes,json,headers:Object.fromEntries(response.headers)};
}
const ok=async(actor:Actor|null,path:string,method='GET',body?:unknown,status=200)=>{const response=await request(actor,path,method,body);assert.equal(response.status,status,`${method} ${path}: ${JSON.stringify(response.json)}`);return response;};
const cvHash=(row:unknown)=>createHash('sha256').update(JSON.stringify(row)).digest('hex');
const fields=['contacts','salary','conditions','summary','skills','experience','projects','education','portfolio','softSkills'];
const compose=(chosen:string[])=>`?fields=${encodeURIComponent(chosen.join(','))}`;
const suffixes=['document-preview','preview.pdf','document.pdf','document.docx'];
const store=async(name:string,response:Awaited<ReturnType<typeof request>>)=>writeFile(`${directory}/${name}`,response.bytes);
try{
 const owner=await actor('candidate','owner'),a=await actor('employer','a'),b=await actor('employer','b'),foreign=await actor('candidate','foreign');
 observations.ownerEmail=owner.email;observations.actors=owned;
 const [resume]=await db.insert(resumes).values({...emptyResume(),userId:owner.id,isPrimary:true,title:'Авторская должность инженера',specialization:'Backend / Python',visibility:'pseudonymous',consentCatalog:true,consentMatching:false,stack:['Python','SQL','PostgreSQL'],skills:['python','FastAPI'],yearsExperience:6,salaryMin:1200000,salaryMax:1800000,salaryPeriod:'year',salaryType:'gross',summary:`Кирилл Сергеевич Орлов. ${owner.email} +79991112233 @privateorlov https://t.me/privateorlov`,experience:[{company:'ОпытТолько',role:'Разработчик',start:'2020-01',end:'2024-12',description:'Разработка API. Альтернативный телефон +7 999 444 55 66.'}],projects:[{title:'ПроектТолько',role:'Автор',description:'Доставка событий.',url:'https://export-private.example.test/owner'}],education:[{institution:'ОбразованиеТолько',qualification:'Информатика',start:'2014',end:'2018'}],portfolio:[{title:'Личные работы',url:'https://export-private.example.test/owner'}]}).returning();observations.resumeId=resume.id;
 await db.insert(preferences).values({resumeId:resume.id,location:'ЛокацияТолько',schedule:'Гибкий',employment:'Проект',relocation:true,startAvailability:'Через неделю'});
 const [sibling]=await db.insert(resumes).values({...emptyResume(),userId:owner.id,title:'Скрытый соседний документ',specialization:'Frontend / TypeScript',visibility:'private'}).returning();observations.siblingResumeId=sibling.id;
 const stats=async()=>{await new Promise(resolve=>setTimeout(resolve,100));return (await ok(owner,'/me/resumes')).json.resumes.find((row:any)=>row.id===resume.id).analytics;};
 const masked=(model:any)=>{for(const value of [owner.email,'79991112233','999 444 55 66','privateorlov','export-private.example.test','Орлов','Кирилл','Сергеевич'])assert.ok(!JSON.stringify(model).includes(value),value);};
 await ok(owner,'/me/resumes');const before=(await db.select().from(resumes).where(eq(resumes.id,resume.id)))[0];observations.cvBeforeHash=cvHash(before);
 for(const who of [null,foreign])for(const suffix of suffixes)await ok(who,`/resumes/${resume.id}/${suffix}${compose(fields)}`,'GET',undefined,who?404:401);
 for(const invalid of ['contacts,admin','*','contacts,'])await ok(owner,`/resumes/${resume.id}/document-preview?fields=${encodeURIComponent(invalid)}`,'GET',undefined,400);
 await ok(owner,`/resumes/${resume.id}/document-preview?fields=contacts&fields=salary`,'GET',undefined,400);
 checks.push('Four document routes keep auth/exact CV ACL; unknown and repeated-array composition rejects 400');
 const restricted=(await ok(a,`/resumes/${resume.id}/document-preview${compose(fields)}`)).json;masked(restricted);assert.equal(restricted.contactsAllowed,false);assert.equal(restricted.contactsPermitted,false);assert.ok(!restricted.composition.includes('contacts'));assert.ok(JSON.stringify(restricted).includes('от 1200000 до 1800000 ₽ / год'));
 for(const suffix of ['document.pdf','document.docx']){const head=await ok(a,`/resumes/${resume.id}/${suffix}${compose(fields)}`,'HEAD');assert.equal(head.bytes.length,0);}
 const inline=await ok(a,`/resumes/${resume.id}/preview.pdf${compose(fields)}`);await store('restricted-all.pdf',inline);assert.equal(inline.headers['x-frame-options'],'SAMEORIGIN');
 const ownerNoContacts=fields.filter(field=>field!=='contacts');const ownerProjection=(await ok(owner,`/resumes/${resume.id}/document-preview${compose(ownerNoContacts)}`)).json;
 assert.equal(ownerProjection.contactsAllowed,false);assert.equal(ownerProjection.contactsPermitted,true);assert.equal(ownerProjection.name,'Кирилл Сергеевич Орлов');for(const value of [owner.email,'79991112233','privateorlov','export-private.example.test'])assert.ok(!JSON.stringify(ownerProjection).includes(value));
 for(const ext of ['pdf','docx'])await store(`owner-no-contacts.${ext}`,await ok(owner,`/resumes/${resume.id}/document.${ext}${compose(ownerNoContacts)}`));
 const empty=(await ok(owner,`/resumes/${resume.id}/document-preview?fields=`)).json;assert.equal(empty.sections.length,1);assert.deepEqual(empty.composition,[]);
 assert.equal((await stats()).views,0);assert.equal((await stats()).downloads,0);
 checks.push('JSON/inline PDF/HEAD/owner downloads remain zero events; owner contact opt-out redacts all strings/links but preserves identity and 7-digit salary');
 const selected=['salary','skills','projects'];observations.selectedFields=selected;const selectedModel=(await ok(a,`/resumes/${resume.id}/document-preview${compose(selected)}`)).json;masked(selectedModel);assert.deepEqual(selectedModel.sections.map((section:any)=>section.title),['Профессиональный профиль','Навыки','Зарплатные ожидания','Проект']);
 await writeFile(`${directory}/selected-model.json`,JSON.stringify(selectedModel,null,2));
 for(const ext of ['pdf','docx'])await store(`restricted-selected.${ext}`,await ok(a,`/resumes/${resume.id}/document.${ext}${compose(selected)}`));
 for(const ext of ['pdf','docx'])await ok(a,`/resumes/${resume.id}/document.${ext}${compose(fields)}`);
 assert.equal((await stats()).downloads,1);assert.equal((await stats()).views,0);
 const after=(await db.select().from(resumes).where(eq(resumes.id,resume.id)))[0];observations.cvAfterHash=cvHash(after);assert.equal(observations.cvAfterHash,observations.cvBeforeHash);
 checks.push('Same selected server composition serves HTML/PDF/DOCX; exclusions work, export never changes original CV; changing fields/format deduplicates employer downloads');
 const current=(await ok(owner,'/me/resumes')).json.resumes.find((row:any)=>row.id===resume.id);await ok(owner,`/me/resumes/${resume.id}`,'PATCH',{revision:current.revision,visibility:'private'});
 const [need]=await db.insert(needs).values({companyId:a.companyId!,title:'Сервисы',description:'Контекст собственной ACL-фикстуры',specialization:'Backend / Python',grade:'Junior',requiredSkills:['Python'],desirableSkills:[],workFormat:'Удалённо',salaryMin:100000,salaryMax:150000,salaryPeriod:'month',salaryType:'gross'}).returning();
 const [invitation]=await db.insert(invitations).values({needId:need.id,companyId:a.companyId!,candidateUserId:owner.id,resumeId:resume.id,title:'Сервисы',message:'Адресное разрешение',reason:'Собственная проверка ACL',salaryMin:100000,salaryMax:150000,salaryPeriod:'month',salaryType:'gross',workFormat:'Удалённо',status:'accepted'}).returning();
 await db.insert(grants).values({invitationId:invitation.id,candidateUserId:owner.id,companyId:a.companyId!});
 const grantModel=(await ok(a,`/resumes/${resume.id}/document-preview${compose(fields)}`)).json;assert.equal(grantModel.contactsAllowed,true);assert.ok(JSON.stringify(grantModel).includes(owner.email));
 const limitedGrant=(await ok(a,`/resumes/${resume.id}/document-preview${compose(ownerNoContacts)}`)).json;assert.equal(limitedGrant.contactsAllowed,false);assert.equal(limitedGrant.contactsPermitted,true);for(const secret of [owner.email,'79991112233','privateorlov','export-private.example.test'])assert.ok(!JSON.stringify(limitedGrant).includes(secret));
 for(const ext of ['pdf','docx'])await store(`granted-a-selected.${ext}`,await ok(a,`/resumes/${resume.id}/document.${ext}${compose(ownerNoContacts)}`));
 for(const suffix of suffixes)for(const target of [b])await ok(target,`/resumes/${resume.id}/${suffix}${compose(fields)}`,'GET',undefined,404);
 for(const suffix of suffixes)await ok(a,`/resumes/${sibling.id}/${suffix}${compose(fields)}`,'GET',undefined,404);
 await ok(owner,`/me/invitations/${invitation.id}/revoke-contact`,'POST',{});
 for(const suffix of suffixes)for(const selectedFields of [fields,selected,ownerNoContacts,[]])for(const method of ['GET','HEAD'])await ok(a,`/resumes/${resume.id}/${suffix}${compose(selectedFields)}`,method,undefined,404);
 assert.equal((await stats()).downloads,1);assert.equal((await stats()).views,0);
 checks.push('Employer may only narrow exact addressed document; B/sibling deny; ordinary revoke closes every previous field set and HEAD/GET URL immediately, no extra counters');
 const copy=await ok(owner,`/me/resumes/${resume.id}/copy`,'POST',{},201);assert.ok(copy.json.title.includes('Авторская должность инженера'));assert.equal(copy.json.visibility,'private');assert.equal(copy.json.consentCatalog,false);assert.equal(copy.json.consentMatching,false);
 while((await ok(owner,'/me/resumes')).json.resumes.length<5)await ok(owner,'/me/resumes','POST',{title:'ML-инженер',specialization:'Backend / Python'},201);
 await ok(owner,`/me/resumes/${resume.id}/copy`,'POST',{},409);await ok(owner,'/me/resumes','POST',{title:'AI-инженер',specialization:'Backend / Python'},409);
 checks.push('Create-copy preserves custom title and resets visibility/consents; both copy and creation enforce maximum five server-side');
}catch(error){failure=(error as Error).stack??String(error);process.exitCode=1;}
finally{
 const stored=owned.length?await db.select({id:users.id,email:users.email}).from(users).where(inArray(users.id,owned)):[];assert.ok(stored.every(row=>row.email.startsWith(prefix)));
 if(owned.length)await db.delete(users).where(inArray(users.id,owned));const remaining=owned.length?(await db.select({id:users.id}).from(users).where(inArray(users.id,owned))).length:0;
 const receipt={status:failure===null&&remaining===0?'PASS':'FAIL',checkedAt:new Date().toISOString(),origin,db:dbTarget.pathname,prefix,checks,requests,observations,failure,cleanup:{ownedIds:owned,remaining,exactIdAndPrefixGuard:true},limits:['Addressed permission uses own accepted-invitation fixture; ordinary revoke API tested. This is not a new invitation/matching acceptance.','No complex or module grade, attempt, answer or proof inserted/updated.','Browser settings/cache/revocation display tested separately by root.']};
 await writeFile(`${directory}/http.json`,JSON.stringify(receipt,null,2));console.log(JSON.stringify({status:receipt.status,checks:checks.length,failure,cleanup:receipt.cleanup}));await pool.end();
}
