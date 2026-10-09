import assert from 'node:assert/strict';
import test from 'node:test';
import { emptySelectionFilters, readSelectionState, selectionContextKey, selectionHref, selectionParams, selectionScopeState, selectionViewState } from '../artifacts/fsp-signal/src/lib/employer-selection-state';

test('quick shortlist starts the selected context immediately and clears prior person/invitation intent', () => {
  const state = readSelectionState('contextType=job&contextId=7&resume=296&candidate=314&invite=1&mode=catalog&q=Иван');
  assert.equal(state.applied, false);
  const filtered = selectionViewState(state, true);
  assert.equal(filtered.applied, true);
  assert.equal(filtered.view, 'shortlisted');
  assert.equal(filtered.mode, undefined);
  assert.deepEqual(filtered.context, { type: 'job', id: 7 });
  assert.equal(filtered.filters.q, 'Иван');
  assert.equal(filtered.resumeId, null);
  assert.equal(filtered.candidateId, null);
  assert.equal(filtered.invite, false);
  assert.equal(selectionParams(filtered, true).get('view'), 'shortlisted');
});

test('one job and two needs retain distinct return contexts through catalogue URL reload', () => {
  for (const context of [{ type: 'job', id: 7 }, { type: 'need', id: 7 }, { type: 'need', id: 8 }] as const) {
    const selected = selectionViewState(readSelectionState(`contextType=${context.type}&contextId=${context.id}`), true);
    const catalogue = selectionScopeState(selected, null);
    assert.equal(catalogue.context, null);
    assert.equal(catalogue.view, 'all');
    assert.equal(catalogue.resumeId, null);
    const reloaded = readSelectionState(selectionHref(catalogue).split('?')[1]);
    assert.deepEqual(reloaded.returnContext, context);
    assert.equal(selectionContextKey(reloaded.returnContext!), `${context.type}:${context.id}`);
    const api = selectionParams(reloaded, true);
    assert.equal(api.has('returnContextId'), false);
    assert.equal(api.has('returnContextType'), false);
    assert.equal(api.has('contextId'), false);
    assert.equal(api.has('view'), false);
    const restored = selectionScopeState({ ...reloaded, filters: { ...emptySelectionFilters, q: 'Другой поиск', specialization: 'Frontend / TypeScript' } }, context);
    assert.equal(restored.applied, true);
    assert.equal(restored.view, 'shortlisted');
    assert.deepEqual(restored.filters, emptySelectionFilters);
    assert.deepEqual(restored.context, context);
    const restoredApi = selectionParams(restored, true);
    assert.equal(restoredApi.get('contextType'), context.type);
    assert.equal(restoredApi.get('contextId'), String(context.id));
    assert.equal(restoredApi.get('view'), 'shortlisted');
  }
});

test('unrelated selected context is never mistaken for the remembered shortlist', () => {
  const catalogue = readSelectionState('returnContextType=need&returnContextId=7');
  const job = selectionScopeState(catalogue, { type: 'job', id: 7 });
  assert.equal(job.view, 'all');
  assert.equal(job.applied, false);
  const otherNeed = selectionScopeState(catalogue, { type: 'need', id: 8 });
  assert.equal(otherNeed.view, 'all');
  const archived = selectionScopeState(catalogue, { type: 'need', id: 8 }, true);
  assert.equal(archived.view, 'shortlisted');
  assert.equal(archived.applied, true);
});

test('catalogue cannot become a shortlist without a context; malformed return metadata is inert', () => {
  const state = selectionViewState(readSelectionState(''), true);
  assert.equal(state.context, null);
  assert.equal(state.view, 'all');
  assert.equal(state.returnContext, undefined);
  for (const query of ['returnContextType=job&returnContextId=0', 'returnContextType=other&returnContextId=7', 'returnContextType=job&returnContextId=2147483648']) {
    const parsed = readSelectionState(query);
    assert.equal(parsed.returnContext, undefined);
    assert.equal(parsed.context, null);
    assert.equal(parsed.invite, false);
  }
});
