import test from 'node:test';
import assert from 'node:assert/strict';
import { selectionReadPolicy, withinSavedSelection } from '../artifacts/api-server/src/lib/selection-read-policy';

test('closed vacancy permits only read-only saved selection, never a new pool',()=>{
  assert.deepEqual(selectionReadPolicy({type:'job',status:'closed'},'shortlisted'),{allowed:true,readOnly:true});
  for(const view of [undefined,'all'] as const)assert.equal(selectionReadPolicy({type:'job',status:'closed'},view).allowed,false);
  assert.equal(selectionReadPolicy({type:'need',status:'archived'},'shortlisted').allowed,false);
  assert.equal(selectionReadPolicy({type:'job',status:'archived'},'shortlisted').allowed,false);
  for(const status of ['draft','published'])assert.deepEqual(selectionReadPolicy({type:'job',status},'shortlisted'),{allowed:true,readOnly:false});
});
test('closed selection scopes exact pinned CVs, not every resume of the person',()=>{
  assert.deepEqual(withinSavedSelection([7,8,9],new Set([7,9])),[7,9]);
  assert.deepEqual(withinSavedSelection([7],new Set()),[]);
  assert.deepEqual(withinSavedSelection([7,8],null),[7,8]);
});
