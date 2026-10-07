import type { ResearchResult, ResearchResponse } from '@workspace/db';
export const RESEARCH_PROTOCOL_VERSION = 'signal-research-v1';
export const RESEARCH_CONSENT_VERSION = 'research-consent-v1';
export type ResearchMeasurement = { pseudonym: string; independentGrade: string | null; form: 'A' | 'B'; programVersion: string; result: ResearchResult | null; responses: ResearchResponse[]; startedAt: Date; submittedAt: Date | null; status: string };
export type ResearchExpert = { reviewerId: string; ratings: { pseudonym: string; grade: string; comment: string }[] };
const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
/** Machine-like answers only in a shareable export; arbitrary free text stays private. */
export function exportResearchAnswer(answer: string, options: string[] = []) {
  if (options.length) return { choiceIndex: options.indexOf(answer) >= 0 ? options.indexOf(answer) : null, indexBase: 0, redacted: options.indexOf(answer) < 0 && answer.length > 0 };
  const tokens = answer.trim().toLowerCase().split(/[|,:;\s]+/).filter(Boolean);
  const allowed = new Set(['true', 'false', 'null', 'none', 'undefined', 'ok', 'old', 'gap', 'pending', 'ready', 'loading', 'error', 'success', 'stale', 'new', 'retry', 'skip']);
  // Restrict magnitude/length so a phone number or other long numeric identifier
  // is not treated as a harmless numeric solution. Raw answers have a private export.
  const safe = tokens.length <= 30 && tokens.every(token => /^-?\d{1,6}(\.\d{1,3})?$/.test(token) || allowed.has(token));
  return { tokens: safe ? tokens : null, redacted: !safe };
}
export function researchReport(rows: ResearchMeasurement[], grade: string, experts: ResearchExpert[] = [], origin = 'synthetic') {
  const completed = rows.filter(row => row.status === 'submitted' && row.result && row.submittedAt);
  const paired = [...new Set(completed.map(row => row.pseudonym))].flatMap(pseudonym => {
    const a = completed.find(row => row.pseudonym === pseudonym && row.form === 'A'), b = completed.find(row => row.pseudonym === pseudonym && row.form === 'B');
    return a && b ? [{ pseudonym, a, b }] : [];
  });
  const transitions: Record<string, number> = {};
  paired.forEach(pair => { const key = `${pair.a.result!.verified ? grade : 'not_confirmed'}→${pair.b.result!.verified ? grade : 'not_confirmed'}`; transitions[key] = (transitions[key] ?? 0) + 1; });
  // Some criteria emit several skill evidences. Count an item once per attempt,
  // rather than turning a Python+API criterion into two independent observations.
  const observations = completed.flatMap(row => [...new Map(row.result!.evidence.map(item => [`${item.templateId ?? item.criterionId}`, item])).values()].map(item => ({ ...item, group: row.independentGrade ?? 'unknown' })));
  const itemKeys = [...new Set(observations.map(item => `${item.templateId ?? item.criterionId}|${item.group}`))];
  const items = itemKeys.map(key => {
    const [templateId, group] = key.split('|');
    const sample = observations.filter(item => item.group === group && (item.templateId ?? item.criterionId) === templateId);
    return { templateId, independentGroup: group, n: sample.length, meanCredit: mean(sample.map(item => item.score / 100)), fullSuccessRate: mean(sample.map(item => Number(item.score === 100))) };
  });
  const gradeRank: Record<string, number> = { Junior: 1, Middle: 2, Senior: 3 };
  const groupDifferences = [...new Set(items.map(item => item.templateId))].flatMap(templateId => {
    const groups = items.filter(item => item.templateId === templateId && gradeRank[item.independentGroup]).sort((a, b) => gradeRank[a.independentGroup]! - gradeRank[b.independentGroup]!);
    return groups.flatMap((lower, index) => groups.slice(index + 1).map(higher => ({ templateId, lowerGroup: lower.independentGroup, higherGroup: higher.independentGroup, lowerN: lower.n, higherN: higher.n, meanCreditHigherMinusLower: higher.meanCredit! - lower.meanCredit!, fullSuccessHigherMinusLower: higher.fullSuccessRate! - lower.fullSuccessRate!, inference: 'Descriptive difference only; no significance or causal claim.' })));
  });
  const referenceComparisons = completed.filter(row => row.independentGrade).map(row => Number(row.result!.verified === (gradeRank[row.independentGrade!] >= gradeRank[grade])));
  const disagreements = experts.length === 2 ? experts[0].ratings.flatMap(left => { const right = experts[1].ratings.find(value => value.pseudonym === left.pseudonym); return right && right.grade !== left.grade ? [{ pseudonym: left.pseudonym, first: left, second: right }] : []; }) : [];
  const expertComparisons = experts.map(expert => ({ reviewerId: expert.reviewerId, comparedAttempts: completed.filter(row => expert.ratings.some(item => item.pseudonym === row.pseudonym)).length, thresholdAgreement: mean(completed.flatMap(row => { const rating = expert.ratings.find(item => item.pseudonym === row.pseudonym); return rating ? [Number(row.result!.verified === (gradeRank[rating.grade] >= gradeRank[grade]))] : []; })) }));
  const responses = completed.flatMap(row => row.responses);
  return { protocolVersion: RESEARCH_PROTOCOL_VERSION, measurementOrigin: origin, status: completed.length ? 'measured' : 'not_measured', humanValidation: origin === 'operator_declared_human' && completed.length ? 'operator_declared_requires_external_protocol' : 'not_measured',
    counts: { attempts: rows.length, completed: completed.length, expired: rows.filter(row => row.status === 'expired').length, participants: new Set(rows.map(row => row.pseudonym)).size, paired: paired.length },
    agreementAB: mean(paired.map(pair => Number(pair.a.result!.verified === pair.b.result!.verified))), transitions,
    scoreChangeBMinusA: mean(paired.map(pair => pair.b.result!.score - pair.a.result!.score)),
    independentReference: { n: referenceComparisons.length, thresholdAgreement: mean(referenceComparisons) }, items, groupDifferences,
    groupCounts: Object.fromEntries(['Junior', 'Middle', 'Senior', 'unknown'].map(group => [group, { participants: new Set(rows.filter(row => (row.independentGrade ?? 'unknown') === group).map(row => row.pseudonym)).size, completedAttempts: completed.filter(row => (row.independentGrade ?? 'unknown') === group).length }])),
    timing: { serverElapsedMs: mean(completed.map(row => row.submittedAt!.getTime() - row.startedAt.getTime())), clientReportedActiveMs: mean(completed.map(row => row.responses.reduce((sum, item) => sum + item.activeMs, 0))), serverSource: 'Elapsed server timestamps include pauses and network time', clientSource: 'Opt-in browser counter only while visible and focused; self-reported, editable, not surveillance or trusted anti-cheat' },
    skipped: responses.filter(row => row.skipped || !row.answer.trim()).length, ambiguous: responses.filter(row => row.ambiguous).length,
    expertReview: { status: experts.length === 2 ? 'two_imported_files' : 'not_measured', reviewers: experts.length, exactAgreement: experts.length === 2 ? mean(experts[0].ratings.flatMap(left => { const right = experts[1].ratings.find(value => value.pseudonym === left.pseudonym); return right ? [Number(left.grade === right.grade)] : []; })) : null, disagreements, byReviewer: expertComparisons },
    limitations: ['A/B decisions refer to these attempts, never the maximum grade stored in a work profile.', 'AB/BA ordering limits but does not remove learning and fatigue effects; solving a studied method correctly is not automatically cheating.', 'Independent group is frozen before the first attempt. Its human provenance requires a separate signed study protocol.', 'Small samples and different populations do not establish market grade validity, psychometric equivalence, IRT parameters, or protection from external assistance.', 'No participants or missing paired/expert data produce null, not zero or perfect rates.'],
  };
}

/** Aggregate-only derivative for reports: never carries pseudonyms, comments,
 * reviewer IDs, account mappings, individual answers or per-person decisions. */
export function aggregateResearchReport(report: ReturnType<typeof researchReport>) {
  const { expertReview, ...aggregate } = report;
  return { ...aggregate, expertReview: { status: expertReview.status, reviewers: expertReview.reviewers, exactAgreement: expertReview.exactAgreement, disagreementCount: expertReview.disagreements.length, byReviewer: expertReview.byReviewer.map(({ reviewerId: _reviewerId, ...metric }, index) => ({ reviewer: index + 1, ...metric })) }, disclosure: 'Aggregate technical report only. Small groups can still be identifying when combined with external knowledge; review before external publication.' };
}
