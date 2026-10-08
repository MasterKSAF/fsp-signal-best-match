/** B4 stateless experiment: response vectors and labels were frozen independently BEFORE this scorer import. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { SkillModuleCase, SkillModuleOracle, SkillLevel } from '@workspace/db';
const dir='outputs/verification/full-audit-a01-a11-20261008/bank';
const bytes=readFileSync(`${dir}/b4-reference-vectors-v5-frozen.json`);const vectorSha=createHash('sha256').update(bytes).digest('hex');
assert.equal(vectorSha,'f4da1b521429c83457d679ebf7f14833c4d70107fd956aa46162005ebaadd07a');
const ref=JSON.parse(bytes.toString('utf8'));assert.equal(ref.rows.length,324);assert.equal(ref.unmapped.length,0);
const labelBytes=readFileSync(`${dir}/profiles-frozen-before-scoring.json`);assert.equal(createHash('sha256').update(labelBytes).digest('hex'),'2741a244cc54ab9785760c59ebb6577acf89c3c74f614d70cdb574ce19fa809a');
const labels=JSON.parse(labelBytes.toString('utf8'));
// Import scoring only after frozen vector and label hash verification.
const bank=await import('../artifacts/api-server/src/lib/skill-module-bank');
const qual=await import('../artifacts/api-server/src/lib/skill-module-qualification');
const reference=new Map<string,any>(ref.rows.map((r:any)=>[r.key,r]));
const works:any[]=[],keyDisagreements:any[]=[],labelDisagreements:any[]=[],categoryWorks:any[]=[];
const forms=new Map<string,{cases:SkillModuleCase[];oracles:SkillModuleOracle;policy:any}>();
const levels=['Junior','Middle','Senior'] as const;
const foreign:Record<string,string>={python:'typescript',sql:'frontend-engineering',typescript:'python',react:'backend-engineering','backend-engineering':'react','frontend-engineering':'sql'};
for(const m of bank.skillModuleRegistry)for(const level of levels)for(let s=0;s<3;s++){
 const cases:SkillModuleCase[]=[],oracles:SkillModuleOracle={};
 for(let c=0;c<6;c++){
  const task=bank.skillScenarioFixture(m.id,level,c,s,5,true);const template=bank.skillModuleTemplates.find(t=>t.skillId===m.id&&t.level===level&&t.competencyIndex===c&&t.scenarioIndex===s)!;const id=`q${c+1}`;
  const options=task.options?.map((text,i)=>({id:`o${i+1}`,text}));const expected=options?options.find(o=>o.text===task.answer)!.id:task.answer;
  const critical=level==='Senior'?m.seniorCriticalCompetencies.includes(m.competencies[c]!):c===0||c===5;
  cases.push({id,competencyId:m.competencies[c]!,title:task.title,prompt:task.prompt,responseType:task.responseType??'text',...(options?{options}:{}),critical,templateId:template.id,templateVersion:template.version,contentFamilyId:template.contentFamilyId,...(task.levelRequirementId?{levelRequirementId:task.levelRequirementId}:{}),...(task.middleOutcome?{middleOutcome:task.middleOutcome}:{}),...(task.seniorOutcome?{seniorOutcome:task.seniorOutcome}:{})});
  const policy=level==='Senior'?bank.seniorSkillModulePolicy:bank.skillModulePolicy;
  oracles[id]={expected,explanation:task.explanation,points:1,rubricVersion:policy.rubricVersion,...(task.parts?{parts:task.parts}:{})};
  const key=`${m.id}/${level}/${c}/${s}/5/true`;const gold=reference.get(key)!;
  if(gold.response!==expected)keyDisagreements.push({key,reference:gold.response,productionKey:expected});
 }
 const form={cases,oracles,policy:level==='Senior'?bank.seniorSkillModulePolicy:bank.skillModulePolicy};forms.set(`${m.id}/${level}/${s}`,form);
 for(const profile of labels.profiles){
  const gap=m.kind==='engineering'?2:1;
  const answers=Object.fromEntries(cases.map((caseRow,c)=>{
   const gold=reference.get(`${m.id}/${level}/${c}/${s}/5/true`)!;
   const known=profile.id==='strong'||profile.id==='junior-only'&&level==='Junior'||profile.id==='middle-only'&&level!=='Senior'||profile.id==='noncritical-gap'&&c!==gap||profile.id==='critical-gap'&&c!==0||profile.id==='weak'&&c===1;
   const answer=known?gold.response:profile.id==='nontransferable'?reference.get(`${foreign[m.id]}/Junior/${c}/${s}/5/true`)!.response:(profile.id==='junior-only'&&level!=='Junior'||profile.id==='middle-only'&&level==='Senior')?gold.primaryResponse:level==='Junior'?'0':'0;0';
   return [caseRow.id,answer];
  }));
  const decision=bank.scoreSkillAttempt(cases,oracles,answers,form.policy);const label=labels.module_labels.find((r:any)=>r.skill===m.id&&r.level===level&&r.profile===profile.id)!;
  const record={skill:m.id,level,s,profile:profile.id,expectedPass:label.pass,actualPass:decision.passed,score:decision.score,criticalComplete:decision.criticalComplete,passedCompetencies:decision.competencies.filter(c=>c.passed).map(c=>c.id),answers,decision};works.push(record);
  if(decision.passed!==label.pass)labelDisagreements.push(record);
 }
}
for(const spec of ['Backend / Python','Frontend / TypeScript'])for(const level of levels)for(const profile of labels.profiles)for(let s=0;s<3;s++){
 const skills=spec.startsWith('Backend')?['python','sql','backend-engineering']:['typescript','react','frontend-engineering'];
 const evidence:qual.SkillModuleEvidence[]=skills.flatMap((skill,i)=>{const w=works.find(w=>w.skill===skill&&w.level===level&&w.profile===profile.id&&w.s===s)!;return w.actualPass?[{id:i+1,userId:71,attemptId:i+1,skillId:skill,level,programVersion:bank.SKILL_BANK_VERSION,decision:w.decision,competencyIds:w.passedCompetencies,verifiedAt:new Date('2026-10-08T15:30:00Z')}]:[];});
 const actual=qual.getSkillQualification({userId:71,specialization:spec,assumedGrade:level,stack:spec.startsWith('Backend')?['Python','SQL']:['TypeScript','React'],skills:[]},{evidence,revokedIds:new Set<number>()});const expected=labels.category_labels.find((r:any)=>r.specialization===spec&&r.targetLevel===level&&r.profile===profile.id)!.expectedGrade;
 const row={specialization:spec,level,profile:profile.id,s,expectedGrade:expected,actualGrade:actual.verifiedGrade,verifiedScore:actual.verifiedScore};categoryWorks.push(row);if(row.actualGrade!==expected)labelDisagreements.push(row);assert.equal(actual.verifiedScore,null);
}
const retest=labels.skills.flatMap((skill:string)=>levels.flatMap(level=>labels.profiles.map((p:any)=>{const rows=works.filter(w=>w.skill===skill&&w.level===level&&w.profile===p.id);return{skill,level,profile:p.id,pairs:3,passConsistent:rows.every(w=>w.actualPass===rows[0].actualPass),scores:rows.map(w=>w.score)};})));
const confusion={tp:0,tn:0,fp:0,fn:0};for(const w of works)confusion[w.expectedPass?w.actualPass?'tp':'fn':w.actualPass?'fp':'tn']++;
const output={bankVersion:bank.SKILL_BANK_VERSION,measuredAt:new Date().toISOString(),sourceHashes:{vectors:vectorSha,profiles:createHash('sha256').update(labelBytes).digest('hex')},scope:{programmes:18,equivalentForms:3,referenceTasks:324,syntheticModuleWorks:works.length,moduleRetestGroups:retest.length,moduleFormPairs:retest.length*3,syntheticCategoryWorks:categoryWorks.length,n:5,flag:true},keyDisagreements,labelDisagreements,confusion,retainedReferenceV1Corrections:8,retest,works,categoryWorks,passed:keyDisagreements.length===0&&labelDisagreements.length===0&&retest.every((r:any)=>r.passConsistent),limitations:ref.limitations.concat(['No DB, HTTP, human users or real hiring observations.','Independent reference agreement tests code/contract consistency; constructed profiles do not calibrate thresholds or measure human discrimination.','Three authored forms n5true are compared; Middle n9false independently executed separately, not pooled as B4 human evidence.','All reference or label disagreements are retained; referenceV1 corrections happened before B4 scorer and frozen profile labels never changed.'])};
writeFileSync(`${dir}/b4-modular-results-v5-final.json`,JSON.stringify(output,null,2));console.log(JSON.stringify({passed:output.passed,...output.scope,confusion,keyDisagreements:keyDisagreements.length,labelDisagreements:labelDisagreements.length}));if(!output.passed)process.exitCode=1;
