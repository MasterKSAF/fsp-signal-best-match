import assert from 'node:assert/strict';
import test from 'node:test';
import {juniorReviewedChoicesV6} from '../artifacts/api-server/src/lib/skill-junior-reviewed-choices-v6';
import {skillBaseScenarioFixture,skillModuleRegistry} from '../artifacts/api-server/src/lib/skill-module-bank';

test('Junior editorial covers every MCQ family across all issued n/flag variants, without changing exact tasks',()=>{
  const families=new Set<string>();let variants=0;
  for(const module of skillModuleRegistry)for(let c=0;c<6;c++)for(let s=0;s<3;s++)for(let n=5;n<=9;n++)for(const flag of [false,true]){
    const historicalBase=skillBaseScenarioFixture(module.id,'Junior',c,s,n,flag);
    const replacement=juniorReviewedChoicesV6(module.id,c,s,n,flag);
    if(!historicalBase.options){assert.equal(replacement,null,`${module.id}/${c}/${s} is exact`);continue;}
    families.add(`${module.id}:${c}:${s}`);variants++;
    assert.ok(replacement,`${module.id}/${c}/${s} missing editorial`);
    assert.equal(replacement.length,4);assert.equal(new Set(replacement).size,4);
    assert.ok(replacement.every(option=>option.trim().length>0));
    const expectedPosition=historicalBase.options.indexOf(historicalBase.answer);
    assert.ok(expectedPosition===0||expectedPosition===1,'historical option identity must be explicit');
    assert.ok(replacement[expectedPosition]);
    assert.notDeepEqual(replacement,historicalBase.options,'current editorial must not alias the historical options');
    // A caller can shuffle/annotate a returned array without changing future issued variants.
    replacement.reverse();assert.notDeepEqual(replacement,juniorReviewedChoicesV6(module.id,c,s,n,flag));
  }
  assert.equal(families.size,44);assert.equal(variants,440);
});
