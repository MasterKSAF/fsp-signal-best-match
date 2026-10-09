import test from 'node:test';
import assert from 'node:assert/strict';
import { contextRequirements, editorRequirements, invitationDraft, requirementLabel, supportsRequirementLevel, verifiedRequirementLevels } from '../artifacts/fsp-signal/src/lib/context-requirements';

test('old requirements keep proof required and do not invent a minimum level from the CV grade',()=>{
  assert.deepEqual(contextRequirements({requiredSkills:['Python','Docker'],requiredSkillLevels:{Python:'Middle'}}),[
    {skill:'Python',mode:'verified',level:'Middle'},{skill:'Docker',mode:'verified'},
  ]);
  assert.deepEqual(contextRequirements({skills:['Python'],skillRequirements:[{skill:'Python',level:'Senior'}]}),[{skill:'Python',mode:'verified',level:'Senior'}]);
});
test('mixed requirements survive dictionary aliases, deselection and legacy levels',()=>{
  const dictionary=[{id:'python',value:'Python',aliases:['py']},{id:'docker',value:'Docker'}];
  const source={skillRequirements:[{skill:'skill:python',mode:'verified',level:'Middle'},{skill:'Docker',mode:'declared_or_verified'}],requiredSkillLevels:{'skill:python':'Middle'}} as const;
  const requirements=editorRequirements(['py','Docker'],{skillRequirements:[...source.skillRequirements],requiredSkillLevels:source.requiredSkillLevels},dictionary);
  assert.deepEqual(requirements,[{skill:'Python',mode:'verified',level:'Middle'},{skill:'Docker',mode:'declared_or_verified'}]);
  assert.deepEqual(verifiedRequirementLevels(requirements),{Python:'Middle'});
  assert.deepEqual(editorRequirements(['Docker'],{skillRequirements:requirements},dictionary),[{skill:'Docker',mode:'declared_or_verified'}]);
  assert.match(requirementLabel(requirements[1]),/достаточно заявленного/);
});
test('declared skills never inherit a level; switching mode explicitly removes the old condition',()=>{
  const result=editorRequirements(['Python'],{skillRequirements:[{skill:'Python',mode:'declared_or_verified'}],requiredSkillLevels:{Python:'Senior'}});
  assert.deepEqual(result,[{skill:'Python',mode:'declared_or_verified'}]);
  assert.deepEqual(verifiedRequirementLevels(result),{});
});
test('private request names never enter generated candidate-facing invitation text',()=>{
  const marker='INTERNAL-ONLY-PRIVATE-NEED-42';
  const draft=invitationDraft({type:'need',title:marker});
  assert.equal(JSON.stringify(draft).includes(marker),false);
  assert.equal(draft.title,'Приглашение от компании');
  const publicDraft=invitationDraft({type:'job',title:'Python-разработчик'});
  assert.match(publicDraft.title,/Python-разработчик/);
  assert.match(publicDraft.message,/Python-разработчик/);
});
test('minimum level is offered only for module skills, including canonical dictionary aliases',()=>{
  const dictionary=[{id:'python',value:'Python',aliases:['py']},{id:'typescript',value:'TypeScript',aliases:['ts']},{id:'backend-engineering',value:'Backend engineering',aliases:['Серверная разработка']},{id:'frontend-engineering',value:'Frontend engineering',aliases:['Клиентская разработка']}];
  for(const skill of ['Python',' py ','SQL','ts','React','Backend engineering','frontend-engineering','Серверная разработка','Клиентская разработка'])assert.equal(supportsRequirementLevel(skill,dictionary),true,skill);
  for(const skill of ['Docker','FastAPI','PostgreSQL','API contracts','Architecture','raw:docker','React Native','skill:python'])assert.equal(supportsRequirementLevel(skill,dictionary),false,skill);
  // The six public canonical labels accepted by the API remain available even while the dictionary is loading.
  for(const skill of ['Python','SQL','TypeScript','React','Backend engineering','Frontend engineering'])assert.equal(supportsRequirementLevel(skill),true,skill);
});

test('legacy alias levels survive without a loaded dictionary and freeform IDs cannot promise unsupported levels',()=>{
  assert.deepEqual(editorRequirements(['Python'],{requiredSkillLevels:{'skill:python':'Middle'}}),[{skill:'Python',mode:'verified',level:'Middle'}]);
  assert.deepEqual(editorRequirements(['Python'],{skillRequirements:[{skill:'py',mode:'declared_or_verified'}]}),[{skill:'Python',mode:'declared_or_verified'}]);
  assert.equal(supportsRequirementLevel('frontend-engineering'),false);
  const dictionary=[{id:'frontend-engineering',value:'Frontend engineering',aliases:['Клиентская разработка']}];
  assert.deepEqual(editorRequirements(['Клиентская разработка'],{skillRequirements:[{skill:'Клиентская разработка',mode:'verified',level:'Middle'}]},dictionary),[{skill:'Frontend engineering',mode:'verified',level:'Middle'}]);
});
