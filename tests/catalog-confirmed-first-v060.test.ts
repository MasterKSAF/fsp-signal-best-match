import test from 'node:test';
import assert from 'node:assert/strict';
import {orderCatalog,deduplicateResumes,matchesCatalogFilters,safeCatalogResume,type CatalogResume} from '../artifacts/api-server/src/lib/signal-resume-catalog';
import {catalogueComputation} from '../artifacts/api-server/src/lib/signal-catalog-computation';
import {readonlyResumeProjection} from '../artifacts/api-server/src/lib/signal-readonly-resume';
const now=new Date('2026-10-07T12:00:00Z'),scope={demoMode:false,reviewScopeId:null};
function row(id:number,patch:Partial<CatalogResume>={}):CatalogResume {
  return {userId:id,resumeId:id*10,resumeRevision:1,title:'Synthetic resume',alias:String.fromCharCode(65+id),specialization:'Backend / Python',verifiedGrade:null,verifiedScore:null,verifiedSkills:[],stack:['Python'],statedSkills:['SQL'],yearsExperience:2,workFormat:'Удалённо',salaryMin:null,salaryMax:null,salaryPeriod:'month',salaryType:'gross',latestAssessmentAt:null,hasFspHistory:false,visibility:'pseudonymous',consentMatching:true,consentCatalog:true,readyForOffers:false,demoMode:false,avatarDataUrl:null,publicName:null,deletedAt:null,legacyQualification:null,...patch};
}
test('mixed catalogue puts confirmed people first without universal Senior, FSP or cross-version score order',()=>{
  const data=[row(1,{alias:'A unconfirmed'}),row(2,{alias:'Z Senior',verifiedGrade:'Senior',verifiedScore:100,hasFspHistory:true}),row(3,{alias:'B Junior',verifiedGrade:'Junior',verifiedScore:83}),row(4,{alias:'C unconfirmed'})];
  const result=orderCatalog(deduplicateResumes(data));assert.deepEqual(result.people.map(p=>p.selected.userId),[3,2,1,4]);assert.equal(result.confirmedTotal,2);assert.equal(result.unconfirmedTotal,2);assert.equal(result.order,'confirmed-first');assert.equal(result.confirmedOrder,'neutral-alias');
  const card=safeCatalogResume(data[0]!);assert.equal(card.confirmationStatus,'unconfirmed');assert.deepEqual(card.qualificationNextStep,{action:'take_signal_qualification',resumeId:10,specialization:'Backend / Python'});assert.equal(safeCatalogResume(data[2]!).qualificationNextStep,null);
});
test('confirmation selects one actual whole filtered résumé, before counts and paging; excluded grades cannot bleed into it',()=>{
  const data=[row(1),row(1,{resumeId:11,verifiedGrade:'Middle',specialization:'Frontend / TypeScript',title:'Frontend confirmed'}),...Array.from({length:29},(_,n)=>row(n+2,{verifiedGrade:n%2?'Middle':null}))];
  const all=orderCatalog(deduplicateResumes(data));assert.equal(all.people.length,30);assert.equal(all.people.find(p=>p.selected.userId===1)!.selected.resumeId,11);
  assert.equal(new Set([...all.people.slice(0,24),...all.people.slice(24)].map(p=>p.selected.userId)).size,30);
  const filtered=data.filter(r=>matchesCatalogFilters(r,{specialization:'Backend / Python'},now)),selected=deduplicateResumes(filtered).find(p=>p.selected.userId===1)!;
  assert.equal(selected.selected.resumeId,10);assert.equal(selected.selected.verifiedGrade,null);assert.equal(selected.alternatives.length,1);
  const noGrade=data.filter(r=>matchesCatalogFilters(r,{grade:'unconfirmed'},now));assert.ok(deduplicateResumes(noGrade).every(p=>p.selected.verifiedGrade===null));
});
test('warm owned catalogue reuses exact current snapshot only; revocation, hide and consent produce fresh band/count results',()=>{
  const owned=(r:CatalogResume[])=>Object.freeze(r.map(readonlyResumeProjection)) as unknown as CatalogResume[];
  const first=owned([row(1,{verifiedGrade:'Middle'}),row(2)]),cold=catalogueComputation(first,{},scope,now,true);assert.equal(cold.confirmedTotal,1);assert.equal(catalogueComputation(first,{},scope,now,true),cold);
  const revoked=owned([row(1,{verifiedGrade:'Middle',assessmentEvidence:{attemptId:1,candidateId:1,programId:'backend-python',programVersion:'signal-backend-python-v6',grade:'Middle',score:100,submittedAt:now.toISOString(),state:'revoked',comparisonPolicy:'same-program-version-rubric-v1',rubricKey:'synthetic'}}),row(2)]);
  const fresh=catalogueComputation(revoked,{},scope,now,true);assert.equal(fresh.confirmedTotal,0);assert.equal(fresh.unconfirmedTotal,2);assert.equal(fresh.people[0]!.selected.verifiedGrade,null);
  for(const patch of [{visibility:'private' as const},{consentCatalog:false},{deletedAt:now}]){const hidden=catalogueComputation(owned([row(1,patch),row(2)]),{},scope,now,true);assert.equal(hidden.availableTotal,1);assert.equal(hidden.people.length,1);}
});
