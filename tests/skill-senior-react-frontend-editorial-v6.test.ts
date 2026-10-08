import assert from 'node:assert/strict';
import test from 'node:test';
import {seniorReactFrontendReviewedChoicesV6} from '../artifacts/api-server/src/lib/skill-senior-react-frontend-reviewed-choices-v6';
import {frontendSeniorProtocolChoicesV6} from '../artifacts/api-server/src/lib/skill-senior-frontend-protocol-choices-v6';
import {historicalSeniorV4RequirementProbe,seniorRequirementProbe} from '../artifacts/api-server/src/lib/skill-senior-outcomes';

const special=new Set(['react:1:0','react:3:0','react:3:2','react:4:0']);
test('Senior React/Frontend editorial covers 32 invariant families and excludes substantive v5/v6 corrections',()=>{
  let replacements=0;
  for(const skill of ['react','frontend-engineering'])for(let c=0;c<6;c++)for(let s=0;s<3;s++){
    const replacement=seniorReactFrontendReviewedChoicesV6(skill,c,s);
    if(special.has(`${skill}:${c}:${s}`)){assert.equal(replacement,null);continue;}
    assert.ok(replacement);replacements++;
    assert.equal(replacement.length,4);assert.equal(new Set(replacement).size,4);
    assert.notDeepEqual(replacement,historicalSeniorV4RequirementProbe(skill,c,s,5,false).parts[1].choices);
    assert.ok(replacement.every(choice=>!choice.includes('Дополнительно trace')&&!choice.includes('Сохранить correlation-id отправленного запроса')));
  }
  assert.equal(replacements,32);assert.equal(seniorReactFrontendReviewedChoicesV6('sql',0,0),null);
});
test('current Senior wrappers change only reviewed plans, retaining practical results and rubric contracts',()=>{
  for(const skill of ['react','frontend-engineering'])for(let c=0;c<6;c++)for(let s=0;s<3;s++)for(let n=5;n<=9;n++)for(const flag of [false,true]){
    const replacement=seniorReactFrontendReviewedChoicesV6(skill,c,s);if(!replacement)continue;
    const previous=historicalSeniorV4RequirementProbe(skill,c,s,n,flag),current=seniorRequirementProbe(skill,c,s,n,flag);
    assert.deepEqual(current.parts[0],previous.parts[0]);
    if(skill==='react')assert.deepEqual(current.parts[1].choices,replacement);
    else {assert.equal(current.parts[1].choices?.length,4);assert.equal(new Set(current.parts[1].choices).size,4);assert.equal(current.parts[1].choices?.[0],frontendSeniorProtocolChoicesV6(c,s,n,flag)[0]);}
    assert.equal(current.parts[1].expected,'1');
    assert.equal(current.parts[1].prompt,previous.parts[1].prompt);assert.equal(current.parts[1].explanation,previous.parts[1].explanation);
    assert.equal(current.requirementId,previous.requirementId);assert.equal(current.outcome,previous.outcome);
  }
});

test('all current Frontend Senior protocols have the same three scenario fields and one changed substantive field per alternative',()=>{
  const familyNames=new Set<string>();
  for(let c=0;c<6;c++)for(let s=0;s<3;s++)for(let n=5;n<=9;n++)for(const flag of [false,true]){
    const options=frontendSeniorProtocolChoicesV6(c,s,n,flag);
    assert.equal(options.length,4);assert.equal(new Set(options).size,4);
    const parse=(value:string)=>value.replace(/\.$/u,'').split('. ').map(field=>{const separator=field.indexOf(': ');return [field.slice(0,separator),field.slice(separator+2)];});
    const correct=parse(options[0]);assert.equal(correct.length,3);
    familyNames.add(`${c}/${s}`);
    for(const option of options.slice(1)){
      const fields=parse(option);assert.equal(fields.length,3);
      assert.deepEqual(fields.map(x=>x[0]),correct.map(x=>x[0]));
      assert.equal(fields.filter((x,i)=>x[1]!==correct[i][1]).length,1);
    }
  }
  assert.equal(familyNames.size,18);
});
