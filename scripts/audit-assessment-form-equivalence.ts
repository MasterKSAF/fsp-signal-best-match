/** Section 7 audit. No DB, people, paid models or production updates. */
import assert from 'node:assert/strict';
import { createHash,randomUUID } from 'node:crypto';
import { readFile,writeFile,mkdir,access } from 'node:fs/promises';
import { assembleManagedAttempt, type ProgramId } from '../artifacts/api-server/src/lib/assessment-managed';
import { scoreAttempt,requiredScore,type AssessmentGrade } from '../artifacts/api-server/src/lib/assessment-bank';
import { modelSourceMechanismTransfer } from './lib/grade-transfer-model';
import { executeVisibleSemanticTask } from './lib/assessment-semantic-execution';
const dir='outputs/quality/assessment-audit-2026-10-07';
const outputArgument=process.argv.indexOf('--output');
const output=outputArgument<0?`${dir}/equivalence-replay-${randomUUID().slice(0,8)}.json`:process.argv[outputArgument+1];
assert.ok(output?.startsWith(dir+'/')&&!output.includes('..')&&output.endsWith('.json'),'Use a new report inside the named audit directory');
await access(output!).then(()=>{throw new Error('Existing audit report is immutable; choose a new output');},error=>{if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;});
const firstFinalReplay=await access(`${dir}/equivalence-and-semantic-experiment.json`).then(()=>false,()=>true);
const sha=(bytes:string|Buffer)=>createHash('sha256').update(bytes).digest('hex');
const historicalPath='outputs/quality/assessment-validation-after.json';
const historicalBytes=await readFile(historicalPath), old=JSON.parse(historicalBytes.toString());
const preserved=JSON.parse(await readFile(`${dir}/historical-inputs.json`,'utf8'));
for(const file of preserved.files.filter((f:any)=>f.path.startsWith('outputs/')||f.path.startsWith('docs/'))) assert.equal(sha(await readFile(file.path)),file.sha256,`Historical record drift: ${file.path}`);
const replay=JSON.parse(await readFile(`${dir}/historical-after-replay.json`,'utf8'));
assert.deepEqual(replay.rows,old.rows,'Saved historical outcomes must be exactly reproduced');
assert.deepEqual(replay.pairs,old.pairs);
const pairs=old.pairs.filter((row:any)=>!row.sameDecision);
assert.equal(pairs.length,18);assert.equal(old.rows.length,468);assert.equal(old.pairs.length,234);
const classifications=pairs.map((pair:any)=>{
 const a=old.rows.find((r:any)=>r.programId===pair.programId&&r.grade===pair.grade&&r.batch===pair.batch&&r.profile===pair.profile&&r.form==='A');
 const b=old.rows.find((r:any)=>r.programId===pair.programId&&r.grade===pair.grade&&r.batch===pair.batch&&r.profile===pair.profile&&r.form==='B');
 assert.equal(pair.profile,'one-template-method-only');assert.equal(a.evidence[0].score,100);assert.equal(b.evidence[0].score,0);assert.equal(b.criticalComplete,false);
 return {...pair,primaryCause:'different_proficiency_profile',secondaryCause:'non_equivalent_content_in_same_broad_criterion',keyDefect:false,rubricDefect:false,thresholdCausedTransition:false,
  formAScenario:pair.programId==='backend-python'?'idempotent saved-response replay':'typed discriminated-union handling',formBScenario:pair.programId==='backend-python'?'optimistic versioned write':'runtime unknown-data boundary',
  criticalCriterion:a.evidence[0].criterionId,sourceProgramVersion:a.evidence[0].programVersion,
  evidence:{aCritical:a.criticalComplete,bCritical:b.criticalComplete,thresholdDecisionsA:a.thresholdSensitivity,thresholdDecisionsB:b.thresholdSensitivity},
  disposition:'Keep the discrepancy. The predeclared synthetic profile intentionally replaces B slot0 with synthetic-wrong; do not tune thresholds or infer human form difficulty.'};
});

