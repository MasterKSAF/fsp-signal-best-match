import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { compareRankedMatches, evaluateMatch, rankMatches, MATCH_ALGORITHM_VERSION, type MatchCandidate, type MatchEvaluation, type MatchNeed } from '../artifacts/api-server/src/lib/signal-matching';
import { compareRankedMatches as compareV4, evaluateMatch as evaluateV4 } from '../artifacts/api-server/src/lib/matching-v4-frozen';
import { evaluateMatch as evaluateV3 } from '../artifacts/api-server/src/lib/matching-v3-frozen';
import { canonicalSkillKey, SKILL_CATALOG_VERSION } from '../artifacts/api-server/src/lib/skill-catalog';
import { runTraceabilityRegression } from './evaluate-traceability-regression';

export const INTERGROUP_CONTROL_SHA256 = '602e7c230ebf7374a44c2cfc2a8ff47392f302aba27c30e3d6d0c4ce3c78c01a';
export const INTERGROUP_EVALUATOR_VERSION = 'signal-intergroup-evaluator-v2';
export const INTERGROUP_METHODS = ['signal', 'old-v4', 'old-v3', 'keyword-baseline', 'random', 'reverse', 'without-test-result'] as const;
type Method = typeof INTERGROUP_METHODS[number];
type Entry = { candidate: MatchCandidate; evaluation: MatchEvaluation };
type WireCandidate = { profile: Omit<MatchCandidate, 'latestAssessmentAt' | 'assessmentEvidence'> & { latestAssessmentAt: string | null }; assessment: MatchCandidate['assessmentEvidence'] };
type Query = { id: string; split: 'development' | 'control-holdout'; purpose: string; need: MatchNeed; candidates: WireCandidate[]; relevanceLabels: Record<string, number>; labelReasons: Record<string, string>; expectedEligibleIds: number[] };
type Dataset = { version: string; evaluationClock: string; rubric: Record<string, unknown>; queries: Query[]; metamorphicAssertions: Record<string, any>; humanValidation: Record<string, unknown> };
const dataUrl = new URL('../outputs/quality/qa-cycle-01/intergroup-control-v1.json', import.meta.url);
const freezeUrl = new URL('../outputs/quality/qa-cycle-01/intergroup-control-freeze.json', import.meta.url);
const hash = (raw: Buffer | string) => createHash('sha256').update(raw).digest('hex');
const sourceHash = (path: string) => hash(readFileSync(new URL(path, import.meta.url)));
const text = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const aliasId = (a: MatchCandidate, b: MatchCandidate) => text(a.alias.normalize('NFC'), b.alias.normalize('NFC')) || a.userId - b.userId;
const mean = (xs: Array<number | null>) => { const known = xs.filter((x): x is number => x !== null); return { value: known.length ? known.reduce((a,b) => a+b,0)/known.length : null, total: xs.length, defined: known.length, undefined: xs.length-known.length }; };

