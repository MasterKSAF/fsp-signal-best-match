import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { assembleManagedAttempt,managedTemplates,type ProgramId } from '../artifacts/api-server/src/lib/assessment-managed';
import { scoreAttempt,isCurrentKalibrAttempt,requiredScore,type AssessmentGrade } from '../artifacts/api-server/src/lib/assessment-bank';
import { executeVisibleSemanticTask } from '../scripts/lib/assessment-semantic-execution';
import { resolveCriterionCompatibility } from '../artifacts/api-server/src/lib/signal-evidence-compatibility';
const programs:ProgramId[]=['backend-python','frontend-typescript'];const grades:AssessmentGrade[]=['Junior','Middle','Senior'];
const solve=(f:ReturnType<typeof assembleManagedAttempt>)=>f.cases.map(c=>({caseId:c.id,answer:f.oracles[c.id]!.answer}));

test('all18 original discrepancies are the predeclared different-knowledge profile, not threshold instability',()=>{
 const old=JSON.parse(readFileSync('outputs/quality/assessment-validation-after.json','utf8'));const inputs=JSON.parse(readFileSync('outputs/quality/assessment-audit-2026-10-07/historical-inputs.json','utf8'));
 assert.equal(createHash('sha256').update(readFileSync('outputs/quality/assessment-validation-after.json')).digest('hex'),inputs.files.find((r:any)=>r.path==='outputs/quality/assessment-validation-after.json').sha256);
 const differences=old.pairs.filter((r:any)=>!r.sameDecision);assert.equal(differences.length,18);
 for(const pair of differences){assert.equal(pair.profile,'one-template-method-only');const b=old.rows.find((r:any)=>r.programId===pair.programId&&r.grade===pair.grade&&r.batch===pair.batch&&r.profile===pair.profile&&r.form==='B');assert.equal(b.evidence[0].score,0);assert.equal(b.criticalComplete,false);assert.ok(b.thresholdSensitivity.every((r:any)=>!r.confirmed));}
});

test('new integer semantics admit equivalent decimal integers; immutable old snapshots retain exact text scoring',()=>{
 for(const p of programs)for(const g of grades){const historical=assembleManagedAttempt(p,g,'integer-compatibility',{forcedVariant:1,programVersion:p==='backend-python'?'signal-backend-python-v6':'signal-frontend-typescript-v2'});const current=assembleManagedAttempt(p,g,'integer-compatibility',{forcedVariant:1});
 const frozen=JSON.stringify(historical);const value=historical.oracles[historical.cases[1]!.id]!.answer;
 for(const representation of [`+${value}`,`000${value}`,`+000${value}`]){const old=solve(historical),next=solve(current);old[1]!.answer=representation;next[1]!.answer=representation;assert.equal(scoreAttempt(historical.cases,historical.oracles,old).evidence[1]!.score,0);const result=scoreAttempt(current.cases,current.oracles,next);assert.equal(result.evidence[1]!.score,100);assert.equal(result.criticalComplete,true);}
 for(const representation of [`${value}.0`,`${value}e0`,`${value} | ${value}`,`${value} 0`,`${value}руб`,'++2','−2','２','Infinity','NaN',String(BigInt(value)+1n)]){const next=solve(current);next[1]!.answer=representation;const result=scoreAttempt(current.cases,current.oracles,next);assert.equal(result.evidence[1]!.score,0);assert.equal(result.criticalComplete,false);}
 assert.equal(JSON.stringify(historical),frozen);assert.equal(requiredScore(g),g==='Junior'?67:83);}
});

test('integer comparator preserves precision, negative zero and strict syntax; malformed saved policy fails qualification validation',()=>{
 const current=assembleManagedAttempt('backend-python','Junior','scalar-integer',{forcedVariant:2});const c=current.cases[1]!,oracle=current.oracles[c.id]!;
 const single=(expected:string,actual:string)=>scoreAttempt([c],{[c.id]:{...oracle,answer:expected}},[{caseId:c.id,answer:actual}]).score;
 assert.equal(single('9007199254740993','+0009007199254740993'),100);assert.equal(single('9007199254740993','9007199254740992'),0);
 assert.equal(single('-2','-0002'),100);assert.equal(single('0','-0000'),100);assert.equal(single('-2','−2'),0);assert.equal(single('2','2.0'),0);
 const invalid=structuredClone(current);delete invalid.oracles[c.id]!.blueprint.answerComparison;assert.equal(isCurrentKalibrAttempt(invalid.cases,invalid.oracles),false);
 const old=assembleManagedAttempt('backend-python','Junior','old-policy',{forcedVariant:1,programVersion:'signal-backend-python-v6'});old.oracles[old.cases[1]!.id]!.blueprint.answerComparison='canonical_integer_v1';assert.equal(isCurrentKalibrAttempt(old.cases,old.oracles),false);
});

test('third form keys agree with executable visible Python/TypeScript/SQL across every grade and unfamiliar seed',()=>{
 for(const p of programs)for(const g of grades)for(const seed of ['independent-runtime-101','independent-runtime-211']){const form=assembleManagedAttempt(p,g,seed,{forcedVariant:2});assert.equal(isCurrentKalibrAttempt(form.cases,form.oracles),true);
 for(const slot of [0,1,3,5])assert.equal(executeVisibleSemanticTask(form.cases[slot]!.prompt,slot),form.oracles[form.cases[slot]!.id]!.answer,`${p}/${g}/${slot}`);
 const copied=assembleManagedAttempt(p,g,seed,{forcedVariant:0});const result=scoreAttempt(form.cases,form.oracles,form.cases.map((c,i)=>({caseId:c.id,answer:copied.oracles[copied.cases[i]!.id]!.answer})));assert.equal(result.criticalComplete&&result.score>=requiredScore(g),false);}
});

test('versioned registry availability/exposure and identity compatibility preserve original program/version/grade',()=>{
 assert.equal(managedTemplates.length,108);
 for(const p of programs)for(const g of grades){const form=assembleManagedAttempt(p,g,'third-form',{forcedVariant:2});const version=form.oracles[form.cases[0]!.id]!.blueprint.version;
 const own=resolveCriterionCompatibility({programId:p,programVersion:version,criterionId:form.oracles[form.cases[0]!.id]!.blueprint.family,grade:g},p==='backend-python'?'Backend / Python':'Frontend / TypeScript');assert.equal(own.applied,true);
 assert.equal(resolveCriterionCompatibility({programId:p,programVersion:version,criterionId:form.oracles[form.cases[0]!.id]!.blueprint.family,grade:g},p==='backend-python'?'Frontend / TypeScript':'Backend / Python').applied,false);
 assert.throws(()=>assembleManagedAttempt(p,g,'bad-client-version',{programVersion:'unknown-version'}));assert.throws(()=>assembleManagedAttempt(p,g,'historical-third',{forcedVariant:2,programVersion:p==='backend-python'?'signal-backend-python-v6':'signal-frontend-typescript-v2'}));}
});
