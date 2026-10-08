import assert from 'node:assert/strict';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { randomUUID,randomBytes,createHash,scryptSync } from 'node:crypto';
import pg from '../lib/db/node_modules/pg/lib/index.js';
const env=Object.fromEntries((await readFile('C:/Users/Misha/.codex/private/signal-employer-e-20261008.env','utf8')).split(/\r?\n/).filter(x=>x&&!x.startsWith('#')).map(line=>{const i=line.indexOf('=');return[line.slice(0,i),line.slice(i+1).replace(/^"|"$/g,'')];}));
const database=new URL(env.DATABASE_URL);assert.equal(database.hostname,'127.0.0.1');assert.equal(database.port,'55435');assert.equal(database.pathname,'/signal_employer_e_20261008');
const base=JSON.parse(await readFile('C:/Users/Misha/.codex/private/signal-employer-e-20261008-fixtures.json','utf8'));
const qaLedger=JSON.parse(await readFile('C:/Users/Misha/.codex/private/signal-employer-e-20261008-http-de9d2537-1ac6-45a1-bff1-082205deca20.json','utf8'));
const owner=base.actors.find(a=>a.suffix==='owner'),foreign=base.actors.find(a=>a.suffix==='foreign'),main=base.actors.find(a=>a.suffix==='two'),qa=qaLedger.actors[0];
const qaResume=qa.resumeIds[0],mainResume=main.resumeIds[0],runId=randomUUID(),pool=new pg.Pool({connectionString:env.DATABASE_URL});
const origin='http://localhost:4413',appOrigin='http://signal-employer.localhost:4414';
const checks=[],receipts=[],actors=[];let passed=false,failure;
async function request(actor,path,method='GET',body){const start=performance.now();const response=await fetch(origin+'/api'+path,{method,headers:{Cookie:actor.cookie,Origin:appOrigin,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});const text=await response.text();let json;try{json=JSON.parse(text);}catch{}receipts.push({path,method,status:response.status,actorId:actor.id,durationMs:Math.round((performance.now()-start)*10)/10});return{status:response.status,json,text};}
async function ok(actor,path,method='GET',body,status=200){const result=await request(actor,path,method,body);assert.equal(result.status,status,`${method} ${path}: ${result.json?.error??''}`);return result.json;}
const query=input=>'/employer/selection?'+new URLSearchParams(Object.fromEntries(Object.entries(input).map(([key,value])=>[key,String(value)])));
const ids=result=>result.items.map(row=>row.candidateId);
function step(name){checks.push({name,status:'PASS'});}
async function profile(actor,resumeId,patch){const current=await ok(actor,`/me/candidate-profile?resumeId=${resumeId}`);return ok(actor,'/me/candidate-profile','PUT',{...current,resumeId,revision:current.revision,identityRevision:current.identityRevision,...patch});}
async function actorFixture(index){const token=randomBytes(32).toString('base64url'),password=randomBytes(24).toString('base64url'),salt=randomBytes(16).toString('hex'),email=`selection-E-${runId}-${index}@example.test`.toLowerCase();
  const user=(await pool.query("INSERT INTO signal_users(email,password_hash,role,display_name,email_verified,demo_mode) VALUES($1,$2,'candidate',$3,true,false) RETURNING id",[email,`scrypt:${salt}:${scryptSync(password,salt,64).toString('hex')}`,`Синтетический дополнительный специалист E ${index}`])).rows[0];
  await pool.query("INSERT INTO signal_sessions(token_hash,user_id,expires_at,demo_mode) VALUES($1,$2,now()+interval '7 days',false)",[createHash('sha256').update(token).digest('hex'),user.id]);
  const actor={id:user.id,email,password,cookie:'fsp_signal_session='+token,role:'candidate',suffix:'selection-'+index};
  const resume=(await ok(actor,'/me/resumes')).resumes[0];actor.resumeIds=[resume.id];
  await profile(actor,resume.id,{professionalAlias:`Дополнительный специалист E ${index}`,stack:['Python'],skills:['Rust'],visibility:'pseudonymous',consentMatching:true,consentCatalog:true,yearsExperience:index,salaryMin:100000+index*10000,salaryMax:200000+index*10000,workFormat:'Удалённо'});
  actors.push(actor);return actor;
}
try{
  await profile(qa,qaResume,{yearsExperience:3,consentMatching:true,consentCatalog:true,visibility:'pseudonymous',salaryMin:100000,salaryMax:200000});
  const current=await ok(qa,`/me/candidate-profile?resumeId=${qaResume}`);
  await ok(qa,`/me/resumes/${qaResume}/work-preferences`,'PATCH',{revision:current.revision,location:'Москва',schedule:'Полный день',employment:'Трудовой договор',relocation:false,startAvailability:'По договорённости'});
  const needBody={title:'Backend-разработчик фильтры E',specialization:'Backend / Python',grade:'Junior',requiredSkills:['Python'],requiredSkillLevels:{Python:'Junior'},desirableSkills:[],description:'Проверка единого подбора, целого CV и прав собственных синтетических профилей.',workFormat:'Удалённо',salaryMin:100000,salaryMax:200000,salaryPeriod:'month',salaryType:'gross'};
  let need=await ok(owner,'/employer/needs','POST',needBody,201);const context={type:'need',id:need.id},scope={contextType:'need',contextId:need.id};
  const filters={...scope,q:'HTTP специалист E',specialization:'Backend / Python',grade:'Junior',declaredSkills:'SQL',declaredSkillsMode:'all',verifiedSkills:'Python',verifiedSkillLevel:'Junior',verifiedSkillsMode:'all',experienceMin:3,workFormat:'Удалённо',location:'Москва',salaryMin:100000,salaryMax:200000,salaryPeriod:'month',salaryType:'gross',fsp:'no'};
  const result=await ok(owner,query(filters));assert.deepEqual(ids(result),[qa.id]);assert.equal(result.items[0].resumeId,qaResume);assert.equal(result.items[0].verifiedGrade,'Junior');assert.equal(result.items[0].salaryMin,100000);
  assert.equal((await ok(owner,query({...filters,salaryType:'net'}))).total,0);
  assert.equal((await ok(owner,query({...filters,verifiedSkillLevel:'Middle'}))).total,0);
  assert.equal((await request(owner,query({...filters,salaryPeriod:'invalid'}))).status,400);
  await ok(qa,'/me/fsp-connection','PUT',{fspId:'OWN-E-'+runId});assert.equal((await ok(owner,query({...filters,fsp:'yes'}))).total,0);await ok(qa,'/me/fsp-connection','DELETE');
  step('11 concrete filters select one exact qualified CV; mismatched net basis, stricter skill level and merely typed FSP ID do not satisfy them');
  const hiddenName='Синтетический HTTP специалист E';assert.equal((await ok(owner,query({q:hiddenName}))).total,0);
  const catalog=await ok(owner,query({})),matching=await ok(owner,query(scope));assert.ok(!ids(catalog).includes(main.id));assert.ok(ids(matching).includes(main.id));
  const catalogOnly=base.actors.find(a=>a.suffix==='one');assert.ok(ids(catalog).includes(catalogOnly.id));
  assert.equal((await request(owner,`/employer/selection/resumes/${mainResume}`)).status,404);
  assert.equal((await ok(owner,`/employer/selection/resumes/${mainResume}?contextType=need&contextId=${need.id}`)).candidate.resumeId,mainResume);
  assert.equal((await ok(owner,query({...scope,mode:'catalog'}))).items.some(item=>item.candidateId===main.id),false);
  step('Matching-only candidate appears only in matching purpose; catalogue and legacy catalogue-with-context retain their own consent pool; hidden true name is not searched');
  const alternate=await ok(qa,'/me/resumes','POST',{title:'Frontend-разработчик E отдельные условия',specialization:'Frontend / TypeScript'},201);qa.resumeIds.push(alternate.id);
  await profile(qa,alternate.id,{professionalAlias:'HTTP специалист E',stack:['TypeScript'],skills:['Rust'],visibility:'pseudonymous',consentMatching:true,consentCatalog:true,salaryMin:300000,salaryMax:400000,yearsExperience:7});
  const falseComposite=await ok(owner,query({q:'HTTP специалист E',specialization:'Backend / Python',salaryMin:300000,salaryMax:400000,salaryPeriod:'month',salaryType:'gross'}));assert.equal(falseComposite.total,0);
  const front=await ok(owner,query({q:'HTTP специалист E',specialization:'Frontend / TypeScript',salaryMin:300000,salaryMax:400000,salaryPeriod:'month',salaryType:'gross'}));assert.equal(front.items[0].resumeId,alternate.id);assert.equal(front.items[0].verifiedGrade,null);
  assert.equal((await ok(owner,query({q:'HTTP специалист E',specialization:'Frontend / TypeScript',verifiedSkills:'Rust'}))).total,0);
  step('Backend qualification and Frontend salary are never combined; selected alternate CV has its own unconfirmed grade, and stated Rust fails a verified filter');
  const extraA=await actorFixture(1),extraB=await actorFixture(2);
  const group=[mainResume,qaResume,extraA.resumeIds[0],extraB.resumeIds[0]];
  for(const size of [2,3,4]){const compared=await ok(owner,'/employer/selection/compare','POST',{context,resumeIds:group.slice(0,size)});assert.equal(compared.items.length,size);assert.equal(new Set(compared.items.map(row=>row.candidateId)).size,size);assert.ok(compared.items.every(row=>!JSON.stringify(row).includes('oracles')&&!JSON.stringify(row).includes('rubricVersion')));}
  await ok(owner,'/employer/selection/compare','POST',{context,resumeIds:[qaResume,alternate.id]},400);
  await ok(foreign,'/employer/selection/compare','POST',{context,resumeIds:group.slice(0,2)},404);
  await ok(foreign,query(scope),'GET',undefined,404);
  const globalCompare=await ok(owner,'/employer/selection/compare','POST',{context:null,resumeIds:[qaResume,extraA.resumeIds[0]]});assert.ok(globalCompare.items.every(row=>!('match' in row)));
  step('Compare works for 2–4 distinct people and global catalogue without fake match; same-owner CV duplication and foreign typed contexts are denied');
  await ok(owner,'/employer/shortlist','PUT',{context,candidateId:qa.id,resumeId:qaResume,contextVersion:need.revision});
  need=await ok(owner,`/employer/needs/${need.id}`,'PUT',{revision:need.revision,requiredSkills:['TypeScript'],requiredSkillLevels:{TypeScript:'Junior'}});
  const pinned=await ok(owner,query({...scope,view:'shortlisted'}));assert.equal(pinned.items[0].resumeId,qaResume);assert.equal(pinned.items[0].needsReview,true);assert.equal(pinned.items[0].match.eligible,false);assert.equal(pinned.total,1);
  step('After requirements change, saved exact CV stays pinned in shortlist with needsReview and ineligible match rather than being replaced or deleted');
  need=await ok(owner,`/employer/needs/${need.id}`,'PUT',{revision:need.revision,requiredSkills:['Python'],requiredSkillLevels:{Python:'Junior'}});
  for(const sort of ['grade','experience','salary','updated','name'])for(const direction of ['asc','desc']){const a=await ok(owner,query({sort,direction,pageSize:1,page:1})),b=await ok(owner,query({sort,direction,pageSize:1,page:2})),again=await ok(owner,query({sort,direction,pageSize:1,page:1}));assert.ok(a.total>=2);assert.equal(a.total,b.total);assert.notEqual(a.items[0].candidateId,b.items[0].candidateId);assert.deepEqual(ids(a),ids(again));}
  step('Both directions of five real sorts have stable totals, deterministic first page and no duplicate person across two pages');
  const pixel='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jS1kAAAAASUVORK5CYII=';
  await ok(qa,'/me/avatar','POST',{dataUrl:pixel});await profile(qa,qaResume,{visibility:'public'});
  const publicDetail=await ok(owner,`/employer/selection/resumes/${qaResume}?contextType=need&contextId=${need.id}`);assert.equal(publicDetail.candidate.avatarDataUrl,pixel);assert.equal(publicDetail.candidate.publicName,hiddenName);
  assert.ok((await ok(owner,query({q:hiddenName}))).items.some(row=>row.resumeId===qaResume));
  await profile(qa,qaResume,{visibility:'pseudonymous'});
  const anonymousDetail=await ok(owner,`/employer/selection/resumes/${qaResume}?contextType=need&contextId=${need.id}`);assert.equal(anonymousDetail.candidate.avatarDataUrl,null);assert.equal(anonymousDetail.candidate.publicName,null);
  const anonymousCompare=await ok(owner,'/employer/selection/compare','POST',{context,resumeIds:[qaResume,mainResume]});assert.equal(anonymousCompare.items.find(row=>row.candidateId===qa.id).avatarDataUrl,null);
  assert.equal((await ok(owner,query({q:hiddenName}))).total,0);
  step('Own synthetic photo/name appear only for public selected CV; identity flip immediately masks detail, comparison and true-name search');
  await profile(qa,qaResume,{consentMatching:false,consentCatalog:false});
  await ok(owner,`/employer/selection/resumes/${qaResume}?contextType=need&contextId=${need.id}`,'GET',undefined,404);
  await ok(owner,`/employer/selection/resumes/${qaResume}`,'GET',undefined,404);
  await ok(owner,'/employer/selection/compare','POST',{context,resumeIds:[qaResume,mainResume]},404);
  const revoked=await ok(owner,query({...scope,view:'shortlisted'}));assert.equal(revoked.total,0);assert.equal(revoked.unavailableShortlistCount,1);
  assert.equal((await ok(owner,`/employer/shortlist?contextType=need&contextId=${need.id}`)).items[0].candidate,null);
  await ok(owner,`/resumes/${qaResume}/document-preview`,'GET',undefined,404);
  await ok(owner,`/resumes/${qaResume}/document.pdf`,'GET',undefined,404);await ok(owner,`/resumes/${qaResume}/document.docx`,'GET',undefined,404);
  await profile(qa,qaResume,{consentMatching:true,consentCatalog:true});await ok(qa,'/me/avatar','DELETE');
  assert.equal((await ok(owner,`/employer/selection/resumes/${mainResume}?contextType=need&contextId=${need.id}`)).candidate.verifiedGrade,'Junior');
  step('Fresh dual revoke closes detail/catalogue/compare/shortlist fields and document exports; unrelated main matching-only fixture remains available for QA');
  passed=true;
}catch(error){failure=error.message;}
finally{await mkdir('outputs/verification/employer-workspace-E01-E16-20261008/backend',{recursive:true});const report=`outputs/verification/employer-workspace-E01-E16-20261008/backend/selection-http-${runId}.json`,privatePath=`C:/Users/Misha/.codex/private/signal-employer-e-20261008-selection-${runId}.json`;
  await writeFile(privatePath,JSON.stringify({synthetic:true,actors,qaActorId:qa.id,qaResumeIds:qa.resumeIds},null,2),{flag:'wx'});
  const durations=receipts.filter(r=>r.path.startsWith('/employer/selection')).map(r=>r.durationMs).sort((a,b)=>a-b);
  await writeFile(report,JSON.stringify({passed,failure,synthetic:true,checks,receipts,targetedTimingOnly:true,performanceGateNotClaimed:true,timings:{requests:durations.length,medianMs:durations[Math.floor(durations.length/2)],maxMs:durations.at(-1)},measuredAt:new Date().toISOString(),privateLedger:privatePath},null,2),{flag:'wx'});
  await pool.end();console.log(JSON.stringify({passed,checks:checks.length,failure,report,selectionRequests:durations.length,maxMs:durations.at(-1)}));}
if(!passed)process.exitCode=1;
