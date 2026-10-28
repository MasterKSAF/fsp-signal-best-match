import assert from 'node:assert/strict';
import test from 'node:test';
import {assembleManagedAttempt} from '../artifacts/api-server/src/lib/assessment-managed';
import {getResumeQualification,type ResumeQualificationAttempt} from '../artifacts/api-server/src/lib/signal-resume-qualification';
import {projectLegacyResumeSkillEvidence} from '../artifacts/api-server/src/lib/signal-resume-skill-projection';
import {skillModuleRegistry,SKILL_BANK_VERSION} from '../artifacts/api-server/src/lib/skill-module-bank';
import type {SkillModuleEvidence} from '../artifacts/api-server/src/lib/skill-module-qualification';
import type {CatalogResume} from '../artifacts/api-server/src/lib/signal-resume-catalog';
import {evaluateResumeCandidates} from '../artifacts/api-server/src/lib/signal-resume-evaluation';
import {rankMatches} from '../artifacts/api-server/src/lib/signal-matching';
import {selectMatchingResumes} from '../artifacts/api-server/src/lib/signal-resume-catalog';
import {catalogueComputation} from '../artifacts/api-server/src/lib/signal-catalog-computation';
import {createRequire} from 'node:module';
const {PgDialect}=createRequire(new URL('../artifacts/api-server/package.json',import.meta.url))('drizzle-orm/pg-core');

const at=new Date('2026-10-08T00:00:00Z');
function cv(userId:number,resumeId:number,patch:Partial<CatalogResume>={}):CatalogResume{return {userId,resumeId,resumeRevision:1,title:`CV ${resumeId}`,alias:`Person ${userId}`,specialization:'Backend / Python',assumedGrade:'Junior',verifiedGrade:null,verifiedScore:null,verifiedSkills:[],stack:['Python','SQL'],statedSkills:[],yearsExperience:2,workFormat:'Удалённо',salaryMin:100000,salaryMax:200000,latestAssessmentAt:null,hasFspHistory:false,visibility:'pseudonymous',consentMatching:true,consentCatalog:true,readyForOffers:true,demoMode:false,avatarDataUrl:null,publicName:null,deletedAt:null,legacyQualification:null,...patch};}
function attempt(id:number):ResumeQualificationAttempt{
  const form=assembleManagedAttempt('backend-python','Middle',`c04-${id}`,{programVersion:'signal-backend-python-v6'});
  return {id,userId:17,resumeId:99,resumeRevision:1,purpose:'signal_qualification',purposeOrigin:'candidate_confirmed',gradeConfirmedAt:at,resumeSpecialization:'Backend / Python',programVersion:'signal-backend-python-v6',programId:'backend-python',grade:'Middle',status:'submitted',...form,answers:form.cases.map(item=>({caseId:item.id,answer:form.oracles[item.id]!.answer})),score:100,verified:true,gradeChanged:true,startedAt:at,dueAt:at,submittedAt:at};
}
function proof(userId:number,skillId:string):SkillModuleEvidence{
  const module=skillModuleRegistry.find(row=>row.id===skillId)!,id=userId*10+skillModuleRegistry.indexOf(module);
  return {id,userId,attemptId:id+10000,skillId,level:'Junior',programVersion:SKILL_BANK_VERSION,competencyIds:[...module.competencies],verifiedAt:at,decision:{score:100,passed:true,criticalComplete:true,competencies:module.competencies.map(id=>({id,label:id,passed:true,critical:true})),failedCritical:[]}};
}
let imports:Promise<{module:typeof import('../artifacts/api-server/src/lib/signal-skill-matching');matching:typeof import('../artifacts/api-server/src/lib/signal-resume-matching')}>|undefined;
function services(){process.env.DATABASE_URL='postgresql://unit_only:unused@127.0.0.1:1/unit_mock_never_connect';return imports??=Promise.all([import('../artifacts/api-server/src/lib/signal-skill-matching'),import('../artifacts/api-server/src/lib/signal-resume-matching')]).then(([module,matching])=>({module,matching}));}

