import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {evaluateMatch,rankMatches,type MatchCandidate,type MatchNeed} from '../artifacts/api-server/src/lib/signal-matching';
import {trustedFspResults} from '../artifacts/api-server/src/lib/fsp-results';
import {TRACEABILITY_SHA256,QUALITY_BOUNDARY_SHA256} from '../scripts/evaluate-traceability-regression-historical-v050';
function frozen(file:string,sha:string){const bytes=readFileSync(file);assert.equal(createHash('sha256').update(bytes).digest('hex'),sha);return JSON.parse(bytes.toString());}
const fixture=frozen('outputs/quality/qa-cycle-01/traceability-regression-v1.json',TRACEABILITY_SHA256),boundary=frozen('outputs/quality/qa-cycle-01/traceability-quality-boundary-v1.json',QUALITY_BOUNDARY_SHA256);
const cases=[...fixture.newBusinessCases,...boundary.newBusinessCases],at=new Date(fixture.evaluationClock);
function candidates(row:any):MatchCandidate[]{return row.candidates.map(({profile,assessment}:any)=>({...profile,latestAssessmentAt:new Date(profile.latestAssessmentAt),assessmentEvidence:assessment}));}
const ranked=(need:MatchNeed,rows:MatchCandidate[])=>rankMatches(rows.map(candidate=>({candidate,evaluation:evaluateMatch(need,candidate,true,at)})).filter(row=>row.evaluation.eligible));
const ids=(rows:ReturnType<typeof ranked>)=>rows.map(row=>row.candidate.userId);
const win=trustedFspResults([{id:'explicit-test-win',title:'Synthetic win',event:'Synthetic fixture',occurredAt:'2026-10-06',kind:'placement',result:'win'}]);

test('v6 original business-fit and complete-provenance boundaries stay primary even with maximum structured sporting evidence',()=>{
  for(const [caseId,expected]of [['business-fit-before-traceability-fsp',[880001,880002]],['equal-fit-full-proof-before-legacy-fsp',[880010,880011]]] as const){
    const row=cases.find((row:any)=>row.id===caseId)!;const original=candidates(row),withResults=original.map(c=>c.hasFspHistory?{...c,fspSignal:win}:c);
    for(const population of [original,withResults,withResults.map((c,index)=>({...c,alias:index%2?'A reverse alias':'Z reverse alias'}))]){const result=ranked(row.need,population);assert.deepEqual(ids(result),expected);assert.equal(result.length,population.length);assert.ok(result.some(entry=>entry.evaluation.ranking.qualityScore===null));assert.ok(result.every(entry=>entry.evaluation.rankingScore===entry.evaluation.ranking.businessFitScore&&entry.evaluation.rankingScore<=100));}
  }
});
test('v6 retained legacy boolean has zero effect; explicit trusted win is positive at an equal comparable result and cannot overcome100-vs83',()=>{
  const equal=cases.find((row:any)=>row.id==='fsp-positive-at-equal-fit-complete-proof-result')!,original=candidates(equal);
  const legacy=ranked(equal.need,original);assert.deepEqual(ids(legacy),[880021,880020]);assert.ok(legacy.every(row=>row.evaluation.fspBonus===0));
  const explicit=ranked(equal.need,original.map(c=>c.hasFspHistory?{...c,fspSignal:win}:c));assert.deepEqual(ids(explicit),[880020,880021]);assert.equal(explicit[0]!.evaluation.fspBonus,3);
  assert.equal(explicit[0]!.evaluation.baseScore,legacy.find(row=>row.candidate.userId===880020)!.evaluation.baseScore);
  const gap=cases.find((row:any)=>row.id==='comparable100-before83-with-fsp')!;
  assert.deepEqual(ids(ranked(gap.need,candidates(gap).map(c=>c.hasFspHistory?{...c,fspSignal:win}:c))),[880031,880030]);
});
