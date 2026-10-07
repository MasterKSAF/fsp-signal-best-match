import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateMatch } from '../artifacts/api-server/src/lib/signal-matching';
import { canonicalSkillKey, resolveSkill, skillCoverage, skillSearchAliases } from '../artifacts/api-server/src/lib/skill-catalog';
import { MATCH_CONTROL_CANDIDATES, MATCH_CONTROL_QUERIES, MATCH_CONTROL_AT } from '../artifacts/api-server/src/lib/matching-control-fixtures';
import { runMatchingQuality } from '../artifacts/api-server/src/lib/matching-quality';
import { matchingBlindPacket, validateMatchingReview, compareMatchingReviews } from '../artifacts/api-server/src/lib/matching-review';

test('controlled synonyms agree before eligibility, scoring and explanation without overwriting raw input', () => {
  const original = MATCH_CONTROL_CANDIDATES[1];
  const firstNeed = MATCH_CONTROL_QUERIES[1].need;
  const equivalentNeed = { ...firstNeed, requiredSkills: [' Python ', 'POSTGRESQL'] };
  const candidate = { ...original, verifiedSkills: ['PYTHON', 'PostgreSQL', 'SQL', 'Architecture'] };
  const before = JSON.stringify([firstNeed, original]);
  assert.deepEqual(evaluateMatch(firstNeed, original, true, MATCH_CONTROL_AT), evaluateMatch(equivalentNeed, candidate, true, MATCH_CONTROL_AT));
  assert.equal(JSON.stringify([firstNeed, original]), before);
  assert.equal(resolveSkill(' Postgres ').raw, ' Postgres ');
  assert.deepEqual(skillSearchAliases('Postgres'), skillSearchAliases('postgresql'));
  assert.notEqual(canonicalSkillKey('SQL'), canonicalSkillKey('PostgreSQL'));
  assert.notEqual(canonicalSkillKey('Python'), canonicalSkillKey('FastAPI'));
  assert.equal(resolveSkill('Q-Store').id, null);
  assert.notEqual(canonicalSkillKey('Q-Store'), canonicalSkillKey('QStore'));
});
test('coverage does not certify unknown skills or frameworks from a general language programme', () => {
  const coverage = skillCoverage(['Python', 'SQL', 'Postgres', 'FastAPI', 'Q-Store'], 'Backend / Python');
  assert.deepEqual(coverage.map(row => row.supported), [true, true, false, false, false]);
  assert.equal(coverage[4].raw, 'Q-Store');
  const need = { ...MATCH_CONTROL_QUERIES[0].need, requiredSkills: ['FastAPI'] };
  assert.equal(evaluateMatch(need, MATCH_CONTROL_CANDIDATES[0], true).eligible, false);
});
test('real evidence is never labeled Demo; unknown historical links remain absent', () => {
  const real = { ...MATCH_CONTROL_CANDIDATES[0], demoMode: false };
  const result = evaluateMatch(MATCH_CONTROL_QUERIES[0].need, real, false, MATCH_CONTROL_AT);
  assert.ok(result.evidence.every(item => !item.source.includes('Demo') && !item.source.includes('демонстрац')));
  assert.ok(result.evidence.every(item => item.provenance === null));
  const proof = { skill: 'Python', candidateId: real.userId, attemptId: 73, programId: 'backend-python', programVersion: 'v5', templateId: null, templateVersion: null, criterionId: 'programme-decision', criterion: 'Успешная программа', result: 83, date: real.latestAssessmentAt!.toISOString(), sourceType: 'signal_assessment' as const, limitation: null };
  const enriched = evaluateMatch(MATCH_CONTROL_QUERIES[0].need, { ...real, skillEvidence: [proof] }, false, MATCH_CONTROL_AT);
  assert.equal(enriched.evidence[0].source, 'Проверка навыков Signal');
  assert.equal(enriched.evidence[0].provenance?.attemptId, 73);
});
test('unlinked historical profile scores do not invent comparable attempt quality', () => {
  const candidate = MATCH_CONTROL_CANDIDATES[0], need = MATCH_CONTROL_QUERIES[0].need;
  assert.equal(evaluateMatch(need, { ...candidate, verifiedScore: 83 }, true, MATCH_CONTROL_AT).baseScore, evaluateMatch(need, { ...candidate, verifiedScore: 100 }, true, MATCH_CONTROL_AT).baseScore);
  assert.equal(evaluateMatch(need, { ...candidate, verifiedGrade: 'Junior', verifiedScore: 100 }, true).eligible, false);
});
test('independent eligibility controls privacy, required skills, grade boundaries and empty results', () => {
  const report = runMatchingQuality();
  assert.equal(report.summary.pairs, 144);
  assert.deepEqual(report.summary.falseExclusions, []);
  assert.deepEqual(report.summary.falseAdmissions, []);
  assert.deepEqual(report.summary.privacyViolations, []);
  assert.equal(report.byQuery.filter(row => row.endToEnd.expectedEmpty).length, 2);
  assert.ok(report.byQuery.every(row => !row.endToEnd.unexpectedEmpty));
  assert.equal(report.humanReview.agreement, null);
  assert.deepEqual(report, runMatchingQuality());
});
test('alias regression is detected before ranking, even when survivors rank perfectly', () => {
  const broken = runMatchingQuality((need, candidate, demo, now) => {
    const result = evaluateMatch(need, candidate, demo, now);
    return { ...result, eligible: result.eligible && need.requiredSkills.every(skill => candidate.verifiedSkills.includes(skill)) };
  });
  assert.ok(broken.summary.falseExclusions.includes('postgres-legacy/2'));
  assert.ok(broken.summary.falseExclusions.includes('api-synonyms/1'));
  assert.ok(broken.byQuery.find(row => row.queryId === 'api-synonyms')!.endToEnd.unexpectedEmpty);
});
test('blind packets omit algorithm scores and labels; importer preserves disagreement and rejects duplicates', () => {
  const packet = matchingBlindPacket();
  assert.ok(packet.ratings.length > 0);
  assert.ok(packet.ratings.every(row => row.eligible === null && row.relevance === null));
  assert.equal(/rankingScore|expectedEligible|signalRanking|verifiedScore/.test(JSON.stringify(packet)), false);
  assert.throws(() => validateMatchingReview(packet));
  const a = { ...packet, reviewerId: 'expert-a', ratings: packet.ratings.map(row => ({ pairId: row.pairId, eligible: true, relevance: 2, comment: 'Synthetic tooling test only' })) };
  const b = { ...a, reviewerId: 'expert-b', ratings: a.ratings.map((row, i) => i ? row : { ...row, relevance: 3 }) };
  assert.equal(compareMatchingReviews(a, b).disagreements.length, 1);
  assert.throws(() => compareMatchingReviews(a, a));
  assert.throws(() => validateMatchingReview({ ...a, ratings: [...a.ratings.slice(1), a.ratings[1]] }));
  assert.throws(() => validateMatchingReview({ ...a, datasetSha256: 'changed' }));
});
