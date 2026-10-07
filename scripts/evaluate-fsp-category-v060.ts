/** Versioned policy/quality receipt; never rewrites historical controls or labels. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {runIntergroupControl} from './evaluate-intergroup-control';
import {competitiveCandidates,competitiveDataset} from '../artifacts/api-server/src/lib/matching-competitive-fixtures';
import {competitiveMetrics,runCompetitiveMatchingQuality} from '../artifacts/api-server/src/lib/matching-competitive-quality';
import * as v5 from '../outputs/quality/0.6.0/fsp-category/history/signal-matching';
import {MATCH_ALGORITHM_VERSION} from '../artifacts/api-server/src/lib/signal-matching';
const directory='outputs/quality/0.6.0/fsp-category';
const hash=(bytes:string|Buffer)=>createHash('sha256').update(bytes).digest('hex');
const beforeBytes=await readFile(`${directory}/before-policy.json`),before=JSON.parse(beforeBytes.toString());
const after=runIntergroupControl();
const comparisons=after.byQuery.map(query=>{
  const old=before.intergroupReport.byQuery.find((row:any)=>row.queryId===query.queryId);
  assert.ok(old,'Previously frozen query must exist');
  assert.deepEqual(query.expectedEligibleIds,old.expectedEligibleIds);
  return {queryId:query.queryId,split:query.split,beforeOrder:old.methods.signal.runtimeRanking,afterOrder:query.methods.signal.runtimeRanking,before:old.methods.signal.endToEnd,after:query.methods.signal.endToEnd,
    ndcgDelta:query.methods.signal.endToEnd.ndcgAt5===null||old.methods.signal.endToEnd.ndcgAt5===null?null:query.methods.signal.endToEnd.ndcgAt5-old.methods.signal.endToEnd.ndcgAt5};
});
const competitive=runCompetitiveMatchingQuality(),dataset=competitiveDataset(),candidates=competitiveCandidates(dataset),at=new Date(dataset.evaluatedAt);
const competitiveComparisons=dataset.queries.map(query=>{
  const old=v5.rankMatches(candidates.filter(c=>query.populationIds.includes(c.userId)).map(candidate=>({candidate,evaluation:v5.evaluateMatch(query.need,candidate,true,at)})).filter(row=>row.evaluation.eligible));
  const current=competitive.byQuery.find(row=>row.queryId===query.id)!;
  const metrics=competitiveMetrics(old.map(row=>row.candidate.userId),query.relevanceLabels,query.expectedEligibleIds);
  assert.deepEqual([...old.map(row=>row.candidate.userId)].sort((a,b)=>a-b),[...current.methods.signal.runtimeRanking].sort((a,b)=>a-b),'Unchanged admitted population');
  return {queryId:query.id,split:query.split,beforeOrder:old.map(row=>row.candidate.userId),afterOrder:current.methods.signal.runtimeRanking,before:metrics,after:current.methods.signal.endToEnd,
    ndcgDelta:metrics.ndcgAt5===null||current.methods.signal.endToEnd.ndcgAt5===null?null:current.methods.signal.endToEnd.ndcgAt5-metrics.ndcgAt5};
});
const sourcePaths=['artifacts/api-server/src/lib/signal-matching.ts','artifacts/api-server/src/lib/fsp-results.ts','artifacts/api-server/src/lib/fsp-provider.ts','artifacts/api-server/src/lib/signal-resume-matching.ts','artifacts/api-server/src/lib/signal-resume-catalog.ts','artifacts/api-server/src/lib/signal-catalog-computation.ts','tests/fixtures/fsp-category-v060.json'];
const sourceHashes=Object.fromEntries(await Promise.all(sourcePaths.map(async path=>[path,hash(await readFile(path))])));
const receipt={schemaVersion:1,applicationVersion:'0.6.0',status:'MEASURED_POLICY_DELTA',measuredAt:new Date().toISOString(),algorithmVersion:MATCH_ALGORITHM_VERSION,sourceHashes,beforeReceiptSha256:hash(beforeBytes),
  oldPolicyPreserved:true,fixtureLabelsChanged:false,admissionChanged:false,
  intergroup:{beforeSummary:before.intergroupReport.summary.methods.signal,afterSummary:after.summary.methods.signal,comparisons,losses:comparisons.filter(row=>row.ndcgDelta!==null&&row.ndcgDelta<0),fullAfter:after},
  competitive:{comparisons:competitiveComparisons,losses:competitiveComparisons.filter(row=>row.ndcgDelta!==null&&row.ndcgDelta<0),fullAfter:competitive},
  limitations:['Synthetic immutable independent business labels; no human ranking or grade validation.','A neutral category-block policy intentionally changes the old queue merge; every loss, null denominator and admitted population is retained.','Legacy boolean sporting history is no longer trusted provider evidence; frozen historical fixtures are not relabelled or upgraded into registry data.','No load/SLA/runtime association is measured by this pure evaluator.','The 1/2/3 MAX coefficients are Signal policy, not an organizer-supplied formula.']};
await mkdir(directory,{recursive:true});
const reportPath=`${directory}/policy-quality-${hash(JSON.stringify(sourceHashes)).slice(0,12)}.json`;
await writeFile(reportPath,JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({status:receipt.status,path:reportPath,intergroupBefore:before.intergroupReport.summary.methods.signal.ndcgAt5.value,intergroupAfter:after.summary.methods.signal.ndcgAt5.value,intergroupLosses:receipt.intergroup.losses.length,competitiveLosses:receipt.competitive.losses.length,labelsChanged:false}));
