import test from 'node:test';
import assert from 'node:assert/strict';
import { applicationSkillChips } from '../artifacts/api-server/src/lib/employer-application-display';
import { skillModuleRegistry } from '../artifacts/api-server/src/lib/skill-module-bank';
import type { SkillModuleEvidence, SkillQualificationTarget } from '../artifacts/api-server/src/lib/skill-module-qualification';
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
test('An exact CV target never borrows another role CV and a fresh correction removes its proof',()=>{
  const evidence=[proof(1,'python'),proof(2,'sql','Middle')];
  const frontend={...target,specialization:'Frontend / TypeScript',stack:['TypeScript','React'],skills:[]};
  assert.deepEqual(applicationSkillChips(frontend,{evidence,revokedIds:new Set()}),[{label:'TypeScript',status:'declared'},{label:'React',status:'declared'}]);
  const corrected=applicationSkillChips(target,{evidence,revokedIds:new Set([1])});
  assert.deepEqual(corrected.find(item=>item.label==='Python'),{label:'Python',status:'declared'});
  assert.deepEqual(corrected.find(item=>item.label==='SQL'),{label:'SQL',status:'verified',level:'Middle'});
  assert.equal(applicationSkillChips(target,{evidence:[],revokedIds:new Set()}).every(item=>item.status==='declared'),true);
});
