import test from 'node:test';
import assert from 'node:assert/strict';
import { candidateGradeSummary, selectionMismatchReasons } from '../artifacts/fsp-signal/src/lib/selection-presentation';

test('declared grade is visible without becoming a confirmed grade',()=>{
  assert.equal(candidateGradeSummary({verifiedGrade:null,declaredGrade:'Senior'}),'Грейд не подтверждён · Заявлен: Senior');
  assert.equal(candidateGradeSummary({verifiedGrade:'Middle',declaredGrade:'Senior'}),'Подтверждён: Middle · Заявлен: Senior');
  assert.equal(candidateGradeSummary({verifiedGrade:null}),'Грейд не подтверждён');
});
test('mismatch distinguishes missing declared skill and insufficient proof, excluding desirable gaps',()=>{
  const reasons=selectionMismatchReasons({score:null,eligible:false,ineligibilityReasons:['required_skills'],gaps:['React'],evidence:[
    {requirement:'Python',satisfied:false,reason:'Нужно подтверждение Middle или выше.'},
    {requirement:'Docker',satisfied:false,reason:'Обязательный навык не заявлен и не подтверждён.'},
    {requirement:'React',satisfied:false,reason:'Нужно подтверждение навыка.'},
  ]},{requiredSkills:['Python','Docker']});
  assert.deepEqual(reasons,['Python: Нужно подтверждение Middle или выше.','Docker: Обязательный навык не заявлен и не подтверждён.']);
});
test('grade mismatch names the selected mode and never invents proof or exposes a technical reason code',()=>{
  const mismatch={score:null,eligible:false,ineligibilityReasons:['grade','specialization']};
  assert.deepEqual(selectionMismatchReasons(mismatch,{grade:'Middle',gradeMode:'declared_or_verified'}),[
    'Специализация резюме не совпадает с требованиями.','Нужен заявленный или подтверждённый общий грейд Middle или выше.',
  ]);
  assert.deepEqual(selectionMismatchReasons({...mismatch,ineligibilityReasons:['grade']},{grade:'Middle'}),['Нужен подтверждённый общий грейд Middle или выше.']);
  assert.deepEqual(selectionMismatchReasons({...mismatch,eligible:true},{grade:'Middle'}),[]);
  assert.deepEqual(selectionMismatchReasons({score:null,eligible:false}),['Резюме не соответствует текущим требованиям.']);
});
