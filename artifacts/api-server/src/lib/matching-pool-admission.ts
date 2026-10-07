import { canonicalSkillKey, canonicalSkillLabels } from './skill-catalog';
import { evaluateMatch, gradeRank, type MatchCandidate, type MatchNeed } from './signal-matching';

/** Compile only the initial admission gate for raw profile rows.
 * Final evaluation after loading linked/corrected proof remains authoritative.
 */
export function preparePoolAdmission(need: MatchNeed, poolDemoMode: boolean): (candidate: MatchCandidate) => boolean {
  const requiredKeys = canonicalSkillLabels(need.requiredSkills).map(canonicalSkillKey);
  return candidate => {
    // The database profile projection has no proof. Preserve full semantics if
    // this helper is ever given an enriched candidate by another caller.
    if (candidate.assessmentEvidence) return evaluateMatch(need, candidate, poolDemoMode).eligible;
    if (candidate.demoMode !== poolDemoMode || !candidate.consentMatching || candidate.visibility === 'private' ||
        candidate.specialization !== need.specialization || !candidate.verifiedGrade ||
        gradeRank[candidate.verifiedGrade] < gradeRank[need.grade]) return false;
    const verified = new Set(candidate.verifiedSkills.map(canonicalSkillKey));
    return requiredKeys.every(key => verified.has(key));
  };
}
