import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSkillAttempt, scoreSkillAttempt, skillModuleRegistry, skillModuleTemplates, skillScenarioFixture, skillBaseScenarioFixture, changedConditionTraining, SKILL_BANK_VERSION } from '../artifacts/api-server/src/lib/skill-module-bank';
import { getSkillQualification, selectAccountSkillEvidence, skillRequirementCovered, type SkillModuleEvidence, type SkillQualificationTarget } from '../artifacts/api-server/src/lib/skill-module-qualification';
import { evaluateMatch, type MatchCandidate } from '../artifacts/api-server/src/lib/signal-matching';
import { skillIssueRestriction } from '../artifacts/api-server/src/lib/skill-module-policy';
test('issuance and submitted retry have precise sliding boundaries across levels and resumes',()=>{
 const now=new Date('2026-10-08T12:00:00Z');
 const row=(skillId='python',level='Junior',status='expired',at=+now-1000,submittedAt:Date|null=null)=>({skillId,level,status,startedAt:new Date(at),submittedAt});
 assert.equal(skillIssueRestriction([row(),row('python','Middle')],'python','Junior',now)?.code,'module_issue_limit');
 assert.equal(skillIssueRestriction([row('python','Junior','expired',+now-24*3600_000),row('python','Middle')],'python','Junior',now),null);
 assert.equal(skillIssueRestriction([row('python','Junior','submitted',+now-25*3600_000,new Date(+now-24*3600_000))],'python','Junior',now),null);
 assert.equal(skillIssueRestriction([row('python','Junior','submitted',+now-25*3600_000,new Date(+now-24*3600_000+1))],'python','Junior',now)?.retryAt,new Date(+now+1).toISOString());
 assert.equal(skillIssueRestriction([row('python','Junior','submitted',+now-2000,new Date(+now-1000))],'sql','Middle',now),null);
 assert.equal(skillIssueRestriction(Array.from({length:8},(_,i)=>row(`s${i}`)),'react','Junior',now)?.code,'account_issue_limit');
});
test('six independent module programmes; unsupported level has no fallback', () => {
  assert.equal(skillModuleTemplates.length, 324);
  for (const module of skillModuleRegistry) for (const level of module.availableLevels) {
    const form = buildSkillAttempt(module.id, level, 'coverage');
    assert.equal(form.cases.length, 6); assert.equal(new Set(form.cases.map(c => c.competencyId)).size, 6);
    assert.equal(form.cases.filter(c => c.critical).length, level === 'Senior' ? module.seniorCriticalCompetencies.length : 2);
    for (const c of form.cases) assert.ok(c.options ? c.options.some(o => o.id === form.oracles[c.id]!.expected) : form.oracles[c.id]!.expected.length);
  }
  assert.equal(buildSkillAttempt('react', 'Senior', 'supported-senior').cases.every(c => c.templateId.includes(':Senior:')), true);
  assert.throws(() => buildSkillAttempt('react', 'Staff' as never, 'unsupported'));
  assert.throws(() => buildSkillAttempt('PostgreSQL', 'Junior', 'not-sql'));
});
test('independent handwritten boundary fixtures change substantive answers', () => {
  const fixtures: [string, 'Junior' | 'Middle', number, number, number, boolean, string][] = [
    ['python','Junior',0,0,5,true,'2|5'], ['python','Middle',0,0,5,false,'3|7'],
    ['python','Junior',1,0,5,true,'10'], ['python','Middle',1,0,5,false,'4'],
    ['python','Middle',3,0,5,true,'10'], ['python','Middle',3,0,5,false,'5'],
    ['python','Junior',5,0,5,false,'7|3|invalid'], ['python','Middle',5,0,5,false,'7|invalid|invalid'],
    ['sql','Junior',0,0,5,false,'5'], ['sql','Middle',0,0,5,false,'6'],
    ['sql','Middle',2,0,5,true,'0'], ['sql','Junior',2,0,5,true,'1'],
    ['sql','Junior',4,2,5,true,'3|4'], ['sql','Middle',4,2,5,true,'2|3'],
    ['typescript','Junior',0,1,5,true,'9|7'], ['typescript','Middle',0,1,5,true,'0|7'],
    ['typescript','Junior',3,2,5,false,'10|5'], ['typescript','Middle',3,2,5,true,'2|5'],
    ['react','Junior',0,0,5,false,'6'], ['react','Junior',0,0,5,true,'7'],
    ['react','Middle',0,0,5,false,'12'], ['react','Middle',2,0,5,true,'setup:5|cleanup:5|setup:6|cleanup:6'],
    ['react','Middle',3,1,5,true,'2'], ['react','Middle',3,1,5,false,'7'],
    ['backend-engineering','Junior',0,0,5,true,'200'], ['backend-engineering','Middle',0,0,5,true,'412'],
    ['backend-engineering','Junior',2,0,5,true,'10'], ['backend-engineering','Middle',2,0,5,false,'15'],
    ['frontend-engineering','Junior',0,0,5,true,'4'], ['frontend-engineering','Middle',0,0,5,true,'0'],
    ['frontend-engineering','Middle',2,0,5,false,'85'], ['frontend-engineering','Middle',3,0,5,false,'initial|new|new'],
  ];
  for (const [skill,level,c,s,n,flag,expected] of fixtures) assert.equal(skillBaseScenarioFixture(skill,level,c,s,n,flag).answer, expected, `${skill}/${level}/${c}/${s}`);
});
test('all-correct and one noncritical omission pass; critical failures cannot be compensated', () => {
  const form = buildSkillAttempt('python','Junior','gates'); const answers = Object.fromEntries(Object.entries(form.oracles).map(([id,o])=>[id,o.expected]));
  assert.equal(scoreSkillAttempt(form.cases,form.oracles,answers).passed,true);
  const noncritical = form.cases.find(c=>!c.critical)!; assert.equal(scoreSkillAttempt(form.cases,form.oracles,{...answers,[noncritical.id]:'wrong'}).passed,true);
  for (const c of form.cases.filter(c=>c.critical)) assert.equal(scoreSkillAttempt(form.cases,form.oracles,{...answers,[c.id]:'wrong'}).passed,false);
  assert.equal(scoreSkillAttempt(form.cases,form.oracles,{}).passed,false);
});
test('new integer rubric accepts equivalent signed/zero-padded integer, while saved v1 remains reproducible',()=>{
 const disabled=new Set(skillModuleTemplates.filter(t=>t.skillId==='react'&&t.level==='Junior'&&t.competencyId==='identity'&&t.scenarioIndex!==1).map(t=>t.id));
 const form=buildSkillAttempt('react','Junior','integer-equivalence',{disabled});
 const c=form.cases.find(c=>c.responseType==='integer')!;assert.ok(c);
 const answers=Object.fromEntries(Object.entries(form.oracles).map(([id,o])=>[id,o.expected]));
 const value=form.oracles[c.id]!.expected;assert.match(value,/^\d+$/);
 const equivalent={...answers,[c.id]:`+00${value}`};
 assert.equal(scoreSkillAttempt(form.cases,form.oracles,equivalent).competencies.find(x=>x.id===c.competencyId)?.passed,true);
 assert.equal(scoreSkillAttempt(form.cases,form.oracles,equivalent,{threshold:83,rubricVersion:'six-competencies-critical-5of6-v1'}).competencies.find(x=>x.id===c.competencyId)?.passed,false);
 for(const invalid of ['1.0','1e0','1|0','not a number'])assert.equal(scoreSkillAttempt(form.cases,form.oracles,{...answers,[c.id]:invalid}).competencies.find(x=>x.id===c.competencyId)?.passed,false);
});
test('new issuance prefers unseen content then 30-day global frequency, snapshots unchanged by disabling', () => {
  const first = buildSkillAttempt('sql','Middle','first'); const personal = new Map(first.cases.map(c=>[c.templateId,1]));
  const second = buildSkillAttempt('sql','Middle','second',{personalExposures:personal});
  assert.ok(second.cases.every(c=>!personal.has(c.templateId)));
  const global = new Map(second.cases.map(c=>[c.templateId,500]));
  const third = buildSkillAttempt('sql','Middle','third',{globalExposures:global}); assert.ok(third.cases.every(c=>!global.has(c.templateId)));
  const copy = structuredClone(first); const disabled = new Set(skillModuleTemplates.filter(t=>t.skillId==='sql'&&t.level==='Middle'&&t.competencyId==='joins').map(t=>t.id));
  assert.throws(()=>buildSkillAttempt('sql','Middle','missing',{disabled})); assert.deepEqual(first,copy);
});
const target = (stack=['Python','SQL']): SkillQualificationTarget => ({ userId:17,specialization:'Backend / Python',assumedGrade:'Middle',stack,skills:[] });
function proof(id:number,skillId:string,level:'Junior'|'Middle'='Junior',userId=17): SkillModuleEvidence {
  const form=buildSkillAttempt(skillId,level,`proof-${id}`); const decision=scoreSkillAttempt(form.cases,form.oracles,Object.fromEntries(Object.entries(form.oracles).map(([id,o])=>[id,o.expected])));
  return {id,userId,attemptId:id,skillId,level,programVersion:SKILL_BANK_VERSION,competencyIds:decision.competencies.map(c=>c.id),verifiedAt:new Date(`2026-10-08T10:00:${String(id).padStart(2,'0')}Z`),decision};
}
test('individual Python Junior, SQL Middle, React Junior coexist without granting overall category',()=>{
  const inputs={evidence:[proof(1,'python'),proof(2,'sql','Middle'),proof(3,'react')],revokedIds:new Set<number>()};
  const account=selectAccountSkillEvidence(target(),inputs); assert.deepEqual(account.map(e=>[e.skillId,e.level]),[['python','Junior'],['react','Junior'],['sql','Middle']]);
  assert.equal(getSkillQualification(target(),inputs).verifiedGrade,null);
  assert.equal(skillRequirementCovered({skill:'PostgreSQL',level:'Junior'},account),false);
  assert.equal(skillRequirementCovered({skill:'SQL',level:'Middle'},account),true);
});
test('mandatory matrix, stack alternatives, target cap, unrelated skills and revocation',()=>{
  const evidence=[proof(1,'python','Middle'),proof(2,'sql','Middle'),proof(3,'backend-engineering','Middle')]; const input={evidence,revokedIds:new Set<number>()};
  const middle=getSkillQualification(target(),input); assert.equal(middle.verifiedGrade,'Middle'); assert.equal(middle.verifiedScore,null); assert.equal(middle.category?.requirements.length,3);
  assert.equal(getSkillQualification({...target(),assumedGrade:'Junior'},input).verifiedGrade,'Junior');
  assert.equal(getSkillQualification(target(['Go','SQL']),input).verifiedGrade,null);
  assert.equal(getSkillQualification(target(['Python','SQL','Kafka']),input).verifiedGrade,'Middle');
  assert.equal(getSkillQualification({...target(),skills:['React','Unknown']},input).verifiedGrade,'Middle');
  assert.equal(getSkillQualification(target(),{evidence,revokedIds:new Set([3])}).verifiedGrade,null);
  assert.equal(getSkillQualification(target(),{evidence:[...evidence,proof(4,'backend-engineering','Middle',88)],revokedIds:new Set([3])}).verifiedGrade,null);
  const snapshot=structuredClone(middle.category); getSkillQualification(target(),{evidence,revokedIds:new Set([3])}); assert.deepEqual(middle.category,snapshot);
});
test('Frontend category requires real React and independent engineering; TypeScript is insufficient',()=>{
  const frontend={...target(['TypeScript','React']),specialization:'Frontend / TypeScript'};
  const ts=proof(1,'typescript','Middle'); assert.equal(getSkillQualification(frontend,{evidence:[ts],revokedIds:new Set()}).verifiedGrade,null);
  assert.equal(getSkillQualification(frontend,{evidence:[ts,proof(2,'react','Middle'),proof(3,'frontend-engineering','Middle')],revokedIds:new Set()}).verifiedGrade,'Middle');
});
test('training condition check is explicitly outside scoring and never changes evidence',()=>{
  const q=changedConditionTraining('python','Junior'); assert.equal(q?.qualificationImpact,false); assert.equal(q?.expected,'two'); assert.equal(changedConditionTraining('sql','Junior'),null);
});
test('matching distinguishes a skill minimum from category and accepts score-null complete category',()=>{
  const q=getSkillQualification(target(),{evidence:[proof(1,'python','Middle'),proof(2,'sql','Middle'),proof(3,'backend-engineering','Middle')],revokedIds:new Set()});
  const candidate: MatchCandidate={userId:17,alias:'A',specialization:'Backend / Python',verifiedGrade:q.verifiedGrade,verifiedScore:null,verifiedSkills:q.verifiedSkills,stack:['Python','SQL'],statedSkills:[],workFormat:'Удалённо',salaryMin:100,salaryMax:200,latestAssessmentAt:q.latestAssessmentAt,hasFspHistory:false,visibility:'public',consentMatching:true,demoMode:false,categoryEvidence:q.category,skillEvidence:q.skills.map(e=>({skill:e.label,candidateId:17,attemptId:e.attemptId,evidenceId:e.evidenceId,level:e.level,programId:`skill:${e.skillId}`,programVersion:e.programVersion,templateId:null,templateVersion:null,criterionId:null,criterion:null,result:null,date:e.verifiedAt,sourceType:'signal_skill_module',limitation:null}))};
  const need={specialization:candidate.specialization,grade:'Middle' as const,requiredSkills:['SQL'],desirableSkills:[],workFormat:'Удалённо',salaryMin:100,salaryMax:200};
  assert.equal(evaluateMatch(need,candidate,false).eligible,true);
  assert.equal(evaluateMatch({...need,requiredSkillLevels:{'skill:sql':'Senior'}},candidate,false).eligible,false);
  assert.equal(evaluateMatch(need,candidate,false).ranking.qualityScore,null);
});
