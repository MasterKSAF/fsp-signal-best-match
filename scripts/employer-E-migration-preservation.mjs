/** Dedicated synthetic migration test. This file cannot target another database. */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash, randomBytes, scryptSync } from 'node:crypto';
import pg from '../lib/db/node_modules/pg/lib/index.js';
const envPath='C:/Users/Misha/.codex/private/signal-employer-e-20261008.env';
const ledgerPath='C:/Users/Misha/.codex/private/signal-employer-e-20261008-fixtures.json';
const output='outputs/verification/employer-workspace-E01-E16-20261008/migration';
const env=Object.fromEntries((await readFile(envPath,'utf8')).split(/\r?\n/).filter(line=>line&& !line.startsWith('#')).map(line=>{const index=line.indexOf('=');return[line.slice(0,index),line.slice(index+1).replace(/^"|"$/g,'')];}));
const database=new URL(env.DATABASE_URL);
assert.equal(database.hostname,'127.0.0.1');assert.equal(database.port,'55435');assert.equal(database.pathname,'/signal_employer_e_20261008');
process.env.DATABASE_URL=env.DATABASE_URL;
const client=new pg.Client({connectionString:env.DATABASE_URL});await client.connect();
const rawQuery=client.query.bind(client);
client.query=async(query,params)=>{try{return await rawQuery(query,params?.map(value=>Array.isArray(value)?JSON.stringify(value):value));}
  catch(error){error.message+=` [${String(query).slice(0,80)}]`;throw error;}};
const tables=['signal_users','signal_candidate_profiles','signal_candidate_resumes','signal_companies','signal_needs','signal_need_skill_levels',
  'signal_jobs','signal_job_requirements','signal_invitations','signal_invitation_requests','signal_contact_grants','signal_applications',
  'signal_consents','signal_assessment_attempts','signal_assessment_contexts','signal_skill_attempts','signal_skill_exposures','signal_skill_evidence',
  'signal_skill_categories','signal_micro_templates','signal_micro_subscriptions','signal_micro_offers'];
