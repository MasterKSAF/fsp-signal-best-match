import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateGradeRequirement, evaluateSkillRequirement, interpretSkillRequirements, validateRecruitingRequirements } from '../artifacts/api-server/src/lib/recruiting-requirements';
import { evaluateMatch, type MatchCandidate, type MatchNeed, type SafeSkillEvidence } from '../artifacts/api-server/src/lib/signal-matching';
import { preparePoolAdmission } from '../artifacts/api-server/src/lib/matching-pool-admission';
import { shortlistReview } from '../artifacts/api-server/src/lib/shortlist-review';
import { canonicalSkillKey } from '../artifacts/api-server/src/lib/skill-catalog';
import { selectionMatchNeed } from '../artifacts/api-server/src/lib/selection-context-contract';
import { jobExportCells } from '../artifacts/api-server/src/lib/job-discovery';

const candidate:MatchCandidate={userId:11,alias:'Fixture',specialization:'Backend / Python',assumedGrade:'Middle',verifiedGrade:null,verifiedScore:null,
 verifiedSkills:[],stack:['Python','Docker'],statedSkills:[],workFormat:'Удалённо',salaryMin:100000,salaryMax:200000,salaryPeriod:'month',salaryType:'gross',
 latestAssessmentAt:null,hasFspHistory:false,visibility:'public',consentMatching:true,demoMode:false};
const need:MatchNeed={specialization:'Backend / Python',grade:'Middle',requiredSkills:['Python','Docker'],desirableSkills:[],workFormat:'Удалённо',salaryMin:100000,salaryMax:200000,salaryPeriod:'month',salaryType:'gross'};
const declared:MatchNeed={...need,gradeMode:'declared_or_verified',skillRequirements:[{skill:'Python',mode:'declared_or_verified'},{skill:'Docker',mode:'declared_or_verified'}]};
const proof:SafeSkillEvidence={skill:'Python',candidateId:11,attemptId:51,programId:'skill:python',programVersion:'signal-skills-v2',templateId:null,templateVersion:null,criterionId:'module:python',criterion:null,result:null,date:'2026-10-09T00:00:00Z',sourceType:'signal_skill_module',limitation:null,level:'Middle'};

