import {
  evaluateMatch,
  type MatchCandidate,
  type MatchNeed,
  type MatchEvaluation,
} from "./signal-matching";

const scalarFields = [
  "userId",
  "alias",
  "specialization",
  "verifiedGrade",
  "verifiedScore",
  "workFormat",
  "salaryMin",
  "salaryMax",
  "salaryPeriod",
  "salaryType",
  "hasFspHistory",
  "visibility",
  "consentMatching",
  "demoMode",
] as const;
const listFields = ["verifiedSkills", "stack", "statedSkills"] as const;
function sameFacts(left: MatchCandidate, right: MatchCandidate): boolean {
  if (
    !scalarFields.every((field) => left[field] === right[field]) ||
    left.latestAssessmentAt?.getTime() !== right.latestAssessmentAt?.getTime()
  )
    return false;
  if (
    !listFields.every(
      (field) =>
        left[field].length === right[field].length &&
        left[field].every((value, index) => value === right[field][index]),
    )
  )
    return false;
  return (
    (left.fspSignal === right.fspSignal ||
      JSON.stringify(left.fspSignal ?? null) === JSON.stringify(right.fspSignal ?? null)) &&
    (left.assessmentEvidence === right.assessmentEvidence ||
      JSON.stringify(left.assessmentEvidence ?? null) ===
        JSON.stringify(right.assessmentEvidence ?? null)) &&
    (left.categoryEvidence === right.categoryEvidence ||
      JSON.stringify(left.categoryEvidence ?? null) ===
        JSON.stringify(right.categoryEvidence ?? null)) &&
    (left.skillEvidence === right.skillEvidence ||
      JSON.stringify(left.skillEvidence ?? null) ===
        JSON.stringify(right.skillEvidence ?? null))
  );
}
/** Request-local only. Identical whole matching facts of the SAME person may
 * share pure calculation; each distinct résumé/qualification remains separate.
 * No permission/profile/grade is cached across requests or across people. */
export function evaluateResumeCandidates<T extends MatchCandidate>(
  need: MatchNeed,
  candidates: T[],
  demoMode: boolean,
  now: Date,
) {
  const personFacts = new Map<
    number,
    { candidate: T; evaluation: MatchEvaluation }[]
  >();
  return candidates.map((candidate) => {
    const variants = personFacts.get(candidate.userId) ?? [];
    const identical = variants.find((row) =>
      sameFacts(row.candidate, candidate),
    );
    // Reuse the existing pure calculation, then bind explanation provenance to
    // this exact CV. A shared object must never retain another CV's revision.
    const base=identical?.evaluation;
    const ledger=base?.factorLedger;
    const factorLedger=ledger?{...ledger,factors:ledger.factors.map(f=>({...f,versions:{...f.versions,resumeId:candidate.resumeId??null,resumeRevision:candidate.resumeRevision??null}}))}:undefined;
    const evaluation = base ? {...base,...(factorLedger?{factorLedger,factors:factorLedger.factors}:{})} : evaluateMatch(need, candidate, demoMode, now);
    if (!identical) {
      variants.push({ candidate, evaluation });
      personFacts.set(candidate.userId, variants);
    }
    return { candidate, evaluation };
  });
}
