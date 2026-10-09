import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PgDialect, getTableConfig } from '../lib/db/node_modules/drizzle-orm/pg-core/index.js';
import { CreateEmployerNeedBody } from '../lib/api-zod/src/generated/api';
import { NeedPatchBody, JobPatchBody, JobInputShape, contextBaseFields } from '../artifacts/api-server/src/lib/employer-context-edit';
import { ContextCreateInvitationBody, invitationContextSnapshot } from '../artifacts/api-server/src/lib/invitation-context-input';
import { mergePresentFields, selectionContextActive, selectionContextKey, type SelectionContextDto } from '../artifacts/api-server/src/lib/selection-context-contract';
import { jobInput } from '../artifacts/api-server/src/lib/opportunity-rules';
import { signalShortlistTable } from '../lib/db/src/schema/signal-shortlist';

// Never connect to a database: every runtime read below receives a mock reader.
process.env.DATABASE_URL ??= 'postgresql://unused:unused@127.0.0.1:1/never_connect';
const contextModule = import('../artifacts/api-server/src/lib/signal-employer-context');
const at=new Date('2026-10-08T12:00:00Z');
const need={id:5,companyId:7,title:'Backend-разработчик',specialization:'Backend / Python',grade:'Middle' as const,
  requiredSkills:['Python','PostgreSQL'],desirableSkills:['FastAPI'],description:'Работа над сервисом компании',
  workFormat:'Удалённо',salaryMin:200000,salaryMax:300000,salaryPeriod:'month' as const,salaryType:'gross' as const,
  revision:3,status:'active' as const,createdAt:at,updatedAt:at,deletedAt:null};
const job={id:5,companyId:7,title:'Backend-разработчик',specialization:'Backend / Python',grade:'Senior',skills:['Python','PostgreSQL'],
  description:'Длинное описание реальной вакансии компании',workFormat:'Удалённо',salaryMin:250000,salaryMax:350000,
  salaryPeriod:'month' as const,salaryType:'gross' as const,version:4,status:'draft' as const,createdAt:at,updatedAt:at,publishedAt:null,deletedAt:null};

test('partial edits preserve absent fields, accept explicit zero/empty values only by field contract, and reject missing CAS',()=>{
  const patch=NeedPatchBody.parse({revision:3,title:'Старший backend-разработчик'});
  const {revision:_version,...fields}=patch;
  const merged=CreateEmployerNeedBody.parse(mergePresentFields(contextBaseFields(need,CreateEmployerNeedBody.shape),fields));
  assert.equal(merged.salaryMax,300000);assert.deepEqual(merged.requiredSkills,['Python','PostgreSQL']);
  assert.deepEqual(mergePresentFields({location:'Москва',years:5},{location:'',years:0}),{location:'',years:0});
  assert.equal(NeedPatchBody.safeParse({title:'Backend-разработчик'}).success,false);
  assert.equal(NeedPatchBody.safeParse({revision:3}).success,false);
  assert.equal(NeedPatchBody.safeParse({revision:3,companyId:99}).success,false);
  assert.equal(JobPatchBody.safeParse({title:'Backend-разработчик'}).success,false);
  const salaryPatch=JobPatchBody.parse({version:4,salaryMin:400000});
  const {version:_revision,...jobFields}=salaryPatch;
  assert.equal(jobInput.safeParse(mergePresentFields(contextBaseFields(job,JobInputShape),jobFields)).success,false,'partial salary must be checked against preserved maximum');
});

test('job and need with equal numeric ID remain distinct, and absent legacy levels are not invented',async()=>{
  const {needSelectionContext,jobSelectionContext}=await contextModule;
  const a=needSelectionContext(need,{'python':'Middle'});
  const b=jobSelectionContext(job,[{skill:'Python',level:'Senior'},{skill:'PostgreSQL'}]);
  assert.notEqual(selectionContextKey(a),selectionContextKey(b));
  assert.equal(a.version,3);assert.equal(b.version,4);
  assert.deepEqual(b.requiredSkills,['Python','PostgreSQL']);assert.deepEqual(b.desirableSkills,[]);
  assert.deepEqual(b.requiredSkillLevels,{'skill:python':'Senior'});
  assert.equal(selectionContextActive({...a,status:'archived'}),false);
  assert.equal(selectionContextActive({...b,status:'closed'}),false);
  assert.equal(selectionContextActive(b),true);
});

