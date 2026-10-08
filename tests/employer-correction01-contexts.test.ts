import test from 'node:test';
import assert from 'node:assert/strict';
import { retainedSkillLevelRequirements, validateSkillLevelRequirements } from '../artifacts/api-server/src/lib/skill-level-requirements';
import { requirementLevels, selectionMatchNeed, type SelectionContextDto } from '../artifacts/api-server/src/lib/selection-context-contract';
import { pendingInvitationCompatible } from '../artifacts/api-server/src/lib/invitation-context-input';
import { evaluateMatch, type SignalGrade } from '../artifacts/api-server/src/lib/signal-matching';
import { MATCH_CONTROL_CANDIDATES } from '../artifacts/api-server/src/lib/matching-control-fixtures';

test('C01 canonical stored keys, raw labels, aliases and unknown raw skills survive repeated level round trips',()=>{
  const skills=['Python','Q-Store'];
  const expected={'skill:python':'Senior','raw:q-store':'Middle'};
  let value:unknown={py:'Senior','Q-Store':'Middle'};
  for(let reload=0;reload<3;reload++) {
    const result=validateSkillLevelRequirements(value,skills);assert.equal(result.success,true);
    assert.deepEqual(result.data,expected);value=result.data;
  }
  assert.deepEqual(retainedSkillLevelRequirements(expected,['py',' Q-Store ']),expected);
  assert.equal(validateSkillLevelRequirements({'skill:sql':'Senior'},skills).success,false);
  assert.equal(validateSkillLevelRequirements({Python:'Junior',py:'Senior'},skills).success,false,'conflicting aliases must not silently weaken a minimum');
  const boundedLabel='x'.repeat(100),bounded=validateSkillLevelRequirements({[boundedLabel]:'Senior'},[boundedLabel]);assert.equal(bounded.success,true);
  assert.deepEqual(validateSkillLevelRequirements(bounded.data,[boundedLabel]),bounded,'valid maximum-length unknown labels survive the raw: prefix on reload');
});
test('C01 omitted levels preserve retained requirements; explicit clearing and skill removal remain possible',()=>{
  const stored={'skill:python':'Senior','skill:sql':'Middle'} as const;
  assert.deepEqual(retainedSkillLevelRequirements(stored,['Python','SQL']),stored);
  assert.deepEqual(retainedSkillLevelRequirements(stored,['py']),{'skill:python':'Senior'});
  const explicit=validateSkillLevelRequirements({},['Python','SQL']);assert.equal(explicit.success,true);assert.deepEqual(explicit.data,{});
});
const context:SelectionContextDto={type:'need',id:1,version:1,title:'Проверка границы уровня',specialization:'Backend / Python',grade:'Junior',
  requiredSkills:['Python'],requiredSkillLevels:{'skill:python':'Senior'},desirableSkills:[],description:'Проверка одинакового допуска для вакансии и запроса',
  workFormat:'Удалённо',salaryMin:1,salaryMax:1000000,salaryPeriod:'month',salaryType:'gross',status:'active',updatedAt:'2026-10-09T00:00:00Z'};
test('C02 shared job adapter canonicalizes aliases and applies the same Junior/Middle/Senior boundary as needs',()=>{
  for(const skill of ['Python','py'])for(const minimum of ['Junior','Middle','Senior'] as const)for(const level of ['Junior','Middle','Senior'] as const) {
    const need=selectionMatchNeed({...context,requiredSkills:[skill],requiredSkillLevels:{'skill:python':minimum}});
    const job=selectionMatchNeed({...context,type:'job',requiredSkills:[skill],requiredSkillLevels:requirementLevels([{skill,level:minimum}])});
    const candidate={...MATCH_CONTROL_CANDIDATES[0],specialization:context.specialization,verifiedGrade:level,verifiedSkills:['Python'],
      consentMatching:true,visibility:'pseudonymous' as const,readyForOffers:true,workFormat:'Удалённо',salaryMin:100000,salaryMax:200000,salaryPeriod:'month' as const,salaryType:'gross' as const,
      skillEvidence:[{skill:'Python',level,sourceType:'signal_skill_module' as const,criterion:'Synthetic boundary proof'}]};
    assert.deepEqual(job.requiredSkillLevels,{'skill:python':minimum});
    const rank:Record<SignalGrade,number>={Junior:1,Middle:2,Senior:3};
    assert.equal(evaluateMatch(need,candidate,true).eligible,rank[level]>=rank[minimum]);
    assert.equal(evaluateMatch(job,candidate,true).eligible,evaluateMatch(need,candidate,true).eligible);
  }
});
test('C02 a declared label or legacy overall evidence cannot bypass an explicit module minimum',()=>{
  const need=selectionMatchNeed({...context,type:'job',requiredSkillLevels:requirementLevels([{skill:'py',level:'Senior'}])});
  const candidate={...MATCH_CONTROL_CANDIDATES[0],specialization:context.specialization,verifiedGrade:'Senior' as const,verifiedSkills:['Python'],
    statedSkills:['Python'],stack:['Python'],consentMatching:true,visibility:'pseudonymous' as const,readyForOffers:true,workFormat:'Удалённо',
    salaryMin:100000,salaryMax:200000,salaryPeriod:'month' as const,salaryType:'gross' as const};
  assert.equal(evaluateMatch(need,{...candidate,skillEvidence:[]},true).eligible,false);
  assert.equal(evaluateMatch(need,{...candidate,skillEvidence:[{skill:'Python',level:'Senior',sourceType:'signal_assessment',criterion:'Historical overall proof'}]},true).eligible,false);
});
const conditions={resumeId:4,title:'Отправленные условия',message:'Приглашение на разговор',reason:'Подходящий подтверждённый профиль',salaryMin:100000,salaryMax:200000,salaryPeriod:'month',salaryType:'gross',workFormat:'Удалённо'};
test('C03 new-key reuse requires the exact CV, sent conditions and prepared revisions without mutating the pending invitation',()=>{
  const existing={...conditions,contextVersion:2,resumeSnapshot:{revision:3,immutable:'historical snapshot'}};
  const before=JSON.stringify(existing),prepared={contextVersion:2,resumeRevision:3};
  assert.equal(pendingInvitationCompatible(existing,{...conditions},prepared),true);
  for(const [field,value] of Object.entries({resumeId:5,title:'Другой заголовок',message:'Другое сообщение',reason:'Другая причина',salaryMin:110000,salaryMax:210000,salaryPeriod:'year',salaryType:'net',workFormat:'Гибрид'}))
    assert.equal(pendingInvitationCompatible(existing,{...conditions,[field]:value},prepared),false,field);
  assert.equal(pendingInvitationCompatible(existing,conditions,{...prepared,contextVersion:3}),false);
  assert.equal(pendingInvitationCompatible(existing,conditions,{...prepared,resumeRevision:4}),false);
  assert.equal(JSON.stringify(existing),before);
});
