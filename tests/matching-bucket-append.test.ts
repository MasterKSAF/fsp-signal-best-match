import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
// Historical v5 optimisation proof remains executable after the intentionally
// different v6 category policy. Its sealed source copy is never current policy.
import * as current from '../outputs/quality/0.6.0/fsp-category/history/signal-matching';
import * as frozen from '../outputs/verification/history/multi-resume-before-rank-append/artifacts/api-server/src/lib/signal-matching';

const frozenRoot = '../outputs/verification/history/multi-resume-before-rank-append/artifacts/api-server/src/lib/';
const sha = (relative: string) => createHash('sha256').update(readFileSync(new URL(relative, import.meta.url))).digest('hex');
const at = new Date('2026-10-06T12:00:00Z');
const need: current.MatchNeed = {
  specialization: 'Backend / Python', grade: 'Junior', requiredSkills: ['Python', 'SQL'],
  desirableSkills: ['Idempotency'], workFormat: 'Удалённо', salaryMin: 150000,
  salaryMax: 250000, salaryPeriod: 'month', salaryType: 'gross',
};

/** Pure synthetic ranking inputs; no DB, real candidate data or assessment claims. */
function people(mixed: boolean): current.MatchCandidate[] {
  return Array.from({ length: 5000 }, (_, index) => {
    const id = index + 1, unknown = mixed && id % 11 === 0;
    const grade = mixed ? (['Junior', 'Middle', 'Senior'] as const)[id % 3]! : 'Middle';
    const submittedAt = new Date(at.getTime() - (mixed && id % 5 === 0 ? 60 : 3) * 86400000);
    return {
      userId: id, alias: `${id % 2 ? 'A\u0301' : 'Á'} Engineer ${String(5000 - index).padStart(4, '0')}`,
      specialization: need.specialization, verifiedGrade: grade,
      verifiedScore: 83 + id % 18, verifiedSkills: ['Python', 'SQL', 'Idempotency'],
      stack: ['Python'], statedSkills: ['SQL'], workFormat: id % 7 === 0 && mixed ? 'Офис' : 'Удалённо',
      salaryMin: 170000, salaryMax: 220000, salaryPeriod: 'month', salaryType: 'gross',
      latestAssessmentAt: submittedAt, hasFspHistory: id % 3 === 0,
      visibility: 'pseudonymous', consentMatching: true, demoMode: false,
      assessmentEvidence: unknown ? null : {
        candidateId: id, attemptId: id, programId: 'backend-python',
        programVersion: mixed && id % 2 === 0 ? 'signal-backend-python-v5' : 'signal-backend-python-v6',
        grade, score: 83 + id % 18, submittedAt: submittedAt.toISOString(), state: 'verified',
        comparisonPolicy: 'same-program-version-rubric-v1', rubricKey: mixed ? `rubric-${id % 4}` : 'same-rubric',
      },
    };
  });
}

function comparePool(candidates: current.MatchCandidate[]) {
  const untouched = JSON.stringify(candidates);
  const beforeEntries = candidates.map(candidate => ({ candidate, evaluation: frozen.evaluateMatch(need, candidate, false, at) }));
  const afterEntries = candidates.map(candidate => ({ candidate, evaluation: current.evaluateMatch(need, candidate, false, at) }));
  assert.equal(beforeEntries.every(entry => entry.evaluation.eligible), true);
  assert.deepEqual(afterEntries, beforeEntries);
  const beforeStart = performance.now(), before = frozen.rankMatches(beforeEntries), beforeMs = performance.now() - beforeStart;
  const afterStart = performance.now(), after = current.rankMatches(afterEntries), afterMs = performance.now() - afterStart;
  assert.deepEqual(after, before);
  assert.equal(JSON.stringify(candidates), untouched, 'Candidate inputs are not mutated');
  assert.equal(beforeEntries.every(entry => entry.evaluation.ranking.position === null), true);
  assert.equal(afterEntries.every(entry => entry.evaluation.ranking.position === null), true);
  assert.equal(after.length, 5000);
  assert.equal(new Set(after.map(entry => entry.candidate.userId)).size, 5000);
  for (let index = 0; index < after.length; index++) {
    const entry = after[index]!;
    assert.equal(entry.evaluation.ranking.position, index + 1);
    assert.equal(entry.evaluation.ranking.poolSize, 5000);
    if (index) {
      assert.equal(current.compareRankedMatches(after[index - 1]!, entry), -1);
      assert.equal(frozen.compareRankedMatches(before[index - 1]!, before[index]!), -1);
    }
  }
  return { beforeMs: Number(beforeMs.toFixed(2)), afterMs: Number(afterMs.toFixed(2)), ids: after.map(entry => entry.candidate.userId) };
}

test('baseline source and dependency were preserved before changing bucket construction', () => {
  assert.equal(sha(`${frozenRoot}signal-matching.ts`), '5132063b3585b3e3c7a3cc98644287288058994c1e9b6b12a29ae016ab9bde44');
  assert.equal(sha(`${frozenRoot}skill-catalog.ts`), '3ef0c5ba605a0c7852fff4614c43c2d3aa2e79cb43e70dbd75f29ac3485a138f');
  assert.equal(current.MATCH_ALGORITHM_VERSION, frozen.MATCH_ALGORITHM_VERSION);
});

test('5000 people in one comparable group retain every evaluation, position and stable order', t => {
  const candidates = people(false), forward = comparePool(candidates);
  const reverse = comparePool([...candidates].reverse());
  assert.deepEqual(reverse.ids, forward.ids);
  t.diagnostic(JSON.stringify({ fixture: 'one-group-5000', forward, reverse: { beforeMs: reverse.beforeMs, afterMs: reverse.afterMs }, heapUsedBytes: process.memoryUsage().heapUsed, timingIsDiagnosticOnly: true }, (key, value) => key === 'ids' ? undefined : value));
});

test('5000 mixed grades, rubrics, versions, missing proof and fit tiers retain complete order', t => {
  const candidates = people(true), forward = comparePool(candidates);
  const rotated = comparePool([...candidates.slice(173), ...candidates.slice(0, 173)]);
  assert.deepEqual(rotated.ids, forward.ids);
  t.diagnostic(JSON.stringify({ fixture: 'mixed-groups-5000', forward, rotated: { beforeMs: rotated.beforeMs, afterMs: rotated.afterMs }, heapUsedBytes: process.memoryUsage().heapUsed, timingIsDiagnosticOnly: true }, (key, value) => key === 'ids' ? undefined : value));
});