test('request-local legacy derivation reuses identical declared contexts but preserves each whole CV',()=>{
  const rows=[cv(17,1),cv(17,2,{title:'Second CV',salaryMin:130000,resumeRevision:9}),cv(17,3)],before=structuredClone(rows),work={qualificationCalls:0,derivedSkillArrays:0};
  const result=projectLegacyResumeSkillEvidence(rows,{attempts:[attempt(1)],correctedIds:new Set()},new Map(),work);
  assert.equal(work.qualificationCalls,1);assert.equal(work.derivedSkillArrays,1);
  assert.equal(result[0]!.verifiedGrade,'Middle');assert.equal(result[1]!.title,'Second CV');assert.equal(result[1]!.salaryMin,130000);assert.equal(result[1]!.resumeRevision,9);
  assert.notEqual(result[0],result[1]);assert.equal(result[0]!.skillEvidence,result[1]!.skillEvidence);assert.equal(result[0]!.verifiedSkills,result[1]!.verifiedSkills);
  assert.deepEqual(rows,before);assert.ok(result.every(row=>row.skillEvidence!.every(p=>p.candidateId===17&&p.attemptId===1&&p.date===at.toISOString())));
});
test('owner, specialization, declared target and historical context remain separate; each matches independent qualification',()=>{
  const history={specialization:'Backend / Python',grade:'Senior' as const,score:91,skills:['SQL'],assessedAt:at.toISOString(),gradeChangedAt:null,attemptId:null,limitation:'Saved history'};
  const rows=[cv(17,1),cv(18,2),cv(17,3,{specialization:'Frontend / TypeScript'}),cv(17,4,{stack:[]}),cv(17,5,{assumedGrade:'Middle'}),cv(17,6,{legacyQualification:history})];
  const inputs={attempts:[attempt(1)],correctedIds:new Set<number>()},work={qualificationCalls:0,derivedSkillArrays:0};
  const result=projectLegacyResumeSkillEvidence(rows,inputs,new Map(),work);assert.equal(work.qualificationCalls,6);
  result.forEach((row,i)=>{const expected=getResumeQualification(rows[i]!,inputs.attempts,inputs.correctedIds);assert.equal(row.verifiedGrade,expected.verifiedGrade);assert.deepEqual(row.verifiedSkills,expected.verifiedSkills);assert.ok(row.skillEvidence?.every(p=>p.candidateId===row.userId));});
  assert.equal(result[1]!.verifiedGrade,null);assert.equal(result[2]!.verifiedGrade,null);assert.equal(result[5]!.verifiedGrade,'Senior');
});
test('next request sees legacy corrections, deletion of proof and version mismatch without altering historical attempts',()=>{
  const saved=attempt(1),history=structuredClone(saved),rows=[cv(17,1),cv(17,2)];
  const first=projectLegacyResumeSkillEvidence(rows,{attempts:[saved],correctedIds:new Set()});assert.equal(first[0]!.verifiedGrade,'Middle');
  for(const inputs of [{attempts:[saved],correctedIds:new Set([1])},{attempts:[],correctedIds:new Set<number>()},{attempts:[{...saved,programVersion:'signal-backend-python-v999'}],correctedIds:new Set<number>()}]){
    const next=projectLegacyResumeSkillEvidence(rows,inputs);assert.ok(next.every(row=>row.verifiedGrade===null&&row.skillEvidence?.length===0));
  }
  assert.equal(first[0]!.verifiedGrade,'Middle');assert.deepEqual(saved,history);
});
test('modular derived arrays are reused only for the exact target and legacy array, and in-place mode accepts only fresh projection rows',async()=>{
  const {module}=await services(),raw=[cv(17,1),cv(17,2),cv(17,3)],before=structuredClone(raw);
  const evidence=['python','sql','backend-engineering'].map(id=>proof(17,id));
  const projected=projectLegacyResumeSkillEvidence(raw,{attempts:[],correctedIds:new Set()}),expected=module.projectCurrentSkillModuleEvidence(projected,{evidence,revokedIds:new Set()});
  const work={qualificationCalls:0,moduleEvidenceGenerations:0,derivedSkillArrays:0,wholeRowCopies:0};
  const result=module.projectCurrentSkillModuleEvidence(projected,{evidence,revokedIds:new Set()},{mutateLocalProjection:true,work});
  assert.deepEqual(result,expected);assert.equal(result[0],projected[0]);assert.equal(result[0]!.skillEvidence,result[1]!.skillEvidence);assert.deepEqual(work,{qualificationCalls:1,moduleEvidenceGenerations:1,derivedSkillArrays:1,wholeRowCopies:0});assert.deepEqual(raw,before);
  assert.throws(()=>module.projectCurrentSkillModuleEvidence([Object.freeze(cv(17,7))],{evidence,revokedIds:new Set()},{mutateLocalProjection:true}),/shared frozen pool/);
  const revoked=module.projectCurrentSkillModuleEvidence(projectLegacyResumeSkillEvidence(raw,{attempts:[],correctedIds:new Set()}),{evidence,revokedIds:new Set([evidence[0]!.id])},{mutateLocalProjection:true});assert.ok(revoked.every(row=>row.verifiedGrade===null));
});
test('page presentation reads only current public photos, keeps qualification intact and does not reuse a removed image',async()=>{
  const {matching}=await services();let photoRows=[{resumeId:1,data:'data:image/png;base64,own_photo'}],reads=0;
  const reader={select(columns:unknown){reads++;assert.deepEqual(Object.keys(columns as object).sort(),['data','resumeId']);return {from(){return {innerJoin(){return {where(){return Promise.resolve(photoRows);}};}};}};}} as Parameters<typeof matching.withResumePhotos>[1];
  const qualification=projectLegacyResumeSkillEvidence([cv(17,1,{visibility:'public',hasAccessiblePhoto:true})],{attempts:[attempt(1)],correctedIds:new Set()});
  const first=await matching.withResumePhotos(qualification,reader);assert.equal(first[0]!.avatarDataUrl,photoRows[0]!.data);assert.equal(first[0]!.skillEvidence,qualification[0]!.skillEvidence);assert.equal(first[0]!.verifiedGrade,'Middle');
  photoRows=[];const fresh=await matching.withResumePhotos(qualification,reader);assert.equal(fresh[0]!.avatarDataUrl,null);assert.equal(reads,2);
  const hidden=await matching.withResumePhotos([{...qualification[0]!,visibility:'pseudonymous'}],reader);assert.equal(hidden[0]!.avatarDataUrl,null);assert.equal(reads,2,'nonpublic photo not queried');
});
test('whole-pool matching ordinal, selected CV, catalog totals and fresh consent/deletion guards survive reuse',async()=>{
  const {module}=await services(),rows=[cv(17,1,{stack:[]}),cv(17,2),cv(18,3)],evidence=[17,18].flatMap(owner=>['python','sql','backend-engineering'].map(id=>proof(owner,id)));
  const project=(source:CatalogResume[],revokedIds=new Set<number>())=>module.projectCurrentSkillModuleEvidence(projectLegacyResumeSkillEvidence(source,{attempts:[],correctedIds:new Set()}),{evidence,revokedIds},{mutateLocalProjection:true});
  const need={specialization:'Backend / Python',grade:'Junior' as const,requiredSkills:['Python'],desirableSkills:[],workFormat:'Удалённо',salaryMin:100000,salaryMax:200000};
  const enriched=project(rows),scope={demoMode:false,reviewScopeId:null};
  const ranking=(pool:CatalogResume[])=>rankMatches(selectMatchingResumes(evaluateResumeCandidates(need,pool,false,at).filter(row=>row.evaluation.eligible)));
  const ranked=ranking(enriched);assert.equal(ranked.length,2);assert.equal(ranked[0]!.candidate.resumeId,2);assert.deepEqual(ranked.map(row=>row.evaluation.ranking.position),[1,2]);assert.ok(ranked.every(row=>row.evaluation.ranking.poolSize===2));
  assert.equal(ranked.find(row=>row.candidate.resumeId===3)!.evaluation.ranking.position,2,'addressed explanation uses entire pool ordinal');
  const catalog=catalogueComputation(enriched,{},scope,at,false);assert.equal(catalog.availableTotal,2);assert.equal(catalog.people.length,2);assert.equal(catalog.people.find(row=>row.selected.userId===17)!.selected.resumeId,2);
  assert.equal(ranking(project(rows.map(row=>row.userId===18?{...row,consentMatching:false}:row))).length,1);
  assert.equal(catalogueComputation(project(rows.map(row=>row.userId===18?{...row,consentCatalog:false}:row)),{},scope,at,false).availableTotal,1);
  assert.equal(catalogueComputation(project(rows.map(row=>row.userId===18?{...row,deletedAt:at}:row)),{},scope,at,false).availableTotal,1);
  assert.equal(ranking(project(rows,new Set([evidence.find(p=>p.userId===18&&p.skillId==='python')!.id]))).length,1);
});
test('fresh qualification input SQL binds whole ID arrays once and reads correction IDs without caching',async()=>{
  await services();process.env.SIGNAL_SKILL_MODULES_ENABLED='true';
  const {loadSkillQualificationInputs}=await import('../artifacts/api-server/src/lib/skill-module-service');
  const {loadCandidateQualificationInputs}=await import('../artifacts/api-server/src/lib/signal-resume');
  const dialect=new PgDialect(),queries:{sql:string;params:unknown[]}[]=[],saved=[proof(17,'python'),proof(17,'sql')];let results:unknown[][]=[saved,[{evidenceId:saved[0]!.id}],[],[]];
  const reader={select(){return {from(){return {where(predicate:unknown){queries.push(dialect.sqlToQuery(predicate));return Promise.resolve(results.shift()!);}};}};}} as Parameters<typeof loadSkillQualificationInputs>[1];
  const first=await loadSkillQualificationInputs([17,17,18],reader);assert.equal(queries.length,4);assert.deepEqual(queries[0]!.params,[[17,18]]);assert.deepEqual(queries[1]!.params,[saved.map(p=>p.id)]);assert.ok(queries.every(q=>q.sql.includes('any(')&&q.sql.includes('::int[]')));assert.deepEqual([...first.revokedIds],[saved[0]!.id]);
  results=[saved,[],[],[]];const second=await loadSkillQualificationInputs([17],reader);assert.equal(queries.length,8);assert.equal(second.revokedIds.size,0,'new correction query on every request');
  queries.length=0;results=[[attempt(1)],[{attemptId:1}],[]];const historical=await loadCandidateQualificationInputs([17,17],reader);assert.equal(queries.length,3);assert.deepEqual(queries[0]!.params,[[17],'submitted']);assert.deepEqual(queries[1]!.params,[[1]]);assert.deepEqual([...historical.correctedIds],[1]);
  queries.length=0;assert.deepEqual((await loadCandidateQualificationInputs([],reader)).attempts,[]);assert.equal(queries.length,0);
});
