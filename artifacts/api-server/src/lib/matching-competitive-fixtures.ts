import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { MatchCandidate, MatchNeed } from './signal-matching';

export type FrozenAssessmentRecord = {
  attemptId: number; candidateId: number; programId: 'backend-python' | 'frontend-typescript';
  programVersion: string; grade: 'Junior' | 'Middle' | 'Senior'; score: number;
  submittedAt: string; state: 'verified' | 'revoked'; comparisonPolicy: 'same-program-version-rubric-v1';
  rubricKey: string; form: string; origin: string;
};
type FrozenProfile = Omit<MatchCandidate, 'latestAssessmentAt' | 'skillEvidence' | 'assessmentEvidence'> & { latestAssessmentAt: string | null };
export type CompetitiveQuery = {
  id: string; split: 'development' | 'control-holdout'; kind: 'competitive' | 'short' | 'empty';
  purpose: string; need: MatchNeed; populationIds: number[]; expectedEligibleIds: number[];
  privacyPermittedIds: number[]; relevanceLabels: Record<string, number>; labelReasons: Record<string, string>;
};
export type CompetitiveDataset = {
  version: string; evaluatedAt: string; rubric: Record<string, unknown>;
  candidates: Array<{ profile: FrozenProfile; assessment: FrozenAssessmentRecord | null; annotation: string }>;
  queries: CompetitiveQuery[];
};
export const COMPETITIVE_FROZEN_SHA256 = '9f26e447b5c268dbbd7c26f0aeddc90b61ced2c7a14785427d5139e73c9111d7';
const dataUrl = new URL('./matching-competitive-data.json', import.meta.url);

/** Labels are read as explicit frozen judgements; never computed by a matcher. */
export function competitiveDataset(): CompetitiveDataset {
  const raw = readFileSync(dataUrl);
  const actual = createHash('sha256').update(raw).digest('hex');
  if (actual !== COMPETITIVE_FROZEN_SHA256) throw new Error(`Frozen competitive data modified: ${actual}`);
  return JSON.parse(raw.toString('utf8')) as CompetitiveDataset;
}

/** Date/provenance wire adapter. It does not alter relevance or observed score. */
export function competitiveCandidates(dataset = competitiveDataset()): MatchCandidate[] {
  return dataset.candidates.map(({ profile, assessment }) => ({
    ...profile,
    latestAssessmentAt: profile.latestAssessmentAt ? new Date(profile.latestAssessmentAt) : null,
    ...(assessment ? {
      assessmentEvidence: {
        attemptId: assessment.attemptId, candidateId: assessment.candidateId,
        programId: assessment.programId, programVersion: assessment.programVersion,
        grade: assessment.grade, score: assessment.score, submittedAt: assessment.submittedAt,
        state: assessment.state, comparisonPolicy: assessment.comparisonPolicy, rubricKey: assessment.rubricKey,
      },
      skillEvidence: profile.verifiedSkills.map(skill => ({
        skill, candidateId: profile.userId, attemptId: assessment.attemptId, programId: assessment.programId,
        programVersion: assessment.programVersion, templateId: `synthetic-form-${assessment.form}`,
        templateVersion: 1, criterionId: `synthetic-explicit-${skill}`, criterion: 'Synthetic authored criterion evidence',
        result: assessment.score, date: assessment.submittedAt, sourceType: 'demo_example' as const,
        limitation: 'Frozen synthetic record; not an observed person or a calibrated cross-form difficulty measure',
      })),
    } : {}),
  }));
}
