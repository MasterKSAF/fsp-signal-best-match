/** Independently curated tiny catalog expectations. No database, API or load. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { catalogueComputation } from '../artifacts/api-server/src/lib/signal-catalog-computation';
import { readonlyResumeProjection } from '../artifacts/api-server/src/lib/signal-readonly-resume';
import type { CatalogFilters, CatalogResume } from '../artifacts/api-server/src/lib/signal-resume-catalog';
import type { SignalPoolScope } from '../artifacts/api-server/src/lib/signal-pool-scope';

const now=new Date('2026-10-06T12:00:00Z'),scope:SignalPoolScope={demoMode:false,reviewScopeId:null};
const base:CatalogResume={userId:1,resumeId:11,resumeRevision:1,title:'Whole Python resume',alias:'Alpha',specialization:'Backend / Python',verifiedGrade:'Middle',verifiedScore:90,verifiedSkills:['Python','SQL'],stack:['Python','SQL'],statedSkills:[],yearsExperience:3,workFormat:'Удалённо',salaryMin:100000,salaryMax:200000,salaryPeriod:'month',salaryType:'gross',latestAssessmentAt:new Date('2026-10-05T12:00:00Z'),hasFspHistory:true,visibility:'pseudonymous',consentMatching:true,consentCatalog:true,readyForOffers:true,demoMode:false,deletedAt:null,legacyQualification:null,avatarDataUrl:null,publicName:null,hasAccessiblePhoto:false,assessmentEvidence:{attemptId:101,candidateId:1,programId:'backend-python',programVersion:'signal-backend-python-v6',grade:'Middle',score:90,submittedAt:'2026-10-05T12:00:00Z',state:'verified',comparisonPolicy:'same-program-version-rubric-v1',rubricKey:'a'.repeat(64)}};
const fixtures:CatalogResume[]=[base,
  {...base,resumeId:12,title:'Whole frontend alternative',specialization:'Frontend / TypeScript',verifiedGrade:'Junior',verifiedScore:100,verifiedSkills:['TypeScript'],stack:['TypeScript'],yearsExperience:4,visibility:'public',hasAccessiblePhoto:true,readyForOffers:false,assessmentEvidence:{...base.assessmentEvidence!,attemptId:102,programId:'frontend-typescript',programVersion:'signal-frontend-typescript-v2',grade:'Junior',score:100}},
  {...base,userId:2,resumeId:21,alias:'Beta',hasFspHistory:false,yearsExperience:1,verifiedGrade:null,verifiedScore:null,verifiedSkills:[],latestAssessmentAt:null,salaryMin:60000,salaryMax:100000,salaryType:'net',assessmentEvidence:null},
  {...base,userId:3,resumeId:31,alias:'Gamma',yearsExperience:8,verifiedGrade:'Senior',verifiedSkills:['Python'],latestAssessmentAt:new Date('2026-03-01T12:00:00Z'),workFormat:'В офисе',salaryMin:2400000,salaryMax:3000000,salaryPeriod:'year',visibility:'public',hasAccessiblePhoto:true,hasFspHistory:false,assessmentEvidence:{...base.assessmentEvidence!,attemptId:103,candidateId:3,grade:'Senior',submittedAt:'2026-03-01T12:00:00Z'}},
  {...base,userId:4,resumeId:41,alias:'Delta',yearsExperience:5,hasFspHistory:false,readyForOffers:false,salaryMin:150000,salaryMax:250000,assessmentEvidence:{...base.assessmentEvidence!,attemptId:104,candidateId:4,state:'revoked'}},
  {...base,userId:5,resumeId:51,alias:'Private',visibility:'private'},
  {...base,userId:6,resumeId:61,alias:'No catalog consent',consentCatalog:false},
];
const owned=(rows:CatalogResume[])=>Object.freeze(rows.map(row=>readonlyResumeProjection(row))) as unknown as CatalogResume[];
const rows=owned(fixtures),checks:string[]=[];
const selected=(result:ReturnType<typeof catalogueComputation>)=>result.people.map(person=>person.selected.resumeId);
const all=catalogueComputation(rows,{},scope,now,true);
assert.deepEqual(selected(all),[11,21,41,31]);assert.equal(all.availableTotal,4);assert.equal(all.visible.length,5);
assert.deepEqual(all.people[0]!.alternatives.map(row=>row.resumeId),[11,12]);
assert.equal(all.order,'neutral-alias');assert.equal(catalogueComputation(rows,{},scope,new Date('2027-01-01'),true),all,'Timeless neutral ordering may reuse the same immutable computation');
assert.equal(all.visible.find(row=>row.resumeId===41)!.verifiedGrade,null);assert.deepEqual(all.visible.find(row=>row.resumeId===41)!.verifiedSkills,[]);
checks.push('Curated whole-resume selection, cross-program neutral order, revoked proof clearing and consent/private exclusions match known IDs');

const cases:[CatalogFilters,number[]][]=[
  [{q:'ALP'},[11]],
  [{specialization:'Frontend / TypeScript'},[12]],
  [{grade:'unconfirmed'},[21,41]],
  [{skills:['Python','SQL']},[11]],
  [{skills:['SQL','TypeScript']},[]],
  [{fsp:'yes'},[11]],
  [{experienceMin:6},[31]],
  [{experienceMax:1},[21]],
  [{workFormat:'Удалённо'},[11,21,41]],
  [{hasPhoto:'yes'},[12,31]],
  [{readyForOffers:'no'},[12,41]],
  [{salaryMin:120000,salaryMax:160000,salaryPeriod:'month',salaryType:'gross'},[11,41]],
  [{salaryMin:60000,salaryMax:80000,salaryPeriod:'month',salaryType:'net'},[21]],
];
for(const [filters,ids] of cases){const cold=catalogueComputation(rows,filters,scope,now,true);assert.deepEqual(selected(cold),ids,JSON.stringify(filters));assert.equal(catalogueComputation(rows,filters,scope,now,true),cold,'Exact filter context must reuse only its matching computation');}
checks.push('Thirteen independently specified search/grade/skill/FSP/experience/format/photo/offer/salary filters preserve exact IDs and cannot union skills across alternatives');

const timed=catalogueComputation(rows,{checkedWithinDays:1},scope,now,true);
assert.deepEqual(selected(timed),[11]);
assert.notEqual(catalogueComputation(rows,{checkedWithinDays:1},scope,now,true),timed,'Time-dependent result must bypass memo even before the boundary');
assert.deepEqual(selected(catalogueComputation(rows,{checkedWithinDays:1},scope,new Date(now.getTime()+1),true)),[]);
const needBypass=catalogueComputation(rows,{},scope,now,false);
assert.notEqual(catalogueComputation(rows,{},scope,now,false),needBypass);
const preNeed=catalogueComputation(rows,{},scope,now,false,true);
assert.deepEqual(selected(preNeed),[11,21,31,41],'Need-mode input preserves dedup/filter membership without an unnecessary neutral sort');
assert.notEqual(catalogueComputation(rows,{},scope,now,false,true),preNeed);
checks.push('checkedWithinDays exact one-day boundary is current on every call; need-mode bypass never retains the computation');

const ordinary=catalogueComputation(rows,{},scope,now,true);
const differentScope=catalogueComputation(rows,{}, {...scope,reviewScopeId:'fe614fd0-8c37-413a-8058-c85029f0d428'},now,true);
assert.notEqual(differentScope,ordinary);assert.deepEqual(selected(differentScope),selected(ordinary));
assert.deepEqual(selected(catalogueComputation(rows,{}, {demoMode:true,reviewScopeId:null},now,true)),[]);
const correction=owned(fixtures.map(row=>row.resumeId===11?{...row,assessmentEvidence:{...row.assessmentEvidence!,state:'revoked' as const}}:row));
assert.deepEqual(selected(catalogueComputation(correction,{grade:'Middle'},scope,now,true)),[]);
const optedOut=owned(fixtures.map(row=>row.userId===1?{...row,consentCatalog:false}:row));
assert.deepEqual(selected(catalogueComputation(optedOut,{},scope,now,true)),[21,41,31]);
checks.push('Exact scope separates memo contexts; fresh corrected and opted-out snapshots cannot borrow previous people or qualification filters');

const plain=fixtures.map(row=>({...row}));const first=catalogueComputation(plain,{q:'ALP'},scope,now,true);
plain[0]!.alias='Changed';plain[1]!.alias='Changed';
assert.deepEqual(selected(catalogueComputation(plain,{q:'ALP'},scope,now,true)),[]);assert.deepEqual(selected(first),[11]);
assert.throws(()=>all.people[0]!.alternatives.push(base),TypeError);
assert.equal(Reflect.set(all,'availableTotal',999),false);
checks.push('Default mutable sources recompute after changes; retained owned arrays/wrappers cannot be changed by a consumer');

const files=['artifacts/api-server/src/lib/signal-catalog-computation.ts','artifacts/api-server/src/lib/signal-resume-catalog.ts','artifacts/api-server/src/routes/signal-candidate-bank.ts','artifacts/api-server/src/lib/signal-readonly-resume.ts','scripts/performance-catalog-independent-review.ts'];
const sourceHashes=Object.fromEntries(await Promise.all(files.map(async path=>[path,createHash('sha256').update(await readFile(path)).digest('hex')])));
const report={passed:true,measuredAt:new Date().toISOString(),checks,curatedFilterCases:cases.length,sourceHashes,scope:'Five tiny groups with independently specified IDs, whole-resume filters, date/context/mutation checks; no SQL/HTTP/DB/process or load. Scope memo isolation is not a substitute for the separate SQL membership ACL, nor a human/SLA claim.'};
const output='outputs/verification/assessment-purpose/performance-catalog-independent-review.json';await mkdir('outputs/verification/assessment-purpose',{recursive:true});
try{const prior=await readFile(output);await mkdir('outputs/verification/assessment-purpose/history',{recursive:true});await writeFile(`outputs/verification/assessment-purpose/history/catalog-review-${createHash('sha256').update(prior).digest('hex').slice(0,12)}.json`,prior,{flag:'wx'});}catch(error:any){if(!['ENOENT','EEXIST'].includes(error.code))throw error;}
await writeFile(output,JSON.stringify(report,null,2));console.log(JSON.stringify({passed:true,groups:checks.length,filterCases:cases.length,output}));
