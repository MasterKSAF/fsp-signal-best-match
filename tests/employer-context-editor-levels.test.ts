import test from 'node:test';
import assert from 'node:assert/strict';
import { editorSkillLevels } from '../artifacts/fsp-signal/src/lib/employer-context-levels';
const dictionary = [{id:'python',value:'Python',aliases:['py']},{id:'api-contracts',value:'API contracts',aliases:['API-контракты']}];
test('Editor restores canonical levels on reload and preserves them through label or alias controls',()=>{
  assert.deepEqual(editorSkillLevels(['Python','API contracts'],{'skill:python':'Senior','skill:api-contracts':'Middle'},dictionary),{Python:'Senior','API contracts':'Middle'});
  assert.deepEqual(editorSkillLevels(['py','API-контракты'],{'skill:python':'Senior','skill:api-contracts':'Middle'},dictionary),{py:'Senior','API-контракты':'Middle'});
  assert.deepEqual(editorSkillLevels(['Python'],{'skill:python':'Senior'}),{Python:'Senior'});
});
test('Custom canonical keys survive; explicit clearing and removing skills remove their levels only',()=>{
  const stored = {'skill:python':'Senior','raw:custom skill':'Junior'} as const;
  assert.deepEqual(editorSkillLevels(['Python',' Custom Skill '],stored,dictionary),{Python:'Senior',' Custom Skill ':'Junior'});
  assert.deepEqual(editorSkillLevels(['Python'],stored,dictionary),{Python:'Senior'});
  assert.deepEqual(editorSkillLevels(['Python'],{},dictionary),{});
  assert.deepEqual(editorSkillLevels(['Python'],{py:'Middle',Python:'Senior'},dictionary),{Python:'Senior'});
});
