import assert from 'node:assert/strict';
import test from 'node:test';
import { reconcileSelectionAccess, selectionAccessBlocked, type SelectionAccessIdentity } from '../artifacts/fsp-signal/src/lib/employer-selection-access';

const row = { candidateId: 8, resumeId: 6, resumeRevision: 2, alias: 'Signal 8', publicName: 'Разрешённое имя', avatarDataUrl: 'data:image/png;base64,public' };
const identity: SelectionAccessIdentity = { resumeId: 6, revision: 2, visibility: 'public', alias: row.alias, publicName: row.publicName, avatarDataUrl: row.avatarDataUrl };

test('initial fresh page can render while the first bounded access check is pending', () => {
  assert.deepEqual(reconcileSelectionAccess([row], undefined).items, [row]);
});
test('pseudonymous access suppresses stale public name and photograph even if supplied accidentally', () => {
  const result = reconcileSelectionAccess([row], [{ ...identity, visibility: 'pseudonymous', alias: 'Новый псевдоним' }]);
  assert.equal(result.items[0].publicName, null);
  assert.equal(result.items[0].avatarDataUrl, null);
  assert.equal(result.items[0].alias, 'Новый псевдоним');
  assert.deepEqual(result.changedResumeIds, [6]);
});
test('unavailable CVs and changed revisions disappear until a fresh whole-CV list response', () => {
  for (const identities of [[], [{ ...identity, visibility: 'private' }], [{ ...identity, revision: 3 }]]) {
    assert.deepEqual(reconcileSelectionAccess([row], identities).items, []);
    assert.deepEqual(reconcileSelectionAccess([row], identities).hiddenResumeIds, [6]);
  }
});
test('failed revalidation drops stale identities despite a previous successful snapshot', () => {
  assert.deepEqual(reconcileSelectionAccess([row], [identity], { failed: true }).items, []);
});
test('newer exact detail masks the visible row before the next page access interval', () => {
  const result = reconcileSelectionAccess([row], [identity], { detail: { ...row, publicName: null, avatarDataUrl: null }, detailCheckedAt: 20, accessCheckedAt: 10 });
  assert.equal(result.items[0].publicName, null);
  assert.equal(result.items[0].avatarDataUrl, null);
});
test('newer detail of another CV may suppress identity but never grant another CV public identity', () => {
  const privateRow = { ...row, publicName: null, avatarDataUrl: null };
  const options = { detail: { ...row, resumeId: 7 }, detailCheckedAt: 20, accessCheckedAt: 10 };
  assert.equal(reconcileSelectionAccess([privateRow], undefined, options).items[0].publicName, null);
  assert.equal(reconcileSelectionAccess([row], undefined, { ...options, detail: { ...options.detail, publicName: null } }).items[0].avatarDataUrl, null);
});
test('an older detail cannot restore revoked identity and newer detail revision cannot keep old CV data', () => {
  assert.equal(reconcileSelectionAccess([row], [{ ...identity, visibility: 'pseudonymous' }], { detail: row, detailCheckedAt: 10, accessCheckedAt: 20 }).items[0].publicName, null);
  assert.deepEqual(reconcileSelectionAccess([row], [identity], { detail: { ...row, resumeRevision: 3 }, detailCheckedAt: 20, accessCheckedAt: 10 }).items, []);
});
test('an older detail cannot override a newly fetched whole-CV list while first access is pending', () => {
  const latestRow = { ...row, resumeRevision: 3, publicName: null, avatarDataUrl: null };
  const result = reconcileSelectionAccess([latestRow], undefined, { detail: row, detailCheckedAt: 10, sourceCheckedAt: 20 });
  assert.deepEqual(result.items, [latestRow]);
  assert.deepEqual(result.changedResumeIds, []);
});
test('retry pending after an access error stays blocked until a newer successful snapshot', () => {
  assert.equal(selectionAccessBlocked({ isError: false, dataUpdatedAt: 0, errorUpdatedAt: 0 }), false);
  assert.equal(selectionAccessBlocked({ isError: true, dataUpdatedAt: 10, errorUpdatedAt: 20 }), true);
  assert.equal(selectionAccessBlocked({ isError: false, dataUpdatedAt: 0, errorUpdatedAt: 20 }), true);
  assert.equal(selectionAccessBlocked({ isError: false, dataUpdatedAt: 10, errorUpdatedAt: 20 }), true);
  assert.equal(selectionAccessBlocked({ isError: false, dataUpdatedAt: 30, errorUpdatedAt: 20 }), false);
});
