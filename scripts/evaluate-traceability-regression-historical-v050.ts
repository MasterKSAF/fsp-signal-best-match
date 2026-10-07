/** Replay old assertions against the exact sealed v5 matcher; no historical outputs are written. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { evaluateMatch, rankMatches, MATCH_ALGORITHM_VERSION, type MatchCandidate, type MatchNeed } from '../outputs/quality/0.6.0/fsp-category/history/signal-matching';
import { evaluateMatch as beforeEvaluate, rankMatches as beforeRank } from '../outputs/verification/history/qa-cycle-01-before-traceability/artifacts/api-server/src/lib/signal-matching';
import { competitiveDataset, competitiveCandidates, COMPETITIVE_FROZEN_SHA256 } from '../artifacts/api-server/src/lib/matching-competitive-fixtures';

export const TRACEABILITY_SHA256='5bcf243f34c7f2be835d2759bdc20f67f63682724a14905487a3ad058824ccab';
export const QUALITY_BOUNDARY_SHA256='d15d6d52aa0081f034c11b058ec331a7a1a4b314f1c9aa3eb5ae3d2a9f74be77';
const BEFORE_SHA256='054a9d7879cf622634cb4d6bc2d089f200268550547914ef954b23d883a2df1f';
const sha=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex');
const sourceSha=(path:string)=>sha(readFileSync(new URL(path,import.meta.url)));
function frozen(path:string,expected:string){const raw=readFileSync(new URL(path,import.meta.url));if(sha(raw)!==expected)throw new Error(`Frozen regression changed: ${path}`);return JSON.parse(raw.toString('utf8'));}
function wireCandidates(rows:any[]):MatchCandidate[]{return rows.map(({profile,assessment})=>({...profile,latestAssessmentAt:profile.latestAssessmentAt?new Date(profile.latestAssessmentAt):null,assessmentEvidence:assessment??null}));}
function order(need:MatchNeed,candidates:MatchCandidate[],at:Date,prior=false){
  const evaluate=prior?beforeEvaluate:evaluateMatch;
  const entries=candidates.map(candidate=>({candidate,evaluation:evaluate(need,candidate,true,at)})).filter(entry=>entry.evaluation.eligible);
  return (prior?beforeRank(entries as any):rankMatches(entries as any)) as Array<{candidate:MatchCandidate;evaluation:any}>;
}
const ids=(rows:Array<{candidate:MatchCandidate}>)=>rows.map(row=>row.candidate.userId);
const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
export function runTraceabilityRegression(){
  const fixture=frozen('../outputs/quality/qa-cycle-01/traceability-regression-v1.json',TRACEABILITY_SHA256);
  const boundary=frozen('../outputs/quality/qa-cycle-01/traceability-quality-boundary-v1.json',QUALITY_BOUNDARY_SHA256);
  const freeze=JSON.parse(readFileSync(new URL('../outputs/quality/qa-cycle-01/traceability-regression-freeze.json',import.meta.url),'utf8'));
  const boundaryFreeze=JSON.parse(readFileSync(new URL('../outputs/quality/qa-cycle-01/traceability-quality-boundary-freeze.json',import.meta.url),'utf8'));
  if(freeze.sha256!==TRACEABILITY_SHA256||freeze.prePatchMatchingSha256!==BEFORE_SHA256)throw new Error('Main regression freeze mismatch');
  if(sourceSha('../outputs/verification/history/qa-cycle-01-before-traceability/artifacts/api-server/src/lib/signal-matching.ts')!==BEFORE_SHA256)throw new Error('Exact before matcher changed');
  const original=competitiveDataset(),candidates=competitiveCandidates(original),byId=new Map(candidates.map(candidate=>[candidate.userId,candidate]));
  if(fixture.originalDatasetSha256!==COMPETITIVE_FROZEN_SHA256)throw new Error('Original control identity changed');
  const at=new Date(fixture.evaluationClock);
  const originalCases=fixture.originalCases.map((row:any)=>{
    const query=original.queries.find(q=>q.id===row.queryId)!;
    if(!equal(query.relevanceLabels,row.relevanceLabels)||!equal(query.labelReasons,row.labelReasons)||!equal(query.populationIds,row.populationIds)||!equal(query.need,row.need))throw new Error('Original need/pool/labels changed');
    const population=query.populationIds.map(id=>byId.get(id)!);
    const prior=order(query.need,population,at,true),current=order(query.need,population,at);
    const before=ids(prior),after=ids(current);
    const pairs=row.betterIds.flatMap((betterId:number)=>row.lowerTraceabilityIds.map((lowerId:number)=>({betterId,lowerId,betterRelevance:query.relevanceLabels[String(betterId)],lowerRelevance:query.relevanceLabels[String(lowerId)],
      before:{betterPosition:before.indexOf(betterId)+1,lowerPosition:before.indexOf(lowerId)+1,passed:before.indexOf(betterId)<before.indexOf(lowerId)},
      after:{betterPosition:after.indexOf(betterId)+1,lowerPosition:after.indexOf(lowerId)+1,passed:after.includes(betterId)&&after.includes(lowerId)&&after.indexOf(betterId)<after.indexOf(lowerId)}})));
    const unknown=current.filter(entry=>row.lowerTraceabilityIds.includes(entry.candidate.userId)).map(entry=>({candidateId:entry.candidate.userId,qualityScore:entry.evaluation.ranking.qualityScore,qualityStatus:entry.evaluation.ranking.qualityStatus,eligible:entry.evaluation.eligible}));
    return {queryId:row.queryId,originalLabelsAndPoolPreserved:true,beforeRanking:before,afterRanking:after,pairs,unknown};
  });
  const newCases=[...fixture.newBusinessCases,...boundary.newBusinessCases].map((row:any)=>{
    const candidates=wireCandidates(row.candidates),prior=order(row.need,candidates,at,true),current=order(row.need,candidates,at);
    const after=ids(current),before=ids(prior),expected=row.expectedBefore;
    const reversed=candidates.map((candidate,i)=>({...candidate,alias:i%2===0?'Z reversed tie alias':'A reversed tie alias'}));
    const aliasReversal=ids(order(row.need,reversed,at));
    return {caseId:row.id,expected,before,after,beforePassed:equal(before,expected),afterPassed:equal(after,expected),aliasReversalPassed:equal(aliasReversal,expected),
      allRemainAdmitted:current.length===candidates.length,states:current.map(entry=>({candidateId:entry.candidate.userId,position:entry.evaluation.ranking.position,baseScore:entry.evaluation.baseScore,rankingScore:entry.evaluation.rankingScore,fspBonus:entry.evaluation.fspBonus,qualityScore:entry.evaluation.ranking.qualityScore,qualityStatus:entry.evaluation.ranking.qualityStatus}))};
  });
  const checks={originalFixedIdsImprove:originalCases.every((row:any)=>row.pairs.every((p:any)=>p.after.passed)),originalInputsAndLabelsUntouched:originalCases.every((row:any)=>row.originalLabelsAndPoolPreserved),
    originalUnknownRemainsNullAndAdmitted:originalCases.every((row:any)=>row.unknown.every((state:any)=>state.qualityScore===null&&state.qualityStatus==='not_measured'&&state.eligible)),
    genericBusinessCasesPass:newCases.every((row:any)=>row.afterPassed&&row.allRemainAdmitted),aliasReversalInvariant:newCases.every((row:any)=>row.aliasReversalPassed),
    detectsBeforeDefect:originalCases.some((row:any)=>row.pairs.some((p:any)=>!p.before.passed))&&newCases.some((row:any)=>!row.beforePassed)};
  return {evaluatorVersion:'signal-traceability-regression-historical-v050',historical:true,datasetVersion:fixture.version,datasetSha256:TRACEABILITY_SHA256,boundaryDatasetVersion:boundary.version,boundaryDatasetSha256:QUALITY_BOUNDARY_SHA256,freeze,boundaryFreeze,
    boundaryTimingCorrection:{status:'authored-semantic-regression-after-patch-before-first-boundary-measurement',observedSourceSha256AtFreeze:boundaryFreeze.prePatchMatchingSha256,
      reason:'Parallel implementation had already changed the matcher when the additional100-vs83/FSP boundary file was frozen. Its earlier prose saying beforeimplementation is superseded by this exact timing disclosure; it is not an independent prepatch control. The main six-case freeze remains prepatch and unchanged.'},
    algorithmVersion:MATCH_ALGORITHM_VERSION,algorithmSha256:sourceSha('../outputs/quality/0.6.0/fsp-category/history/signal-matching.ts'),beforeAlgorithmSha256:BEFORE_SHA256,evaluatorSha256:sourceSha('./evaluate-traceability-regression.ts'),measurementAt:new Date().toISOString(),evaluationClock:fixture.evaluationClock,
    originalDatasetSha256:COMPETITIVE_FROZEN_SHA256,controlUsage:'consumed-original-control regression + frozen semantic counterexamples; not a fresh blind metric benchmark',checks,originalCases,newCases,
    humanValidation:{status:'not_measured',participants:0,expertReviewers:0},workingEnvironment:{localhost4310:'untouched',database:'not_used',docker:'not_used'},
    limitations:[...fixture.policyLimitations,'Before executes an exact preserved pretraceability source054a9d with its preserved catalog dependency. After replays the exact sealed 0.5 matcher snapshot; this historical expectation is not current 0.6 acceptance.',
      'The additional FSP/100-vs83 boundary was frozen after the matcher patch, before its first measurement; it is a semantic regression test, not an independent untouched control.']};
}
