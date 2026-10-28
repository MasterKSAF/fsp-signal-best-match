import type { SkillAttemptProvenance, SkillModuleCase, SkillModuleOracle } from '@workspace/db';
import { bankContentHash } from './skill-bank-manifest';
import { scoreSkillAttempt } from './skill-module-bank';

/** Replay the saved procedure, never regenerate with today's bank or silently regrade a user. */
export function replaySkillSnapshot(attempt: { cases: SkillModuleCase[]; oracles: SkillModuleOracle; answers: Record<string, string>; policy: { threshold: number; rubricVersion: string }; provenance?: SkillAttemptProvenance | null }) {
  if (attempt.provenance && bankContentHash({ cases: attempt.cases, oracles: attempt.oracles, policy: attempt.policy }) !== attempt.provenance.variantHash) throw new Error('Saved assessment snapshot failed its integrity check');
  return { provenanceStatus: attempt.provenance ? 'complete' : 'legacy_snapshot', decision: scoreSkillAttempt(attempt.cases, attempt.oracles, attempt.answers, attempt.policy) };
}
