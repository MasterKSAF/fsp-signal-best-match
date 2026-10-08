import assert from 'node:assert/strict';
import test from 'node:test';
import { employerTaskAnswerView } from '../artifacts/fsp-signal/src/lib/employer-task-answer';
const offer = { id: 7, templateId: 3, resumeId: 42, resumeAvailable: true, resumeProvenance: 'captured', candidateIdentity: { alias: 'Псевдоним', displayName: null }, resumeContext: { resumeId: 42, title: 'Выбранное резюме' }, answer: 'Ответ на\nсохранённые условия' };
test('answer author, snapshot exact CV and profile link share the same authorized offer', () => {
  const view = employerTaskAnswerView(offer);
  assert.equal(view.name, 'Псевдоним');
  assert.equal(view.pseudonymous, true);
  assert.equal(view.resumeLabel, 'Резюме №42 · Выбранное резюме');
  assert.equal(view.profileHref, '/employer/microtasks?task=3&tab=answers&offer=7&profile=1');
  assert.equal(view.preview, 'Ответ на сохранённые условия');
  assert.equal(employerTaskAnswerView({ ...offer, candidateIdentity: { ...offer.candidateIdentity, displayName: 'Разрешённое имя' } }).name, 'Разрешённое имя');
});
test('revoked and unavailable answers reveal neither identity, answer preview nor profile URL', () => {
  for (const denied of [{ ...offer, consentRevokedAt: '2026-10-09' }, { ...offer, resumeAvailable: false }]) {
    const view = employerTaskAnswerView(denied);
    assert.equal(view.name, 'Доступ отозван'); assert.equal(view.preview, ''); assert.equal(view.profileHref, null);
    assert.equal(view.resumeLabel.includes('42'), false);
  }
});
test('legacy and mismatched bindings never invent an exact or current primary resume overview', () => {
  assert.equal(employerTaskAnswerView({ ...offer, resumeProvenance: 'legacy_unbound', resumeId: null, resumeContext: null }).resumeLabel, 'Прежняя запись без сохранённого резюме');
  assert.equal(employerTaskAnswerView({ ...offer, resumeId: 43 }).resumeLabel.includes('43'), false);
  assert.equal(employerTaskAnswerView({ ...offer, answer: 'a'.repeat(200) }).preview.length, 141);
});
