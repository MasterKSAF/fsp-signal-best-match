import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateMatch, rankMatches, type MatchNeed } from '../artifacts/api-server/src/lib/signal-matching';
import { compareResumeFacts } from '../artifacts/api-server/src/lib/signal-resume-comparison';
import type { CatalogResume } from '../artifacts/api-server/src/lib/signal-resume-catalog';

const now = new Date('2026-10-08T00:00:00Z');
const need: MatchNeed = {
  specialization: 'Backend / Python', grade: 'Junior', requiredSkills: ['Python'], desirableSkills: [],
  workFormat: 'Удалённо', salaryMin: 100, salaryMax: 200, salaryPeriod: 'month', salaryType: 'gross',
};
function resume(userId: number, alias: string): CatalogResume {
  return {
    userId, alias, resumeId: userId, resumeRevision: 1, title: 'Backend-разработчик',
    specialization: need.specialization, assumedGrade: 'Junior', verifiedGrade: 'Junior', verifiedScore: null,
    verifiedSkills: ['Python'], stack: ['Python'], statedSkills: ['Python'], yearsExperience: 2,
    workFormat: need.workFormat, salaryMin: 100, salaryMax: 200, salaryPeriod: 'month', salaryType: 'gross',
    latestAssessmentAt: now, hasFspHistory: false, visibility: 'pseudonymous', consentMatching: true,
    consentCatalog: true, readyForOffers: true, demoMode: false, avatarDataUrl: null, publicName: null,
    deletedAt: null, legacyQualification: null, assessmentEvidence: null,
  };
}
function modular(userId: number, alias: string): CatalogResume {
  return { ...resume(userId, alias), categoryEvidence: {
    matrixVersion: 'signal-category-competency-matrix-v1', specialization: need.specialization,
    grade: 'Junior', targetGrade: 'Junior', requirements: ['python', 'sql', 'backend-engineering'].map((skillId, index) => ({
      id: skillId, skillId, level: 'Junior' as const, evidenceId: userId * 10 + index,
      attemptId: userId * 100 + index, programVersion: 'signal-skills-2026-10-v1', verifiedAt: now.toISOString(),
    })),
  } };
}
function measured(userId: number, alias: string): CatalogResume {
  return { ...resume(userId, alias), verifiedScore: 100, assessmentEvidence: {
    attemptId: userId * 100, candidateId: userId, programId: 'backend-python',
    programVersion: 'signal-backend-python-v7', grade: 'Junior', score: 100,
    submittedAt: now.toISOString(), state: 'verified', comparisonPolicy: 'same-program-version-rubric-v1',
    rubricKey: 'independent-comparison-fixture',
  } };
}
const entry = (candidate: CatalogResume) => ({ candidate, evaluation: evaluateMatch(need, candidate, false, now) });

test('a complete matrix certificate precedes grade-only history at equal fit without a fabricated score', () => {
  const historical = resume(1, 'А · история'), matrix = modular(2, 'Б · матрица'), exam = measured(3, 'В · экзамен');
  const pool = rankMatches([historical, matrix, exam].map(entry));
  assert.deepEqual(pool.map(row => row.candidate.userId), [2, 3, 1]);
  const confirmed = pool.find(row => row.candidate.userId === 2)!;
  assert.equal(confirmed.evaluation.ranking.provenancePriority, 0);
  assert.equal(confirmed.evaluation.ranking.qualityStatus, 'not_measured');
  assert.equal(confirmed.evaluation.ranking.qualityScore, null);
  assert.equal(confirmed.evaluation.ranking.attemptId, null);
  assert.equal(confirmed.evaluation.factors.find(f => f.scope === 'within_comparable_group')!.score, null);
  assert.equal(pool[0].evaluation.ranking.businessFitScore, pool[1].evaluation.ranking.businessFitScore);
});

test('need fit remains primary and an incompatible matrix certificate does not establish proof completeness', () => {
  const historical = resume(1, 'Я · история'), matrix = { ...modular(2, 'А · матрица'), workFormat: 'Офис' };
  assert.deepEqual(rankMatches([matrix, historical].map(entry)).map(row => row.candidate.userId), [1, 2]);
  const incompatible = modular(3, 'Б · несоответствие');
  incompatible.categoryEvidence = { ...incompatible.categoryEvidence!, grade: 'Middle' };
  assert.equal(entry(incompatible).evaluation.ranking.provenancePriority, 1);
});

test('comparison recognizes complete modular evidence but never compares module aggregates to exam scores', () => {
  for (const other of [measured(3, 'В · экзамен'), modular(4, 'Г · матрица')]) {
    const left = entry(modular(2, 'Б · матрица')), right = entry(other);
    const result = compareResumeFacts(need, left, right, rankMatches([left, right]));
    assert.equal(result.comparable, false);
    assert.match(result.limitations.join(' '), /Обе категории подтверждены действующими доказательствами/);
    assert.match(result.limitations.join(' '), /нет единого экзаменационного балла/);
    assert.doesNotMatch(result.limitations.join(' '), /нет полного действующего протокола/);
    assert.match(result.orderContext.note, /сертификат матрицы подтверждает категорию/);
    assert.ok(!result.differences.some(d => d.kind === 'comparable-result'));
  }
});

test('comparison names only the missing historical proof while explaining matrix certificate priority', () => {
  const left = entry(modular(2, 'Б · матрица')), right = entry(resume(1, 'А · история'));
  const result = compareResumeFacts(need, left, right, rankMatches([left, right]));
  assert.match(result.limitations.join(' '), /для второго резюме нет полного действующего протокола/);
  assert.doesNotMatch(result.limitations.join(' '), /для первого резюме нет полного действующего протокола/);
  assert.match(result.limitations.join(' '), /Категория первого резюме подтверждена действующим сертификатом матрицы/);
  assert.match(result.orderContext.note, /приоритет получает первое резюме с действующим сертификатом матрицы/);
  assert.equal(result.orderContext.leftPosition, 1);
  assert.equal(result.orderContext.rightPosition, 2);
});