const excluded={signal_needs:['revision','status','updated_at','deleted_at'],signal_jobs:['deleted_at'],signal_invitations:['job_id','context_version','context_snapshot']};
const hash=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
async function rowHashes(){const result={};for(const table of tables){
  const subtract=(excluded[table]??[]).map(name=>` - '${name}'`).join('');
  const rows=(await client.query(`SELECT (to_jsonb(t)${subtract})::text AS row FROM ${table} t ORDER BY (to_jsonb(t)${subtract})::text`)).rows.map(row=>row.row);
  result[table]={count:rows.length,sha256:hash(rows)};
}return result;}
const actors=[];const ids={};let before,after;
try {
  assert.equal(Number((await client.query('SELECT count(*) FROM drizzle.__drizzle_migrations')).rows[0].count),15,'Must start from the preserved 15-migration schema');
  assert.equal(Number((await client.query('SELECT count(*) FROM signal_users')).rows[0].count),0,'Fixtures require this newly created empty test DB');
  await client.query('BEGIN');
  for(const [role,suffix,name] of [['employer','owner','Тестовая компания E'],['employer','foreign','Чужая тестовая компания E'],['candidate','one','Тестовый специалист E Один'],['candidate','two','Тестовый специалист E Два']]){
    const password=randomBytes(24).toString('base64url'),salt=randomBytes(16).toString('hex'),token=randomBytes(32).toString('base64url');
    const passwordHash=`scrypt:${salt}:${scryptSync(password,salt,64).toString('hex')}`;
    const email=`employer-E-${suffix}@example.test`.toLowerCase();
    const user=(await client.query('INSERT INTO signal_users(email,password_hash,role,display_name,email_verified,demo_mode) VALUES($1,$2,$3,$4,true,false) RETURNING id',[email,passwordHash,role,name])).rows[0];
    const actor={id:user.id,email,password,cookie:`fsp_signal_session=${token}`,role,suffix};
    await client.query("INSERT INTO signal_sessions(token_hash,user_id,expires_at,demo_mode) VALUES($1,$2,now()+interval '7 days',false)",[hash(token),user.id]);
    if(role==='employer')actor.companyId=(await client.query('INSERT INTO signal_companies(owner_user_id,name,contact_email) VALUES($1,$2,$3) RETURNING id',[user.id,name,email])).rows[0].id;
    else await client.query('INSERT INTO signal_candidate_profiles(user_id,professional_alias,consent_matching,phone,contact_email) VALUES($1,$2,true,$3,$4)',[user.id,`Синтетический специалист ${suffix}`,'+79990000001',email]);
    actors.push(actor);
    await client.query("INSERT INTO signal_consents(user_id,consent_type,version) VALUES($1,'terms','synthetic-E-terms'),($1,'privacy','synthetic-E-privacy')",[user.id]);
  }
  const owner=actors[0],candidate=actors[2],second=actors[3];
  for(const [actor,title,specialization,primary,matching,catalog] of [[candidate,'Backend-разработчик','Backend / Python',true,true,true],[candidate,'Frontend-разработчик','Frontend / TypeScript',false,false,true],[second,'Backend-разработчик для подбора','Backend / Python',true,true,false]]){
    const resume=(await client.query("INSERT INTO signal_candidate_resumes(user_id,title,specialization,is_primary,visibility,consent_matching,consent_catalog,ready_for_offers,stack,skills,years_experience,salary_min,salary_max,summary) VALUES($1,$2,$3,$4,'pseudonymous',$5,$6,true,ARRAY['Python'],ARRAY['Python','SQL'],3,100000,200000,'Синтетическое резюме миграционной проверки') RETURNING id",[actor.id,title,specialization,primary,matching,catalog])).rows[0];
    actor.resumeIds??=[];actor.resumeIds.push(resume.id);
  }
  ids.need=(await client.query("INSERT INTO signal_needs(company_id,title,specialization,grade,required_skills,desirable_skills,description,work_format,salary_min,salary_max,salary_period,salary_type) VALUES($1,'Backend-разработчик','Backend / Python','Junior',ARRAY['Python'],'{}','Приватный синтетический запрос до миграции','Удалённо',100000,200000,'month','gross') RETURNING id",[owner.companyId])).rows[0].id;
  await client.query('INSERT INTO signal_need_skill_levels(need_id,levels) VALUES($1,$2)',[ids.need,{python:'Junior'}]);
  ids.job=(await client.query("INSERT INTO signal_jobs(company_id,title,description,specialization,grade,skills,work_format,salary_min,salary_max,salary_period,salary_type,status,published_at) VALUES($1,'Backend-разработчик','Опубликованная синтетическая вакансия до миграции','Backend / Python','Junior',ARRAY['Python'],'Удалённо',100000,200000,'month','gross','published',now()) RETURNING id",[owner.companyId])).rows[0].id;
  await client.query('INSERT INTO signal_job_requirements(job_id,location,skill_requirements) VALUES($1,$2,$3)',[ids.job,'Москва',[{skill:'Python',level:'Junior'}]]);
  const resumeSnapshot={resumeId:candidate.resumeIds[0],revision:1,title:'Backend-разработчик',specialization:'Backend / Python',verifiedGrade:null,verifiedScore:null,verifiedSkills:[],stack:['Python'],skills:['Python','SQL'],yearsExperience:3,workFormat:'Удалённо',salaryMin:100000,salaryMax:200000,salaryPeriod:'month',salaryType:'gross',updatedAt:'2026-10-07T10:00:00.000Z',summary:''};
  for(const [actor,status] of [[candidate,'accepted'],[second,'sent']]){
    const snapshot={...resumeSnapshot,resumeId:actor.resumeIds[0]};
    const invitation=(await client.query("INSERT INTO signal_invitations(need_id,company_id,candidate_user_id,resume_id,resume_snapshot,title,message,reason,salary_min,salary_max,salary_period,salary_type,work_format,status) VALUES($1,$2,$3,$4,$5,'Историческое приглашение E','Синтетическое предложение сохранности истории','Синтетический проверочный контекст',100000,200000,'month','gross','Удалённо',$6) RETURNING id",[ids.need,owner.companyId,actor.id,actor.resumeIds[0],snapshot,status])).rows[0];
    await client.query('INSERT INTO signal_invitation_requests(company_id,request_key,body_hash,invitation_id) VALUES($1,$2,$3,$4)',[owner.companyId,`synthetic-E-pre15-${actor.id}`,hash({synthetic:true,invitationId:invitation.id}),invitation.id]);
    if(status==='accepted'){ids.invitation=invitation.id;ids.contactGrant=(await client.query('INSERT INTO signal_contact_grants(invitation_id,candidate_user_id,company_id) VALUES($1,$2,$3) RETURNING id',[invitation.id,actor.id,owner.companyId])).rows[0].id;}
  }
  const jobSnapshot={version:1,title:'Backend-разработчик',companyName:'Тестовая компания E',description:'Исторические условия E',specialization:'Backend / Python',grade:'Junior',skills:['Python'],workFormat:'Удалённо',salaryMin:100000,salaryMax:200000,salaryPeriod:'month',salaryType:'gross'};
  ids.application=(await client.query("INSERT INTO signal_applications(job_id,company_id,candidate_user_id,resume_id,resume_snapshot,snapshot,message,status) VALUES($1,$2,$3,$4,$5,$6,'Синтетическое сопроводительное письмо до миграции','shortlisted') RETURNING id",[ids.job,owner.companyId,candidate.id,candidate.resumeIds[0],resumeSnapshot,jobSnapshot])).rows[0].id;
  await client.query('INSERT INTO signal_contact_grants(application_id,candidate_user_id,company_id) VALUES($1,$2,$3)',[ids.application,candidate.id,owner.companyId]);
  ids.assessment=(await client.query("INSERT INTO signal_assessment_attempts(user_id,purpose,purpose_origin,resume_id,resume_revision,resume_specialization,program_id,program_version,grade,status,cases,oracles,answers,due_at,submitted_at,score,verified) VALUES($1,'legacy_unknown','legacy_signal_bank',$2,1,'Backend / Python','synthetic-preservation','synthetic-pre15','Junior','submitted',$3,$4,$5,now(),now(),0,false) RETURNING id",[candidate.id,candidate.resumeIds[0],[{id:'synthetic-case',family:'synthetic',title:'Историческая синтетическая запись',prompt:'Не является настоящим экзаменом',responseType:'text',options:[]}],{'synthetic-case':{synthetic:true}},[{caseId:'synthetic-case',answer:'Сохранить исторический ответ'}]])).rows[0].id;
  await client.query('INSERT INTO signal_assessment_contexts(attempt_id,snapshot) VALUES($1,$2)',[ids.assessment,{synthetic:true,resumeId:candidate.resumeIds[0],revision:1}]);
  const syntheticDecision={passed:false,synthetic:true,note:'Preservation fixture only; no qualification awarded'};
  ids.skillAttempt=(await client.query("INSERT INTO signal_skill_attempts(user_id,resume_id,skill_id,level,program_version,status,cases,oracles,answers,policy,decision,expires_at,submitted_at) VALUES($1,$2,'python','Junior','synthetic-pre15','submitted','[]','{}','{}',$3,$4,now(),now()) RETURNING id",[candidate.id,candidate.resumeIds[0],{synthetic:true},syntheticDecision])).rows[0].id;
  await client.query('INSERT INTO signal_skill_exposures(user_id,attempt_id,template_id) VALUES($1,$2,$3)',[candidate.id,ids.skillAttempt,'synthetic-preservation-template']);
  await client.query("INSERT INTO signal_skill_evidence(user_id,attempt_id,skill_id,level,program_version,competency_ids,verified_at,decision) VALUES($1,$2,'python','Junior','synthetic-pre15',ARRAY['synthetic'],now(),$3)",[candidate.id,ids.skillAttempt,syntheticDecision]);
  await client.query('INSERT INTO signal_skill_categories(user_id,resume_id,snapshot_hash,snapshot) VALUES($1,$2,$3,$4)',[candidate.id,candidate.resumeIds[0],hash({synthetic:true}),{synthetic:true,verifiedGrade:null}]);
  const rubric=[{id:'old-criterion',label:'Исходный критерий',maxPoints:5}];
  ids.template=(await client.query("INSERT INTO signal_micro_templates(company_id,title,competency,specialization,scenario,expected_minutes,rubric,interval_days,deadline_days) VALUES($1,'Историческое задание E','Python','Backend / Python','Синтетический исторический сценарий задания работодателя до миграции',15,$2,7,3) RETURNING id",[owner.companyId,rubric])).rows[0].id;
  for(const [actor,status] of [[candidate,'evaluated'],[second,'submitted']]){
    const context={resumeId:actor.resumeIds[0],revision:1,title:'Backend-разработчик',specialization:'Backend / Python',verifiedGrade:'Junior',verifiedSkills:['Python'],professionalAlias:`Синтетический специалист ${actor.suffix}`};
    const subscription=(await client.query("INSERT INTO signal_micro_subscriptions(template_id,candidate_user_id,resume_id,resume_revision,resume_context,resume_provenance,next_due_at) VALUES($1,$2,$3,1,$4,'captured',now()+interval '7 days') RETURNING id",[ids.template,actor.id,actor.resumeIds[0],context])).rows[0];
    const snapshot={title:'Историческое задание E',competency:'Python',scenario:'Исходный синтетический сценарий',expectedMinutes:15,rubric,version:1,companyName:'Тестовая компания E',limits:'Синтетическое задание, квалификация не меняется'};
    const result=status==='evaluated'?{purpose:'company_task',qualificationEffect:'none',evaluatorUserId:owner.id,evaluatedAt:'2026-10-07T12:00:00Z',scores:[{criterionId:'old-criterion',points:3,comment:'Синтетическая оценка'}],total:3,max:5,feedback:'Историческая оценка',source:'company_task',competency:'Python',templateVersion:1}:null;
    const offer=(await client.query("INSERT INTO signal_micro_offers(subscription_id,company_id,candidate_user_id,resume_id,resume_revision,resume_context,resume_provenance,snapshot,status,due_at,scheduled_for,accepted_at,submitted_at,answer,result,share_result) VALUES($1,$2,$3,$4,1,$5,'captured',$6,$7,now()+interval '1 day',now(),now(),now(),'Исторический синтетический ответ',$8,true) RETURNING id",[subscription.id,owner.companyId,actor.id,actor.resumeIds[0],context,snapshot,status,result])).rows[0];
    ids[status+'Offer']=offer.id;
  }
  await client.query('COMMIT');
  await mkdir(output,{recursive:true});
  await writeFile(ledgerPath,JSON.stringify({synthetic:true,database:'signal_employer_e_20261008',apiOrigin:'http://localhost:4413',uiOrigin:'http://signal-employer.localhost:4414',actors,ids},null,2),{flag:'wx'});
  before=await rowHashes();
  await writeFile(output+'/pre15-preservation.json',JSON.stringify({synthetic:true,qualificationFixturesAreNotRealExams:true,migrationCount:15,originalColumns:before,ids,measuredAt:new Date().toISOString()},null,2),{flag:'wx'});
  const {db,pool}=await import('../lib/db/src/index.ts');
  const {migrate}=await import('../lib/db/node_modules/drizzle-orm/node-postgres/migrator.js');
  try{await migrate(db,{migrationsFolder:'lib/db/migrations'});}finally{await pool.end();}
  assert.equal(Number((await client.query('SELECT count(*) FROM drizzle.__drizzle_migrations')).rows[0].count),16);
  after=await rowHashes();assert.deepEqual(after,before,'Original row contents and all history must remain exactly equal');
  const invitations=(await client.query('SELECT id,need_id,job_id,context_version,context_snapshot FROM signal_invitations ORDER BY id')).rows;
  assert.ok(invitations.every(row=>row.need_id===ids.need&&row.job_id===null&&row.context_version===1&&row.context_snapshot.legacyConditionsOnly===true));
  assert.equal(Number((await client.query('SELECT count(*) FROM signal_shortlist')).rows[0].count),0);
  await writeFile(output+'/post16-preservation.json',JSON.stringify({passed:true,synthetic:true,qualificationFixturesAreNotRealExams:true,migrationCount:16,originalColumns:after,allOriginalRowsExactlyPreserved:true,legacyInvitationSourcePreserved:true,shortlistInitiallyEmpty:true,measuredAt:new Date().toISOString()},null,2),{flag:'wx'});
  console.log(JSON.stringify({passed:true,migrations:16,preservedTables:tables.length,actors:actors.length,resumes:3,privateLedger:ledgerPath}));
} catch(error){await client.query('ROLLBACK').catch(()=>{});console.error(error.message);process.exitCode=1;}
finally{await client.end();}
