import test from 'node:test';
import assert from 'node:assert/strict';
import { applicationNameMatches } from '../artifacts/api-server/src/lib/employer-application-display';
test('A public applicant can be found by both the allowed name and the alias',()=>{
  const candidate = {publicName:'Тестовый специалист',alias:'SignalAlias42'};
  assert.equal(applicationNameMatches(candidate,'специалист'),true);
  assert.equal(applicationNameMatches(candidate,'SIGNALALIAS'),true);
  assert.equal(applicationNameMatches(candidate,'чужое имя'),false);
});
test('Anonymous and revoked applications cannot be found through a hidden name or stale identity field',()=>{
  const anonymous = {publicName:null,alias:'Разрешённый псевдоним',displayName:'Скрытая фамилия'};
  assert.equal(applicationNameMatches(anonymous,'Скрытая фамилия'),false);
  assert.equal(applicationNameMatches(anonymous,'псевдоним'),true);
  assert.equal(applicationNameMatches(null,'псевдоним'),false);
  assert.equal(applicationNameMatches(null,''),true);
});
