import { runMatchingQuality } from './matching-quality';
import { evaluateMatch, MATCH_ALGORITHM_VERSION, type MatchCandidate, type MatchNeed } from './signal-matching';

// A deliberately small, synthetic control suite. These labels are design
// expectations written separately from the scoring function, NOT human ratings.
export const CONTROL_VERSION = 'signal-control-v1';
export const EVALUATION_AT = new Date('2026-10-05T12:00:00Z');
export type ControlQuery = { id: string; split: 'development' | 'control-holdout'; need: MatchNeed; candidates: MatchCandidate[]; labels: Record<number, number> };

const relevance = [3, 3, 3, 2, 2, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0];
const scenarios = [
  ['Junior', 'Python', 'API contracts', 'SQL'],
  ['Middle', 'Python', 'PostgreSQL', 'Idempotency'],
  ['Senior', 'Python', 'Architecture', 'Incident diagnosis'],
  ['Middle', 'Python', 'SQL', 'API contracts'],
  ['Junior', 'Python', 'SQL', 'PostgreSQL'],
  ['Middle', 'Python', 'Idempotency', 'Architecture'],
  ['Senior', 'Python', 'Incident diagnosis', 'API contracts'],
  ['Senior', 'Python', 'PostgreSQL', 'SQL'],
] as const;

export function controlQueries(): ControlQuery[] {
  return scenarios.map(([grade, required, extraA, extraB], index) => {
    const need: MatchNeed = { specialization: 'Backend / Python', grade, requiredSkills: [required], desirableSkills: [extraA, extraB], workFormat: 'Удалённо', salaryMin: 200000, salaryMax: 400000 };
    const candidates: MatchCandidate[] = Array.from({ length: 15 }, (_, i) => ({
      userId: index * 100 + i + 1, alias: `Control ${index + 1}/${i + 1}`,
      specialization: i === 10 ? 'Frontend / TypeScript' : 'Backend / Python',
      verifiedGrade: i === 11 ? null : grade,
      verifiedScore: [96, 91, 87, 80, 76, 69, 65, 60, 55, 54, 90, 90, 90, 90, 90][i],
      // 0..4 satisfy the task's stated practical requirements. 5..9 only
      // evidence its minimum skill, despite rich self-reported keywords.
      verifiedSkills: i < 3 ? [required, extraA, extraB] : i < 5 ? [required, extraA] : [required],
      stack: i < 3 ? [required] : [required, extraA, extraB],
      statedSkills: i < 3 ? [required] : [required, extraA, extraB],
      workFormat: i < 8 ? 'Удалённо' : 'Офис',
      salaryMin: 220000, salaryMax: 320000,
      latestAssessmentAt: new Date(EVALUATION_AT.getTime() - (i < 5 ? 7 : 170) * 86400000),
      hasFspHistory: i === 7, visibility: i === 12 ? 'private' : 'pseudonymous',
      consentMatching: i !== 13, demoMode: i !== 14,
    }));
    return { id: `control-${index + 1}`, split: index < 4 ? 'development' : 'control-holdout', need, candidates, labels: Object.fromEntries(candidates.map((candidate, i) => [candidate.userId, relevance[i]])) };
  });
}

export function precisionAtK(ranking: number[], labels: Record<number, number>, k = 5): number {
  if (k < 1) return 0;
  return ranking.slice(0, k).filter(id => (labels[id] ?? 0) >= 2).length / k;
}
export function ndcgAtK(ranking: number[], labels: Record<number, number>, eligible: number[], k = 5): number {
  const dcg = (values: number[]) => values.slice(0, k).reduce((sum, value, i) => sum + (2 ** value - 1) / Math.log2(i + 2), 0);
  const ideal = dcg(eligible.map(id => labels[id] ?? 0).sort((a, b) => b - a));
  return ideal ? dcg(ranking.map(id => labels[id] ?? 0)) / ideal : 0;
}

export function runControlEvaluation() {
  const byQuery = controlQueries().map(query => {
    const eligible = query.candidates.filter(candidate => evaluateMatch(query.need, candidate, true, EVALUATION_AT).eligible);
    const byId = (a: MatchCandidate, b: MatchCandidate) => a.userId - b.userId;
    const signal = [...eligible].sort((a, b) => evaluateMatch(query.need, b, true, EVALUATION_AT).rankingScore - evaluateMatch(query.need, a, true, EVALUATION_AT).rankingScore || byId(a, b)).map(candidate => candidate.userId);
    const requirements = [...query.need.requiredSkills, ...query.need.desirableSkills];
    const keywordScore = (candidate: MatchCandidate) => requirements.filter(skill => new Set([...candidate.stack, ...candidate.statedSkills]).has(skill)).length;
    const baseline = [...eligible].sort((a, b) => keywordScore(b) - keywordScore(a) || byId(a, b)).map(candidate => candidate.userId);
    const metric = (ranking: number[]) => ({ precisionAt5: precisionAtK(ranking, query.labels), ndcgAt5: ndcgAtK(ranking, query.labels, eligible.map(candidate => candidate.userId)) });
    return { queryId: query.id, split: query.split, eligibleCount: eligible.length, signalRanking: signal.slice(0, 5), baselineRanking: baseline.slice(0, 5), signal: metric(signal), baseline: metric(baseline) };
  });
  const holdout = byQuery.filter(query => query.split === 'control-holdout');
  const mean = (method: 'signal' | 'baseline', key: 'precisionAt5' | 'ndcgAt5') => holdout.reduce((sum, query) => sum + query[method][key], 0) / holdout.length;
  return {
    datasetVersion: CONTROL_VERSION, algorithmVersion: MATCH_ALGORITHM_VERSION,
    generatedAt: EVALUATION_AT.toISOString(), annotationSource: 'team-control' as const,
    labelMethod: 'Synthetic scenario expectations authored with AI assistance; no independent human annotation',
    split: '4 development / 4 control-holdout', sampleSize: holdout.length, totalPairs: 120,
    metrics: { signal: { precisionAt5: mean('signal', 'precisionAt5'), ndcgAt5: mean('signal', 'ndcgAt5') }, baseline: { precisionAt5: mean('baseline', 'precisionAt5'), ndcgAt5: mean('baseline', 'ndcgAt5') } },
    byQuery,
    comprehensive: runMatchingQuality(),
    limitations: [
      'Контрольные ожидания заданы при проектировании с помощью ИИ, а не независимыми экспертами.',
      'Набор специально проверяет различие подтверждённых навыков и ключевых слов; это не оценка точности реального найма.',
      'Восемь сценариев используют общие архетипы. Их нельзя считать 120 независимыми наблюдениями.',
      'Оба метода получают один и тот же допустимый пул. Равные баллы разрешаются по фиксированному ID.',
      'Порог релевантности для Precision@5 — 2 из 3; NDCG@5 использует gain = 2^relevance − 1.',
      'Для выводов о реальном качестве нужны слепая разметка двумя специалистами и пилот КАЛИБР.',
    ],
  };
}