/** Explicit authored labels are immutable inputs; this adapter never generates them. */
export function loadIntergroupDataset(): Dataset {
  const raw = readFileSync(dataUrl);
  if (hash(raw) !== INTERGROUP_CONTROL_SHA256) throw new Error('Frozen intergroup fixture bytes changed');
  const freeze = JSON.parse(readFileSync(freezeUrl, 'utf8'));
  if (freeze.fileSha256 !== INTERGROUP_CONTROL_SHA256) throw new Error('Frozen metadata no longer matches fixture');
  if (sourceHash('../artifacts/api-server/src/lib/matching-v4-frozen.ts') !== freeze.oldAlgorithmSha256AtFreeze) throw new Error('Preserved v4 baseline changed since independent fixture freeze');
  return JSON.parse(raw.toString('utf8')) as Dataset;
}
export function intergroupCandidates(query: Query): MatchCandidate[] {
  return query.candidates.map(({profile, assessment}) => ({ ...profile, latestAssessmentAt: profile.latestAssessmentAt ? new Date(profile.latestAssessmentAt) : null, assessmentEvidence: assessment ?? null }));
}
export function intergroupMetrics(ranking: readonly number[], labels: Record<string,number>, eligible: readonly number[]) {
  const k = 5, top = ranking.slice(0,k), relevant = eligible.filter(id => labels[String(id)] >= 2);
  const found = top.filter(id => relevant.includes(id)).length;
  const dcg = (grades: readonly number[]) => grades.slice(0,k).reduce((sum,g,i) => sum + (2**g-1)/Math.log2(i+2), 0);
  const ideal = dcg(eligible.map(id => labels[String(id)] ?? 0).sort((a,b) => b-a));
  return { precisionAt5: found/k, precisionAt5Numerator: found, precisionAt5Denominator: k, ndcgAt5: ideal ? dcg(top.map(id => labels[String(id)] ?? 0))/ideal : null,
    relevantRecallAt5: relevant.length ? found/relevant.length : null, relevantTotal: relevant.length, returnedCount: ranking.length, topReturnedCount: top.length,
    maximumAvailablePrecisionAt5: Math.min(k,relevant.length)/k, actualEmpty: ranking.length===0, unexpectedEmpty: eligible.length>0 && ranking.length===0 };
}
function evaluate(query: Query, candidates: MatchCandidate[], at: Date): Entry[] {
  return candidates.map(candidate => ({ candidate, evaluation: evaluateMatch(query.need,candidate,true,at) }));
}
function ranked(entries: Entry[]): Entry[] { return rankMatches(entries.filter(entry => entry.evaluation.eligible)); }
function ids(entries: Entry[]) { return entries.map(entry => entry.candidate.userId); }
function methods(query: Query, entries: Entry[], at: Date): Record<Method, number[]> {
  const eligible = entries.filter(entry => entry.evaluation.eligible);
  const signal = ids(ranked(eligible));
  const v4 = eligible.map(entry => ({ candidate: entry.candidate, evaluation: evaluateV4(query.need,entry.candidate,true,at) })).sort(compareV4).map(entry => entry.candidate.userId);
  const oldScores = new Map(eligible.map(entry => [entry.candidate.userId,evaluateV3(query.need,entry.candidate,true,at).rankingScore]));
  const oldV3 = [...eligible].sort((a,b) => oldScores.get(b.candidate.userId)!-oldScores.get(a.candidate.userId)! || aliasId(a.candidate,b.candidate)).map(entry => entry.candidate.userId);
  const requirements = [...query.need.requiredSkills,...query.need.desirableSkills].map(canonicalSkillKey);
  const mentions = (candidate: MatchCandidate) => { const stated = new Set([...candidate.stack,...candidate.statedSkills].map(canonicalSkillKey)); return requirements.filter(key=>stated.has(key)).length; };
  const keyword = [...eligible].sort((a,b) => mentions(b.candidate)-mentions(a.candidate) || aliasId(a.candidate,b.candidate)).map(entry=>entry.candidate.userId);
  const random = [...eligible].sort((a,b) => text(hash(`${INTERGROUP_CONTROL_SHA256}|fixed-random-v1|${query.id}|${a.candidate.userId}`),hash(`${INTERGROUP_CONTROL_SHA256}|fixed-random-v1|${query.id}|${b.candidate.userId}`)) || aliasId(a.candidate,b.candidate)).map(entry=>entry.candidate.userId);
  // Diagnostic removal changes no admission/group/metadata. All group quality values
  // are unavailable to the within-group queue, without pretending the original proof failed.
  const removed = eligible.map(entry => ({ ...entry, evaluation: { ...entry.evaluation, ranking: { ...entry.evaluation.ranking, qualityScore: null } } }));
  return { signal, 'old-v4':v4, 'old-v3':oldV3, 'keyword-baseline':keyword, random, reverse:[...signal].reverse(), 'without-test-result':ids(ranked(removed)) };
}
function admission(query: Query, entries: Entry[]) {
  const rows = entries.map(({candidate,evaluation}) => ({ pairId:`${query.id}/${candidate.userId}`,expectedEligible:query.expectedEligibleIds.includes(candidate.userId),actualEligible:evaluation.eligible }));
  return { pairs:rows.length, expectedEligible:query.expectedEligibleIds.length, falseExclusions:rows.filter(r=>r.expectedEligible&&!r.actualEligible).map(r=>r.pairId), falseAdmissions:rows.filter(r=>!r.expectedEligible&&r.actualEligible).map(r=>r.pairId),
    privacyViolations:[] as string[], privacyNegativeDenominator:0, privacyViolationRate:null, note:'This new ranking-specific control contains admitted synthetic candidates only. Privacy/forbidden-gate denominators are zero; existing frozen control covers them separately.' };
}