const programs:ProgramId[]=['backend-python','frontend-typescript'];const grades:AssessmentGrade[]=['Junior','Middle','Senior'];
const solved=(form:ReturnType<typeof assembleManagedAttempt>)=>form.cases.map(c=>({caseId:c.id,answer:form.oracles[c.id]!.answer}));
const integerRows:any[]=[];
for(const program of programs)for(const grade of grades)for(const variant of [0,1] as const)for(const seed of ['audit-integer-0','audit-integer-1','audit-integer-2']) {
 const before=assembleManagedAttempt(program,grade,seed,{forcedVariant:variant,programVersion:program==='backend-python'?'signal-backend-python-v6':'signal-frontend-typescript-v2'});
 const after=assembleManagedAttempt(program,grade,seed,{forcedVariant:variant});
 const expected=before.oracles[before.cases[1]!.id]!.answer;assert.equal(expected,after.oracles[after.cases[1]!.id]!.answer);
 const representations=[{kind:'canonical',answer:expected,valid:true},{kind:'leading_plus',answer:`+${expected}`,valid:true},{kind:'leading_zeros',answer:`000${expected}`,valid:true},{kind:'plus_zeros',answer:`+000${expected}`,valid:true},{kind:'outer_whitespace',answer:` \n${expected}\t`,valid:true},
 ...[`${expected}.0`,`${expected}e0`,`${expected} kg`,`${expected}|${expected}`,`${expected} 0`,'','NaN','Infinity',String(BigInt(expected)+1n)].map(answer=>({kind:'invalid_or_wrong',answer,valid:false}))];
 for(const row of representations){const run=(f:typeof after)=>{const answers=solved(f);answers[1]!.answer=row.answer;const score=scoreAttempt(f.cases,f.oracles,answers);return {criterion:score.evidence[1]!.score,total:score.score,criticalComplete:score.criticalComplete,confirmed:score.criticalComplete&&score.score>=requiredScore(grade)};};
  const oldResult=run(before),newResult=run(after);assert.equal(newResult.criterion,row.valid?100:0);
  integerRows.push({program,grade,variant,seed,expected,...row,beforeVersion:before.oracles[before.cases[0]!.id]!.blueprint.version,afterVersion:after.oracles[after.cases[0]!.id]!.blueprint.version,before:oldResult,after:newResult});}
}

const semanticRows:any[]=[];
for(const program of programs)for(const grade of grades)for(const seed of ['semantic-unseen-17','semantic-unseen-29','semantic-unseen-43']) {
 const learned=assembleManagedAttempt(program,grade,seed,{forcedVariant:0});const novel=assembleManagedAttempt(program,grade,seed,{forcedVariant:2});
 const copy=scoreAttempt(novel.cases,novel.oracles,novel.cases.map((c,slot)=>({caseId:c.id,answer:learned.oracles[learned.cases[slot]!.id]!.answer})));
 const transfer=modelSourceMechanismTransfer({programId:program,grade,sourceId:learned.cases[0]!.id,targetId:novel.cases[0]!.id,sourcePrompt:learned.cases[0]!.prompt,targetPrompt:novel.cases[0]!.prompt,strategy:'cross-template'});
 const executed=novel.cases.flatMap((c,slot)=>{const actual=executeVisibleSemanticTask(c.prompt,slot);if(actual===null)return [];const expected=novel.oracles[c.id]!.answer;assert.equal(actual,expected,`${program}/${grade}/${seed}/${slot} visible contract key`);return [{slot,actual,key:expected,keyAgrees:actual===expected}];});
 semanticRows.push({program,grade,seed,programVersion:novel.oracles[novel.cases[0]!.id]!.blueprint.version,
  structuralTemplates:novel.cases.map(c=>novel.oracles[c.id]!.blueprint.templateId),literalAnswerCopy:{score:copy.score,criticalComplete:copy.criticalComplete,confirmed:copy.criticalComplete&&copy.score>=requiredScore(grade)},limitedStudiedMethod:transfer,reasonedVisibleContractExecution:{mechanism:'Local Python/TypeScript/SQLite interpreters; not a human/LLM learning simulation',executed,judgementSlotsNotEvaluated:[2,4]}});
}

