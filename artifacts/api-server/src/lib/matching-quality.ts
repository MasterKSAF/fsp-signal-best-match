import { createHash } from 'node:crypto';
import { evaluateMatch, rankMatches, MATCH_ALGORITHM_VERSION, type MatchCandidate, type MatchNeed } from './signal-matching';
import { canonicalSkillKey, SKILL_CATALOG_VERSION } from './skill-catalog';
import { MATCH_CONTROL_AT, MATCH_CONTROL_CANDIDATES as candidates, MATCH_CONTROL_QUERIES as queries, MATCH_CONTROL_VISIBLE as visible, MATCH_CONTROL_RUBRIC as rubric, MATCH_CONTROL_VERSION } from './matching-control-fixtures';

export const matchingDataset = () => ({ version: MATCH_CONTROL_VERSION, at: MATCH_CONTROL_AT, rubric, candidates, queries, visible });
export const matchingDatasetHash = () => createHash('sha256').update(JSON.stringify(matchingDataset())).digest('hex');
type Evaluator = (need: MatchNeed, candidate: MatchCandidate, demo: boolean, at: Date) => ReturnType<typeof evaluateMatch>;
const ratio = (numerator: number, denominator: number): number | null => denominator ? numerator / denominator : null;
const ndcg = (ranking: number[], labels: Record<number, number>, eligible: number[]) => {
  const dcg = (values: number[]) => values.slice(0, 5).reduce((sum, value, index) => sum + (2 ** value - 1) / Math.log2(index + 2), 0);
  const ideal = dcg(eligible.map(id => labels[id] ?? 0).sort((a, b) => b - a));
  return ideal ? dcg(ranking.map(id => labels[id] ?? 0)) / ideal : null;
};
export function runMatchingQuality(evaluator: Evaluator = evaluateMatch) {
  const pairRows = queries.flatMap(query => candidates.map(candidate => ({ queryId: query.id, candidateId: candidate.userId, minimumGrade: query.need.grade, candidateGrade: candidate.verifiedGrade ?? 'unverified', fspHistory: candidate.hasFspHistory, showable: visible.includes(candidate.userId), expectedEligible: query.eligible.includes(candidate.userId), actualEligible: evaluator(query.need, candidate, true, MATCH_CONTROL_AT).eligible })));
  const admission = (rows: typeof pairRows) => ({
    pairs: rows.length, permittedPairs: rows.filter(x => x.showable).length,
    expectedEligible: rows.filter(x => x.expectedEligible).length,
    falseExclusions: rows.filter(x => x.showable && x.expectedEligible && !x.actualEligible).map(x => `${x.queryId}/${x.candidateId}`),
    falseAdmissions: rows.filter(x => x.showable && !x.expectedEligible && x.actualEligible).map(x => `${x.queryId}/${x.candidateId}`),
    privacyViolations: rows.filter(x => !x.showable && x.actualEligible).map(x => `${x.queryId}/${x.candidateId}`),
    recall: ratio(rows.filter(x => x.expectedEligible && x.actualEligible).length, rows.filter(x => x.expectedEligible).length),
    falseAdmissionRate: ratio(rows.filter(x => x.showable && !x.expectedEligible && x.actualEligible).length, rows.filter(x => x.showable && !x.expectedEligible).length),
  });
  const byQuery = queries.map(query => {
    const labels = query.labels as Record<number, number>;
    const independentPool = candidates.filter(candidate => query.eligible.includes(candidate.userId));
    const runtimePool = candidates.filter(candidate => evaluator(query.need, candidate, true, MATCH_CONTROL_AT).eligible);
    const rank = (pool: MatchCandidate[]) => rankMatches(pool.map(candidate => ({ candidate, evaluation: evaluator(query.need, candidate, true, MATCH_CONTROL_AT) }))).map(x => x.candidate.userId);
    const requirements = [...query.need.requiredSkills, ...query.need.desirableSkills].map(canonicalSkillKey);
    const keyword = (candidate: MatchCandidate) => requirements.filter(skill => [...candidate.statedSkills, ...candidate.stack].map(canonicalSkillKey).includes(skill)).length;
    const baseline = [...independentPool].sort((a, b) => keyword(b) - keyword(a) || a.userId - b.userId).map(x => x.userId);
    const finalRanking = rank(runtimePool);
    const relevant = independentPool.filter(x => (labels[x.userId] ?? 0) >= 2).map(x => x.userId);
    const metric = (ranking: number[]) => ({ precisionAt5: ranking.slice(0, 5).filter(id => (labels[id] ?? 0) >= 2).length / 5, ndcgAt5: ndcg(ranking, labels, query.eligible) });
    return { queryId: query.id, purpose: query.purpose, ...admission(pairRows.filter(x => x.queryId === query.id)), independentlyEligibleIds: query.eligible, finalRanking, signalOrderWithinExpectedPool: rank(independentPool), baselineOrderWithinExpectedPool: baseline, rankingOnly: { signal: metric(rank(independentPool)), baseline: metric(baseline) }, endToEnd: { ...metric(finalRanking), relevantRecallAll: ratio(finalRanking.filter(id => relevant.includes(id)).length, relevant.length), relevantRecallAt5: ratio(finalRanking.slice(0, 5).filter(id => relevant.includes(id)).length, relevant.length), relevantTotal: relevant.length, returnedCount: finalRanking.length, expectedEmpty: query.eligible.length === 0, actualEmpty: finalRanking.length === 0, unexpectedEmpty: query.eligible.length > 0 && finalRanking.length === 0 } };
  });
  return {
    datasetVersion: MATCH_CONTROL_VERSION, datasetSha256: matchingDatasetHash(), algorithmVersion: MATCH_ALGORITHM_VERSION, catalogVersion: SKILL_CATALOG_VERSION,
    evaluatedAt: MATCH_CONTROL_AT.toISOString(), annotationSource: rubric.source, rubric,
    summary: admission(pairRows), byQuery,
    strata: { minimumGrade: ['Junior', 'Middle', 'Senior'].map(value => ({ value, ...admission(pairRows.filter(x => x.minimumGrade === value)) })), candidateGrade: ['unverified', 'Junior', 'Middle', 'Senior'].map(value => ({ value, ...admission(pairRows.filter(x => x.candidateGrade === value)) })), fsp: [false, true].map(value => ({ value, ...admission(pairRows.filter(x => x.fspHistory === value)) })) },
    humanReview: { status: 'not_measured', reviewers: 0, agreement: null },
    limitations: [rubric.limits, 'Precision@5 divides by five even when fewer candidates are admissible. Empty denominators remain null, not perfect scores.', 'Eligibility labels are explicit immutable lists, not generated by the production eligibility function.', 'Ranking-only uses the independently labelled pool; end-to-end also includes actual exclusions/admissions.', 'Results measure synthetic contract consistency, not hiring probability, external validity, or absence of bias.'],
  };
}