export function intergroupMetamorphicChecks(dataset = loadIntergroupDataset()) {
  const at = new Date(dataset.evaluationClock);
  const same = (a: unknown,b: unknown) => JSON.stringify(a)===JSON.stringify(b);
  const results = dataset.queries.map(query => {
    const candidates = intergroupCandidates(query), entries = evaluate(query,candidates,at), prepared = ranked(entries), expected = ids(prepared);
    const variants = [[...entries].reverse(),[...entries.slice(3),...entries.slice(0,3)],entries.filter((_,i)=>i%2===0).concat(entries.filter((_,i)=>i%2===1))];
    const permutation = variants.map(variant => same(ids(ranked(variant)),expected));
    const versions = dataset.metamorphicAssertions.renameEquivalentTechnicalIdentifiers.versions as Record<string,string>;
    const renamed = candidates.map(candidate => ({ ...candidate, assessmentEvidence: candidate.assessmentEvidence ? { ...candidate.assessmentEvidence,
      programVersion:versions[candidate.assessmentEvidence.programVersion] ?? candidate.assessmentEvidence.programVersion,
      rubricKey:(candidate.assessmentEvidence.rubricKey.startsWith('a')?'zz-':'aa-')+candidate.assessmentEvidence.rubricKey } : null }));
    const renamedPrepared = ranked(evaluate(query,renamed,at));
    let triples=0, violations=0;
    for(let i=0;i<prepared.length;i++)for(let j=i+1;j<prepared.length;j++)for(let k=j+1;k<prepared.length;k++) {
      triples++;
      if(!(compareRankedMatches(prepared[i],prepared[j])<0 && compareRankedMatches(prepared[j],prepared[k])<0 && compareRankedMatches(prepared[i],prepared[k])<0)) violations++;
    }
    const renamedProofPreserved = renamedPrepared.every(entry => entry.evaluation.ranking.qualityStatus===entries.find(e=>e.candidate.userId===entry.candidate.userId)!.evaluation.ranking.qualityStatus &&
      entry.evaluation.ranking.qualityScore===entries.find(e=>e.candidate.userId===entry.candidate.userId)!.evaluation.ranking.qualityScore);
    return { queryId:query.id, permutations:{cases:variants.length,passed:permutation.filter(Boolean).length,results:permutation},
      technicalRename:{orderPreserved:same(ids(renamedPrepared),expected),proofStatusAndScorePreserved:renamedProofPreserved,before:expected,after:ids(renamedPrepared)},
      transitivity:{triples,violations},positions:{unique:new Set(prepared.map(entry=>entry.evaluation.ranking.position)).size===prepared.length,
        contiguous:prepared.every((entry,i)=>entry.evaluation.ranking.position===i+1)} };
  });
  const quality = dataset.metamorphicAssertions.qualityOrder;
  const qualityQuery = dataset.queries.find(query=>query.id===quality.queryId)!;
  const qualityRank = ids(ranked(evaluate(qualityQuery,intergroupCandidates(qualityQuery),at)));
  const promotion = dataset.metamorphicAssertions.gradePromotion;
  const promotionQuery = dataset.queries.find(query=>query.id===promotion.queryId)!;
  const promotionCandidates = intergroupCandidates(promotionQuery);
  const beforePromotion = ids(ranked(evaluate(promotionQuery,promotionCandidates,at)));
  const promoted = promotionCandidates.map(candidate => candidate.userId===promotion.candidateId ? { ...candidate,verifiedGrade:promotion.to } : candidate);
  const afterPromotion = ids(ranked(evaluate(promotionQuery,promoted,at)));
  const unknown = dataset.metamorphicAssertions.unknownQuality;
  const unknownQuery=dataset.queries.find(query=>query.id===unknown.queryId)!;
  const unknownRows=evaluate(unknownQuery,intergroupCandidates(unknownQuery),at).filter(entry=>unknown.candidateIds.includes(entry.candidate.userId)).map(entry=>({candidateId:entry.candidate.userId,profileScore:entry.candidate.verifiedScore,qualityScore:entry.evaluation.ranking.qualityScore,qualityStatus:entry.evaluation.ranking.qualityStatus}));
  const checks={permutationsStable:results.every(r=>r.permutations.passed===r.permutations.cases),technicalRenameInvariant:results.every(r=>r.technicalRename.orderPreserved && r.technicalRename.proofStatusAndScorePreserved),
    transitive:results.every(r=>r.transitivity.violations===0),positionsContiguousAndUnique:results.every(r=>r.positions.contiguous&&r.positions.unique),
    comparable100Above83:qualityRank.indexOf(quality.higherId)<qualityRank.indexOf(quality.lowerId),
    acceptedGradePromotionNoPenalty:afterPromotion.indexOf(promotion.candidateId)<=beforePromotion.indexOf(promotion.candidateId),
    unknownQualityIsNull:unknownRows.every(row=>row.qualityScore===null&&row.qualityStatus==='not_measured')};
  return {checks,byQuery:results,quality:{higherId:quality.higherId,lowerId:quality.lowerId,ranking:qualityRank},gradePromotion:{candidateId:promotion.candidateId,before:beforePromotion,after:afterPromotion},unknownQuality:unknownRows};
}

