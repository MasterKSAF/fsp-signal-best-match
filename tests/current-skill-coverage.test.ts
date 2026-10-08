import test from 'node:test';
import assert from 'node:assert/strict';
import { currentSkillCoverage } from '../artifacts/api-server/src/lib/current-skill-coverage';
import { skillModuleRegistry,skillModuleTemplates,SKILL_BANK_VERSION } from '../artifacts/api-server/src/lib/skill-module-bank';

test('coverage follows all current skill modules and levels, including React and aliases',()=>{
  for(const item of currentSkillCoverage(skillModuleRegistry.map(module=>module.title),{enabled:true})){
    assert.equal(item.supported,true,item.label);
    assert.deepEqual(item.availableLevels,['Junior','Middle','Senior']);
    assert.equal(item.programVersion,SKILL_BANK_VERSION);
  }
  assert.equal(currentSkillCoverage(['py','ts','React'],{enabled:true})[0].id,'python');
  assert.equal(currentSkillCoverage(['py','ts','React'],{enabled:true})[1].id,'typescript');
});
test('unavailable programmes and unsupported technologies never receive a false availability claim',()=>{
  assert.equal(currentSkillCoverage(['React'],{enabled:false})[0].supported,false);
  assert.equal(currentSkillCoverage(['Postgres','FastAPI','New framework'],{enabled:true}).some(row=>row.supported),false);
  const disabled=new Set(skillModuleTemplates.filter(row=>row.skillId==='react'&&row.level==='Senior').map(row=>row.id));
  assert.deepEqual(currentSkillCoverage(['React'],{enabled:true,disabled})[0].availableLevels,['Junior','Middle']);
});
