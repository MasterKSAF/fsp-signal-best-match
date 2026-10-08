import test from 'node:test';
import assert from 'node:assert/strict';
import { CreateEmployerNeedBody } from '../lib/api-zod/src/generated/api';
import { EmployerRequiredSkills } from '../artifacts/api-server/src/lib/employer-required-skills';
import { evaluateMatch, type MatchCandidate, type MatchNeed } from '../artifacts/api-server/src/lib/signal-matching';

const need: MatchNeed = { specialization:'Backend / Python',grade:'Junior',requiredSkills:['Python'],desirableSkills:[],workFormat:'Удалённо',salaryMin:100000,salaryMax:200000 };
const candidate: MatchCandidate = {userId:801,alias:'Independent',specialization:need.specialization,verifiedGrade:'Middle',verifiedScore:83,verifiedSkills:['Python','SQL'],stack:[],statedSkills:[],workFormat:need.workFormat,salaryMin:110000,salaryMax:180000,latestAssessmentAt:new Date('2026-10-07T12:00:00Z'),hasFspHistory:false,visibility:'pseudonymous',consentMatching:true,demoMode:true};
const body = {...need,title:'Independent need',description:'Synthetic required-skills control',salaryPeriod:'month',salaryType:'gross'};

test('source-generated contract rejects each blank original item, not just an empty array', () => {
  for (const skills of [[],[''],[' '],['\u00a0'],['\ufeff'],['\u3000'],['Python','\u202f']]) {
    assert.equal(CreateEmployerNeedBody.safeParse({...body,requiredSkills:skills}).success,false);
    assert.equal(EmployerRequiredSkills.safeParse(skills).success,false);
    assert.equal(evaluateMatch({...need,requiredSkills:skills},candidate,true).eligible,false);
  }
});
test('aliases normalize, unknown content remains mandatory and similar names stay distinct', () => {
  assert.deepEqual(EmployerRequiredSkills.parse(['  py  ','\u00a0SQL\u00a0','Python']),['Python','SQL']);
  assert.deepEqual(EmployerRequiredSkills.parse([' MyUnknownRequiredSkill ']),['MyUnknownRequiredSkill']);
  for (const skill of ['MyUnknownRequiredSkill','Java','JavaScript','Postgres','PostgreSQL'])
    assert.equal(evaluateMatch({...need,requiredSkills:[skill]},candidate,true).eligible,false);
  assert.equal(evaluateMatch({...need,requiredSkills:['py','SQL']},candidate,true).eligible,true);
});
test('limits apply before normalization and deduplication, including NFKC expansion', () => {
  assert.equal(EmployerRequiredSkills.safeParse(Array(41).fill('Python')).success,false);
  assert.equal(EmployerRequiredSkills.safeParse(['x'.repeat(101)]).success,false);
  assert.equal(EmployerRequiredSkills.safeParse(['ﬃ'.repeat(40)]).success,false);
  assert.equal(EmployerRequiredSkills.safeParse(Array(40).fill('x'.repeat(100))).success,true);
  assert.equal(CreateEmployerNeedBody.safeParse({...body,requiredSkills:Array(41).fill('Python')}).success,false);
});
