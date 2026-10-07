import { catalogVisible, deduplicateResumes, matchesCatalogFilters, orderCatalog, prepareCatalogFilters, type CatalogFilters, type CatalogResume } from './signal-resume-catalog';
import { isReadonlyResumeProjection, readonlyResumeProjection } from './signal-readonly-resume';
import type { SignalPoolScope } from './signal-pool-scope';

function compute(rows:CatalogResume[],filters:CatalogFilters,scope:SignalPoolScope,now:Date,skipNeutralOrder=false) {
  const visible=rows.map(row=>{
    if(row.assessmentEvidence?.state!=='revoked')return row;
    const cleared={...row,verifiedGrade:null,verifiedScore:null,verifiedSkills:[],latestAssessmentAt:null};
    return isReadonlyResumeProjection(row)?readonlyResumeProjection(cleared):cleared;
  })
    .filter(row=>catalogVisible(row,scope.demoMode));
  const prepared=prepareCatalogFilters(filters);
  const filtered=visible.filter(row=>matchesCatalogFilters(row,filters,now,prepared));
  const people=deduplicateResumes(filtered);
  const ordered=skipNeutralOrder?{people,order:'need-fit',orderNote:'',confirmedOrder:'need-fit',confirmedTotal:people.filter(p=>p.selected.verifiedGrade!==null).length,unconfirmedTotal:people.filter(p=>p.selected.verifiedGrade===null).length}:orderCatalog(people);
  return {visible,filtered,people:ordered.people,order:ordered.order,orderNote:ordered.orderNote,confirmedOrder:ordered.confirmedOrder,confirmedTotal:ordered.confirmedTotal,unconfirmedTotal:ordered.unconfirmedTotal,
    availableTotal:deduplicateResumes(visible).length,specializations:[...new Set(visible.map(row=>row.specialization))].sort()};
}
type Computation=ReturnType<typeof compute>;
// Only one context per owned snapshot: references/order and safe revocation
// projections, never assessment bodies, mutable Dates, actual photos or contacts.
const memo=new WeakMap<object,{key:string;result:Computation}>();
const maximumDerivedBytes=2*1024*1024;
export function catalogueComputation(rows:CatalogResume[],filters:CatalogFilters,scope:SignalPoolScope,now:Date,allowMemo:boolean,skipNeutralOrder=false) {
  const saved=memo.get(rows);
  const reusable=allowMemo&&!skipNeutralOrder&&filters.checkedWithinDays===undefined&&Object.isFrozen(rows)
    &&(saved!==undefined||rows.every(isReadonlyResumeProjection));
  const key=JSON.stringify([scope,filters]);
  if(reusable&&saved?.key===key)return saved.result;
  const result=compute(rows,filters,scope,now,skipNeutralOrder);
  // Conservative derived reference/array/wrapper estimate. The raw pool's
  // existing 128-MiB budget also reserves 96 extra structural bytes per row.
  const bytes=rows.length*32+result.people.length*192
    +result.people.reduce((sum,person)=>sum+person.alternatives.length*8,0)+1024;
  if(reusable&&bytes<=maximumDerivedBytes) {
    for(const person of result.people) {Object.freeze(person.alternatives);Object.freeze(person);}
    Object.freeze(result.people);Object.freeze(result.visible);Object.freeze(result.filtered);Object.freeze(result.specializations);Object.freeze(result);
    memo.set(rows,{key,result});
  }
  return result;
}
