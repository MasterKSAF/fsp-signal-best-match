import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyInvitationWorkFormat, invitationAllowsWorkFormat, invitationWorkFormats } from '../artifacts/api-server/src/lib/invitation-work-format';

test('the Northstar alternative admits remote and hybrid while retaining distinct office semantics', () => {
  assert.deepEqual(classifyInvitationWorkFormat('Удалённо или гибрид'), ['Удалённо', 'Гибрид']);
  assert.equal(invitationAllowsWorkFormat('Удалённо или гибрид', 'Удалённо'), true);
  assert.equal(invitationAllowsWorkFormat('Удалённо или гибрид', 'Гибрид'), true);
  assert.equal(invitationAllowsWorkFormat('Удалённо или гибрид', 'Офис'), false);
  for (const format of invitationWorkFormats) assert.deepEqual(classifyInvitationWorkFormat(format), [format]);
});

test('explicit alternatives and common precise aliases are classified consistently', () => {
  assert.deepEqual(classifyInvitationWorkFormat('Формат работы: офис / удалённая работа'), ['Удалённо', 'Офис']);
  assert.deepEqual(classifyInvitationWorkFormat('  УДАЛЕННО и/или ГИБРИД.  '), ['Удалённо', 'Гибрид']);
  assert.deepEqual(classifyInvitationWorkFormat('В офисе; возможен гибридный формат'), ['Офис', 'Гибрид']);
  assert.deepEqual(classifyInvitationWorkFormat('Только удалённо'), ['Удалённо']);
});

test('negation cannot become a positive match and explicit exclusions take precedence', () => {
  assert.deepEqual(classifyInvitationWorkFormat('без удалённой работы'), []);
  assert.deepEqual(classifyInvitationWorkFormat('Удалённая работа не предусмотрена'), []);
  assert.deepEqual(classifyInvitationWorkFormat('Офис, без удалённой работы'), ['Офис']);
  assert.deepEqual(classifyInvitationWorkFormat('Удалённо и офис и без удалённой работы'), ['Офис']);
  assert.deepEqual(classifyInvitationWorkFormat('Удалённо, но удалённая работа не допускается'), []);
  assert.deepEqual(classifyInvitationWorkFormat('Не гибрид; в офисе'), ['Офис']);
});

test('unknown and conditional descriptions do not manufacture an available work format', () => {
  for (const description of ['', 'по договорённости', 'гибкий график', 'неудалённо', 'переход на удалённую работу когда-нибудь', 'удалённо после испытательного срока', 'офис или другой формат']) {
    assert.deepEqual(classifyInvitationWorkFormat(description), [], description);
  }
});
