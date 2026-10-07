import assert from 'node:assert/strict';
import test from 'node:test';
import { assembleAttempt, isCurrentKalibrAttempt, requiredScore, scoreAttempt, type AssessmentGrade } from '../artifacts/api-server/src/lib/assessment-bank.ts';
import { getAssessmentContext, isAssessmentContextId, listAssessmentContexts, selectContextForNeed, snapshotForNeed, snapshotForProfile, type AssessmentContextId, type NeedForAssessment } from '../artifacts/api-server/src/lib/assessment-context.ts';

const profiles: AssessmentContextId[] = ['api-platform', 'data-services', 'reliability'];
const grades: AssessmentGrade[] = ['Junior', 'Middle', 'Senior'];
const anchors = [0, 1, 3, 5];
const need = (overrides: Partial<NeedForAssessment>): NeedForAssessment => ({
  title: 'Разработчик', description: '', specialization: 'Backend / Python', grade: 'Middle', requiredSkills: ['Python'], desirableSkills: [], ...overrides,
});

test('Описания трёх разных вакансий выбирают прикладные модули по требованиям', () => {
  const examples = [
    need({ title: 'Разработчик API платформы', description: 'REST API и HTTP, публикация событий через outbox', requiredSkills: ['Python', 'API contracts', 'FastAPI'] }),
    need({ title: 'Разработчик потоковых сервисов данных', description: 'Обработка данных, SQL и consumer-ы Kafka', requiredSkills: ['Python', 'SQL', 'PostgreSQL'] }),
    need({ title: 'Инженер надёжных сервисов', description: 'Инциденты под нагрузкой, восстановление операций и мониторинг', requiredSkills: ['Python', 'Incident diagnosis', 'Replay safety'] }),
  ];
  assert.deepEqual(examples.map((item) => selectContextForNeed(item).context.id), profiles);
  for (const item of examples) {
    const selected = selectContextForNeed(item);
    assert.equal(selected.targetGrade, item.grade);
    assert.equal(new Set(selected.context.coverage.flatMap(row => row.families)).size, 6);
  }
  assert.deepEqual(selectContextForNeed(examples[0]!).unsupportedRequirements, ['FastAPI']);
  assert.deepEqual(selectContextForNeed(need({ requiredSkills: ['Python', 'NoSQL', 'Kafka', 'Redis'] })).unsupportedRequirements, ['NoSQL', 'Kafka', 'Redis']);
  assert.equal(selectContextForNeed(need({ specialization: 'Frontend' })).supported, false);
});

test('900 форм: четыре точных общих задания, разные прикладные задачи и единая шкала', () => {
  for (const grade of grades) for (let index = 0; index < 100; index += 1) {
    const seed = `context-comparison-${grade}-${index}`;
    const forms = profiles.map(profile => assembleAttempt(grade, seed, profile));
    for (const form of forms) {
      assert.equal(isCurrentKalibrAttempt(form.cases, form.oracles), true);
      assert.equal(form.cases.length, 6);
      assert.equal(Object.values(form.oracles).filter(oracle => oracle.blueprint.critical).length, 3);
      assert.equal(Object.values(form.oracles).filter(oracle => oracle.blueprint.responseType !== 'choice').length, 4);
      const correct = form.cases.map(item => ({ caseId: item.id, answer: form.oracles[item.id]!.answer }));
      const graded = scoreAttempt(form.cases, form.oracles, correct);
      assert.deepEqual({ ...graded, evidence: graded.evidence.map(({ skill, score, criterion }) => ({ skill, score, criterion })) }, { score: 100, criticalComplete: true, evidence: form.cases.map(item => ({ skill: item.family, score: 100, criterion: 'Критерий варианта подтверждён серверной проверкой.' })) });
      for (const anchor of anchors) assert.deepEqual(form.cases[anchor], forms[0]!.cases[anchor]);
      assert.deepEqual(Object.values(form.oracles).map(item => [item.blueprint.targetSeconds, item.blueprint.critical, item.blueprint.partialCredit]), Object.values(forms[0]!.oracles).map(item => [item.blueprint.targetSeconds, item.blueprint.critical, item.blueprint.partialCredit]));
    }
    // Context selects actual situations and answers, not merely a heading.
    assert.equal(new Set(forms.map(form => form.cases[4]!.prompt)).size, 3);
    assert.equal(new Set(forms.map(form => form.oracles[form.cases[4]!.id]!.answer)).size, 3);
    assert.notEqual(forms[0]!.cases[2]!.prompt, forms[2]!.cases[2]!.prompt);
    for (let missed = 0; missed < 6; missed += 1) {
      const results = forms.map(form => scoreAttempt(form.cases, form.oracles, form.cases.map((item, position) => ({ caseId: item.id, answer: position === missed ? 'неверный ответ' : form.oracles[item.id]!.answer }))));
      assert.deepEqual(results.map(result => [result.score, result.criticalComplete]), Array(3).fill([results[0]!.score, results[0]!.criticalComplete]));
      assert.equal(new Set(results.map(result => result.score >= requiredScore(grade) && result.criticalComplete)).size, 1);
    }
  }
});

test('Выбор контекста не ломает старые v4 формы или историю', () => {
  for (const grade of grades) {
    const old = assembleAttempt(grade, 'existing-v4-form');
    const noContext = assembleAttempt(grade, 'existing-v4-form', undefined);
    assert.deepEqual(old, noContext);
    assert.equal(isCurrentKalibrAttempt(old.cases, old.oracles), true);
    const saved = JSON.parse(JSON.stringify(old));
    assert.equal(isCurrentKalibrAttempt(saved.cases, saved.oracles), true);
    assert.equal(scoreAttempt(saved.cases, saved.oracles, []).score, 0);
  }
  assert.deepEqual(grades.map(requiredScore), [67, 83, 83]);
});

test('Публичные профили и снимки не содержат ключей ответов, seed и личных полей компании', () => {
  assert.equal(isAssessmentContextId('private-company-id'), false);
  assert.equal(isAssessmentContextId('reliability'), true);
  const job = { ...need({ title: 'Сервис данных', description: 'Секретный внутренний текст', requiredSkills: ['Python', 'SQL', 'Redis'] }), ownerUserId: 999, companyId: 123, contactEmail: 'private@example.test' };
  const snapshot = snapshotForNeed(job);
  assert.deepEqual(snapshot.unsupportedRequirements, ['Redis']);
  assert.equal(snapshot.targetGrade, 'Middle');
  for (const payload of [listAssessmentContexts(), snapshot, ...profiles.map(profile => snapshotForProfile(profile, 'Junior'))]) {
    const text = JSON.stringify(payload);
    for (const field of ['answer', 'oracles', 'seed', 'blueprint', 'diagnosisBranch', 'architectureBranch', 'ownerUserId', 'companyId', 'contactEmail', 'private@example.test', 'Секретный внутренний текст']) assert.equal(text.includes(field), false, field);
  }
  // The server still has the actual module choices.
  assert.equal(getAssessmentContext('reliability').architectureBranch, 2);
});
