import assert from 'node:assert/strict';
import test from 'node:test';
const evaluated=import('../scripts/evaluate-correction01-matching-supplement.ts').then(module=>module.evaluateSupplement());

test('frozen supplement exposes its original mistaken forecast instead of rewriting labels or failures',async()=>{
  const report=await evaluated;
  assert.equal(report.freeze.files.labels,'5494c474687ae55ccf6fb4e3c95f39488708889c080deaba7ab3afe3bb92127f');
  assert.equal(report.status,'FAIL');
  assert.deepEqual(report.failures,[{type:'projection',resumeId:10240,expected:null,actual:'Junior',derivationConsistent:true}]);
  assert.ok(report.projection.every(row=>row.derivationConsistent&&row.evidenceOwnerMatches));
  assert.equal(report.preservation.unchanged,true);
});

test('all four real qualification-to-CV matching paths retain admission and whole-CV selection',async()=>{
  const report=await evaluated;
  assert.equal(report.cases.length,4);
  for(const row of report.cases){
    assert.deepEqual(row.admission.falseAdmissions,[]); assert.deepEqual(row.admission.missingAdmissions,[]);
    assert.deepEqual(row.admission.selectedErrors,[]); assert.equal(row.admission.duplicates,0); assert.equal(row.permutationStable,true);
    assert.ok(row.orderingPairs.every(pair=>pair.passed));
  }
  const first=report.projection.find(row=>row.resumeId===10060)!,second=report.projection.find(row=>row.resumeId===10061)!;
  assert.equal(first.verifiedGrade,null); assert.equal(second.verifiedGrade,'Middle');
  const strict=report.cases.find(row=>row.needId==='backend-demo-explicit-skill-minimum')!;
  assert.ok([1007,1020,1021,1022].every(id=>!strict.admission.returned.includes(id)));
});

test('nonzero trusted synthetic Demo FSP has meaningful equal-category ablation and exact negative controls',async()=>{
  const report=await evaluated;
  assert.ok(report.bonusChecks.every(row=>row.passed));
  const backend=report.cases.find(row=>row.needId==='backend-demo-middle')!,frontend=report.cases.find(row=>row.needId==='frontend-demo-middle')!;
  for(const row of [backend,frontend]){
    assert.equal(row.fspAblation.changed,true); assert.equal(row.fspAblation.pairs.length,1);
    assert.equal(row.fspAblation.pairs[0]!.sameCategoryObserved,true); assert.equal(row.fspAblation.pairs[0]!.passed,true);
    assert.ok(row.order.some(entry=>entry.fspBonus===3));
  }
  assert.equal(report.categoryIsolation.passed,true);
  const ordinary=report.cases.find(row=>row.needId==='backend-ordinary-middle')!;
  assert.equal(ordinary.fspAblation.changed,false); assert.ok(ordinary.order.every(row=>row.fspBonus===0));
});

test('qualification strength uses real linked full exams and preserves unknown modular or historical scores',async()=>{
  const report=await evaluated;
  assert.equal(report.strength.comparable.sameProgram,true); assert.equal(report.strength.comparable.sameVersion,true);
  assert.equal(report.strength.comparable.sameRubric,true); assert.deepEqual(report.strength.comparable.scores,[100,83]);
  assert.notEqual(report.strength.incomparable.versions[0],report.strength.incomparable.versions[1]);
  assert.ok(report.strength.moduleOverallScores.every(row=>row.score===null)); assert.ok(report.strength.legacyOverallScores.every(row=>row.score===null));
  const revoked=report.projection.find(row=>row.userId===1008)!;
  assert.equal(revoked.verifiedGrade,null); assert.ok(!revoked.skillEvidence?.some(row=>row.skill==='SQL'));
  const full=report.projection.find(row=>row.userId===1024)!;
  assert.equal(full.historicalGrade,null); assert.equal(full.modularGrade,'Junior');
  assert.ok(full.historicalApplicability.some(row=>row.reasonCode==='revoked'));
});

test('catalog scope and filters use one actual CV and preserve independent catalog consent',async()=>{
  const report=await evaluated;
  for(const row of report.catalogs){assert.deepEqual(row.falseAdmissions,[]);assert.deepEqual(row.missingAdmissions,[]);assert.deepEqual(row.selectedErrors,[]);}
  const backend=report.catalogs.find(row=>row.id==='backend-demo-qualified-middle')!;
  assert.ok(backend.returned.includes(1011),'catalog consent is separate from matching consent');
  assert.ok(!backend.returned.includes(1009),'ordinary and demo pools remain separate');
  assert.ok(!backend.returned.includes(1012),'deleted CV is not catalog-visible');
  assert.equal(backend.people.find(row=>row.userId===1006)!.resumeId,10061);
});
