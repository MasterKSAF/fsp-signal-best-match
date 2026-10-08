/** Evaluates frozen team reference against production scoring. Expected answers
 * and readiness labels live in separate frozen files and never call the oracle.
 * Neither this local diagnostic nor the team content rule is human calibration. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { assembleManagedAttempt, assessmentPrograms, verifiedSkillsForAttempt, type ProgramId } from '../artifacts/api-server/src/lib/assessment-managed';
import { requiredScore, scoreAttempt, type AssessmentGrade } from '../artifacts/api-server/src/lib/assessment-bank';
import { modelSourceMechanismTransfer, transferModelVersion } from './lib/grade-transfer-model';

type Ref = { id: string; programId: ProgramId; programVersion: string; grade: AssessmentGrade; seed: string; batch: string; form: 'A'|'B'; variant: 0|1; reference: { slot: number; family: string; answer: string; reason: string; publicPromptSha256: string }[] };
type Profile = { id: string; description: string; transform: string; correctSlots?: number[]; slot?: number; expected: Record<AssessmentGrade,boolean>; expectedB?: boolean };
const sha = (input: string | Buffer) => createHash('sha256').update(input).digest('hex');
const manifest = JSON.parse(await readFile('docs/validation/frozen-manifest-v1.json','utf8'));
for(const [path,hash] of Object.entries(manifest.files)) assert.equal(sha(await readFile(path)),hash,`Frozen fixture drift ${path}`);
const references: Ref[] = JSON.parse(await readFile('docs/validation/reference-answers-v1.json','utf8')).forms;
const profiles: Profile[] = JSON.parse(await readFile('docs/validation/work-profiles-v1.json','utf8')).profiles;
const argument = (name: string) => { const i=process.argv.indexOf(name); return i<0 ? undefined : process.argv[i+1]; };
const label = argument('--label') ?? 'after';
const output = argument('--output') ?? `outputs/quality/assessment-audit-2026-10-07/historical-${label}-replay-${randomUUID().slice(0,8)}.json`;
assert.ok(!/^outputs[\\/]quality[\\/]assessment-validation-(before|after)(-original)?\.json$/.test(output), 'Original validation records are immutable; use a new output path');
await access(output).then(()=>{throw new Error('Existing validation replay is immutable; choose a new output');},error=>{if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;});
assert.ok(['before','after'].includes(label));
const normalize = (s: string) => s.trim().normalize('NFC').replace(/\s+/g,' ').toLowerCase();
const visibleForms: { id: string; cases: {prompt: string}[] }[] = JSON.parse(await readFile('docs/validation/visible-forms-v1.json','utf8')).forms;
const rows: any[] = [], answerErrors: any[] = [], scoringErrors: any[] = [];

function submitted(form: Ref, profile: Profile) {
  const answers = form.reference.map(item => ({ slot: item.slot, answer: item.answer }));
  for (const item of answers) {
    if(profile.transform==='slots' && !profile.correctSlots?.includes(item.slot) || profile.transform==='skip' && item.slot===profile.slot) item.answer='';
    if(profile.transform==='partial' && item.slot===profile.slot) item.answer=item.answer.split('|').map((value,index,array)=> index===array.length-1?'synthetic-wrong':value).join('|');
    if(profile.transform==='extra' && item.slot===profile.slot) item.answer+='|synthetic-alternative';
    if(profile.transform==='form-gap' && form.form==='B' && item.slot===profile.slot) item.answer='synthetic-wrong';
    if(profile.transform==='whitespace') item.answer=`  ${item.answer.replace(/ /g,'  ')}\n`;
  }
  return profile.transform==='reverse'?answers.reverse():answers;
}
// Expected *credit* is independently reconstructed from the frozen answers and
// explicit error profile. Readiness is a predeclared semantic label, not a score
// threshold calculated by this function (notably architecture-gap Senior).
function independentCredit(form: Ref, answers: ReturnType<typeof submitted>) {
  return form.reference.map(item=> {
    const answer=normalize(answers.find(a=>a.slot===item.slot)?.answer??'');
    const expected=normalize(item.answer);
    if(!answer)return 0;
    if([0,3,5].includes(item.slot)) {
      const given=answer.split('|'), wanted=expected.split('|');
      if(given.length!==wanted.length)return 0;
      return Math.floor(100*wanted.filter((part,index)=>given[index]===part).length/wanted.length+.5);
    }
    return Number(answer===expected)*100;
  });
}
function formForEvaluation(form: Ref) {
  const current=assembleManagedAttempt(form.programId,form.grade,form.seed,{forcedVariant:form.variant,programVersion:label==='before'?form.programVersion:form.programId==='backend-python'?'signal-backend-python-v6':'signal-frontend-typescript-v2'});
  if(label!=='before')return current;
  // Reproducible replay of the explicitly frozen old rubric. The original
  // before-change execution is preserved separately as before-original.json.
  const oldCases=current.cases.map(task=>({...task,id:task.id.replace(/signal-backend-python-v6|signal-frontend-typescript-v2/,form.programVersion)}));
  return {cases:oldCases,oracles:Object.fromEntries(current.cases.map((task,slot)=>[oldCases[slot]!.id,{...current.oracles[task.id]!,blueprint:{...current.oracles[task.id]!.blueprint,version:form.programVersion,critical:[0,1,3].includes(slot),templateVersion:1}}]))};
}
for(const form of references) {
  const generated=formForEvaluation(form);
  for(const reference of form.reference) {
    const task=generated.cases[reference.slot]!;
    assert.equal(sha(task.prompt),reference.publicPromptSha256,`Public prompt changed ${form.id}/${reference.slot}; use a new control version`);
    if(generated.oracles[task.id]!.answer!==reference.answer)answerErrors.push({form:form.id,slot:reference.slot,expected:reference.answer,actual:generated.oracles[task.id]!.answer});
  }
  for(const profile of profiles) {
    const answerValues=submitted(form,profile);
    const result=scoreAttempt(generated.cases,generated.oracles,answerValues.map(item=>({caseId:generated.cases[item.slot]!.id,answer:item.answer})));
    const expectedCredit=independentCredit(form,answerValues);
    const expectedScore=Math.floor(expectedCredit.reduce((sum,n)=>sum+n,0)/6+.5);
    if(JSON.stringify(result.evidence.map(item=>item.score))!==JSON.stringify(expectedCredit) || result.score!==expectedScore)scoringErrors.push({form:form.id,profile:profile.id,expectedCredit,expectedScore,result});
    const confirmed=result.score>=requiredScore(form.grade)&&result.criticalComplete;
    const expected=form.form==='B'&&profile.expectedB!==undefined?profile.expectedB:profile.expected[form.grade];
    rows.push({formId:form.id,programId:form.programId,grade:form.grade,batch:form.batch,form:form.form,profile:profile.id,score:result.score,criticalComplete:result.criticalComplete,confirmed,teamExpectedReadiness:expected,agreesWithTeamReadiness:confirmed===expected,evidence:result.evidence.map((item,slot)=>({slot,score:item.score,templateId:item.templateId,criterionId:item.criterionId,programVersion:item.programVersion})),verifiedSkills:verifiedSkillsForAttempt(generated.cases,generated.oracles,result.evidence),thresholdSensitivity:[-5,-2,0,2,5].map(delta=>({delta,threshold:requiredScore(form.grade)+delta,confirmed:result.criticalComplete&&result.score>=requiredScore(form.grade)+delta}))});
  }
}
const pairs = rows.filter(row=>row.form==='A').map(a=> {
  const b=rows.find(row=>row.programId===a.programId&&row.grade===a.grade&&row.batch===a.batch&&row.profile===a.profile&&row.form==='B');
  assert.ok(b);return {programId:a.programId,grade:a.grade,batch:a.batch,profile:a.profile,scoreA:a.score,scoreB:b.score,scoreChange:b.score-a.score,confirmedA:a.confirmed,confirmedB:b.confirmed,transition:`${a.confirmed?'confirmed':'not_confirmed'}→${b.confirmed?'confirmed':'not_confirmed'}`,sameDecision:a.confirmed===b.confirmed};
});
const summaries=assessmentPrograms.flatMap(program=>(['Junior','Middle','Senior'] as const).map(grade=>{
  const group=rows.filter(row=>row.programId===program.id&&row.grade===grade),pair=pairs.filter(p=>p.programId===program.id&&p.grade===grade);
  return {programId:program.id,grade,works:group.length,teamLabelDisagreements:group.filter(row=>!row.agreesWithTeamReadiness).length,pairedWorks:pair.length,decisionAgreement:pair.filter(p=>p.sameDecision).length/pair.length,transitions:Object.fromEntries([...new Set(pair.map(p=>p.transition))].map(transition=>[transition,pair.filter(p=>p.transition===transition).length])),maxAbsoluteScoreChange:Math.max(...pair.map(p=>Math.abs(p.scoreChange)))};
}));
// Conditional core transfer experiment. Slot 0 alone varies; the other five
// slots use frozen independently worked answers as a declared positive-control
// baseline, not evidence that this model acquired those five competencies.
// Model input contains visible source/target prompts only, never target keys.
type TransferStrategy = 'copy-ready-answer' | 'apply-studied-same-template-method' | 'apply-only-A-mechanism-to-B' | 'independent-understanding-of-target';
type TransferRow = {programId:ProgramId;grade:AssessmentGrade;source:string;target:string;strategy:TransferStrategy;model:ReturnType<typeof modelSourceMechanismTransfer>|null;answerProvenance:string;targetCoreReferenceUsed:boolean;nonCoreReferenceSlots:number[];status:'evaluated'|'not_evaluated';reason:string|null;score:number|null;criticalComplete:boolean|null;confirmed:boolean|null;interpretation:string};
const transfer:TransferRow[]=[];
for(const program of assessmentPrograms)for(const grade of ['Junior','Middle','Senior'] as const){
  const source=references.find(f=>f.programId===program.id&&f.grade===grade&&f.batch==='development'&&f.form==='A')!;
  for(const targetForm of ['A','B'] as const){
    const target=references.find(f=>f.programId===program.id&&f.grade===grade&&f.batch==='fresh-control'&&f.form===targetForm)!;
    const generated=formForEvaluation(target);
    for(const strategy of ['copy-ready-answer','apply-studied-same-template-method','apply-only-A-mechanism-to-B','independent-understanding-of-target'] as const){
      if(strategy==='apply-studied-same-template-method'&&targetForm!=='A'||strategy==='apply-only-A-mechanism-to-B'&&targetForm!=='B')continue;
      const modeled=strategy==='apply-studied-same-template-method'||strategy==='apply-only-A-mechanism-to-B'
        ?modelSourceMechanismTransfer({programId:program.id,grade,sourceId:source.id,targetId:target.id,sourcePrompt:visibleForms.find(form=>form.id===source.id)!.cases[0]!.prompt,targetPrompt:visibleForms.find(form=>form.id===target.id)!.cases[0]!.prompt,strategy:strategy==='apply-studied-same-template-method'?'same-template':'cross-template'}):null;
      const baseline={programId:program.id,grade,source:source.id,target:target.id,strategy,model:modeled,answerProvenance:strategy==='copy-ready-answer'?'Frozen source reference answers at all 6 slots.':modeled?'Core slot 0 computed from visible source mechanism and target calls. Non-core slots 1..5 held at frozen independent reference answers.':'All 6 frozen independent target references: declared constructed positive control, not a transfer model.',targetCoreReferenceUsed:strategy==='independent-understanding-of-target',nonCoreReferenceSlots:strategy==='copy-ready-answer'?[]:[1,2,3,4,5]};
      if(modeled?.status==='not_evaluated') {
        transfer.push({...baseline,status:'not_evaluated',reason:modeled.reason,score:null,criticalComplete:null,confirmed:null,interpretation:'Unsupported model scenario; excluded from evaluated-transfer denominators, never counted as resistance.'});
        continue;
      }
      if(modeled) {
        assert.equal(modeled.recognizedCallCount,modeled.expectedCallCount);
        assert.equal(modeled.trace.length,modeled.expectedCallCount);
        assert.ok(modeled.answer&&modeled.answer.trim().length>0,'Empty model answer must never be scored as failed transfer');
        assert.equal(modeled.provenance.sourceId,source.id);
        assert.equal(modeled.provenance.sourcePromptSha256,source.reference[0]!.publicPromptSha256);
        assert.equal(modeled.provenance.targetPromptSha256,target.reference[0]!.publicPromptSha256);
      }
      const answers=target.reference.map((reference,slot)=>({caseId:generated.cases[slot]!.id,answer:strategy==='copy-ready-answer'?source.reference[slot]!.answer:modeled&&slot===0?modeled.answer!:reference.answer}));
      const result=scoreAttempt(generated.cases,generated.oracles,answers);
      transfer.push({...baseline,status:'evaluated',reason:null,score:result.score,criticalComplete:result.criticalComplete,confirmed:result.score>=requiredScore(grade)&&result.criticalComplete,interpretation:strategy==='copy-ready-answer'?'Concrete stale answer reproduction':strategy==='apply-only-A-mechanism-to-B'?'Specified source A mechanism mapped to visible B inputs, conditional on five independently correct non-core answers. No human transfer or broad resistance is measured.':strategy==='apply-studied-same-template-method'?'Specified source mechanism applied to new same-template core inputs; other five competencies held correct. Legitimate learned-method model, not observed human learning.':'Constructed independent-answer positive control, not observed understanding in people'});
    }
  }
}
const disagreements=rows.filter(row=>!row.agreesWithTeamReadiness);
const sourceHashes=Object.fromEntries(await Promise.all(['scripts/validate-grades.ts','scripts/lib/grade-transfer-model.ts','scripts/build-grade-reference.py','artifacts/api-server/src/lib/assessment-managed.ts','artifacts/api-server/src/lib/assessment-bank.ts'].map(async path=>[path,sha(await readFile(path))])));
const transferSummaries=[...new Set(transfer.map(row=>row.strategy))].map(strategy=>{const group=transfer.filter(row=>row.strategy===strategy),evaluated=group.filter(row=>row.status==='evaluated');return {strategy,attempted:group.length,evaluated:evaluated.length,notEvaluated:group.length-evaluated.length,confirmed:evaluated.filter(row=>row.confirmed).length};});
const transferSourceGuardRegressionManifestSha256=sha(await readFile('docs/validation/transfer-model-regression-v2-manifest.json'));
const transferExactDefinitionRegressionManifestSha256=sha(await readFile('docs/validation/transfer-model-regression-v3-manifest.json'));
const report={version:'signal-grade-validation-v2',label,executionMode:label==='before'?'Frozen historical v5/v1 rubric replay; original actual pre-change run is before-original.json':'Historical v6/v2 snapshot replay under current executable; original after report is unchanged',generatedAt:new Date().toISOString(),passed:answerErrors.length===0&&scoringErrors.length===0&&(label==='before'||disagreements.length===0),provenance:'AI-assisted team-authored synthetic reference. No human pilot, timing, population calibration or independent external experts.',programVersions:Object.fromEntries(assessmentPrograms.map(p=>[p.id,label==='before'?references.find(form=>form.programId===p.id)!.programVersion:p.id==='backend-python'?'signal-backend-python-v6':'signal-frontend-typescript-v2'])),sourceHashes,fixtureManifestSha256:sha(await readFile('docs/validation/frozen-manifest-v1.json')),transferModelVersion,transferExactDefinitionRegressionManifestSha256,transferSourceGuardRegressionManifestSha256,transferRegressionManifestSha256:sha(await readFile('docs/validation/transfer-model-regression-v1-manifest.json')),historicalTransferDefect:'outputs/quality/history/qa-cycle-01-transfer-defect/history-manifest.json',historicalSourceGuardDefect:'outputs/quality/history/qa-cycle-01-transfer-v2-pre-whitespace/history-manifest.json',historicalIndentationGuardDefect:'outputs/quality/history/qa-cycle-01-transfer-v3-pre-indent/history-manifest.json',commands:`node --import tsx scripts/validate-grades.ts --label ${label}`,counts:{forms:references.length,independentTaskAnswers:references.length*6,syntheticWorks:rows.length,pairs:pairs.length,teamLabelDisagreements:disagreements.length,answerErrors:answerErrors.length,scoringErrors:scoringErrors.length,transferExperiments:transfer.length,transferEvaluated:transfer.filter(row=>row.status==='evaluated').length,transferNotEvaluated:transfer.filter(row=>row.status==='not_evaluated').length},answerErrors,scoringErrors,disagreements,summaries,rows,pairs,transferSummaries,transfer,humanMeasures:{gradeValidity:'not_measured',formDifficultyEquivalence:'not_measured',repeatStability:'not_measured',methodSharingResistance:'not_measured',time:'not_measured'},limitations:['Readiness labels concern a synthetic work on a given grade, not three-class classification of a person.','Positive independent reasoning validates task arithmetic/content boundaries, not human difficulty.','A/B profile disagreement is deliberately retained for template-specific ability; it does not establish stochastic repeat reliability.','Fresh-control uses new parameters and independent worked answers, but shares semantic templates with development.','Threshold sensitivity is descriptive; production thresholds were never tuned against this report.','Core method transfer uses a bounded source-signature-validated model on visible new calls. Five non-core slots are independently correct by construction, so this is a conditional core-mechanism experiment, not acquired full-form skill.','Source definitions must match exact declared text after CRLF normalization and outer trim; all internal indentation/whitespace/literals remain significant. Alternative source formatting is conservatively unsupported, not semantically inferred.','Only source mechanism maps declared in model provenance are evaluated. Unsupported/count-mismatched scenarios are not_evaluated, not evidence of resistance.','Independent-understanding strategy is a declared target-reference positive control, not observed human understanding or a simulated learning process.','Historical v1 transfer reports contain two empty Backend model answers and a constant Frontend fallback; their broad transfer interpretation is invalid, preserved as history, and superseded by v2.']};
await mkdir('outputs/quality',{recursive:true});
await mkdir(output.slice(0,Math.max(output.lastIndexOf('/'),output.lastIndexOf('\\'))),{recursive:true});
await writeFile(output,JSON.stringify(report,null,2),{flag:'wx'});
console.log(JSON.stringify({passed:report.passed,label,counts:report.counts,summaries}));
assert.equal(answerErrors.length,0,'Production oracle disagrees with independent visible-task reference');
assert.equal(scoringErrors.length,0,'Production credit disagrees with independent fixture arithmetic');
if(label==='after')assert.equal(disagreements.length,0,'Readiness disagreement remains; inspect and document instead of changing frozen labels');
