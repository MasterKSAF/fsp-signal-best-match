/** A separate process: frozen vector/model/labels are checked before scorer import. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import type {SkillModuleCase,SkillModuleOracle,SkillLevel} from '@workspace/db';
const dir='outputs/verification/correction-01-20261008/bank';
const revision=process.argv[2]??'v1';assert.match(revision,/^v[1-9]\d*$/);
const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const receipt=JSON.parse(readFileSync(`${dir}/b4-${revision}-freeze-receipt.json`,'utf8'));
const bytes=readFileSync(receipt.path);assert.equal(sha(bytes),receipt.sha256);
const frozen=JSON.parse(bytes.toString('utf8'));
for(const [path,hash]of Object.entries(frozen.sourceHashes))assert.equal(sha(readFileSync(path)),hash,`input drift ${path}`);
// A source-only supplement may bind the unchanged frozen experiment to C04 SQL hydration.
// The original default remains strict; no vector/model/label or scorer rebindings are allowed.
const sourceLedgerPath=process.argv[3]??null;
let evaluatedSourceHashes=frozen.bankSourceHashes;
let sourceBinding:any=null;
if(sourceLedgerPath){
 const ledgerBytes=readFileSync(sourceLedgerPath),ledger=JSON.parse(ledgerBytes.toString('utf8'));
 assert.equal(ledger.bankVersion,'signal-skills-2026-10-v6');
 assert.equal(ledger.preservedVectorSha256,receipt.sha256);
 assert.deepEqual(Object.keys(ledger.bankSourceHashes).sort(),Object.keys(frozen.bankSourceHashes).sort());
 const baseBytes=readFileSync(ledger.baseSourceLedger.path);assert.equal(sha(baseBytes),ledger.baseSourceLedger.sha256);
 assert.deepEqual(JSON.parse(baseBytes.toString('utf8')).bankSourceHashes,frozen.bankSourceHashes);
 assert.equal(ledger.evaluatorSha256,sha(readFileSync('scripts/correction01-b4-evaluate.mts')));
 const changed=Object.keys(frozen.bankSourceHashes).filter(path=>ledger.bankSourceHashes[path]!==frozen.bankSourceHashes[path]);
 assert.deepEqual(changed,['artifacts/api-server/src/lib/skill-module-service.ts']);
 assert.equal(ledger.sourceRebindings.length,1);
 assert.deepEqual(ledger.sourceRebindings[0],{path:changed[0],fromSha256:frozen.bankSourceHashes[changed[0]],toSha256:ledger.bankSourceHashes[changed[0]],scope:'C04 parameterized ANY(int[]) evidence/corrections hydration queries only'});
 evaluatedSourceHashes=ledger.bankSourceHashes;
 sourceBinding={path:sourceLedgerPath,sha256:sha(ledgerBytes),sourceRebindings:ledger.sourceRebindings,baseSourceLedger:ledger.baseSourceLedger,evaluatorSha256:ledger.evaluatorSha256};
}
for(const [path,hash]of Object.entries(evaluatedSourceHashes))assert.equal(sha(readFileSync(path)),hash,`bank drift ${path}`);
const bank=await import('../artifacts/api-server/src/lib/skill-module-bank');
const qual=await import('../artifacts/api-server/src/lib/skill-module-qualification');
const refs=new Map<string,any>(frozen.vectors.map((r:any)=>[r.key,r]));
const keyDisagreements:any[]=[],moduleDisagreements:any[]=[],categoryDisagreements:any[]=[],results:any[]=[],categoryResults:any[]=[];
function formFor(keys:string[]){
 const cases:SkillModuleCase[]=[],oracles:SkillModuleOracle={};
 for(const [c,key]of keys.entries()){
  const [skill,level,,scenario]=key.split('/');const s=Number(scenario),l=level as SkillLevel;
  const m=bank.skillModuleRegistry.find(m=>m.id===skill)!;const t=bank.skillScenarioFixture(skill,l,c,s,5,true);
  const template=bank.skillModuleTemplates.find(t=>t.skillId===skill&&t.level===l&&t.competencyIndex===c&&t.scenarioIndex===s)!;
  const id=`q${c+1}`,options=t.options?.map((text,i)=>({id:`o${i+1}`,text})),expected=options?options.find(o=>o.text===t.answer)!.id:t.answer;
  const policy=l==='Senior'?bank.seniorSkillModulePolicy:bank.skillModulePolicy;
  cases.push({id,competencyId:m.competencies[c],title:t.title,prompt:t.prompt,responseType:t.responseType??'text',...(options?{options}:{}),critical:l==='Senior'?m.seniorCriticalCompetencies.includes(m.competencies[c]):c===0||c===5,templateId:template.id,templateVersion:template.version,contentFamilyId:template.contentFamilyId,...(t.levelRequirementId?{levelRequirementId:t.levelRequirementId}:{}),...(t.middleOutcome?{middleOutcome:t.middleOutcome}:{}),...(t.seniorOutcome?{seniorOutcome:t.seniorOutcome}:{})});
  oracles[id]={expected,explanation:t.explanation,points:1,rubricVersion:policy.rubricVersion,...(t.parts?{parts:t.parts}:{})};
 }
 return{cases,oracles,policy:keys[0].includes('/Senior/')?bank.seniorSkillModulePolicy:bank.skillModulePolicy};
}
// Check every reference, independent of whether a specific work uses the scenario.
for(const r of frozen.vectors){const f=formFor(Array.from({length:6},(_,c)=>`${r.skill}/${r.level}/${c}/${r.s}/5/true`));const expected=f.oracles[`q${r.c+1}`].expected;if(r.response!==expected)keyDisagreements.push({key:r.key,reference:r.response,productionKey:expected});}
for(const w of frozen.works){
 const f=formFor(w.taskKeys),decision=bank.scoreSkillAttempt(f.cases,f.oracles,w.answers,f.policy);
 const contentGateChecks=w.edits.map((e:any)=>{const c=f.cases.find(c=>c.id===e.caseId)!,oracle=f.oracles[e.caseId],fragments=w.answers[e.caseId].split(';');return{caseId:e.caseId,taskKey:e.taskKey,providedParts:fragments.length,requiredParts:oracle.parts?.length??1,allPartsFilled:fragments.every((v:string)=>v.trim().length>0),critical:c.critical,competencyPassed:decision.competencies.find(v=>v.id===c.competencyId)!.passed,partTypes:oracle.parts?.map(p=>p.responseType)??[c.responseType],response:w.answers[e.caseId],model:e.model};});
 const row={...w,actualPass:decision.passed,score:decision.score,criticalComplete:decision.criticalComplete,passedCompetencies:decision.competencies.filter(c=>c.passed).map(c=>c.id),contentGateChecks,decision};results.push(row);
 if(row.actualPass!==w.expectedPass)moduleDisagreements.push({profile:w.profile,skill:w.skill,level:w.level,repeat:w.repeat,expected:w.expectedPass,actual:row.actualPass,score:row.score,criticalComplete:row.criticalComplete});
}
for(const label of frozen.categoryLabels)for(let repeat=0;repeat<3;repeat++){
 const matrix=frozen.matrices.find((m:any)=>m.id===label.matrix);
 const evidence:qual.SkillModuleEvidence[]=results.filter(w=>w.profile===label.profile&&w.level===label.level&&w.repeat===repeat&&w.actualPass).map((w,i)=>({id:i+1,userId:71,attemptId:i+1,skillId:w.skill,level:w.level,programVersion:bank.SKILL_BANK_VERSION,decision:w.decision,competencyIds:w.passedCompetencies,verifiedAt:new Date('2026-10-08T15:30:00Z')}));
 const actual=qual.getSkillQualification({userId:71,specialization:matrix.specialization,assumedGrade:label.level,stack:matrix.stack,skills:[]},{evidence,revokedIds:new Set<number>()});
 assert.equal(actual.verifiedScore,null);
 const row={...label,repeat,actualGrade:actual.verifiedGrade,coverage:actual.coverage,missing:actual.missing,mandatory:matrix.mandatory,usedCategory:actual.category};categoryResults.push(row);
 if(row.expectedGrade!==row.actualGrade)categoryDisagreements.push(row);
}
const retest=frozen.moduleLabels.map((l:any)=>{const works=results.filter(w=>w.profile===l.profile&&w.skill===l.skill&&w.level===l.level);return{...l,works:works.length,passConsistent:works.every(w=>w.actualPass===works[0].actualPass),scores:works.map(w=>w.score),decisions:works.map(w=>w.actualPass)};});
const categoryRetest=frozen.categoryLabels.map((l:any)=>{const rows=categoryResults.filter(w=>w.profile===l.profile&&w.level===l.level&&w.matrix===l.matrix);return{...l,categoryConsistent:rows.every(w=>w.actualGrade===rows[0].actualGrade),grades:rows.map(w=>w.actualGrade)};});
const confusion={tp:0,tn:0,fp:0,fn:0};for(const w of results)confusion[w.expectedPass?w.actualPass?'tp':'fn':w.actualPass?'fp':'tn']++;
const contentChecks=results.flatMap(w=>w.contentGateChecks);
const knowledgeAffected=results.filter(w=>w.contentGateChecks.length);
const output={measuredAt:new Date().toISOString(),bankVersion:bank.SKILL_BANK_VERSION,frozenAt:frozen.frozenAt,freezeSha256:receipt.sha256,sourceHashes:evaluatedSourceHashes,...(sourceBinding?{sourceBinding,referenceFreezeSourceHashes:frozen.bankSourceHashes}:{}),scope:{referenceKeys:324,moduleWorks:results.length,completeKnowledgeModuleWorks:results.filter(w=>w.kind==='complete-semantic-error').length,affectedKnowledgeModuleWorks:knowledgeAffected.length,categoryWorks:categoryResults.length,moduleRepeatGroups:retest.length,categoryRepeatGroups:categoryRetest.length,mandatoryMatrices:frozen.matrices},keyDisagreements,moduleDisagreements,categoryDisagreements,retest,categoryRetest,confusion,contentGateSummary:{editedAnswers:contentChecks.length,completePartCount:contentChecks.filter(c=>c.providedParts===c.requiredParts&&c.allPartsFilled).length,rejectedCompetencies:contentChecks.filter(c=>!c.competencyPassed).length,criticalErrors:contentChecks.filter(c=>c.critical&&!c.competencyPassed).length,affectedModulePasses:knowledgeAffected.filter(w=>w.actualPass).length,affectedModuleFails:knowledgeAffected.filter(w=>!w.actualPass).length},results,categoryResults,passed:keyDisagreements.length===0&&moduleDisagreements.length===0&&categoryDisagreements.length===0&&retest.every((r:any)=>r.passConsistent)&&categoryRetest.every((r:any)=>r.categoryConsistent),limitations:frozen.limitations.concat(sourceBinding?['C04 service queries are source-bound by SHA only: this stateless scorer does not execute DB hydration or prove SQL runtime/performance.']:[])};
const resultRevision=process.argv[4]??revision;assert.match(resultRevision,/^[a-z0-9][a-z0-9-]*$/);
assert.ok(!sourceBinding||resultRevision!==revision,'Source supplement requires a separate result name');
writeFileSync(`${dir}/b4-results-${resultRevision}.json`,JSON.stringify(output,null,2),{flag:'wx'});
console.log(JSON.stringify({passed:output.passed,...output.scope,confusion,keyDisagreements:keyDisagreements.length,moduleDisagreements:moduleDisagreements.length,categoryDisagreements:categoryDisagreements.length,contentGateSummary:output.contentGateSummary}));
if(!output.passed)process.exitCode=1;
