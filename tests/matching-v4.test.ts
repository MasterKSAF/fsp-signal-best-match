import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateMatch, rankMatches, compareRankedMatches, type MatchCandidate, type AssessmentRankingEvidence } from '../artifacts/api-server/src/lib/signal-matching';
import { MATCH_CONTROL_CANDIDATES, MATCH_CONTROL_QUERIES, MATCH_CONTROL_AT } from '../artifacts/api-server/src/lib/matching-control-fixtures';
import {trustedFspResults} from '../artifacts/api-server/src/lib/fsp-results';
const need = MATCH_CONTROL_QUERIES[0].need;
function person(id: number, score: number, fields: Partial<MatchCandidate> = {}): MatchCandidate {
  const candidate = { ...MATCH_CONTROL_CANDIDATES[0], userId:id, alias:`Person ${id}`, verifiedGrade:'Middle' as const, latestAssessmentAt: MATCH_CONTROL_AT, ...fields };
  const assessmentEvidence: AssessmentRankingEvidence = {attemptId:id+100,candidateId:id,programId:'backend-python',programVersion:'signal-backend-python-v6',grade:candidate.verifiedGrade!,score,submittedAt:candidate.latestAssessmentAt!.toISOString(),state:'verified',comparisonPolicy:'same-program-version-rubric-v1',rubricKey:'synthetic-independent-rubric'};
  return {...candidate,assessmentEvidence};
}
const rank = (candidates: MatchCandidate[]) => rankMatches(candidates.map(candidate=>({candidate,evaluation:evaluateMatch(need,candidate,true,MATCH_CONTROL_AT)})));
test('100 beats 83 from comparable successful attempts despite alias and profile score',()=>{
  const weak=person(1,83,{alias:'A',verifiedScore:100}),strong=person(2,100,{alias:'Z',verifiedScore:83});
  const rows=rank([weak,strong]); assert.equal(rows[0].candidate.userId,2);
  assert.equal(rows[0].evaluation.ranking.qualityScore,100);
  assert.equal(rows[0].evaluation.ranking.attemptId,102);
  assert.equal(rows[0].evaluation.rankingScore,rows[1].evaluation.rankingScore);
  assert.ok(rows[0].evaluation.ranking.position!<rows[1].evaluation.ranking.position!);
});
test('close scores retain their effect beneath rounded presentation and ties use shared alias/id order',()=>{
  const weak=person(1,84,{alias:'A'}),strong=person(2,85,{alias:'Z'});
  const rows=rank([weak,strong]); assert.equal(rows[0].candidate.userId,2);
  assert.equal(rows[0].evaluation.baseScore,rows[1].evaluation.baseScore);
  assert.deepEqual(rank([person(9,84,{alias:'A'}),person(3,84,{alias:'A'}),person(1,84,{alias:'Z'})]).map(x=>x.candidate.userId),[3,9,1]);
});
test('unknown quality is distinct from zero; wrong linkage, grade/date/program cannot supply it',()=>{
  const source=person(1,100);
  for(const field of [{candidateId:2},{grade:'Senior'},{submittedAt:'2025-01-01T00:00:00Z'},{programId:'frontend-typescript'}]){
    const result=evaluateMatch(need,{...source,assessmentEvidence:{...source.assessmentEvidence!,...field} as AssessmentRankingEvidence},true,MATCH_CONTROL_AT);
    assert.equal(result.ranking.qualityStatus,'not_measured'); assert.equal(result.ranking.qualityScore,null);
    assert.equal(result.factors[1].score,null); assert.equal(result.factors[1].effectiveWeight,0);
  }
});
test('high result never overrides gate or revoked attempt; FSP is separate bounded factor',()=>{
  const source=person(1,100);
  for(const fields of [{verifiedSkills:[]},{visibility:'private'},{consentMatching:false},{demoMode:false},{specialization:'Frontend / TypeScript'},{verifiedGrade:'Junior'}]) assert.equal(evaluateMatch(need,{...source,...fields} as MatchCandidate,true).eligible,false);
  assert.equal(evaluateMatch(need,{...source,assessmentEvidence:{...source.assessmentEvidence!,state:'revoked'}},true).eligible,false);
  const first=evaluateMatch(need,source,true,MATCH_CONTROL_AT), second=evaluateMatch(need,{...source,hasFspHistory:!source.hasFspHistory},true,MATCH_CONTROL_AT);
  assert.equal(first.baseScore,second.baseScore); assert.equal(first.rankingScore,second.rankingScore);assert.equal(second.fspBonus,0,'Legacy history flag is not a trusted result');
  const trusted=evaluateMatch(need,{...source,fspSignal:trustedFspResults([{id:'example',title:'Synthetic win',event:'Пример: event',occurredAt:'2026-09-25',kind:'placement',result:'win'}])},true,MATCH_CONTROL_AT);
  assert.equal(trusted.fspBonus,3);assert.equal(trusted.rankingScore,first.rankingScore);
});
test('mixed grades, versions, legacy groups yield one transitive, permutation-stable order',()=>{
  const people=[person(1,83),person(2,100),person(3,100,{verifiedGrade:'Senior'}),{...person(4,100),assessmentEvidence:null},person(5,83),person(6,100)];
  people[4].assessmentEvidence={...people[4].assessmentEvidence!,programVersion:'signal-backend-python-v5'};
  people[5].assessmentEvidence={...people[5].assessmentEvidence!,rubricKey:'different-structural-rubric'};
  const rows=rank(people),ordered=rows.map(x=>x.candidate.userId);
  for(let shift=0;shift<people.length;shift++)assert.deepEqual(rank([...people.slice(shift),...people.slice(0,shift)].reverse()).map(x=>x.candidate.userId),ordered);
  for(const a of rows)for(const b of rows)for(const c of rows)if(compareRankedMatches(a,b)<=0&&compareRankedMatches(b,c)<=0)assert.ok(compareRankedMatches(a,c)<=0);
  assert.equal(rows.find(x=>x.candidate.userId===3)!.evaluation.rankingScore,rows.find(x=>x.candidate.userId===2)!.evaluation.rankingScore);
});
test('pool comparator refuses unprepared or unrelated scopes instead of pairwise group rules',()=>{
  const first=rank([person(1,83),person(2,100)]),second=rank([person(1,83),person(2,100)]);
  assert.throws(()=>compareRankedMatches(first[0],second[0]),/complete pool/);
  const raw={candidate:person(1,100),evaluation:evaluateMatch(need,person(1,100),true,MATCH_CONTROL_AT)};
  assert.throws(()=>compareRankedMatches(raw,raw),/complete pool/);
});
test('mathematically perfect known and unknown salary shared fits do not differ by floating ulps',()=>{
  const requirement={...need,salaryPeriod:'month' as const,salaryType:'gross' as const};
  const known=person(1,83,{verifiedSkills:[...requirement.requiredSkills,...requirement.desirableSkills],workFormat:requirement.workFormat,salaryMin:requirement.salaryMin,salaryMax:requirement.salaryMax,salaryPeriod:'month',salaryType:'gross'});
  const unknown={...known,userId:2,assessmentEvidence:null,salaryType:undefined};
  const a=evaluateMatch(requirement,known,true,MATCH_CONTROL_AT),b=evaluateMatch(requirement,unknown,true,MATCH_CONTROL_AT);
  assert.equal(a.rankingScore,b.rankingScore);
  assert.equal(a.factors.find(f=>f.name==='Совместимость зарплатных условий')!.score,1);
  assert.equal(b.factors.find(f=>f.name==='Совместимость зарплатных условий')!.score,null);
});
test('grade-only regrouping of unknown quality cannot create a hidden exact-date priority',()=>{
  const baseline=[{...person(1,83,{alias:'A',latestAssessmentAt:new Date(MATCH_CONTROL_AT.getTime()-7*86400000)}),assessmentEvidence:null},
    {...person(2,100,{alias:'B',verifiedGrade:'Senior',latestAssessmentAt:MATCH_CONTROL_AT}),assessmentEvidence:null},
    {...person(3,83,{alias:'C',verifiedGrade:'Senior',latestAssessmentAt:new Date(MATCH_CONTROL_AT.getTime()-14*86400000)}),assessmentEvidence:null}];
  const before=rank(baseline).map(row=>row.candidate.userId);
  const promoted=baseline.map(candidate=>candidate.userId===1?{...candidate,verifiedGrade:'Senior' as const}:candidate);
  assert.deepEqual(before,[1,2,3]);assert.deepEqual(rank(promoted).map(row=>row.candidate.userId),before);
});
