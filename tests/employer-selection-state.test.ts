import assert from 'node:assert/strict';
import test from 'node:test';
import { emptySelectionFilters, readSelectionState, selectionContextKey, selectionDraftKey, selectionHref, selectionParams } from '../artifacts/fsp-signal/src/lib/employer-selection-state';

test('selection has an explicit initial search and never implicitly picks an own context', () => {
  const state = readSelectionState('');
  assert.equal(state.applied, false);
  assert.equal(state.context, null);
  assert.equal(state.resumeId, null);
});
test('typed contexts with equal IDs remain distinct across URL reload', () => {
  const job = readSelectionState('contextType=job&contextId=7&applied=1');
  const need = readSelectionState('contextType=need&contextId=7&applied=1');
  assert.notEqual(selectionContextKey(job.context), selectionContextKey(need.context));
  assert.deepEqual(readSelectionState(selectionHref(job).split('?')[1]).context, { type: 'job', id: 7 });
});
test('applied URL recovers exact CV, saved list, pagination and all filter families', () => {
  const initial = readSelectionState('contextType=need&contextId=18&applied=1&view=shortlisted&resume=49&candidate=5&page=3&q=Alias&verifiedSkills=Python,SQL&verifiedSkillLevel=Middle&verifiedSkillsMode=any&declaredSkills=React&location=Москва&salaryMin=120000&salaryMax=180000&salaryPeriod=month&salaryType=net&fsp=yes&workFormat=Удалённо&grade=Middle&experienceMin=4&hasPhoto=yes&experienceMax=9');
  const reloaded = readSelectionState(selectionHref(initial).split('?')[1]);
  assert.deepEqual(reloaded, initial);
  const request = selectionParams(initial, true);
  assert.equal(request.has('resume'), false);
  assert.equal(request.has('candidate'), false);
  assert.equal(request.has('applied'), false);
  assert.equal(request.get('view'), 'shortlisted');
});
test('legacy matches and catalogue links retain need ID and distinct consent purpose', () => {
  const matching = readSelectionState('need=11&resumeId=90', '/employer/matches');
  assert.deepEqual(matching.context, { type: 'need', id: 11 });
  assert.equal(matching.applied, true);
  assert.equal(matching.mode, undefined);
  assert.equal(matching.resumeId, 90);
  const catalogue = readSelectionState('needId=11&skills=py&experienceMax=6&readyForOffers=yes', '/employer/candidates');
  assert.deepEqual(catalogue.context, { type: 'need', id: 11 });
  assert.equal(catalogue.mode, 'catalog');
  assert.equal(catalogue.filters.verifiedSkills, 'py');
  assert.equal(catalogue.filters.readyForOffers, 'yes');
  assert.equal(selectionParams(catalogue, true).get('mode'), 'catalog');
});
test('malformed IDs never produce a different context or person', () => {
  for (const value of ['-7', '1.2', 'bad', '2147483648', '0']) {
    const state = readSelectionState(`contextType=job&contextId=${value}&resume=${value}`);
    assert.equal(state.context, null);
    assert.equal(state.resumeId, null);
    assert.equal(state.invalidContext, true);
  }
});
test('draft freshness distinguishes requirements but leaves person and page changes independent', () => {
  const applied = readSelectionState('contextType=job&contextId=5&applied=1');
  assert.equal(selectionDraftKey(applied), selectionDraftKey({ ...applied, page: 2, resumeId: 98 }));
  assert.notEqual(selectionDraftKey(applied), selectionDraftKey({ ...applied, filters: { ...emptySelectionFilters, declaredSkills: 'SQL' } }));
  assert.notEqual(selectionDraftKey(applied), selectionDraftKey({ ...applied, context: { type: 'need', id: 5 } }));
});
test('salary period and tax basis travel together with a salary range only', () => {
  const idle = readSelectionState('');
  assert.equal(selectionParams(idle, true).has('salaryPeriod'), false);
  assert.equal(selectionParams(idle, true).has('salaryType'), false);
  const active = { ...idle, filters: { ...idle.filters, salaryMin: '0', salaryPeriod: 'year', salaryType: 'net' } };
  assert.equal(selectionParams(active, true).get('salaryPeriod'), 'year');
  assert.equal(selectionParams(active, true).get('salaryType'), 'net');
});


test('dismissing a linked invitation clears only its open intent and reload keeps the exact selection',()=>{
  for(const type of ['job','need']){
    const opened=readSelectionState(`contextType=${type}&contextId=51&applied=1&mode=catalog&resume=296&candidate=314&invite=1&q=RUI-20261009&page=2&declaredSkills=Docker`);
    const href=selectionHref({...opened,invite:false});
    const reloaded=readSelectionState(href.split('?')[1]);
    assert.equal(new URLSearchParams(href.split('?')[1]).has('invite'),false);
    assert.deepEqual(reloaded,{...opened,invite:false});
    assert.deepEqual(reloaded.context,{type,id:51});
    assert.equal(reloaded.resumeId,296);
    assert.equal(reloaded.candidateId,314);
  }
});
