import test from 'node:test';
import assert from 'node:assert/strict';
import { applicationSkillChips } from '../artifacts/api-server/src/lib/employer-application-display';
import { skillModuleRegistry } from '../artifacts/api-server/src/lib/skill-module-bank';
import { getSkillQualification, type SkillModuleEvidence, type SkillQualificationTarget } from '../artifacts/api-server/src/lib/skill-module-qualification';
const target:SkillQualificationTarget={userId:72,specialization:'Backend / Python',assumedGrade:'Middle',stack:['Python','SQL'],skills:['Postgres','FastAPI']};
function proof(id:number,skillId:string,level:'Junior'|'Middle'='Junior',userId=72):SkillModuleEvidence {
  const competencies=skillModuleRegistry.find(module=>module.id===skillId)!.competencies;
  return {id,userId,attemptId:id,skillId,level,programVersion:'signal-skills-2026-10-v1',competencyIds:[...competencies],verifiedAt:new Date('2026-10-08T10:00:00Z'),decision:{score:100,passed:true,criticalComplete:true,competencies:competencies.map(id=>({id,passed:true,critical:false})),threshold:80}} as SkillModuleEvidence;
}
test('Application chips use real module levels; legacy declarations and neighbouring technologies stay gray',()=>{
  const items=applicationSkillChips(target,{evidence:[proof(1,'python'),proof(2,'sql','Middle'),proof(3,'react','Junior',99)],revokedIds:new Set()});
  assert.deepEqual(items.filter(item=>item.status==='verified').map(item=>[item.label,item.level]),[['Python','Junior'],['SQL','Middle']]);
  assert.deepEqual(items.filter(item=>item.status==='declared').map(item=>item.label),['PostgreSQL','FastAPI']);
  assert.ok(!JSON.stringify(items).includes('attemptId'));
});
test('Own account proofs survive another role while declarations and overall category stay exact to its CV; corrections remove proof',()=>{
  const evidence=[proof(1,'python'),proof(2,'sql','Middle'),proof(3,'react','Middle',99),proof(4,'typescript','Middle')];
  const inputs={evidence,revokedIds:new Set([4])};
  const frontend={...target,specialization:'Frontend / TypeScript',stack:['TypeScript','React'],skills:[]};
  assert.deepEqual(applicationSkillChips(frontend,inputs),[
    {label:'Python',status:'verified',level:'Junior'},
    {label:'SQL',status:'verified',level:'Middle'},
    {label:'TypeScript',status:'declared'},
    {label:'React',status:'declared'},
  ],'account proofs keep real levels; foreign React and revoked TypeScript cannot verify declarations, and another CV cannot supply PostgreSQL/FastAPI');
  const qualification=getSkillQualification(frontend,inputs);
  assert.deepEqual(qualification.skills.map(item=>[item.skillId,item.level,item.evidenceId]),[['python','Junior',1],['sql','Middle',2]],'chips must come from these current owned evidence records');
  assert.equal(qualification.verifiedGrade,null,'Python/SQL proof cannot complete the Frontend category');
  assert.equal(qualification.category,null);
  const correction={evidence,revokedIds:new Set([1,4])};
  assert.deepEqual(applicationSkillChips(frontend,correction),[
    {label:'SQL',status:'verified',level:'Middle'},
    {label:'TypeScript',status:'declared'},
    {label:'React',status:'declared'},
  ],'corrected Python disappears when the selected CV never declared it');
  const corrected=applicationSkillChips(target,correction);
  assert.deepEqual(corrected.find(item=>item.label==='Python'),{label:'Python',status:'declared'});
  assert.deepEqual(corrected.find(item=>item.label==='SQL'),{label:'SQL',status:'verified',level:'Middle'});
  assert.equal(applicationSkillChips(target,{evidence:[],revokedIds:new Set()}).every(item=>item.status==='declared'),true);
});
