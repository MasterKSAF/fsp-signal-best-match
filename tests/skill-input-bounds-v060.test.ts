import test from 'node:test';
import assert from 'node:assert/strict';
import {SaveCandidateProfileBody,CreateEmployerNeedBody,GetSkillCoverageQueryParams} from '../lib/api-zod/src/generated/api';
import {SkillCoverageQuerySchema,SKILL_COVERAGE_TEXT_LIMIT} from '../artifacts/api-server/src/lib/skill-coverage-input';
const tags=(count:number,length=100)=>Array.from({length:count},(_,i)=>String(i).padStart(2,'0')+'x'.repeat(length-2));
const profile={displayName:'Synthetic bounded profile',professionalAlias:'Synthetic bounded alias',specialization:'Backend / Python',assumedGrade:'Middle',stack:tags(30),skills:tags(40),yearsExperience:0,workFormat:'Удалённо',salaryPeriod:'month',salaryType:'gross',visibility:'pseudonymous',consentMatching:false};
const need={title:'Synthetic bounded need',specialization:'Backend / Python',grade:'Middle',requiredSkills:tags(40),desirableSkills:tags(40),description:'Synthetic contract boundary only',workFormat:'Удалённо',salaryMin:1,salaryMax:2,salaryPeriod:'month',salaryType:'gross'};
test('actual generated profile API body accepts30/40 tags of100 and rejects31/41 or101 without altering accepted values',()=>{
  const accepted=SaveCandidateProfileBody.safeParse(profile);assert.ok(accepted.success);assert.deepEqual(accepted.data.stack,profile.stack);assert.deepEqual(accepted.data.skills,profile.skills);
  for(const patch of [{stack:tags(31)},{skills:tags(41)},{stack:tags(1,101)},{skills:tags(1,101)}])assert.equal(SaveCandidateProfileBody.safeParse({...profile,...patch}).success,false);
});
test('actual generated need body keeps required min1, accepts40x100 in both lists, rejects41/101 and retains empty desirable list',()=>{
  assert.ok(CreateEmployerNeedBody.safeParse(need).success);assert.ok(CreateEmployerNeedBody.safeParse({...need,desirableSkills:[]}).success);
  for(const patch of [{requiredSkills:[]},{requiredSkills:tags(41)},{desirableSkills:tags(41)},{requiredSkills:tags(1,101)},{desirableSkills:tags(1,101)}])assert.equal(CreateEmployerNeedBody.safeParse({...need,...patch}).success,false);
});
test('real coverage route schema and generated query agree on finite4100 limit and cover40x100 comma-space joined values',()=>{
  const query={specialization:'Backend / Python',skills:tags(40).join(', ')};assert.equal(query.skills.length,4078);assert.equal(SKILL_COVERAGE_TEXT_LIMIT,4100);
  for(const schema of [SkillCoverageQuerySchema,GetSkillCoverageQueryParams]){assert.ok(schema.safeParse(query).success);assert.ok(schema.safeParse({...query,skills:'x'.repeat(4100)}).success);assert.equal(schema.safeParse({...query,skills:'x'.repeat(4101)}).success,false);}
  assert.equal(SkillCoverageQuerySchema.safeParse({...query,unknown:'client cannot extend route'}).success,false);
});