test('legacy skill and grade requirements remain verified, with no invented skill minimum',()=>{
 assert.deepEqual(interpretSkillRequirements(['Python']),[{skill:'Python',mode:'verified'}]);
 assert.equal(evaluateMatch(need,candidate,false).eligible,false);
 assert.equal(evaluateGradeRequirement('Middle',undefined,candidate).satisfied,false);
 const result=evaluateMatch(need,{...candidate,verifiedGrade:'Middle',verifiedSkills:['Python','Docker']},false);
 assert.equal(result.eligible,true);
});
test('declared-only selected CV passes flexible requirements without proof credit',()=>{
 const result=evaluateMatch(declared,candidate,false);
 assert.equal(result.eligible,true);
 assert.equal(preparePoolAdmission(declared,false)(candidate),true);
 assert.equal(result.factors.find(item=>item.name==='Подтверждённое покрытие навыков')!.score,0);
 assert.ok(result.evidence.every(item=>item.status==='stated'&&item.satisfied&&item.provenance===null&&item.date===null));
 assert.deepEqual(result.strengths,[]);
 assert.deepEqual(result.gaps,[]);
});
test('a second CV cannot supply declaration or grade to the selected CV',()=>{
 assert.equal(evaluateMatch(declared,{...candidate,stack:['SQL']},false).eligible,false);
 assert.equal(evaluateMatch(declared,{...candidate,assumedGrade:'Junior'},false).eligible,false);
 assert.equal(preparePoolAdmission(declared,false)({...candidate,stack:['SQL']}),false);
});
test('mixed requirements need the exact proof level and keep declared Docker distinct',()=>{
 const mixed:MatchNeed={...declared,skillRequirements:[{skill:'Python',mode:'verified',level:'Middle'},{skill:'Docker',mode:'declared_or_verified'}]};
 const person={...candidate,verifiedSkills:['Python'],skillEvidence:[proof]};
 const result=evaluateMatch(mixed,person,false);
 assert.equal(result.eligible,true);assert.equal(preparePoolAdmission(mixed,false)(person),true);
 assert.equal(result.evidence[0].status,'verified');assert.equal(result.evidence[1].status,'stated');
 assert.equal(result.factors.find(item=>item.name==='Подтверждённое покрытие навыков')!.score,0.5);
 assert.equal(evaluateMatch(mixed,{...person,skillEvidence:[{...proof,level:'Junior'}]},false).eligible,false);
 assert.equal(evaluateMatch(mixed,{...person,skillEvidence:[{...proof,candidateId:12}]},false).eligible,false);
});
test('higher verified grade satisfies either mode; declared grade never supplies a skill level',()=>{
 assert.equal(evaluateGradeRequirement('Middle','declared_or_verified',{verifiedGrade:'Senior',assumedGrade:'Junior'}).source,'verified');
 assert.equal(evaluateSkillRequirement({skill:'Python',mode:'verified',level:'Middle'},{...candidate,assumedGrade:'Senior'}).covered,false);
 const revoked={...candidate,verifiedGrade:'Middle' as const,verifiedSkills:['Python'],latestAssessmentAt:new Date('2026-10-09T00:00:00Z'),assessmentEvidence:{state:'revoked',candidateId:11,grade:'Middle',programId:'backend-python',programVersion:'signal-backend-python-v6',attemptId:51,score:90,comparisonPolicy:'same-program-version-rubric-v1',rubricKey:'fixture',submittedAt:'2026-10-09T00:00:00Z'} as MatchCandidate['assessmentEvidence']};
 assert.equal(evaluateSkillRequirement({skill:'Python'},revoked).covered,false);
 assert.equal(evaluateSkillRequirement({skill:'Python',mode:'declared_or_verified'},revoked).source,'declared');
 assert.equal(evaluateGradeRequirement('Middle','verified',revoked).satisfied,false);
 assert.equal(evaluateGradeRequirement('Middle','declared_or_verified',revoked).source,'declared');
});
test('strict validation rejects unknown modes, duplicates, conflict and unsupported level',()=>{
 for(const value of [[{skill:'Python',mode:'optional'}],[{skill:'Python',mode:'declared_or_verified',level:'Middle'}],[{skill:'Docker',mode:'verified',level:'Middle'}],[{skill:'Python'},{skill:'py'}],[]]) {
  assert.equal(validateRecruitingRequirements(value[0]?.skill==='Docker'?['Docker']:['Python'],value,undefined).success,false);
 }
 assert.equal(validateRecruitingRequirements(['Python'],[{skill:'Python',mode:'declared_or_verified'}],{Python:'Middle'}).success,false);
 assert.equal(validateRecruitingRequirements(['Python'],[{skill:'Python',mode:'verified',level:'Middle'}],{Python:'Junior'}).success,false);
});
test('new complete list is authoritative; unrelated edits preserve legacy levels and declared modes',()=>{
 const prior=[{skill:'Python',mode:'verified' as const,level:'Middle' as const},{skill:'Docker',mode:'declared_or_verified' as const}];
 const kept=validateRecruitingRequirements(['Python','Docker'],undefined,undefined,prior,{[canonicalSkillKey('Python')]:'Middle'});
 assert.ok(kept.success);if(!kept.success)return;assert.deepEqual(kept.data,prior);
 const replaced=validateRecruitingRequirements(['Python'],[{skill:'Python',mode:'declared_or_verified'}],undefined,prior,{[canonicalSkillKey('Python')]:'Middle'});
 assert.ok(replaced.success);if(replaced.success){assert.deepEqual(replaced.levels,{});assert.equal(replaced.data[0].mode,'declared_or_verified');}
 const legacy=validateRecruitingRequirements(['SQL'],undefined,undefined,[],{[canonicalSkillKey('SQL')]:'Senior',[canonicalSkillKey('Python')]:'Middle'});
 assert.ok(legacy.success);if(legacy.success)assert.equal(legacy.data[0].level,'Senior');
});
test('interpreter and evaluation leave historical input snapshots untouched',()=>{
 const source={...need,requiredSkillLevels:{[canonicalSkillKey('Python')]:'Middle'}};
 const before=structuredClone(source), person=structuredClone(candidate);
 interpretSkillRequirements(source.requiredSkills,undefined,source.requiredSkillLevels);evaluateMatch(source,candidate,false);
 assert.deepEqual(source,before);assert.deepEqual(candidate,person);
});
test('shortlist bookmarking remains permitted but review reflects mismatch and context revision',()=>{
 const fail=evaluateMatch(need,candidate,false),pass=evaluateMatch(declared,candidate,false);
 const review=shortlistReview(4,4,fail);assert.equal(review.needsReview,true);assert.equal(review.match!.eligible,false);assert.deepEqual(review.match!.ineligibilityReasons,['grade','required_skills']);
 assert.equal(shortlistReview(4,4,pass).needsReview,false);assert.equal(shortlistReview(3,4,pass).needsReview,true);assert.equal(shortlistReview(4,4,null).needsReview,true);
});
test('selection context and export preserve mode semantics without changing application policy',()=>{
 const context={...declared,type:'job' as const,id:1,version:2,title:'Role',requiredSkills:[...declared.requiredSkills],skillRequirements:[...declared.skillRequirements!],requiredSkillLevels:{},desirableSkills:[],description:'Role',salaryPeriod:'month' as const,salaryType:'gross' as const,status:'published',updatedAt:'2026-10-09'};
 assert.equal(evaluateMatch(selectionMatchNeed(context),candidate,false).eligible,true);
 const cells=jobExportCells({id:1,companyName:'Company',title:'Role',specialization:need.specialization,grade:'Middle',gradeMode:'declared_or_verified',skills:['Docker'],skillRequirements:[{skill:'Docker',mode:'declared_or_verified'}],salaryMin:1,salaryMax:2,salaryPeriod:'month',salaryType:'gross',workFormat:'Удалённо',publishedAt:null},'http://localhost');
 assert.match(cells[3],/достаточно заявленного/);assert.match(cells[4],/Docker — достаточно заявленного/);
});