export function runIntergroupControl() {
  const dataset = loadIntergroupDataset(), at = new Date(dataset.evaluationClock), freeze=JSON.parse(readFileSync(freezeUrl,'utf8'));
  const firstUrl=new URL('../outputs/quality/qa-cycle-01/intergroup-control-v1-first-measurement.json',import.meta.url);
  const first=existsSync(firstUrl)?JSON.parse(readFileSync(firstUrl,'utf8')):null;
  const byQuery=dataset.queries.map(query=>{
    const entries=evaluate(query,intergroupCandidates(query),at), orders=methods(query,entries,at);
    return {queryId:query.id,split:query.split,kind:'competitive',purpose:query.purpose,expectedEligibleIds:query.expectedEligibleIds,admission:admission(query,entries),
      methods:Object.fromEntries(INTERGROUP_METHODS.map(method=>[method,{runtimeRanking:orders[method],expectedRanking:orders[method],endToEnd:intergroupMetrics(orders[method],query.relevanceLabels,query.expectedEligibleIds),rankingOnly:intergroupMetrics(orders[method],query.relevanceLabels,query.expectedEligibleIds)}])) as Record<Method,{runtimeRanking:number[];expectedRanking:number[];endToEnd:ReturnType<typeof intergroupMetrics>;rankingOnly:ReturnType<typeof intergroupMetrics>}>,
      pairRows:entries.map(({candidate,evaluation})=>({pairId:`${query.id}/${candidate.userId}`,candidateId:candidate.userId,expectedEligible:query.expectedEligibleIds.includes(candidate.userId),actualEligible:evaluation.eligible,relevance:query.relevanceLabels[String(candidate.userId)],labelReason:query.labelReasons[String(candidate.userId)],grade:candidate.verifiedGrade,qualityStatus:evaluation.ranking.qualityStatus,qualityScore:evaluation.ranking.qualityScore,programVersion:evaluation.ranking.programVersion,rubricKey:evaluation.ranking.rubricKey,salaryCompatibility:evaluation.salaryCompatibility})),
      currentPreparedScores:ranked(entries).map(entry=>({candidateId:entry.candidate.userId,evaluation:entry.evaluation})),
    };
  });
  const aggregate=(rows:typeof byQuery)=>({queries:rows.length,competitiveQueries:rows.length,shortQueries:0,emptyQueries:0,
    admission:{pairs:rows.reduce((n,q)=>n+q.admission.pairs,0),expectedEligible:rows.reduce((n,q)=>n+q.admission.expectedEligible,0),falseExclusions:rows.flatMap(q=>q.admission.falseExclusions),falseAdmissions:rows.flatMap(q=>q.admission.falseAdmissions),privacyViolations:[],privacyNegativeDenominator:0,privacyViolationRate:null},
    methods:Object.fromEntries(INTERGROUP_METHODS.map(method=>[method,{precisionAt5:mean(rows.map(q=>q.methods[method].endToEnd.precisionAt5)),ndcgAt5:mean(rows.map(q=>q.methods[method].endToEnd.ndcgAt5)),relevantRecallAt5:mean(rows.map(q=>q.methods[method].endToEnd.relevantRecallAt5)),unexpectedEmpty:rows.filter(q=>q.methods[method].endToEnd.unexpectedEmpty).map(q=>q.queryId)}])),
  });
  const changes=byQuery.map(query=>({queryId:query.queryId,split:query.split,precisionAt5:query.methods.signal.endToEnd.precisionAt5-query.methods['old-v4'].endToEnd.precisionAt5,
    ndcgAt5:query.methods.signal.endToEnd.ndcgAt5!==null&&query.methods['old-v4'].endToEnd.ndcgAt5!==null?query.methods.signal.endToEnd.ndcgAt5!-query.methods['old-v4'].endToEnd.ndcgAt5!:null}));
  const metamorphic=intergroupMetamorphicChecks(dataset);
  const traceabilityRegression=runTraceabilityRegression();
  const previousUrl=new URL('../outputs/verification/history/qa-cycle-01-before-traceability/outputs/quality/qa-cycle-01/intergroup-control-v1-report.json',import.meta.url);
  const previousRaw=readFileSync(previousUrl),previous=JSON.parse(previousRaw.toString('utf8'));
  const postQaDeltas=byQuery.map(query=>{const before=previous.byQuery.find((q:any)=>q.queryId===query.queryId).methods.signal.endToEnd;return {queryId:query.queryId,
    precisionAt5:query.methods.signal.endToEnd.precisionAt5-before.precisionAt5,ndcgAt5:query.methods.signal.endToEnd.ndcgAt5!==null&&before.ndcgAt5!==null?query.methods.signal.endToEnd.ndcgAt5!-before.ndcgAt5:null};});
  return {evaluatorVersion:INTERGROUP_EVALUATOR_VERSION,datasetVersion:dataset.version,datasetSha256:INTERGROUP_CONTROL_SHA256,algorithmVersion:MATCH_ALGORITHM_VERSION,
    algorithmSha256:sourceHash('../artifacts/api-server/src/lib/signal-matching.ts'),oldAlgorithmVersion:'fsp-signal-match-v4',oldAlgorithmSha256:sourceHash('../artifacts/api-server/src/lib/matching-v4-frozen.ts'),
    evaluatorSha256:sourceHash('./evaluate-intergroup-control.ts'),catalogVersion:SKILL_CATALOG_VERSION,measurementAt:new Date().toISOString(),evaluationClock:dataset.evaluationClock,freeze,
    measurementHistory:{firstMeasuredAt:first?.measurementAt??null,firstAlgorithmSha256:first?.algorithmSha256??null,
      firstPreservedFile:first?'outputs/quality/qa-cycle-01/intergroup-control-v1-first-measurement.json':null,
      firstMatchesCurrentSource:first?first.algorithmSha256===sourceHash('../artifacts/api-server/src/lib/signal-matching.ts'):null,
      note:'The first run may capture an interim source while the preselected policy is being implemented. Each run records its exact source SHA; the first file is never overwritten. Dataset labels and partitions are unchanged. The current report is authoritative only for its stated source.'},
    controlUsage:{initialFreezeBeforeImplementation:true,currentUse:'regression-after-independent-QA-followup',labelsAndMembershipChanged:false,
      reason:'Independent QA after the initial measurement identified incomplete historical evidence/FSP ahead of current complete proof at equal concrete job fit in the original consumed control. A general nonnumeric traceability preference at equal common fit was added; no candidate-ID exceptions or relabelling.',
      independentUntouchedHoldoutClaimForFinalPolicy:false,traceabilityFreezeAt:traceabilityRegression.freeze.frozenAt,traceabilityDatasetSha256:traceabilityRegression.datasetSha256},
    environment:{mode:'local-pure-function-control',node:process.version,platform:process.platform,architecture:process.arch,database:'not_used',working4310:'untouched',dockerImage:'not_applicable'},
    annotationSource:dataset.rubric.provenance,rubric:dataset.rubric,summary:aggregate(byQuery),strata:{split:['development','control-holdout'].map(split=>({value:split,...aggregate(byQuery.filter(q=>q.split===split))}))},
    byQuery,metamorphic,traceabilityRegression,comparisons:{oldV4:changes},beforeAfterLosses:changes.filter(change=>change.ndcgAt5!==null&&change.ndcgAt5<0),
    postQaComparison:{beforeReportSha256:hash(previousRaw),beforeAlgorithmSha256:previous.algorithmSha256,beforeMeasurementAt:previous.measurementAt,
      beforeSummary:previous.summary,deltas:postQaDeltas,allLosses:postQaDeltas.filter(delta=>delta.ndcgAt5!==null&&delta.ndcgAt5<0)},
    diagnostics:{qualityRemovalChangesTop5:byQuery.some(q=>JSON.stringify(q.methods.signal.runtimeRanking.slice(0,5))!==JSON.stringify(q.methods['without-test-result'].runtimeRanking.slice(0,5))),
      qualityRemovalLowersNdcg:byQuery.some(q=>q.methods.signal.endToEnd.ndcgAt5!>q.methods['without-test-result'].endToEnd.ndcgAt5!+1e-9),
      reverseLowersNdcg:byQuery.some(q=>q.methods.signal.endToEnd.ndcgAt5!>q.methods.reverse.endToEnd.ndcgAt5!+1e-9),randomLowersNdcg:byQuery.some(q=>q.methods.signal.endToEnd.ndcgAt5!>q.methods.random.endToEnd.ndcgAt5!+1e-9)},
    humanValidation:dataset.humanValidation,
    limitations:['AI-assisted synthetic labels are explicit business judgements, not independent human or hiring observations. No people participated.',
      'All eight pools are admitted-candidate ranking scenarios with twelve candidates each. This fixture has no privacy-negative denominator; existing frozen control retains privacy/gate measurement.',
      'All labels, membership, transformations and splits were frozen before the initial implementation. The initial run consumed holdout; generic traceability policy changed after independent QA-followup. This current rerun is regression, not fresh untouched holdout proof. Labels and numeric weights were not changed.',
      'Bijective synthetic metadata renaming preserves each comparison partition; it proves opaque-ID order invariance, not real bank cross-form or human difficulty equivalence.',
      'Quality is never compared across grade/program/version/rubric. At equal concrete business fit complete linked proof has an explicit nonnumeric traceability preference over historical incomplete summaries; raw unknown quality remains null. Within group/FSP ties, queue heads use deterministic identity.',
      'A synthetic historical verified profile can have quality not_measured; verifiedScore99 without its linked protocol is deliberately not recovered.',
      'Known salary mismatch and unknown tax basis are distinct. Unknown salary is excluded from the common fit denominator, not assigned failure.',
    'Metric losses and rubric-policy tradeoffs are retained per need. A finite age band is a product policy, not proof of human skill decay.',
    'The first preserved measurement was taken during implementation on its recorded interim source; the final report uses its separately recorded exact source. No labels, splits or transforms changed between them.',
      'Fixed-random ordering is one sensitivity diagnostic, not an average of repeated random trials.',
      'Before is the exact preserved v4 source file. No running Docker API or compiled bundle was exercised by this pure-function report.']};
}

