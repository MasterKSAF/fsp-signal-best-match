import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogueComputation } from '../artifacts/api-server/src/lib/signal-catalog-computation';
import { readonlyResumeProjection } from '../artifacts/api-server/src/lib/signal-readonly-resume';
import { catalogVisible, matchesCatalogFilters, deduplicateResumes, orderCatalog, type CatalogResume, type CatalogFilters } from '../artifacts/api-server/src/lib/signal-resume-catalog';
const now=new Date('2026-10-06T12:00:00Z'),scope={demoMode:false,reviewScopeId:null};
function row(userId:number,resumeId:number,patch:Partial<CatalogResume>={}):CatalogResume {
  return {userId,resumeId,resumeRevision:1,title:'Backend',alias:`Alias ${userId}`,specialization:'Backend / Python',verifiedGrade:'Middle',verifiedScore:100,verifiedSkills:['Python','SQL'],stack:['Python'],statedSkills:['SQL'],workFormat:'Удалённо',salaryMin:150000,salaryMax:250000,salaryPeriod:'month',salaryType:'gross',latestAssessmentAt:new Date(now.getTime()-30*86400000),hasFspHistory:false,visibility:'pseudonymous',consentMatching:true,consentCatalog:true,readyForOffers:true,avatarDataUrl:null,publicName:null,deletedAt:null,legacyQualification:null,yearsExperience:3,demoMode:false,...patch};
}
function owned(rows:CatalogResume[]) {return Object.freeze(rows.map(readonlyResumeProjection)) as unknown as CatalogResume[];}
function oracle(rows:CatalogResume[],filters:CatalogFilters,at:Date=now) {
  const visible=rows.filter(r=>catalogVisible(r,false)),filtered=visible.filter(r=>matchesCatalogFilters(r,filters,at)),ordered=orderCatalog(deduplicateResumes(filtered));
  return {visible,filtered,...ordered,availableTotal:deduplicateResumes(visible).length,specializations:[...new Set(visible.map(r=>r.specialization))].sort()};
}
test('owned catalogue computation retains exact whole-resume filters/order/counts and one context per immutable current snapshot',()=>{
  const rows=owned([row(1,1),row(1,2,{verifiedSkills:['TypeScript'],specialization:'Frontend / TypeScript'}),row(2,3,{salaryType:'net'}),row(3,4,{visibility:'private'})]);
  const filters:CatalogFilters={skills:['Python','SQL'],salaryMin:170000,salaryMax:220000,salaryPeriod:'month',salaryType:'gross'};
  const cold=catalogueComputation(rows,filters,scope,now,true);assert.deepEqual(cold,oracle(rows,filters));
  const warm=catalogueComputation(rows,{...filters,skills:[...filters.skills!]},{...scope},new Date(now.getTime()+1000),true);assert.equal(warm,cold);assert.equal(cold.people.length,1);assert.equal(cold.availableTotal,2);
  const other=catalogueComputation(rows,{q:'Alias 2'},scope,now,true);assert.deepEqual(other,oracle(rows,{q:'Alias 2'}));assert.notEqual(other,cold);
  assert.notEqual(catalogueComputation(rows,filters,scope,now,true),cold,'Replacing the single context releases the previous filter computation');
  const changed=owned([row(1,1,{consentCatalog:false}),row(2,3)]);
  assert.deepEqual(catalogueComputation(changed,{},scope,now,true),oracle(changed,{}));
  assert.equal(catalogueComputation(changed,{},scope,now,true).people.length,1);
  const revoked=owned([row(1,1,{assessmentEvidence:{attemptId:9,candidateId:1,programId:'backend-python',programVersion:'v6',grade:'Middle',score:100,submittedAt:now.toISOString(),state:'revoked',comparisonPolicy:'same-program-version-rubric-v1',rubricKey:'rubric'}})]);
  assert.equal(catalogueComputation(revoked,{skills:['SQL']},scope,now,true).people.length,0);
});
test('temporal, need/default opt-out and arbitrary frozen sources bypass shared computation; current clock and pool remain material',()=>{
  const rows=owned([row(1,1)]),filters={checkedWithinDays:30};
  assert.equal(catalogueComputation(rows,filters,scope,now,true).people.length,1);
  assert.equal(catalogueComputation(rows,filters,scope,new Date(now.getTime()+1),true).people.length,0);
  const first=catalogueComputation(rows,{},scope,now,false),second=catalogueComputation(rows,{},scope,now,false);assert.notEqual(first,second);
  const unsafe=Object.freeze([Object.freeze(row(1,1))]) as unknown as CatalogResume[];
  assert.notEqual(catalogueComputation(unsafe,{},scope,now,true),catalogueComputation(unsafe,{},scope,now,true));
  const ordinary=catalogueComputation(rows,{},scope,now,true),otherScope=catalogueComputation(rows,{}, {...scope,reviewScopeId:'other-owned-scope'},now,true);assert.notEqual(ordinary,otherScope);
  assert.equal(catalogueComputation(rows,{}, {demoMode:true,reviewScopeId:null},now,true).people.length,0);
});
