import assert from 'node:assert/strict';
import test from 'node:test';
import { reconcileProfileDraft } from '../artifacts/fsp-signal/src/lib/candidate-profile-draft';

const baseline = {
  title: 'Backend', displayName: 'Первое имя', professionalAlias: 'Первый псевдоним',
  phone: '+70000000001', contactEmail: 'first@example.test', stack: ['Python'], consentMatching: false,
};

test('refresh of stale secondary CV preserves its title edit and all newer shared identity fields', () => {
  const current = { ...baseline, displayName: 'Новое имя', professionalAlias: 'Новый псевдоним', phone: '+70000000002', contactEmail: 'second@example.test' };
  const result = reconcileProfileDraft(baseline, { ...baseline, title: 'Мой новый заголовок' }, current);
  assert.deepEqual(result.draft, { ...current, title: 'Мой новый заголовок' });
  assert.deepEqual(result.overlappingFields, []);
});

test('conflicting contact edit remains visible and explicitly identified for deliberate reapplication', () => {
  const local = { ...baseline, phone: '+70000000003' };
  const current = { ...baseline, phone: '+70000000002' };
  const result = reconcileProfileDraft(baseline, local, current);
  assert.equal(result.draft.phone, local.phone);
  assert.deepEqual(result.overlappingFields, ['phone']);
  assert.equal(current.phone, '+70000000002');
});

test('local skill and consent edits survive while untouched fields use the refreshed server state', () => {
  const local = { ...baseline, stack: ['Python', 'SQL'], consentMatching: true };
  const current = { ...baseline, displayName: 'Новое имя', title: 'Серверный заголовок' };
  assert.deepEqual(reconcileProfileDraft(baseline, local, current).draft, { ...current, stack: local.stack, consentMatching: true });
});

test('the same concurrent edit is not an unresolved conflict; null-to-value edits remain distinct', () => {
  const base = { phone: null as string | null, stack: ['Python'] };
  const current = { phone: '+70000000002', stack: ['Python', 'SQL'] };
  assert.deepEqual(reconcileProfileDraft(base, { ...current }, current), { draft: current, overlappingFields: [] });
  assert.deepEqual(reconcileProfileDraft(base, base, current).draft, current);
});
