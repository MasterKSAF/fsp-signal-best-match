import type { MatchEvaluation } from './signal-matching';

/** Bookmarks remain useful even when requirements do not match. A saved ID is
 * never evidence of eligibility or a grant of access. */
export function shortlistReview(savedVersion:number,currentVersion:number,evaluation:MatchEvaluation|null) {
  return {needsReview:savedVersion!==currentVersion||!evaluation||!evaluation.eligible,
    match:evaluation?{eligible:evaluation.eligible,score:evaluation.rankingScore,ineligibilityReasons:evaluation.ineligibilityReasons,gaps:evaluation.gaps,evidence:evaluation.evidence}:null};
}
