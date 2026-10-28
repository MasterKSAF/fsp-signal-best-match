import { createHash } from 'node:crypto';
import { canonicalJson } from './canonical-json';
import type { MatchCandidate } from './signal-matching';
import {canonicalSkillKey} from './skill-catalog';

export type LedgerInput = { factorId: string; name: string; reason: string; score: number | null; weight: number; scope: 'shared_fit' | 'within_comparable_group'; evidenceRefs?: readonly string[]; rawUnit?: string };
export type LedgerVersions = { algorithm: string; contextRevision: number | string | null; resumeId: number | null; resumeRevision: number | null; evidenceFingerprint: string };
export function matchingEvidenceFingerprint(values: readonly { evidenceId?: number; attemptId: number | null; date: string | null; level?: string; skill: string }[]) {
  return createHash('sha256').update(JSON.stringify(values.map(v => [v.skill, v.evidenceId ?? null, v.attemptId, v.date, v.level ?? null]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), 'en')))).digest('hex');
}
export function candidateQualificationFingerprint(candidate: Pick<MatchCandidate,'skillEvidence'|'verifiedSkills'|'verifiedGrade'|'verifiedScore'|'latestAssessmentAt'|'assessmentEvidence'>) {
  const proofs=(candidate.skillEvidence??[]).map(v=>({skill:canonicalSkillKey(v.skill),id:v.evidenceId??null,attemptId:v.attemptId,source:v.sourceType,program:v.programVersion,criterion:v.criterionId,result:v.result,date:v.date,level:v.level??null})).sort((a,b)=>canonicalJson(a).localeCompare(canonicalJson(b),'en'));
  const at=candidate.latestAssessmentAt&&Number.isFinite(+candidate.latestAssessmentAt)?candidate.latestAssessmentAt.toISOString():null;
  return createHash('sha256').update(canonicalJson({proofs,verifiedSkills:[...new Set(candidate.verifiedSkills.map(canonicalSkillKey))].sort(),grade:candidate.verifiedGrade,score:candidate.verifiedScore,at,assessment:candidate.assessmentEvidence??null})).digest('hex');
}
/** The ledger explains the existing policy; it neither grants eligibility nor creates evidence. */
export function buildMatchingFactorLedger(inputs: readonly LedgerInput[], versions: LedgerVersions) {
  const known = inputs.filter(f => f.scope === 'shared_fit' && f.score !== null && Number.isFinite(f.score) && f.weight > 0);
  const knownWeight = known.reduce((sum, f) => sum + f.weight, 0);
  const factors = inputs.map(f => {
    const usable = f.score !== null && Number.isFinite(f.score);
    const effectiveWeight = usable && f.scope === 'shared_fit' && knownWeight > 0 ? f.weight / knownWeight : 0;
    return { ...f, state: !usable ? 'unknown' as const : f.scope === 'within_comparable_group' ? 'not_applicable' as const : 'known' as const,
      normalizedValue: usable ? f.score : null, rawUnit: f.rawUnit ?? 'fraction', baseWeight: f.weight, effectiveWeight,
      contribution: usable ? f.score! * effectiveWeight * 100 : 0, evidenceRefs: [...f.evidenceRefs ?? []], versions };
  });
  const exactScore = knownWeight > 0 ? Number(factors.reduce((sum, f) => sum + f.contribution, 0).toFixed(10)) : null;
  return { factors, exactScore, state: exactScore === null ? 'insufficient_data' as const : 'calculated' as const,
    rounding: { policy: 'sum-exact-then-round-v1', internalDecimals: 10, displayDecimals: 0, factorDisplayDecimals: 1 },
    tieBreakPolicy: 'need-fit-proof-category-queues-v3', fspIncluded: false as const };
}