test('invitations require exactly one typed source and a current version for jobs and private needs',()=>{
  const body={candidateId:9,resumeId:11,title:'Backend-разработчик',message:'Приглашаем обсудить условия',reason:'Подходит подтверждённый опыт',
    salaryMin:200000,salaryMax:300000,salaryPeriod:'month',salaryType:'gross',workFormat:'Удалённо'};
  assert.equal(ContextCreateInvitationBody.safeParse({...body,needId:5,contextVersion:3}).success,true);
  assert.equal(ContextCreateInvitationBody.safeParse({...body,needId:5}).success,false);
  assert.equal(ContextCreateInvitationBody.safeParse({...body,jobId:5,contextVersion:4,resumeRevision:2}).success,true);
  assert.equal(ContextCreateInvitationBody.safeParse({...body,jobId:5}).success,false);
  assert.equal(ContextCreateInvitationBody.safeParse({...body,jobId:5,needId:5,contextVersion:4}).success,false);
  assert.equal(ContextCreateInvitationBody.safeParse(body).success,false);
});

test('sent snapshot freezes the typed context and sent conditions independently from later editing',async()=>{
  const {jobSelectionContext}=await contextModule;
  const context=jobSelectionContext({...job,skills:[...job.skills]});
  const conditions={title:context.title,salaryMin:260000,salaryMax:340000,salaryPeriod:'month',salaryType:'net',workFormat:'Гибрид'};
  const snapshot=invitationContextSnapshot(context,conditions);
  context.version=5;context.requiredSkills.push('Redis');conditions.salaryMin=900000;
  assert.equal(snapshot.version,4);assert.deepEqual(snapshot.requiredSkills,['Python','PostgreSQL']);
  assert.equal((snapshot.invitationConditions as typeof conditions).salaryMin,260000);
  assert.equal((snapshot.invitationConditions as typeof conditions).salaryType,'net');
});

