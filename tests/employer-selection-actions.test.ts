import assert from 'node:assert/strict';
import test from 'node:test';
import { pendingInvitationConflictId, selectionContextReadOnly } from '../artifacts/fsp-signal/src/lib/employer-selection-actions';

test('closed job read access stays read-only without declaring a closed need or catalogue readable', () => {
  assert.equal(selectionContextReadOnly({ type: 'job', status: 'closed' }), true);
  assert.equal(selectionContextReadOnly({ type: 'job', status: 'published', readOnly: false }), false);
  assert.equal(selectionContextReadOnly({ type: 'job', status: 'published', readOnly: true }), true);
  assert.equal(selectionContextReadOnly({ type: 'need', status: 'closed' }), false);
  assert.equal(selectionContextReadOnly(null), false);
});
test('only explicit pending invitation conflict with a valid existing ID offers the transition', () => {
  assert.equal(pendingInvitationConflictId(409, 'PENDING_INVITATION_CONFLICT', 5), 5);
  for (const id of [null, 0, -1, 1.5, '5', Number.MAX_SAFE_INTEGER + 1]) assert.equal(pendingInvitationConflictId(409, 'PENDING_INVITATION_CONFLICT', id), null);
  assert.equal(pendingInvitationConflictId(409, 'CONTEXT_VERSION_CONFLICT', 5), null);
  assert.equal(pendingInvitationConflictId(200, 'PENDING_INVITATION_CONFLICT', 5), null);
});