// Frozen independent labels are replayed as EXPLICIT strategy predictions only.
// No empirical claim is made for the reference response which is correct by definition.
const controlsBytes=await readFile(`${dir}/independent-controls.json`);assert.equal(sha(controlsBytes),'f79d00fe0a881e54d168d1aaf2ee295a1f01c8ee548cace7c611dc6bb345f5bc');
const controls=JSON.parse(controlsBytes.toString());
const norm=(s:string)=>s.trim().normalize('NFKC').toLocaleLowerCase('ru-RU');
const controlRows=controls.cases.map((c:any)=>{const expected=c.manual_reference.components.map(norm);const strategy=(name:string)=>{const response=c.strategies[name].response;return {response,source:'Frozen explicit manual strategy prediction, not observed behaviour',score:response.length!==expected.length?0:100*response.filter((v:string,i:number)=>norm(v)===expected[i]).length/expected.length,structurallyInvalid:response.length!==expected.length};};
 return {id:c.id,split:c.split,program:c.program,noveltyBoundary:c.novelty,knowledgeRequirements:c.knowledge_requirements,literalCopy:strategy('literal_copy'),limitedMethod:strategy('limited_family_procedure'),semanticReferenceEmpiricalResult:null};});
const codePaths=['scripts/audit-assessment-form-equivalence.ts','scripts/lib/assessment-semantic-execution.ts','artifacts/api-server/src/lib/assessment-bank.ts','artifacts/api-server/src/lib/assessment-managed.ts','artifacts/api-server/src/lib/assessment-semantic-variants.ts','artifacts/api-server/src/lib/signal-evidence-compatibility.ts'];
const report={version:'signal-equivalence-audit-v1',generatedAt:new Date().toISOString(),passed:true,
 historical:{originalPath:historicalPath,originalSha256:sha(historicalBytes),replayPath:`${dir}/historical-after-replay.json`,replaySha256:sha(await readFile(`${dir}/historical-after-replay.json`)),works:468,pairs:234,unchangedDecisions:true,discrepancies:classifications,decisionAgreement:216/234,thresholds:{Junior:67,Middle:83,Senior:83},thresholdPolicyChanged:false},
 fixedDefect:{kind:'canonical_integer_rubric',before:'Mathematically equivalent +002 and 2 rejected by textual integer equality',after:'Canonical decimal integer equality only in v7/v3; saved old rubrics unchanged',rows:integerRows,summary:{rows:integerRows.length,oldFalseNegatives:integerRows.filter(r=>r.valid&&r.before.criterion!==100).length,newFalseNegatives:integerRows.filter(r=>r.valid&&r.after.criterion!==100).length,newFalsePositives:integerRows.filter(r=>!r.valid&&r.after.criterion===100).length}},
 semanticExpansion:{forms:semanticRows.length,executedTraceOrSQLCriteria:semanticRows.reduce((n,r)=>n+r.reasonedVisibleContractExecution.executed.length,0),rows:semanticRows,literalCopyConfirmations:semanticRows.filter(r=>r.literalAnswerCopy.confirmed).length,limitedMethodNotEvaluated:semanticRows.filter(r=>r.limitedStudiedMethod.status==='not_evaluated').length},
 independentControls:{frozenSha256:sha(controlsBytes),protocolSha256:sha(await readFile(`${dir}/independent-protocol.md`)),cases:24,diagnostic:12,holdout:12,firstFinalReplay,predictionOnly:true,rows:controlRows},
 sourceHashes:Object.fromEntries(await Promise.all(codePaths.map(async p=>[p,sha(await readFile(p))]))),
 limitations:['18 historical transitions were deliberately authored knowledge-profile differences, not measured test-retest errors. They remain unchanged.','Canonical-integer controls establish a bounded format/rubric fix; they do not calibrate human grade thresholds.','Third form changes logic/branches/contracts, not only numbers; novelty is relative to exposed A form, not an assertion that no participant has seen similar tasks.','Visible contract execution checks keys, not human skill, learning, proctoring or cheating. Architecture/diagnosis choice items are not runtime-executed.','Limited source method rejects the unsupported third contract as not_evaluated; its rejection is not proof of resistance.','The 24 blind-authored semantic controls replay fixed manual strategy predictions. Semantic reference is not an empirical 100% result.','No DB updates, production regrading, corrections, paid models, human pilot or anti-cheat enforcement were performed.']};
await mkdir(dir,{recursive:true});await writeFile(output!,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({passed:report.passed,historicalDiscrepancies:18,integer:report.fixedDefect.summary,thirdForms:semanticRows.length,executedCriteria:report.semanticExpansion.executedTraceOrSQLCriteria,literalCopyConfirmations:report.semanticExpansion.literalCopyConfirmations,limitedMethodNotEvaluated:report.semanticExpansion.limitedMethodNotEvaluated,manualControlCases:24,firstFinalReplay,proof:output}));
