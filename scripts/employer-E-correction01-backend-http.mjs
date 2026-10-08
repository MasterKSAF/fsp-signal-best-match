/** C01-C03: new owned synthetic actors only, on the dedicated employer E DB. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash,randomBytes,randomUUID,scryptSync} from 'node:crypto';
import pg from '../lib/db/node_modules/pg/lib/index.js';
const runtimePath=process.argv[2];assert.ok(runtimePath?.includes('employer-workspace-E01-E16-20261008'),'Pass the current own E runtime bundle path');
const runtimeSha256=createHash('sha256').update(await readFile(runtimePath)).digest('hex');
const env=Object.fromEntries((await readFile('C:/Users/Misha/.codex/private/signal-employer-e-20261008.env','utf8')).split(/\r?\n/).filter(x=>x&&!x.startsWith('#')).map(line=>{const i=line.indexOf('=');return[line.slice(0,i),line.slice(i+1).replace(/^"|"$/g,'')];}));
const database=new URL(env.DATABASE_URL);assert.equal(database.hostname,'127.0.0.1');assert.equal(database.port,'55435');assert.equal(database.pathname,'/signal_employer_e_20261008');
const pool=new pg.Pool({connectionString:env.DATABASE_URL});
const runId=randomUUID(),aliasPrefix=`C01 QA ${runId.slice(0,8)}`,actors=[],checks=[],receipts=[],actualAttempts=[],contexts=[];
const origin='http://localhost:4413',appOrigin='http://signal-employer.localhost:4414';
const output='outputs/verification/employer-workspace-E01-E16-20261008/correction-01/backend';
const privatePath=`C:/Users/Misha/.codex/private/signal-employer-e-20261008-correction01-backend-${runId}.json`;
let passed=false,failure;
async function request(actor,path,method='GET',body){
  const response=await fetch(origin+'/api'+path,{method,headers:{Cookie:actor.cookie,Origin:appOrigin,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
  const type=response.headers.get('content-type')??'',text=type.includes('json')?await response.text():null;let json;if(text){try{json=JSON.parse(text);}catch{}}
  const bytes=text===null?new Uint8Array(await response.arrayBuffer()):null;
  receipts.push({path,method,status:response.status,actorId:actor.id});return{status:response.status,json,bytes,type};
}
async function ok(actor,path,method='GET',body,status=200){const r=await request(actor,path,method,body);assert.equal(r.status,status,`${method} ${path}: ${r.json?.error??''}`);return r.json;}
const step=name=>checks.push({name,status:'PASS'});
async function checkpoint(){await writeFile(privatePath,JSON.stringify({synthetic:true,runId,actors,contexts},null,2));}
async function actor(role,suffix){
  const password=randomBytes(24).toString('base64url'),salt=randomBytes(16).toString('hex'),token=randomBytes(32).toString('base64url');
  const email=`employer-e-c01-${runId}-${suffix}@example.test`.toLowerCase();
  const row=(await pool.query('INSERT INTO signal_users(email,password_hash,role,display_name,email_verified,demo_mode) VALUES($1,$2,$3,$4,true,false) RETURNING id',[email,`scrypt:${salt}:${scryptSync(password,salt,64).toString('hex')}`,role,`${aliasPrefix} ${suffix}`])).rows[0];
  await pool.query("INSERT INTO signal_sessions(token_hash,user_id,expires_at,demo_mode) VALUES($1,$2,now()+interval '7 days',false)",[createHash('sha256').update(token).digest('hex'),row.id]);
  const result={id:row.id,email,password,cookie:`fsp_signal_session=${token}`,role,suffix};
  if(role==='employer')result.companyId=(await pool.query('INSERT INTO signal_companies(owner_user_id,name,contact_email) VALUES($1,$2,$3) RETURNING id',[row.id,`${aliasPrefix} Компания`,email])).rows[0].id;
  actors.push(result);await checkpoint();return result;
}
async function profile(candidate,resumeId){
  const current=await ok(candidate,`/me/candidate-profile?resumeId=${resumeId}`);
  return ok(candidate,'/me/candidate-profile','PUT',{...current,resumeId,revision:current.revision,identityRevision:current.identityRevision,
    professionalAlias:`${aliasPrefix} ${candidate.suffix}`,stack:['Python','SQL'],skills:['Python','SQL'],visibility:'pseudonymous',consentMatching:true,consentCatalog:false,readyForOffers:true,workFormat:'Удалённо',salaryMin:100000,salaryMax:200000});
}
async function qualifySkill(candidate,resumeId,skillId,level){
  const matrix=await ok(candidate,`/me/skill-matrix?resumeId=${resumeId}`);
  const issued=await request(candidate,'/me/skill-attempts','POST',{resumeId,skillId,level,programVersion:matrix.bankVersion});assert.ok([200,201].includes(issued.status),issued.json?.error);
  const attempt=issued.json.attempt;
  const stored=(await pool.query('SELECT user_id,oracles,cases FROM signal_skill_attempts WHERE id=$1 AND user_id=$2',[attempt.id,candidate.id])).rows[0];assert.equal(stored.user_id,candidate.id);
  const answers=Object.fromEntries(stored.cases.map(c=>[c.id,stored.oracles[c.id].expected]));
  const result=(await ok(candidate,`/me/skill-attempts/${attempt.id}/submit`,'POST',{revision:attempt.revision,answers})).attempt;
  assert.equal(result.decision.passed,true);assert.equal(result.decision.criticalComplete,true);
  actualAttempts.push({actorId:candidate.id,resumeId,skillId,level,attemptId:attempt.id,programVersion:result.programVersion,rubricVersion:result.decision.rubricVersion});
}
const needBody={title:'C01 уровни запроса',specialization:'Backend / Python',grade:'Junior',requiredSkills:['Python'],requiredSkillLevels:{py:'Senior'},desirableSkills:[],description:'Собственный запрос для адресной проверки сохранения минимального уровня.',workFormat:'Удалённо',salaryMin:100000,salaryMax:200000,salaryPeriod:'month',salaryType:'gross'};
const jobBody={title:'C02 уровни вакансии',description:'Собственная вакансия для проверки одинакового допуска Python Senior при общем grade Junior.',specialization:'Backend / Python',grade:'Junior',skills:['py'],skillRequirements:[{skill:'py',level:'Senior'}],location:'Москва',workFormat:'Удалённо',salaryMin:100000,salaryMax:200000,salaryPeriod:'month',salaryType:'gross'};
const query=ref=>`/employer/selection?${new URLSearchParams({contextType:ref.type,contextId:String(ref.id),q:aliasPrefix,pageSize:'50'})}`;
async function eligibleIds(owner,ref){return (await ok(owner,query(ref))).items.map(item=>item.candidateId).sort((a,b)=>a-b);}
try {
  await mkdir(output,{recursive:true});
  assert.equal(Number((await pool.query('SELECT count(*) FROM drizzle.__drizzle_migrations')).rows[0].count),16);
  const owner=await actor('employer','owner'),junior=await actor('candidate','junior'),senior=await actor('candidate','senior');
  for(const candidate of [junior,senior]){
    candidate.resumeIds=[(await ok(candidate,'/me/resumes')).resumes[0].id];await profile(candidate,candidate.resumeIds[0]);
    for(const skillId of ['python','sql','backend-engineering'])await qualifySkill(candidate,candidate.resumeIds[0],skillId,skillId==='python'&&candidate===senior?'Senior':'Junior');
    assert.equal((await ok(candidate,`/me/skill-matrix?resumeId=${candidate.resumeIds[0]}`)).qualification.verifiedGrade,'Junior');
  }
  const resumeA=junior.resumeIds[0],resumeB=senior.resumeIds[0];
  const alternate=await ok(junior,'/me/resumes','POST',{title:'C03 другое Backend резюме',specialization:'Backend / Python'},201);junior.resumeIds.push(alternate.id);await profile(junior,alternate.id);await checkpoint();
  step('New own actors earn actual HTTP Python Junior/Senior and core Junior proofs; no reviewer or historical qualification is modified');

  let job=await ok(owner,'/employer/jobs','POST',jobBody,201);contexts.push({type:'job',id:job.id});await checkpoint();
  const jobRef={type:'job',id:job.id};assert.deepEqual(await eligibleIds(owner,jobRef),[senior.id]);
  for(const ext of ['document-preview','document.pdf','document.docx'])await ok(owner,`/resumes/${resumeA}/${ext}`,'GET',undefined,404);
  await ok(owner,`/resumes/${resumeB}/document-preview`);
  const inviteBody={candidateId:junior.id,resumeId:resumeA,resumeRevision:(await ok(junior,`/me/candidate-profile?resumeId=${resumeA}`)).revision,
    jobId:job.id,contextVersion:job.version,title:'C03 неизменяемые условия',message:'Приглашаем обсудить возможность сотрудничества.',reason:'Подтверждённые навыки соответствуют условиям.',salaryMin:100000,salaryMax:200000,salaryPeriod:'month',salaryType:'gross',workFormat:'Удалённо'};
  await ok(owner,'/employer/invitations','POST',{...inviteBody,idempotencyKey:`c01-denied-${runId}`},404);
  step('C02 job-only matching export preview/PDF/DOCX and invitation reject Python Junior against Python Senior; Senior CV remains accessible');

  let need=await ok(owner,'/employer/needs','POST',needBody,201);contexts.push({type:'need',id:need.id});await checkpoint();
  const needRef={type:'need',id:need.id};assert.deepEqual(need.requiredSkillLevels,{'skill:python':'Senior'});
  assert.deepEqual(await eligibleIds(owner,needRef),[senior.id]);
  let reloaded=(await ok(owner,'/employer/needs')).find(item=>item.id===need.id);assert.deepEqual(reloaded.requiredSkillLevels,{'skill:python':'Senior'});
  need=await ok(owner,`/employer/needs/${need.id}`,'PUT',{revision:need.revision,title:'C01 меняется только название'});
  assert.deepEqual(need.requiredSkillLevels,{'skill:python':'Senior'});assert.deepEqual(await eligibleIds(owner,needRef),[senior.id]);
  reloaded=(await ok(owner,'/employer/needs')).find(item=>item.id===need.id);assert.deepEqual(reloaded.requiredSkillLevels,{'skill:python':'Senior'});
  await ok(owner,`/employer/needs/${need.id}`,'PUT',{revision:1,title:'Устаревшее изменение'},409);
  need=await ok(owner,`/employer/needs/${need.id}`,'PUT',{revision:need.revision,requiredSkills:['py']});assert.deepEqual(need.requiredSkillLevels,{'skill:python':'Senior'});
  need=await ok(owner,`/employer/needs/${need.id}`,'PUT',{revision:need.revision,requiredSkillLevels:{'skill:python':'Senior'}});assert.deepEqual(need.requiredSkillLevels,{'skill:python':'Senior'});
  step('C01 create/reload/title-only/reload, alias skill edit and canonical level re-send preserve Senior; stale CAS409 does not change the requirement');

  for(const ref of [needRef,jobRef]){
    const detail=await ok(owner,`/employer/selection/resumes/${resumeA}?contextType=${ref.type}&contextId=${ref.id}`);assert.equal(detail.match.eligible,false);
    const compare=await ok(owner,'/employer/selection/compare','POST',{context:ref,resumeIds:[resumeA,resumeB]});assert.equal(compare.items.find(item=>item.resumeId===resumeA).match.eligible,false);assert.equal(compare.items.find(item=>item.resumeId===resumeB).match.eligible,true);
  }
  await qualifySkill(junior,resumeA,'python','Middle');
  for(const minimum of ['Junior','Middle','Senior']) {
    need=await ok(owner,`/employer/needs/${need.id}`,'PUT',{revision:need.revision,requiredSkillLevels:{py:minimum}});
    job=await ok(owner,`/employer/jobs/${job.id}`,'PUT',{version:job.version,skillRequirements:[{skill:'py',level:minimum}]});
    const expected=minimum==='Senior'?[senior.id]:[junior.id,senior.id].sort((a,b)=>a-b);
    assert.deepEqual(await eligibleIds(owner,needRef),expected);assert.deepEqual(await eligibleIds(owner,jobRef),expected);
  }
  step('C02 detail and compare apply minimums; live actual Junior/Middle/Senior evidence follows equal job/need alias boundaries');
  need=await ok(owner,`/employer/needs/${need.id}`,'PUT',{revision:need.revision,requiredSkillLevels:{}});assert.deepEqual(need.requiredSkillLevels,{});
  assert.deepEqual(await eligibleIds(owner,needRef),[junior.id,senior.id].sort((a,b)=>a-b));
  need=await ok(owner,`/employer/needs/${need.id}`,'PUT',{revision:need.revision,requiredSkills:['Python','SQL'],requiredSkillLevels:{Python:'Senior',SQL:'Junior'}});
  need=await ok(owner,`/employer/needs/${need.id}`,'PUT',{revision:need.revision,requiredSkills:['SQL']});assert.deepEqual(need.requiredSkillLevels,{'skill:sql':'Junior'});
  step('C01 explicit {} clears minimums and removing Python deletes only its level while SQL Junior remains');

  job=await ok(owner,`/employer/jobs/${job.id}`,'PUT',{version:job.version,skillRequirements:[{skill:'py',level:'Junior'}]});
  const captured=[];
  for(const ref of [jobRef,needRef]) {
    const common={...inviteBody,resumeRevision:(await ok(junior,`/me/candidate-profile?resumeId=${resumeA}`)).revision,contextVersion:ref.type==='job'?job.version:need.revision};delete common.jobId;
    common[ref.type==='job'?'jobId':'needId']=ref.id;
    const key=`c03-${ref.type}-${runId}`,originalBody={...common,idempotencyKey:key};
    const original=await ok(owner,'/employer/invitations','POST',originalBody,201);captured.push(original.id);
    const before=(await pool.query('SELECT to_jsonb(t) AS row FROM signal_invitations t WHERE id=$1 AND company_id=$2',[original.id,owner.companyId])).rows[0].row;
    const receiptsBefore=Number((await pool.query('SELECT count(*) FROM signal_invitation_requests WHERE company_id=$1 AND invitation_id=$2',[owner.companyId,original.id])).rows[0].count);
    assert.equal((await ok(owner,'/employer/invitations','POST',originalBody)).id,original.id);
    const alternateRevision=(await ok(junior,`/me/candidate-profile?resumeId=${alternate.id}`)).revision;
    for(const changed of [{resumeId:alternate.id,resumeRevision:alternateRevision},{salaryMax:210000},{message:'Иные условия нового действия работодателя'}]) {
      const conflict=await ok(owner,'/employer/invitations','POST',{...common,...changed,idempotencyKey:`c03-conflict-${randomUUID()}`},409);
      assert.equal(conflict.code,'PENDING_INVITATION_CONFLICT');assert.equal(conflict.existingInvitationId,original.id);
    }
    const badSameKey=await ok(owner,'/employer/invitations','POST',{...originalBody,resumeId:alternate.id,resumeRevision:alternateRevision},409);assert.equal(badSameKey.code,'IDEMPOTENCY_CONFLICT');
    const receiptsAfter=Number((await pool.query('SELECT count(*) FROM signal_invitation_requests WHERE company_id=$1 AND invitation_id=$2',[owner.companyId,original.id])).rows[0].count);assert.equal(receiptsAfter,receiptsBefore);
    const compatible=await ok(owner,'/employer/invitations','POST',{...common,idempotencyKey:`c03-compatible-${ref.type}-${runId}`});assert.equal(compatible.id,original.id);
    const after=(await pool.query('SELECT to_jsonb(t) AS row FROM signal_invitations t WHERE id=$1 AND company_id=$2',[original.id,owner.companyId])).rows[0].row;assert.deepEqual(after,before);
    await ok(owner,`/employer/invitations/${original.id}/contacts`,'GET',undefined,403);
    if(ref.type==='job')job=await ok(owner,`/employer/jobs/${job.id}`,'PUT',{version:job.version,title:'C03 изменённый текущий контекст'});
    else need=await ok(owner,`/employer/needs/${need.id}`,'PUT',{revision:need.revision,title:'C03 изменённый текущий запрос'});
    assert.equal((await ok(owner,'/employer/invitations','POST',originalBody)).id,original.id);
    const currentVersion=ref.type==='job'?job.version:need.revision;
    const contextConflict=await ok(owner,'/employer/invitations','POST',{...common,contextVersion:currentVersion,idempotencyKey:`c03-revision-${ref.type}-${runId}`},409);assert.equal(contextConflict.code,'PENDING_INVITATION_CONFLICT');
  }
  assert.equal(Number((await pool.query('SELECT count(*) FROM signal_invitations WHERE company_id=$1',[owner.companyId])).rows[0].count),2);
  assert.equal(Number((await pool.query('SELECT count(*) FROM signal_contact_grants WHERE company_id=$1',[owner.companyId])).rows[0].count),0);
  assert.equal(Number((await pool.query('SELECT count(*) FROM signal_shortlist WHERE company_id=$1',[owner.companyId])).rows[0].count),0);
  step('C03 job and need return explicit409 for changed exact CV/conditions/context; same-key replay and compatible retry return the immutable original, no conflict receipts/grants/count inflation');
  // Retain fresh own fixtures for the controller's UI recheck: Senior need,
  // Junior vacancy, pending invitations and both explicit CV alternatives.
  need=await ok(owner,`/employer/needs/${need.id}`,'PUT',{revision:need.revision,requiredSkills:['Python'],requiredSkillLevels:{Python:'Senior'}});
  Object.assign(contexts.find(item=>item.type==='need'),{version:need.revision,requiredSkillLevels:need.requiredSkillLevels});
  Object.assign(contexts.find(item=>item.type==='job'),{version:job.version,invitationId:captured[0]});
  await checkpoint();passed=true;
}catch(error){failure={name:error.name,message:error.message};}
finally{
  await checkpoint();await pool.end();
  await writeFile(`${output}/http-${runId}.json`,JSON.stringify({passed,failure,runId,syntheticActorsOnly:true,reviewerRecordsUntouched:true,database:'signal_employer_e_20261008',port:4413,runtimePath,runtimeSha256,checks,receipts,actualAttempts,actors:actors.map(({id,role,suffix,resumeIds,companyId})=>({id,role,suffix,resumeIds,companyId})),contexts,measuredAt:new Date().toISOString()},null,2));
  console.log(JSON.stringify({passed,checks:checks.length,requests:receipts.length,actualAttempts:actualAttempts.length,report:`${output}/http-${runId}.json`,privateLedger:privatePath,failure}));
}
if(!passed)process.exitCode=1;
