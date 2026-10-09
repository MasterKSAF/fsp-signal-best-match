import assert from 'node:assert/strict';
import test from 'node:test';
import { catalogContextCaption, professionLabel } from '../artifacts/fsp-signal/src/lib/employer-workspace-navigation';
import { readSelectionState, selectionHref } from '../artifacts/fsp-signal/src/lib/employer-selection-state';
import { normalizeJobFilterParams } from '../artifacts/fsp-signal/src/lib/job-skill-filters';

test('catalogue caption follows the saved context after the invitation closes and URL reloads', () => {
  for (const [type, caption] of [
    ['job', 'Каталог с требованиями выбранной вакансии.'],
    ['need', 'Каталог с требованиями выбранного запроса.'],
  ] as const) {
    const opened = readSelectionState(`contextType=${type}&contextId=40&mode=catalog&invite=1&resume=296&candidate=314&applied=1`);
    const reloaded = readSelectionState(selectionHref({ ...opened, invite: false }).split('?')[1]);
    assert.equal(catalogContextCaption(reloaded.context?.type), caption);
    assert.deepEqual(reloaded.context, { type, id: 40 });
    assert.equal(reloaded.resumeId, 296);
    assert.equal(reloaded.candidateId, 314);
    assert.equal(reloaded.invite, false);
  }
});

test('legacy employer catalogue links still name their need; an unscoped catalogue names no requirement', () => {
  for (const [path, query] of [
    ['/employer/candidates', 'needId=18&resumeId=296'],
    ['/employer/matches', 'need=18&resumeId=296'],
  ]) {
    const state = readSelectionState(query, path);
    assert.equal(catalogContextCaption(state.context?.type), 'Каталог с требованиями выбранного запроса.');
    assert.deepEqual(state.context, { type: 'need', id: 18 });
  }
  assert.equal(catalogContextCaption(readSelectionState('mode=catalog').context?.type), null);
});

test('profession labels are readable while old public and candidate job URLs preserve API values', () => {
  for (const [value, label] of [
    ['Backend / Python', 'Backend-разработчик'],
    ['Frontend / TypeScript', 'Frontend-разработчик'],
  ]) {
    for (const path of ['/jobs', '/candidate/jobs']) {
      const original = new URL(`https://signal.example${path}?${new URLSearchParams({ specialization: value, job: '40', resumeId: '296' })}`);
      const normalized = normalizeJobFilterParams(original.searchParams).params;
      assert.equal(professionLabel(normalized.get('specialization')), label);
      assert.equal(normalized.get('specialization'), value);
      assert.equal(normalized.get('job'), '40');
      assert.equal(normalized.get('resumeId'), '296');
      assert.equal(original.searchParams.get('specialization'), value);
    }
  }
  assert.equal(professionLabel('Новая специальность'), 'Новая специальность');
});
