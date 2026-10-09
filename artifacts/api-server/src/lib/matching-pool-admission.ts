import { evaluateMatch, type MatchCandidate, type MatchNeed } from './signal-matching';
import { hasMeaningfulRequiredSkills } from './employer-required-skills';
import { evaluateGradeRequirement, evaluateSkillRequirement, interpretSkillRequirements } from './recruiting-requirements';

/** Compile only the initial admission gate for raw profile rows.
 * Final evaluation after loading linked/corrected proof remains authoritative.
 */
export function preparePoolAdmission(need: MatchNeed, poolDemoMode: boolean): (candidate: MatchCandidate) => boolean {
  // Validate original items/count/length BEFORE canonical deduplication, once
  // for this request. Invalid historical needs cannot silently become empty.
  if (!hasMeaningfulRequiredSkills(need.requiredSkills)) return () => false;
  const requirements = interpretSkillRequirements(need.requiredSkills,need.skillRequirements,need.requiredSkillLevels);
  return candidate => {
    // The database profile projection has no proof. Preserve full semantics if
    // this helper is ever given an enriched candidate by another caller.
    if (candidate.assessmentEvidence || candidate.skillEvidence) return evaluateMatch(need, candidate, poolDemoMode).eligible;
    if (candidate.demoMode !== poolDemoMode || !candidate.consentMatching || candidate.visibility === 'private' ||
        candidate.specialization !== need.specialization || !evaluateGradeRequirement(need.grade,need.gradeMode,candidate).satisfied) return false;
    return requirements.every(item => evaluateSkillRequirement(item,candidate,{preliminary:true}).covered);
  };
}