function mockReader(rows:Record<string,unknown[]>) {
  const calls:{table:string;params:unknown[];lock:boolean}[]=[];
  const dialect=new PgDialect();
  return {calls,reader:{select(){let call:{table:string;params:unknown[];lock:boolean};
    const builder:any={from(table:any){call={table:getTableConfig(table).name,params:[],lock:false};calls.push(call);return builder;},
      where(condition:any){call.params=dialect.sqlToQuery(condition).params;return builder;},limit(){return builder;},groupBy(){return builder;},
      for(){call.lock=true;return builder;},then(resolve:any,reject:any){return Promise.resolve(rows[call.table]??[]).then(resolve,reject);}};
    return builder;}} as any};
}
test('shared loader reads owned typed context afresh, locks when asked and does not insert a hidden need',async()=>{
  const {loadOwnedSelectionContext}=await contextModule;
  const rows={signal_needs:[need],signal_jobs:[job],signal_need_skill_levels:[{needId:5,levels:{python:'Middle'}}],signal_job_requirements:[{jobId:5,skillRequirements:[{skill:'Python',level:'Senior'}]}]};
  const mock=mockReader(rows);
  const selected=await loadOwnedSelectionContext(7,{type:'job',id:5},mock.reader,{lock:true});
  assert.equal(selected?.context.type,'job');assert.equal(selected?.matchNeed.grade,'Senior');
  assert.deepEqual(mock.calls[0].params,[7,5]);assert.equal(mock.calls[0].lock,true);
  assert.equal(mock.calls.some(call=>call.table==='signal_needs'),false);
  rows.signal_jobs[0]={...job,version:5};
  assert.equal((await loadOwnedSelectionContext(7,{type:'job',id:5},mock.reader))?.context.version,5);
  assert.equal((await loadOwnedSelectionContext(7,{type:'need',id:5},mock.reader))?.context.version,3);
  const missing=mockReader({});assert.equal(await loadOwnedSelectionContext(8,{type:'job',id:5},missing.reader),null);
  assert.deepEqual(missing.calls[0].params,[8,5]);
});
test('card counters use two grouped owned reads and retain job/need distinction',async()=>{
  const {loadSelectionCounters}=await contextModule;
  const mock=mockReader({signal_shortlist:[{type:'job',id:5,total:2},{type:'need',id:5,total:1}],signal_applications:[{id:5,total:3}]});
  const result=await loadSelectionCounters(7,mock.reader);
  assert.equal(result.shortlist.get('job:5'),2);assert.equal(result.shortlist.get('need:5'),1);assert.equal(result.applications.get(5),3);
  assert.equal(mock.calls.length,2);mock.calls.forEach(call=>assert.deepEqual(call.params,[7]));
});
test('matching-only document definitions include owned active jobs with exact explicit levels and no hidden needs',async()=>{
  const {listActiveOwnedMatchNeeds}=await contextModule;
  const mock=mockReader({signal_jobs:[job],signal_job_requirements:[{jobId:5,skillRequirements:[{skill:'Python',level:'Senior'},{skill:'PostgreSQL'}]}]});
  const definitions=await listActiveOwnedMatchNeeds(7,'Backend / Python',mock.reader);
  assert.equal(definitions.length,1);assert.equal(definitions[0].grade,'Senior');
  assert.deepEqual(definitions[0].requiredSkillLevels,{'skill:python':'Senior'});assert.deepEqual(definitions[0].desirableSkills,[]);
  assert.deepEqual(mock.calls.find(call=>call.table==='signal_jobs')!.params,[7,'Backend / Python','draft','published']);
  assert.deepEqual(mock.calls.find(call=>call.table==='signal_needs')!.params,[7,'Backend / Python','active']);
});
test('persistent schema uniqueness includes company + typed context + person; no snapshots or contacts saved',()=>{
  const table=getTableConfig(signalShortlistTable);
  const unique=table.indexes.find(index=>index.config.name==='signal_shortlist_person_unique')!;
  assert.equal(unique.config.unique,true);
  assert.deepEqual(unique.config.columns.map((column:any)=>column.name),['company_id','context_type','context_id','candidate_user_id']);
  assert.equal(table.columns.some(column=>/snapshot|contact|alias|avatar/.test(column.name)),false);
});
test('standalone saved-candidate projection masks pseudonymous identity and excludes examiner criteria, dates and bank versions',async()=>{
  const {safeShortlistCandidate}=await import('../artifacts/api-server/src/lib/shortlist-access');
  const row:any={userId:9,alias:'Разрешённый псевдоним',visibility:'pseudonymous',publicName:'Скрытое настоящее имя',avatarDataUrl:'private-photo',
    resumeId:10,resumeRevision:1,title:'Backend-разработчик',specialization:'Backend / Python',verifiedGrade:'Junior',verifiedScore:null,
    verifiedSkills:['Python'],stack:['Python'],statedSkills:['Python'],yearsExperience:3,workFormat:'Удалённо',salaryMin:100000,salaryMax:200000,
    salaryPeriod:'month',salaryType:'gross',readyForOffers:true,latestAssessmentAt:null,
    skillEvidence:[{skill:'Python',level:'Junior',sourceType:'signal_skill_module',criterion:'private examiner details',programVersion:'private-bank-version',date:'private-date',attemptId:99}]};
  const projected=safeShortlistCandidate(row),encoded=JSON.stringify(projected);
  assert.equal(projected.publicName,null);assert.equal(projected.avatarDataUrl,null);
  assert.deepEqual(projected.skillEvidence,[{skill:'Python',level:'Junior',sourceType:'signal_skill_module'}]);
  for(const secret of ['Скрытое настоящее имя','private-photo','private examiner details','private-bank-version','private-date'])assert.equal(encoded.includes(secret),false);
});
test('migration 16 preserves old invitation IDs and grants and forbids cascade from context to invitation',()=>{
  const sql=readFileSync('lib/db/migrations/0015_employer_selection_workspace.sql','utf8');
  assert.match(sql,/need_id DROP NOT NULL/);assert.match(sql,/CHECK \(\(need_id IS NOT NULL\) <> \(job_id IS NOT NULL\)\)/);
  assert.match(sql,/FOREIGN KEY \(need_id\).*ON DELETE RESTRICT/);
  assert.equal(/DELETE FROM|TRUNCATE|DROP TABLE|signal_assessment_attempts/i.test(sql),false);
  assert.match(sql,/'legacyConditionsOnly', true/);
});
