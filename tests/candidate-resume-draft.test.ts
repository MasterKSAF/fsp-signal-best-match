import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareResumeDraftRecovery, resolveResumeDraftRecovery, resumeContentEqual, resumeDraftBaseline, type ResumeInput } from '../artifacts/fsp-signal/src/lib/candidate-resume-draft';

const baseline: ResumeInput = {
  summary: 'Сохранённое описание', softSkills: ['Командная работа'], experience: [], projects: [],
  education: [{ institution: 'Университет', qualification: 'Информатика', start: '2018', end: '2022' }], portfolio: [],
  questionnaire: { version: 'backend-python-v1', industry: 'Финтех', specialization: 'Backend / Python', answers: { python: 1, ownership: 2 } },
};

test('recovery preserves dirty text and year-only dates while taking independent server edits', () => {
  const local = { ...baseline, summary: 'Мой несохранённый большой текст' };
  const current = { ...baseline, projects: [{ title: 'Новый сохранённый проект', role: 'Разработчик', description: 'Серверные изменения', url: null }] };
  const recovery = prepareResumeDraftRecovery(baseline, local, current);
  assert.deepEqual(recovery.draft, { ...current, summary: local.summary });
  assert.deepEqual(recovery.overlappingFields, []);
  assert.equal(baseline.summary, 'Сохранённое описание');
});

test('overlapping paragraphs and row collections require a choice instead of silent replacement', () => {
  const local = { ...baseline, summary: 'Мой текст', education: [] };
  const current = { ...baseline, summary: 'Текст другой вкладки', education: [{ ...baseline.education[0], qualification: 'Новая квалификация' }] };
  const recovery = prepareResumeDraftRecovery(baseline, local, current);
  assert.deepEqual(recovery.overlappingFields, ['summary', 'education']);
  assert.equal(recovery.draft.summary, local.summary);
  assert.deepEqual(recovery.draft.education, local.education);
  assert.equal(current.summary, 'Текст другой вкладки');
  assert.equal(resolveResumeDraftRecovery(recovery, current, {}, true), null);
  assert.equal(resolveResumeDraftRecovery(recovery, current, { summary: 'local' }, true), null);
  const resolved = resolveResumeDraftRecovery(recovery, current, { summary: 'local', education: 'current' }, true);
  assert.equal(resolved?.summary, local.summary);
  assert.deepEqual(resolved?.education, current.education);
});

test('identical concurrent edits and JSONB key order do not invent content conflicts', () => {
  const current = { ...baseline, summary: 'Совпадающая правка', questionnaire: { answers: { ownership: 2, python: 1 }, specialization: 'Backend / Python' as const, industry: 'Финтех', version: 'backend-python-v1' as const } };
  const recovery = prepareResumeDraftRecovery(baseline, { ...baseline, summary: current.summary }, current);
  assert.deepEqual(recovery.overlappingFields, []);
  assert.ok(resumeContentEqual(baseline.questionnaire, current.questionnaire));
  assert.ok(!resumeContentEqual(['Python', 'SQL'], ['SQL', 'Python']));
});

test('specialization recovery keeps free text and old answers without submitting an incompatible questionnaire', () => {
  const local = { ...baseline, summary: 'Черновик опыта', questionnaire: { ...baseline.questionnaire, industry: 'Моя предметная область', answers: { python: 3, ownership: 3 } } };
  const current: ResumeInput = { ...baseline, questionnaire: { version: 'frontend-typescript-v1', industry: 'Информационные технологии', specialization: 'Frontend / TypeScript', answers: { typescript: null, state: null, accessibility: null, performance: null, architecture: null, ownership: null } } };
  const recovery = prepareResumeDraftRecovery(baseline, local, current);
  assert.equal(recovery.programChanged, true);
  assert.equal(recovery.draft.summary, local.summary);
  assert.equal(recovery.draft.questionnaire.version, 'frontend-typescript-v1');
  assert.equal(recovery.draft.questionnaire.industry, local.questionnaire.industry);
  assert.deepEqual(recovery.draft.questionnaire.answers, current.questionnaire.answers);
  assert.deepEqual(recovery.previousQuestionnaire, local.questionnaire);
  assert.ok(!recovery.overlappingFields.includes('questionnaire'));
  assert.equal(resolveResumeDraftRecovery(recovery, current, {}, false), null);
  assert.equal(resolveResumeDraftRecovery(recovery, current, {}, true)?.questionnaire.version, 'frontend-typescript-v1');
});

test('returning to a tab reads the old cached baseline and still detects a stale dirty draft', () => {
  const cached = { draft: { ...baseline, summary: 'Черновик из памяти вкладки' }, revision: 4, baseline: JSON.stringify(baseline) };
  const current = { ...baseline, summary: 'Обновлённая версия сервера' };
  const decoded = resumeDraftBaseline(cached.baseline);
  const recovery = prepareResumeDraftRecovery(decoded, cached.draft, current);
  assert.deepEqual(recovery.overlappingFields, ['summary']);
  assert.equal(recovery.draft.summary, cached.draft.summary);
  assert.equal(cached.revision, 4);
});

test('unknown or damaged baseline never silently discards a restored local draft', () => {
  assert.equal(resumeDraftBaseline('{invalid'), null);
  assert.equal(resumeDraftBaseline('{}'), null);
  const local = { ...baseline, summary: 'Сохрани меня' };
  const recovery = prepareResumeDraftRecovery(null, local, baseline);
  assert.equal(recovery.draft.summary, local.summary);
  assert.deepEqual(recovery.overlappingFields, ['summary']);
});
