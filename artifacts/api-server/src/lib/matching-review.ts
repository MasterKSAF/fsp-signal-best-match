import { createHash } from 'node:crypto';
import { matchingDataset, matchingDatasetHash } from './matching-quality';

const pairId = (queryId: string, candidateId: number) => createHash('sha256').update(`${matchingDatasetHash()}:${queryId}:${candidateId}`).digest('hex').slice(0, 16);
export function matchingBlindPacket() {
  const dataset = matchingDataset();
  return { datasetSha256: matchingDatasetHash(), instructions: 'Два специалиста заполняют независимые копии. Не смотреть контрольные метки, ранжирование, код формулы и оценки второго специалиста. eligibility — обязательные условия; relevance от 0 до 3 по рубрике. В комментарии указать основание. Это синтетические профили, не реальные кандидаты.', rubric: dataset.rubric, reviewerId: '',
    ratings: dataset.queries.flatMap(query => dataset.candidates.filter(candidate => dataset.visible.includes(candidate.userId)).map(candidate => ({ pairId: pairId(query.id, candidate.userId), role: { description: query.purpose, ...query.need }, candidate: { specialization: candidate.specialization, verifiedGrade: candidate.verifiedGrade, verifiedSkills: candidate.verifiedSkills, statedSkills: candidate.statedSkills, stack: candidate.stack, workFormat: candidate.workFormat, salaryMin: candidate.salaryMin, salaryMax: candidate.salaryMax, salaryPeriod: candidate.salaryPeriod, salaryType: candidate.salaryType, evidenceDate: candidate.latestAssessmentAt, fspHistory: candidate.hasFspHistory }, eligible: null as boolean | null, relevance: null as number | null, comment: '' }))),
  };
}
export type MatchingReview = { datasetSha256: string; reviewerId: string; ratings: { pairId: string; eligible: boolean; relevance: number; comment: string }[] };
export function validateMatchingReview(value: unknown): MatchingReview {
  const input = value as Partial<MatchingReview> | null;
  if (!input || input.datasetSha256 !== matchingDatasetHash() || typeof input.reviewerId !== 'string' || !input.reviewerId.trim() || !Array.isArray(input.ratings)) throw new Error('Укажите reviewerId и неизменённый datasetSha256.');
  const expected = new Set(matchingBlindPacket().ratings.map(row => row.pairId));
  const seen = new Set<string>();
  for (const row of input.ratings) {
    if (!row || !expected.has(row.pairId) || seen.has(row.pairId) || typeof row.eligible !== 'boolean' || !Number.isInteger(row.relevance) || row.relevance < 0 || row.relevance > 3 || typeof row.comment !== 'string' || !row.comment.trim() || row.comment.length > 4000 || (!row.eligible && row.relevance !== 0)) throw new Error('Каждая пара нужна один раз: eligible, relevance 0..3 и комментарий. При недопуске relevance=0.');
    seen.add(row.pairId);
  }
  if (seen.size !== expected.size) throw new Error('Неполная разметка. Сохраните черновик; импорт требует полный набор.');
  return { datasetSha256: input.datasetSha256, reviewerId: input.reviewerId.trim(), ratings: input.ratings.map(row => ({ pairId: row.pairId, eligible: row.eligible, relevance: row.relevance, comment: row.comment })) };
}
export function compareMatchingReviews(first: MatchingReview, second: MatchingReview) {
  const a = validateMatchingReview(first), b = validateMatchingReview(second);
  if (a.reviewerId.toLocaleLowerCase() === b.reviewerId.toLocaleLowerCase()) throw new Error('Нужны два разных специалиста.');
  const rows = a.ratings.map(left => ({ pairId: left.pairId, first: left, second: b.ratings.find(right => right.pairId === left.pairId)! }));
  const disagreements = rows.filter(row => row.first.eligible !== row.second.eligible || row.first.relevance !== row.second.relevance);
  return { datasetSha256: matchingDatasetHash(), annotationSource: 'imported-reviewer-files', reviewerIds: [a.reviewerId, b.reviewerId], pairs: rows.length,
    eligibilityAgreement: rows.filter(row => row.first.eligible === row.second.eligible).length / rows.length,
    relevanceExactAgreement: rows.filter(row => row.first.relevance === row.second.relevance).length / rows.length,
    relevanceMeanAbsoluteDifference: rows.reduce((sum, row) => sum + Math.abs(row.first.relevance - row.second.relevance), 0) / rows.length,
    disagreements, adjudication: 'not_performed', provenanceNote: 'Импорт сохраняет заявленные авторами оценки. Личность и независимость специалистов требуют внешнего подтверждения; автоматический импорт этого не доказывает.' };
}
