import assert from 'node:assert/strict';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import {createHash} from 'node:crypto';
import { evaluateMatch, rankMatches, MATCH_ALGORITHM_VERSION, type MatchNeed, type SignalGrade } from '../artifacts/api-server/src/lib/signal-matching';
import { selectMatchingResumes, catalogVisible, matchesCatalogFilters, deduplicateResumes, orderCatalog, type CatalogResume } from '../artifacts/api-server/src/lib/signal-resume-catalog';
import { canonicalSkillKey } from '../artifacts/api-server/src/lib/skill-catalog';
import { emptyFspSignal, compactFspSignal, trustedFspResults } from '../artifacts/api-server/src/lib/fsp-results';
const phase=process.argv[2]; assert.ok(phase==='before'||phase==='after');
const inputs='docs/validation/modular-matching-a10-20261008';
const output=`outputs/verification/full-audit-a01-a11-20261008/matching/${phase}`;
const sha=(b:string|Uint8Array)=>createHash('sha256').update(b).digest('hex');
const load=async(name:string)=>JSON.parse(await readFile(`${inputs}/${name}.json`,'utf8'));
const freeze=await load('freeze');
for(const [name,hash] of Object.entries(freeze.files)) assert.equal(sha(await readFile(`${inputs}/${name}.json`)),hash);
const sourceHashes:Record<string,string>={};
for(const name of Object.keys(freeze.sources)) sourceHashes[name]=sha(await readFile(`artifacts/api-server/src/lib/${name}`));
if(phase==='before') assert.deepEqual(sourceHashes,freeze.sources);
const dataset=await load('dataset'),labels=await load('labels'); const now=new Date(dataset.now);
const version=phase==='before'?'signal-skills-2026-10-v5':'signal-skills-2026-10-v6';
function adapt(row:any):CatalogResume {
  const grade=row.grade as SignalGrade|null;
  return {userId:row.personId,alias:`Кандидат ${row.personId}`,resumeId:row.resumeId,resumeRevision:1,title:row.title,
    specialization:row.specialization,verifiedGrade:grade,assumedGrade:grade??'Senior',verifiedScore:null,
    verifiedSkills:[...row.core],stack:[...row.claimedSkills],statedSkills:[...row.claimedSkills],
    workFormat:row.format,salaryMin:row.salaryMin,salaryMax:row.salaryMax,salaryPeriod:row.period,salaryType:row.tax,
    latestAssessmentAt:grade?now:null,hasFspHistory:row.fsp!=='none',demoMode:row.demo,visibility:row.visibility,
    consentMatching:row.matching,consentCatalog:row.catalog,yearsExperience:row.yearsExperience,readyForOffers:true,
    avatarDataUrl:null,publicName:null,deletedAt:null,legacyQualification:null,assessmentEvidence:null,
    fspSignal:compactFspSignal(row.fsp==='trusted-synthetic-win'?trustedFspResults([{id:`event-${row.personId}`,title:'Synthetic tournament',event:'Synthetic fixture',occurredAt:'2026-10-01',kind:'placement',result:'win'}]):emptyFspSignal(row.fsp!=='none')),
    skillEvidence:row.proof==='legacy'?[]:row.core.map((skill:string,index:number)=>({skill,candidateId:row.personId,evidenceId:row.resumeId*10+index,level:row.levels[row.coreIds[index]],attemptId:row.resumeId*100+index,
      programId:`${row.coreIds[index]}-${row.levels[row.coreIds[index]]?.toLowerCase()}`,programVersion:version,templateId:null,templateVersion:null,criterionId:null,criterion:null,result:null,date:dataset.now,sourceType:'signal_skill_module',limitation:null})),
    categoryEvidence:row.proof==='modular'&&grade?{matrixVersion:'signal-category-competency-matrix-v1',specialization:row.specialization,grade,targetGrade:grade,
      requirements:row.coreIds.map((skillId:string,index:number)=>({id:skillId,skillId,level:grade,evidenceId:row.resumeId*10+index,attemptId:row.resumeId*100+index,programVersion:version,verifiedAt:dataset.now}))}:null};
}
function metrics(ids:number[],points:any[],k:number){
  const grades=new Map(points.map(p=>[p.personId,p.relevance]));const actual=ids.slice(0,k).map(id=>Number(grades.get(id)??0));
  const ideal=points.map(p=>p.relevance).sort((a,b)=>b-a).slice(0,k);
  const dcg=(v:number[])=>v.reduce((sum,x,i)=>sum+(2**x-1)/Math.log2(i+2),0);const idcg=dcg(ideal);
  return {k,nDCG:idcg?dcg(actual)/idcg:null,precision:actual.filter(x=>x>=2).length/k,dcg:dcg(actual),idcg,missingPlaces:Math.max(0,k-ids.length)};
}
const diff=(a:number[],b:number[])=>a.filter(id=>!b.includes(id));
await mkdir(output,{recursive:true});
await writeFile(`${output}/first-use.json`,JSON.stringify({startedAt:new Date().toISOString(),phase,frozenInputs:freeze.files,sourceHashes,version,noTuning:true},null,2)+'\n',{flag:'wx'});
const cases=dataset.needs.map((raw:any)=>{
  const need:MatchNeed={...raw,requiredSkillLevels:Object.fromEntries(Object.entries(raw.requiredSkillLevels).map(([key,value])=>[canonicalSkillKey(key),value as SignalGrade]))};
  const source=dataset.resumes.filter((r:any)=>r.personId>=Number(raw.needId.split('-')[0])&&r.personId<Number(raw.needId.split('-')[0])+100);
  const points=labels.find((l:any)=>l.needId===raw.needId).pointwise;
  const run=(rows:CatalogResume[],fsp:boolean)=>{
    const entries=rows.map(candidate=>({candidate:fsp?candidate:{...candidate,fspSignal:compactFspSignal(emptyFspSignal()),hasFspHistory:false},evaluation:null as any}));
    for(const e of entries)e.evaluation=evaluateMatch(need,e.candidate,raw.poolDemoMode,now);
    const eligible=entries.filter(e=>e.evaluation.eligible);return {eligible,ranked:rankMatches(selectMatchingResumes(eligible)),all:entries};
  };
  const pool=source.map(adapt),actual=run(pool,true),reverse=run([...pool].reverse(),true),withoutFsp=run(pool,false);
  const ids=actual.ranked.map(r=>r.candidate.userId);const expected=points.filter((p:any)=>p.eligible).map((p:any)=>p.personId);
  const selectionErrors=actual.ranked.filter(r=>!points.find((p:any)=>p.personId===r.candidate.userId)?.allowedSelectedResumeIds.includes(r.candidate.resumeId)).map(r=>({personId:r.candidate.userId,selectedResumeId:r.candidate.resumeId}));
  const catalog=orderCatalog(deduplicateResumes(pool.filter(r=>catalogVisible(r,false)&&matchesCatalogFilters(r,{specialization:raw.specialization},now))));
  const catalogExpected=source.filter((r:any)=>!r.demo&&r.visibility!=='private'&&r.catalog&&r.specialization===raw.specialization).map((r:any)=>r.personId);
  const catalogIds=catalog.people.map(p=>p.selected.userId);
  return {needId:raw.needId,metrics:{at3:metrics(ids,points,3),at5:metrics(ids,points,5)},coverage:{expected,returned:ids,falseAdmissions:diff(ids,expected),missingAdmissions:diff(expected,ids),selectionErrors,duplicates:ids.length-new Set(ids).size},
    order:actual.ranked.map(r=>({personId:r.candidate.userId,resumeId:r.candidate.resumeId,relevance:points.find((p:any)=>p.personId===r.candidate.userId).relevance,fit:r.evaluation.ranking.businessFitScore,fspBonus:r.evaluation.fspBonus,proof:r.evaluation.ranking.qualityStatus,category:r.evaluation.ranking.categoryId})),
    permutationStable:JSON.stringify(ids)===JSON.stringify(reverse.ranked.map(r=>r.candidate.userId)),
    fspAblation:{personIds:withoutFsp.ranked.map(r=>r.candidate.userId),at3:metrics(withoutFsp.ranked.map(r=>r.candidate.userId),points,3),at5:metrics(withoutFsp.ranked.map(r=>r.candidate.userId),points,5)},
    allRejected:actual.all.filter(e=>!e.evaluation.eligible).map(e=>({resumeId:e.candidate.resumeId,reasons:e.evaluation.ineligibilityReasons})),
    catalog:{people:catalogIds,falseAdmissions:diff(catalogIds,[...new Set<number>(catalogExpected)]),missingAdmissions:diff([...new Set<number>(catalogExpected)],catalogIds)}};
});
const mean=(fn:(c:any)=>number|null)=>{const vals=cases.map(fn).filter((v):v is number=>v!==null);return vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:null;};
const report={phase,measuredAt:new Date().toISOString(),algorithm:MATCH_ALGORITHM_VERSION,moduleEvidenceVersion:version,sourceHashes,freeze,
  datasetCounts:{people:freeze.people,resumes:freeze.resumes,needs:freeze.needs,labels:freeze.labels},
  aggregate:{nDCGAt3:mean(c=>c.metrics.at3.nDCG),nDCGAt5:mean(c=>c.metrics.at5.nDCG),precisionAt3:mean(c=>c.metrics.at3.precision),precisionAt5:mean(c=>c.metrics.at5.precision),
    falseAdmissions:cases.reduce((n,c)=>n+c.coverage.falseAdmissions.length,0),missingAdmissions:cases.reduce((n,c)=>n+c.coverage.missingAdmissions.length,0),selectionErrors:cases.reduce((n,c)=>n+c.coverage.selectionErrors.length,0),permutationFailures:cases.filter(c=>!c.permutationStable).length},
  cases,limitations:(await load('rubric')).limits,productionWeightsAdjusted:false,synthetic:true,humanCalibration:false};
await writeFile(`${output}/report.json`,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({phase,aggregate:report.aggregate,report:`${output}/report.json`}));
