import assert from 'node:assert/strict';
import test from 'node:test';
import { appendResumeQuestionnaireHistory, emptyResume, recommendResumeGrade, SaveResumeSchema } from '../artifacts/api-server/src/lib/signal-resume-contract.ts';
import { renderCandidateResumePdf } from '../artifacts/api-server/src/lib/signal-resume-pdf.ts';

test('resume accepts structured Russian work history, projects and learning without requiring employment', () => {
  const input = emptyResume();
  input.summary = 'Разрабатываю сервисы на Python';
  input.softSkills = ['Командная работа'];
  input.projects = [{ title: 'Учебный сервис', role: 'Разработчик', description: 'API с проверкой доступа', url: 'https://example.org/project' }];
  input.education = [{ institution: 'Университет', qualification: 'Прикладная информатика', start: '2023-09', end: null }];
  assert.equal(SaveResumeSchema.safeParse(input).success, true);
  assert.equal(input.experience.length, 0);
});

test('resume rejects script URLs, credentials, impossible dates, reversed periods and forged grade fields', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,hello', 'file:///C:/secret', 'https://name:password@example.org']) {
    assert.equal(SaveResumeSchema.safeParse({ ...emptyResume(), portfolio: [{ title: 'Портфолио', url }] }).success, false, url);
  }
  for (const dates of [{ start: '2024-13', end: null }, { start: '2025-05', end: '2024-01' }]) {
    assert.equal(SaveResumeSchema.safeParse({ ...emptyResume(), experience: [{ company: 'Компания', role: 'Разработчик', description: '', ...dates }] }).success, false);
  }
  assert.equal(SaveResumeSchema.safeParse({ ...emptyResume(), verifiedGrade: 'Senior' }).success, false);
  assert.equal(SaveResumeSchema.safeParse({ ...emptyResume(), summary: 'x'.repeat(3001) }).success, false);
});

test('unfinished questionnaire never recommends a grade and advanced answers cannot hide a fundamental gap', () => {
  const input = emptyResume();
  assert.equal(recommendResumeGrade(input.questionnaire).grade, null);
  input.questionnaire.answers = { python: 3, databases: 3, api: 3, testing: 3, reliability: null, ownership: 3 };
  assert.equal(recommendResumeGrade(input.questionnaire).grade, null);
  input.questionnaire.answers.reliability = 0;
  assert.equal(recommendResumeGrade(input.questionnaire).grade, 'Junior');
  input.questionnaire.answers = { python: 2, databases: 2, api: 2, testing: 2, reliability: 2, ownership: 2 };
  assert.equal(recommendResumeGrade(input.questionnaire).grade, 'Middle');
  input.questionnaire.answers = { python: 3, databases: 3, api: 3, testing: 3, reliability: 2, ownership: 3 };
  assert.equal(recommendResumeGrade(input.questionnaire).grade, 'Senior');
  assert.match(recommendResumeGrade(input.questionnaire).explanation, /не подтверждённая категория/);
});

test('questionnaire history stays idempotent after JSONB key reordering and preserves prior snapshots', () => {
  const questionnaire = emptyResume().questionnaire;
  questionnaire.answers = { python: 2, databases: 2, api: 2, testing: 2, reliability: 2, ownership: 2 };
  const history = appendResumeQuestionnaireHistory([], questionnaire, '2026-10-05T10:00:00Z');
  const reordered = { answers: { ownership: 2, reliability: 2, testing: 2, api: 2, databases: 2, python: 2 }, specialization: questionnaire.specialization, industry: questionnaire.industry, version: questionnaire.version };
  assert.deepEqual(appendResumeQuestionnaireHistory(history, reordered, '2026-10-05T11:00:00Z'), history);
  const changed = { ...questionnaire, answers: { ...questionnaire.answers, python: 3 } };
  const next = appendResumeQuestionnaireHistory(history, changed, '2026-10-05T12:00:00Z');
  assert.equal(next.length, 2);
  assert.equal(history.length, 1);
  assert.deepEqual(next[0], history[0]);
  assert.deepEqual(appendResumeQuestionnaireHistory(next, { ...changed, answers: { ...changed.answers, ownership: null } }), next);
});

test('PDF generation produces a portable Cyrillic document and handles multi-page work history', async () => {
  const input = emptyResume();
  input.summary = 'Программирую на Python и проектирую надёжные сервисы.';
  input.experience = Array.from({ length: 5 }, (_, index) => ({ company: `Компания ${index + 1}`, role: 'Backend-разработчик', start: '2020-01', end: '2024-01', description: 'Разработал API, добавил тесты и сократил время обработки запросов. '.repeat(28) }));
  const pdf = await renderCandidateResumePdf({ displayName: 'Александр Сергеев', professionalAlias: 'Python Engineer', specialization: 'Backend / Python', assumedGrade: 'Middle', verifiedGrade: 'Junior', verifiedSkills: ['Python'], stack: ['Python', 'PostgreSQL'], skills: ['REST API'], yearsExperience: 3, workFormat: 'Удалённо', salaryMin: 150000, salaryMax: 220000, salaryPeriod: 'month', salaryType: 'gross', latestAssessmentAt: new Date('2026-10-05T10:00:00Z') }, input, new Date('2026-10-05T12:00:00Z'));
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.match(pdf.subarray(-32).toString(), /%%EOF/);
  assert.ok((pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length > 1);
  assert.ok(pdf.toString('latin1').includes('/FontFile2'), 'Cyrillic font is embedded');
});
