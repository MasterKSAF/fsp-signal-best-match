import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateMatch, rankMatches, type MatchNeed, type SignalGrade } from '../artifacts/api-server/src/lib/signal-matching';
import type { CatalogResume } from '../artifacts/api-server/src/lib/signal-resume-catalog';
import { compareResumeFacts } from '../artifacts/api-server/src/lib/signal-resume-comparison';

const at=new Date('2026-10-07T12:00:00Z');
const need: MatchNeed={specialization:'Backend / Python',grade:'Junior',requiredSkills:['Python'],desirableSkills:[],workFormat:'Удалённо',salaryMin:100000,salaryMax:200000,salaryPeriod:'month',salaryType:'gross'};
function person(id:number,grade:SignalGrade='Middle',full=true):CatalogResume {
  return {userId:id,resumeId:id*10,resumeRevision:1,title:'Independent synthetic',alias:`Candidate ${String((id*17)%101).padStart(3,'0')}`,specialization:need.specialization,verifiedGrade:grade,verifiedScore:83,verifiedSkills:['Python'],stack:[],statedSkills:[],yearsExperience:1,workFormat:need.workFormat,salaryMin:110000,salaryMax:180000,salaryPeriod:'month',salaryType:'gross',latestAssessmentAt:at,hasFspHistory:false,visibility:'pseudonymous',consentMatching:true,consentCatalog:true,readyForOffers:false,demoMode:true,avatarDataUrl:null,publicName:null,deletedAt:null,legacyQualification:null,assessmentEvidence:full?{attemptId:id+10000,candidateId:id,programId:'backend-python',programVersion:'signal-backend-python-v6',grade,score:83,submittedAt:at.toISOString(),state:'verified',comparisonPolicy:'same-program-version-rubric-v1',rubricKey:'independent'}:null};
}
function compare(a:CatalogResume,b:CatalogResume) {
  const entries=[a,b].map(candidate=>({candidate,evaluation:evaluateMatch(need,candidate,true,at)}));
  const pool=rankMatches(entries.filter(x=>x.evaluation.eligible));
  const before=pool.map(x=>({id:x.candidate.resumeId,ranking:JSON.stringify(x.evaluation.ranking)}));
  const result=compareResumeFacts(need,entries[0],entries[1],pool);
  assert.deepEqual(pool.map(x=>({id:x.candidate.resumeId,ranking:JSON.stringify(x.evaluation.ranking)})),before,'Explanation cannot mutate order or scores');
  return {result,entries};
}
test('independent 801 Middle / 802 Senior counterexample has no fictional full exam',()=>{
  const {result,entries}=compare(person(801,'Middle',false),person(802,'Senior',false));
  assert.ok(entries.every(x=>x.evaluation.eligible&&x.evaluation.ranking.qualityStatus==='not_measured'));
  assert.match(result.orderContext.note,/Полных действующих протоколов для этой пары нет/);
  assert.doesNotMatch(result.orderContext.note,/при полном действующем экзамене|оба резюме имеют полные/i);
  assert.equal(result.comparable,false);
});
test('complete comparable, different grades, versions and rubric have factual explanations',()=>{
  assert.equal(compare(person(1),person(2)).result.comparable,true);
  const otherGrade=compare(person(1),person(2,'Senior')).result;
  assert.match(otherGrade.orderContext.note,/оба резюме имеют полные/);
  const version=person(2);version.assessmentEvidence!.programVersion='signal-backend-python-v5';
  assert.equal(compare(person(1),version).result.comparable,false);
  assert.match(compare(person(1),version).result.limitations.join(' '),/Оба протокола полные/);
  const rubric=person(2);rubric.assessmentEvidence!.rubricKey='different';
  assert.equal(compare(person(1),rubric).result.comparable,false);
  const otherProgram=person(2);otherProgram.specialization='Frontend / TypeScript';otherProgram.assessmentEvidence!.programId='frontend-typescript';otherProgram.assessmentEvidence!.programVersion='signal-frontend-typescript-v2';
  assert.equal(compare(person(1),otherProgram).result.comparable,false);
});
test('one missing, revoked and inapplicable proofs never promise comparable full protocols',()=>{
  const missing=compare(person(1),person(2,'Senior',false)).result;
  assert.match(missing.orderContext.note,/приоритет получает первое резюме/i);
  assert.match(missing.limitations.join(' '),/для второго резюме нет полного/);
  const revoked=person(2);revoked.assessmentEvidence!.state='revoked';
  const checked=compare(person(1),revoked);
  assert.equal(checked.entries[1].evaluation.eligible,false);
  assert.match(checked.result.limitations.join(' '),/результат отозван/);
  const mismatched=person(2);mismatched.assessmentEvidence!.candidateId=9999;
  assert.match(compare(person(1),mismatched).result.limitations.join(' '),/для второго резюме нет полного/);
});
test('unequal need-fit does not describe a tie or invent a full missing proof',()=>{
  const worse=person(2,'Senior',false);worse.workFormat='Офис';
  const result=compare(person(1,'Middle',false),worse).result;
  assert.doesNotMatch(result.orderContext.note,/При равном соответствии|оба резюме имеют полные/i);
  assert.match(result.differences.map(x=>x.text).join(' '),/формату работы/);
});
