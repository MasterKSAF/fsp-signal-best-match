import assert from 'node:assert/strict';
import test from 'node:test';
import { resumeCompletion, selectedSkillProgress, resumeRoleRecommendations } from '../artifacts/api-server/src/lib/resume-progress';
const empty={title:'Инженер',specialization:'Backend / Python',summary:'',stack:[] as string[],skills:[] as string[],experience:[] as any[],projects:[] as any[],workFormat:'Удалённо'};
test('professional completeness has explicit five sections and never depends on photograph, contacts or optional education',()=>{
  const initial=resumeCompletion(empty);assert.equal(initial.completed,2);assert.equal(initial.total,5);
  const complete={...empty,summary:'Разрабатываю сервисы',stack:['Python'],projects:[{title:'Проект'}]};assert.equal(resumeCompletion(complete).completed,5);
  assert.deepEqual(resumeCompletion({...complete,photo:null,contactEmail:null,education:[]} as any),resumeCompletion(complete));
});
test('confirmation denominator includes unsupported skills and deduplicates aliases; unrelated evidence does not inflate it',()=>{
  const progress=selectedSkillProgress({...empty,stack:['Python','SQL'],skills:['python','Rust']},[{label:'Python',level:'Junior'},{label:'React',level:'Middle'}],['Python','SQL','React']);
  assert.equal(progress.total,3);assert.equal(progress.confirmed,1);assert.equal(progress.supported,2);assert.equal(progress.unsupported,1);assert.equal(progress.items.find(item=>item.label==='Rust')?.verified,false);
});
test('empty selected skills has honest zero denominator and never shows complete confirmation',()=>{
  const progress=selectedSkillProgress(empty,[{label:'Python',level:'Senior'}],['Python']);assert.equal(progress.total,0);assert.equal(progress.confirmed,0);
});
test('CV recommendations come only from missing role requirements and preserve actual lower proof level',()=>{
  const coverage=[{skillId:'python',level:'Middle',covered:false},{skillId:'sql',level:'Middle',covered:true},{skillId:'backend-engineering',level:'Middle',covered:false},{skillId:null,level:'Middle',covered:false}];
  const recommendations=resumeRoleRecommendations(coverage,[{skillId:'python',level:'Junior'}],[{id:'python',label:'Python'},{id:'sql',label:'SQL'},{id:'backend-engineering',label:'Инженерия Backend'},{id:'postgresql',label:'PostgreSQL'}]);
  assert.deepEqual(recommendations,[{skillId:'python',label:'Python',level:'Middle',verifiedLevel:'Junior'},{skillId:'backend-engineering',label:'Инженерия Backend',level:'Middle',verifiedLevel:null}]);
  assert.ok(!recommendations.some(item=>item.skillId==='postgresql'));
});
