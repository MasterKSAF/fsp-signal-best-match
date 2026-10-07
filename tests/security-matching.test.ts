import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateMatch,
  isMatchEligible,
  type MatchCandidate,
  type MatchNeed,
} from "../artifacts/api-server/src/lib/signal-matching.ts";

const now = new Date("2026-10-05T10:00:00.000Z");
const need: MatchNeed = {
  specialization: "Backend / Python",
  grade: "Middle",
  requiredSkills: ["Python", "PostgreSQL"],
  desirableSkills: ["FastAPI"],
  workFormat: "Удалённо или гибрид",
  salaryMin: 200_000,
  salaryMax: 300_000,
};

function candidate(overrides: Partial<MatchCandidate> = {}): MatchCandidate {
  return {
    userId: 1,
    alias: "Synthetic candidate",
    specialization: "Backend / Python",
    verifiedGrade: "Middle",
    verifiedScore: 90,
    verifiedSkills: ["Python", "PostgreSQL", "FastAPI"],
    stack: ["Python", "FastAPI"],
    statedSkills: ["Python", "PostgreSQL", "FastAPI"],
    workFormat: "Удалённо",
    salaryMin: 210_000,
    salaryMax: 260_000,
    latestAssessmentAt: now,
    hasFspHistory: false,
    visibility: "pseudonymous",
    consentMatching: true,
    demoMode: false,
    ...overrides,
  };
}

test("matching keeps a no-FSP candidate eligible and separates only the bounded bonus", () => {
  const withoutFsp = evaluateMatch(need, candidate(), false, now);
  const withFsp = evaluateMatch(need, candidate({ hasFspHistory: true }), false, now);

  assert.equal(withoutFsp.eligible, true);
  assert.equal(withFsp.eligible, true);
  assert.equal(withoutFsp.baseScore, withFsp.baseScore);
  assert.equal(withoutFsp.fspBonus, 0);
  assert.equal(withFsp.fspBonus, 0, 'Legacy boolean alone has no trusted sporting outcome');
  assert.equal(withFsp.rankingScore, withoutFsp.rankingScore);
  assert.equal(withFsp.factors.reduce((sum, factor) => sum + factor.weight, 0), 1);
});

test("the shared eligibility gate blocks the same missing requirements for every caller", () => {
  const missingRequiredSkill = candidate({ verifiedSkills: ["Python"] });
  const privateProfile = candidate({ visibility: "private" });
  const wrongPool = candidate({ demoMode: true });

  assert.equal(evaluateMatch(need, missingRequiredSkill, false, now).eligible, false);
  assert.equal(isMatchEligible(need, missingRequiredSkill, false), false);
  assert.equal(evaluateMatch(need, privateProfile, false, now).eligible, false);
  assert.equal(evaluateMatch(need, wrongPool, false, now).eligible, false);
});

test("salary compatibility normalizes periods but never guesses a gross/net conversion", () => {
  const annualNeed: MatchNeed = {
    ...need,
    salaryMin: 2_400_000,
    salaryMax: 3_600_000,
    salaryPeriod: "year",
    salaryType: "gross",
  };
  const monthlyCandidate = candidate({
    salaryMin: 220_000,
    salaryMax: 260_000,
    salaryPeriod: "month",
    salaryType: "gross",
  });
  const netCandidate = candidate({
    ...monthlyCandidate,
    salaryType: "net",
  });

  assert.equal(
    evaluateMatch(annualNeed, monthlyCandidate, false, now).salaryCompatibility,
    "compatible",
  );
  assert.equal(
    evaluateMatch(annualNeed, netCandidate, false, now).salaryCompatibility,
    "unknown",
  );
});