export async function writeIntergroupControl() {
  const report=runIntergroupControl(), folder='outputs/quality/qa-cycle-01';
  await mkdir(folder,{recursive:true});
  const json=JSON.stringify(report,null,2)+'\n';
  const first=`${folder}/intergroup-control-v1-first-measurement.json`;
  if(!existsSync(first))await writeFile(first,json);
  await writeFile(`${folder}/intergroup-control-v1-report.json`,json);
  const fmt=(value:number|null)=>value===null?'not_defined':value.toFixed(4);
  const lines=['# Межгрупповой контроль QA-01: фактический результат','',`Измерено: ${report.measurementAt}. Алгоритм ${report.algorithmVersion}; набор ${report.datasetVersion}.`,`SHA256 набора: ${report.datasetSha256}; заморожен ${report.freeze.frozenAt}.`,'',
    'Синтетические явные метки подготовлены отдельным QA-агентом до первоначальной реализации нового порядка. После первого измерения независимая QA обнаружила дополнительную границу полноты происхождения; общая политика доработана. Текущий прогон — регрессия уже использованного контроля, не новый нетронутый holdout. Метки/числовые веса не менялись. Люди и реальный найм не измерены. Результаты не являются официальными конкурсными баллами.','',
    `Точный SHA256 текущего алгоритма: ${report.algorithmSha256}. Первый сохранённый прогон: ${report.measurementHistory.firstMeasuredAt??'это измерение'}; SHA256 ${report.measurementHistory.firstAlgorithmSha256??report.algorithmSha256}. История сохраняется без перезаписи; промежуточный исходник и итоговый исходник различаются явно. Метки/набор не менялись.`, '',
    '| Метод | P@5 / 8 потребностей | nDCG@5 / определённые | Неопределённых |','| --- | ---: | ---: | ---: |',
    ...INTERGROUP_METHODS.map(method=>{const m=report.summary.methods[method] as {precisionAt5:{value:number|null};ndcgAt5:{value:number|null;undefined:number;total:number}};return `| ${method} | ${fmt(m.precisionAt5.value)} | ${fmt(m.ndcgAt5.value)} | ${m.ndcgAt5.undefined}/${m.ndcgAt5.total} |`;}),'',
    '| Потребность | Раздел | Допустимых | Новый P@5 | Новый nDCG | v4 nDCG | Δ nDCG |','| --- | --- | ---: | ---: | ---: | ---: | ---: |',
    ...report.byQuery.map((q,i)=>`| ${q.queryId} | ${q.split} | ${q.expectedEligibleIds.length} | ${fmt(q.methods.signal.endToEnd.precisionAt5)} | ${fmt(q.methods.signal.endToEnd.ndcgAt5)} | ${fmt(q.methods['old-v4'].endToEnd.ndcgAt5)} | ${fmt(report.comparisons.oldV4[i].ndcgAt5)} |`),'',
    'Все 96 пар допустимы по заранее заданной потребности. Ошибки допуска/исключения проверяются, но приватностных отрицательных примеров здесь нет: знаменатель 0, ставка null. Такой контроль не заменяет прежний контроль допуска и приватности.','',
    '## Метаморфные проверки','',...Object.entries(report.metamorphic.checks).map(([key,value])=>`- ${key}: ${value?'PASS':'FAIL'}`),'',
    '## Все проигрыши против v4','',...(report.beforeAfterLosses.length?report.beforeAfterLosses.map(loss=>`- ${loss.queryId}: Δ nDCG@5 ${fmt(loss.ndcgAt5)}.`):['Ни одной потребности с отрицательным Δ nDCG@5 на этом замороженном наборе. Это не доказательство превосходства на внешних данных.']),'',
    '## Последующая QA01b-регрессия','',`Исходный отчёт до полноты происхождения сохранён: source ${report.postQaComparison.beforeAlgorithmSha256}, измерение ${report.postQaComparison.beforeMeasurementAt}, SHA отчёта ${report.postQaComparison.beforeReportSha256}.`, '',
    '| Потребность | Δ P@5 после QA01b | Δ nDCG@5 после QA01b |','| --- | ---: | ---: |',...report.postQaComparison.deltas.map(delta=>`| ${delta.queryId} | ${fmt(delta.precisionAt5)} | ${fmt(delta.ndcgAt5)} |`),'',
    ...report.postQaComparison.allLosses.map(loss=>`- Сохранённый проигрыш: ${loss.queryId}, Δ nDCG@5 ${fmt(loss.ndcgAt5)}.`),'',
    ...Object.entries(report.traceabilityRegression.checks).map(([key,value])=>`- traceability.${key}: ${value?'PASS':'FAIL'}`),'',
    '## Ограничения','',...report.limitations.map(value=>`- ${value}`),''];
  await writeFile(`${folder}/intergroup-control-v1-report.md`,lines.join('\n'));
  console.log(JSON.stringify({file:`${folder}/intergroup-control-v1-report.json`,summary:report.summary,metamorphic:report.metamorphic.checks,beforeAfterLosses:report.beforeAfterLosses},null,2));
  return report;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1])writeIntergroupControl().catch(error=>{console.error(error);process.exitCode=1;});
