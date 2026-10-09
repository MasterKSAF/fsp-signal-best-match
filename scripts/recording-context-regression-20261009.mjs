/** Narrow R07/R08/R09/R11 real-HTTP regression on a NEW review scope only.
 * Default: plan. --apply runtimePath sha256 requires the controller's GO DB.
 * A private stage journal permits resuming a failed stage without duplicate data.
 */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, open, rename, unlink } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes, randomUUID, scryptSync } from 'node:crypto';
import pg from '../lib/db/node_modules/pg/lib/index.js';
const project=resolve(dirname(fileURLToPath(import.meta.url)),'..'),lct=resolve(project,'..');
const output=resolve(lct,'outputs/signal-recording-release-20261009/implementation/workspaces/http');
const privatePath='C:/Users/Misha/.codex/private/signal-recording-n01-n20-20261009/context-regression.json';
const base='http://127.0.0.1:4423/api',origin='http://signal-recruiting.localhost:4424',database='signal_employer_e_20261008';
if(process.argv[2]!=='--apply'){console.log(JSON.stringify({plan:true,scope:'New reviewScope: candidate, employer, foreign employer; R07/R08/R09/R11. No demo/old history writes.'}));process.exit(0);}
assert.equal(process.argv.length,5);const runtimePath=resolve(process.argv[3]),runtimeSha256=process.argv[4];
assert.ok(runtimePath.replaceAll('\\','/').toLowerCase().startsWith(resolve(project,'outputs/verification/recording-finalization-20261009').replaceAll('\\','/').toLowerCase()+'/'));
assert.equal(createHash('sha256').update(await readFile(runtimePath)).digest('hex'),runtimeSha256);
const env=Object.fromEntries((await readFile('C:/Users/Misha/.codex/private/signal-employer-e-20261008.env','utf8')).split(/\r?\n/).filter(v=>v&&!v.startsWith('#')).map(v=>{const i=v.indexOf('=');return[v.slice(0,i),v.slice(i+1).replace(/^"|"$/g,'')];}));
const target=new URL(env.DATABASE_URL);assert.equal(target.hostname,'127.0.0.1');assert.equal(target.port,'55435');assert.equal(target.pathname,'/'+database);
await mkdir(output,{recursive:true});await mkdir(dirname(privatePath),{recursive:true});const lock=await open(privatePath+'.lock','wx',0o600);
const pool=new pg.Pool({connectionString:env.DATABASE_URL,max:1});let j,failure,passed=false;const at=new Date().toISOString();
async function save(){await writeFile(privatePath+'.tmp',JSON.stringify(j,null,2),{mode:0o600});await rename(privatePath+'.tmp',privatePath);}
function check(name,value,details={}){assert.ok(value,name);j.checks.push({name,passed:true,...details});}
async function api(actor,path,method='GET',body,status=200){
  const r=await fetch(base+path,{method,headers:{Origin:origin,...(actor?.cookie?{Cookie:actor.cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
  const data=await r.json();j.requests.push({actorId:actor?.id??null,path,method,status:r.status});
  assert.ok((Array.isArray(status)?status:[status]).includes(r.status),`${method} ${path} HTTP ${r.status}, ${data?.code??'no-code'}`);
  if(path==='/auth/login'){assert.equal(data.user.id,actor.id);actor.cookie=r.headers.get('set-cookie').split(';')[0];await save();}return data;
}
async function once(key,fn){if(j.stages[key]?.done)return j.stages[key].value;j.currentStage=key;await save();const value=await fn();j.stages[key]={done:true,value,at:new Date().toISOString()};await save();return value;}
const terms={specialization:'Backend / Python',grade:'Middle',gradeMode:'declared_or_verified',workFormat:'Удалённо',salaryMin:160000,salaryMax:220000,salaryPeriod:'month',salaryType:'gross'};
const requirement=[{skill:'Python',mode:'declared_or_verified'}];
try{
  assert.equal((await pool.query('SELECT current_database() AS name')).rows[0].name,database);
  try{j=JSON.parse(await readFile(privatePath,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;const id=randomUUID(),scope=randomUUID();j={synthetic:true,runId:id,scope,database,createdAt:at,stages:{},checks:[],requests:[],actors:[['candidate','candidate'],['owner','employer'],['foreign','employer']].map(([key,role])=>({key,role,scope,name:'Проверка контекстов '+key,email:`recording-context-${id}-${key}@example.test`,password:randomBytes(24).toString('base64url')}))};await save();}
  assert.equal(j.synthetic,true);assert.equal(j.database,database);assert.equal(j.actors.length,3);
  for(const actor of j.actors){
    assert.equal(actor.scope,j.scope);assert.ok(actor.email.startsWith(`recording-context-${j.runId}-`));
    let row=(await pool.query('SELECT id,role,demo_mode,review_scope_id FROM signal_users WHERE email=$1',[actor.email])).rows[0];
    if(!row){assert.equal(actor.id,undefined);const salt=randomBytes(16).toString('hex');row=(await pool.query('INSERT INTO signal_users(email,password_hash,role,display_name,email_verified,demo_mode,review_scope_id) VALUES($1,$2,$3,$4,true,true,$5) RETURNING id,role,demo_mode,review_scope_id',[actor.email,`scrypt:${salt}:${scryptSync(actor.password,salt,64).toString('hex')}`,actor.role,actor.name,actor.scope])).rows[0];await pool.query("INSERT INTO signal_consents(user_id,consent_type,version) VALUES($1,'terms','2026-10-09-context-synthetic'),($1,'privacy','2026-10-09-context-synthetic')",[row.id]);}
    assert.equal(row.demo_mode,true);assert.equal(row.review_scope_id,j.scope);assert.equal(row.role,actor.role);if(actor.id)assert.equal(actor.id,row.id);actor.id=row.id;await save();
    if(actor.role==='employer'){actor.companyId=(await pool.query('INSERT INTO signal_companies(owner_user_id,name,contact_email) VALUES($1,$2,$3) ON CONFLICT(owner_user_id) DO UPDATE SET owner_user_id=excluded.owner_user_id RETURNING id',[actor.id,actor.name,actor.email])).rows[0].id;await save();}
    await api(actor,'/auth/login','POST',{email:actor.email,password:actor.password});
  }
  const [candidate,owner,foreign]=j.actors;
  const cv1=await once('cv1',async()=>{const cv=(await api(candidate,'/me/resumes')).resumes[0];return {id:cv.id};});
  const cv2=await once('cv2',async()=>{const all=(await api(candidate,'/me/resumes')).resumes;const found=all.find(row=>row.title==='Второе резюме для проверки контекста');return found??api(candidate,'/me/resumes','POST',{title:'Второе резюме для проверки контекста',specialization:'Backend / Python'},201);});
  for(const cv of [cv1,cv2])await once('profile-'+cv.id,async()=>{const old=await api(candidate,`/me/candidate-profile?resumeId=${cv.id}`);await api(candidate,'/me/candidate-profile','PUT',{...old,resumeId:cv.id,revision:old.revision,identityRevision:old.identityRevision,assumedGrade:'Middle',skills:['Python','SQL'],stack:['Python','SQL'],visibility:'public',consentMatching:true,consentCatalog:true,readyForOffers:true,workFormat:'Удалённо',salaryMin:160000,salaryMax:220000,salaryPeriod:'month',salaryType:'gross'});return {id:cv.id};});
  async function createContext(actor,type,key){return once(key,async()=>{const path=type==='job'?'/employer/jobs':'/employer/needs';const title=(type==='need'?'PRIVATE-CONTEXT-':'QA-context-')+j.runId+'-'+key;const list=await api(actor,path);let row=list.find(x=>x.title===title);if(!row)row=await api(actor,path,'POST',{...terms,title,description:'Описание собственного проверочного контекста. Не предназначено для демонстрации или переноса в публичный интерфейс.',skillRequirements:requirement,...(type==='job'?{skills:['Python'],location:'Казань'}:{requiredSkills:['Python'],desirableSkills:[]})},201);if(type==='job'&&row.status==='draft')row=await api(actor,`${path}/${row.id}/status`,'POST',{status:'published',version:row.version});return {type,id:row.id,version:row.version??row.revision,title,companyId:actor.companyId};});}
  const job=await createContext(owner,'job','job'),need1=await createContext(owner,'need','need1'),need2=await createContext(owner,'need','need2'),foreignNeed=await createContext(foreign,'need','foreignNeed');
  const shortlist=ctx=>api(owner,`/employer/shortlist?contextType=${ctx.type}&contextId=${ctx.id}`);
  const saveShort=(ctx,cv)=>api(owner,'/employer/shortlist','PUT',{context:{type:ctx.type,id:ctx.id},contextVersion:ctx.version,candidateId:candidate.id,resumeId:cv.id});
  await once('independent-shortlists',async()=>{
    await saveShort(job,cv1);await saveShort(need1,cv2);await saveShort(need2,cv1);
    for(const [ctx,cv]of[[job,cv1],[need1,cv2],[need2,cv1]]){const list=await shortlist(ctx);check('shortlist-exact-context-'+ctx.type+ctx.id,list.total===1&&list.items[0].resumeId===cv.id&&!list.items[0].needsReview);}
    await api(owner,'/employer/shortlist','DELETE',{context:{type:'need',id:need2.id},candidateId:candidate.id});
    check('remove-need2-does-not-touch-job-or-need1',(await shortlist(need2)).total===0&&(await shortlist(job)).total===1&&(await shortlist(need1)).total===1);
    await saveShort(need2,cv1);check('readd-need2',(await shortlist(need2)).total===1);return {job:job.id,need1:need1.id,need2:need2.id};
  });
  const updatedNeed=await once('needs-review',async()=>{
    const changed=await api(owner,`/employer/needs/${need1.id}`,'PUT',{revision:need1.version,gradeMode:'verified'});
    const list=await shortlist(need1);check('changed-requirements-needs-review',list.items[0].needsReview===true);
    check('other-contexts-remain-current',!(await shortlist(job)).items[0].needsReview&&!(await shortlist(need2)).items[0].needsReview);
    const reply=await api(owner,'/employer/shortlist','PUT',{context:{type:'need',id:need1.id},contextVersion:changed.revision,candidateId:candidate.id,resumeId:cv2.id});
    check('ineligible-bookmark-kept-review-put-and-get',reply.item.needsReview&&(await shortlist(need1)).items[0].needsReview);return changed;
  });
  const invitationBase=async cv=>{const profile=await api(candidate,`/me/candidate-profile?resumeId=${cv.id}`);return{candidateId:candidate.id,resumeId:cv.id,resumeRevision:profile.revision,title:'Приглашение от компании',message:'Предлагаем обсудить задачи и условия сотрудничества.',reason:'Заявленный опыт соответствует текущим требованиям.',salaryMin:160000,salaryMax:220000,salaryPeriod:'month',salaryType:'gross',workFormat:'Удалённо'};};
  await once('invitation-rejections',async()=>{
    const body=await invitationBase(cv1),key='context-'+j.runId;
    await api(owner,'/employer/invitations','POST',{...body,contextVersion:job.version,idempotencyKey:key+'-none'},400);check('invitation-no-context-rejected',true);
    await api(owner,'/employer/invitations','POST',{...body,jobId:job.id,needId:need2.id,contextVersion:job.version,idempotencyKey:key+'-both'},400);check('invitation-two-contexts-rejected',true);
    await api(owner,'/employer/invitations','POST',{...body,needId:foreignNeed.id,contextVersion:foreignNeed.version,idempotencyKey:key+'-foreign'},404);check('invitation-foreign-context-rejected',true);
    const mismatch=await api(owner,'/employer/invitations','POST',{...body,needId:need1.id,contextVersion:updatedNeed.revision,idempotencyKey:key+'-mismatch'},404);check('invitation-mismatched-bookmark-rejected',mismatch.code==='CANDIDATE_UNAVAILABLE');
    await api(owner,'/employer/invitations','POST',{...body,jobId:job.id,idempotencyKey:key+'-noversion'},400);check('invitation-missing-version-rejected',true);return {};
  });
  const invitation=await once('need-invitation',async()=>{const existing=(await pool.query('SELECT id FROM signal_invitations WHERE company_id=$1 AND candidate_user_id=$2 AND need_id=$3',[owner.companyId,candidate.id,need2.id])).rows[0];return existing??api(owner,'/employer/invitations','POST',{...await invitationBase(cv1),needId:need2.id,contextVersion:need2.version,idempotencyKey:'context-'+j.runId+'-need'},201);});
  function noPrivateTitle(name,payload){check(name,!JSON.stringify(payload).includes('PRIVATE-CONTEXT-'));}
  await once('candidate-privacy',async()=>{
    const detail=await api(candidate,`/me/invitations/${invitation.id}`);noPrivateTitle('candidate-detail-no-private-title',detail);
    check('candidate-need-neutral-context',detail.context.type==='need'&&detail.context.available===false&&detail.context.title==='Приглашение по запросу компании');
    check('candidate-company-visible-before-decision',detail.company?.id===owner.companyId);
    noPrivateTitle('candidate-list-no-private-title',await api(candidate,'/me/invitations'));
    noPrivateTitle('candidate-search-no-private-title',await api(candidate,'/me/invitations/search'));
    noPrivateTitle('candidate-view-no-private-title',await api(candidate,`/me/invitations/${invitation.id}/view`,'POST',{}));
    noPrivateTitle('assessment-contexts-no-private-title',await api(candidate,'/assessments/contexts?programId=backend-python'));
    const own=(await api(owner,'/employer/invitations')).find(row=>row.id===invitation.id);check('owner-context-keeps-private-title',own.context.title===need2.title);
    await api(foreign,`/employer/needs/${need2.id}/assessment-context`,'GET',undefined,404);check('foreign-assessment-context-denied',true);
    return {};
  });
  const application=await once('real-application',async()=>{
    const input={companyId:owner.companyId,jobVersion:job.version,resumeId:cv2.id,consentDisclosure:true,message:'Хочу обсудить задачи команды. Передаю именно второе резюме.'};
    await api(owner,`/jobs/${job.id}/applications`,'POST',input,403);check('employer-cannot-submit-candidate-application',true);
    const created=await api(candidate,`/jobs/${job.id}/applications`,'POST',input,[200,201]);check('application-created-with-exact-cv',created.resumeId===cv2.id&&created.jobId===job.id);
    const repeated=await api(candidate,`/jobs/${job.id}/applications`,'POST',input,200);check('application-repeat-same-id',repeated.id===created.id);
    const candidateRow=(await api(candidate,'/me/applications')).find(row=>row.id===created.id),ownerRow=(await api(owner,'/employer/applications')).items.find(row=>row.id===created.id);
    check('same-application-visible-to-both-roles',candidateRow?.resumeId===cv2.id&&ownerRow?.resumeId===cv2.id);
    await api(owner,`/employer/applications/${created.id}/status`,'POST',{status:'shortlisted'});
    const current=(await api(candidate,'/me/applications')).find(row=>row.id===created.id);check('candidate-sees-current-status',current.status==='shortlisted');
    check('foreign-company-cannot-see-application',!(await api(foreign,'/employer/applications')).items.some(row=>row.id===created.id));
    return {id:created.id,jobId:job.id,resumeId:cv2.id,status:'shortlisted'};
  });
  const jobInvitation=await once('job-invitation',async()=>{
    const existing=(await pool.query('SELECT id FROM signal_invitations WHERE company_id=$1 AND candidate_user_id=$2 AND job_id=$3',[owner.companyId,candidate.id,job.id])).rows[0];
    const row=existing??await api(owner,'/employer/invitations','POST',{...await invitationBase(cv2),jobId:job.id,contextVersion:job.version,idempotencyKey:'context-'+j.runId+'-job'},201);
    const detail=await api(candidate,`/me/invitations/${row.id}`);
    check('job-invitation-exact-xor-cv',detail.jobId===job.id&&detail.needId===null&&detail.resumeId===cv2.id);
    check('job-invitation-published-context-link',detail.context.type==='job'&&detail.context.id===job.id&&detail.context.available===true);
    return {id:row.id,jobId:job.id,resumeId:cv2.id};
  });
  await once('archive-history',async()=>{
    const currentNeed=(await api(owner,'/employer/needs')).find(row=>row.id===need2.id);assert.ok(currentNeed);
    if(currentNeed.status!=='archived')await api(owner,`/employer/needs/${need2.id}`,'PUT',{revision:currentNeed.revision,status:'archived'});
    const history=await api(candidate,`/me/invitations/${invitation.id}`);check('archived-need-invitation-preserved',history.id===invitation.id&&history.needId===need2.id);noPrivateTitle('archived-need-history-no-private-title',history);
    let currentJob=(await api(owner,'/employer/jobs')).find(row=>row.id===job.id);assert.ok(currentJob);
    if(currentJob.status==='published')currentJob=await api(owner,`/employer/jobs/${job.id}/status`,'POST',{version:currentJob.version,status:'closed'});
    if(currentJob.status!=='archived')await api(owner,`/employer/jobs/${job.id}/status`,'POST',{version:currentJob.version,status:'archived'});
    check('archived-job-application-history-preserved',(await api(candidate,'/me/applications')).some(row=>row.id===application.id));
    const invitationHistory=await api(candidate,`/me/invitations/${jobInvitation.id}`);check('archived-job-invitation-history-without-dead-link',invitationHistory.id===jobInvitation.id&&invitationHistory.context.available===false);
    return {};
  });
  await once('demo-owner-readonly-correlation',async()=>{
    const demo=JSON.parse(await readFile('C:/Users/Misha/.codex/private/signal-recording-n01-n20-20261009/demo.json','utf8'));
    const ownerActor=demo.actors.find(row=>row.key==='employer');const contexts=demo.recording;
    for(const ctx of [...contexts.jobs,...contexts.needs]){const table=ctx.type==='job'?'signal_jobs':'signal_needs';const rows=await pool.query(`SELECT company_id FROM ${table} WHERE id=$1`,[ctx.id]);check('demo-owner-correlation-'+ctx.type+ctx.id,rows.rows[0]?.company_id===ownerActor.companyId,{contextId:ctx.id,companyId:ownerActor.companyId});}
    return {demoCompanyId:ownerActor.companyId,jobs:contexts.jobs.map(row=>row.id),needs:contexts.needs.map(row=>row.id)};
  });
  j.completedAt=new Date().toISOString();j.currentStage=null;await save();passed=true;
}catch(error){failure={stage:j?.currentStage??'startup',name:error.name,code:error.code??null};if(j){j.privateFailure={...failure,message:error.message};await save();}}
finally{
  await pool.end();await lock.close();await unlink(privatePath+'.lock');
  const report={passed,failure,synthetic:true,independentAcceptance:false,runtimePath,runtimeSha256,database,api:base,at,completedAt:j?.completedAt,
    actors:j?.actors.map(({key,id,role,companyId})=>({key,id,role,companyId})),stages:j?.stages,checks:[...new Map((j?.checks??[]).map(row=>[row.name,row])).values()],requests:j?.requests,
    limits:['No browser assertions in this HTTP report.','No legacy complex attempt created; candidate current context DTO checked, legacy snapshot projection is covered by earlier privacy tests.','Other agents cover grade proof truth, revoke/export, and N18/N19 task ACL.']};
  await writeFile(resolve(output,'context-regression.json'),JSON.stringify(report,(_key,value)=>typeof value==='string'&&value.includes('@example.test')?'[private synthetic address]':value,2));
  console.log(JSON.stringify({passed,failure,checks:j?.checks.length,httpRequests:j?.requests.length,report:resolve(output,'context-regression.json'),credentialsPrinted:false}));
}
if(!passed)process.exitCode=1;
