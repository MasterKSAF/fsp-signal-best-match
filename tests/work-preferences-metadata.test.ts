import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { currentWorkPreferencesSnapshot, editableWorkPreferences, retainWorkPreferences, sameWorkPreferences, savedWorkPreferencesRows, workPreferencesPatch, workPreferencesSnapshot } from '../artifacts/fsp-signal/src/lib/work-preferences-recovery';
import { QueryClient, QueryObserver } from '../artifacts/fsp-signal/node_modules/@tanstack/react-query/build/modern/index.js';

// Exercise the actual strict request schema without importing the API router or DB.
const require = createRequire(new URL('../artifacts/api-server/package.json', import.meta.url));
const { z } = require('zod');
const routeSource = readFileSync(new URL('../artifacts/api-server/src/routes/signal-resume.ts', import.meta.url), 'utf8');
const schemaExpression = routeSource.match(/^const WorkPreferencesSchema=(.+);$/m)?.[1];
assert.ok(schemaExpression, 'the route must retain an identifiable strict request contract');
const requestSchema = runInNewContext(schemaExpression, { z });
const fields = ['location', 'schedule', 'employment', 'relocation', 'startAvailability'];
const saved = (location: string, updatedAt = '2026-10-08T16:49:00.000Z') => ({
  location, schedule: 'Гибкий', employment: 'Полный день', relocation: false, startAvailability: '',
  resumeId: 1, updatedAt,
});

test('read-model metadata never becomes editable fields or causes dirty/conflict equality', () => {
  const raw = saved('Казань');
  const projected = editableWorkPreferences(raw);
  assert.deepEqual(Object.keys(projected), fields);
  assert.equal(projected.relocation, false);
  assert.equal(projected.startAvailability, '');
  assert.equal(sameWorkPreferences(projected, saved('Казань', 'later timestamp')), true);
  assert.equal(sameWorkPreferences(projected, { ...raw, resumeId: 999 }), true);
  assert.equal(sameWorkPreferences(projected, { ...raw, location: 'Москва' }), false);
  assert.equal(sameWorkPreferences(projected, { ...raw, relocation: true }), false);
  projected.location = 'Локальная правка';
  assert.equal(raw.location, 'Казань', 'state is detached from the raw cached row');
});

test('the editable payload passes the actual strict server schema; spreading the saved row is a negative control', () => {
  const raw = saved('Казань');
  assert.equal(requestSchema.safeParse({ ...raw, revision: 3 }).success, false);
  const payload = workPreferencesPatch(raw, 3);
  assert.deepEqual(Object.keys(payload), [...fields, 'revision']);
  assert.equal(requestSchema.safeParse(payload).success, true);
  assert.equal(payload.revision, 3);
  assert.equal(requestSchema.safeParse(workPreferencesPatch(raw, 0)).success, false);
});

test('conflict recovery from a persisted row supports a fresh CAS resave and the next save without metadata loss', () => {
  const stale = editableWorkPreferences(saved('Казань · вкладка A'));
  const rowB = { id: 1, revision: 3, workPreferences: saved('Казань · вкладка B') };
  const aboutDraft = { summary: 'Другой несохранённый раздел' };
  assert.equal(sameWorkPreferences(stale, rowB.workPreferences), false, 'real editable changes still conflict');
  const recovered = workPreferencesSnapshot([rowB], 1);
  const baseline = editableWorkPreferences(recovered.preferences);
  const draftC = { ...recovered.preferences, location: 'Казань · вкладка C' };
  const fresh = { ...rowB, revision: 4, workPreferences: saved(rowB.workPreferences.location, 'changed metadata') };
  assert.equal(sameWorkPreferences(fresh.workPreferences, baseline), true, 'metadata does not block the conscious recovered edit');
  assert.equal(sameWorkPreferences(draftC, baseline), false, 'the next location edit remains dirty');
  const payloadC = workPreferencesPatch(draftC, fresh.revision);
  assert.equal(requestSchema.safeParse(payloadC).success, true);
  assert.equal(payloadC.revision, 4, 'the resave uses the latest revision, not the stale one');
  const savedC = { id: 1, revision: 5, workPreferences: { ...saved('Казань · вкладка C'), updatedAt: 'new server timestamp' } };
  const payloadD = workPreferencesPatch({ ...workPreferencesSnapshot([savedC], 1).preferences, schedule: 'Полный день' }, savedC.revision);
  assert.equal(requestSchema.safeParse(payloadD).success, true, 'a subsequent save remains valid');
  assert.equal(rowB.workPreferences.location, 'Казань · вкладка B');
  assert.deepEqual(aboutDraft, { summary: 'Другой несохранённый раздел' });
});

test('equal editable fields retain state identity across fresh metadata objects, so synchronization reaches a fixed point', () => {
  const baseline = editableWorkPreferences(saved('Казань · вкладка B'));
  for (let render = 0; render < 20; render++) {
    const incoming = saved('Казань · вкладка B', `metadata version ${render}`);
    assert.equal(retainWorkPreferences(baseline, incoming), baseline, 'an effect dependency must keep the identical reference');
  }
  const metadataState = saved('Казань · вкладка B');
  const cleaned = retainWorkPreferences(metadataState, metadataState);
  assert.notEqual(cleaned, metadataState);
  assert.deepEqual(Object.keys(cleaned), fields);
  assert.equal(retainWorkPreferences(cleaned, saved('Казань · вкладка B')), cleaned, 'legacy metadata is removed once, not on every render');
  const changed = retainWorkPreferences(baseline, saved('Казань · вкладка C'));
  assert.notEqual(changed, baseline);
  assert.equal(changed.location, 'Казань · вкладка C');
});

test('accepted save updates the own query row first and survives stale props without replacing another CV or a newer revision', () => {
  const client = new QueryClient();
  const key = ['candidate-resumes', 1];
  const prior = { id: 1, revision: 3, workPreferences: saved('Казань · вкладка B') };
  const other = { id: 2, revision: 8, workPreferences: saved('Москва') };
  client.setQueryData(key, { resumes: [prior, other] });
  const observer = new QueryObserver<{ resumes: typeof prior[] }>(client, { queryKey: key, enabled: false });
  const unsubscribe = observer.subscribe(() => {});
  const accepted = { revision: 4, preferences: editableWorkPreferences(saved('Казань · вкладка C')) };
  client.setQueryData<{ resumes: typeof prior[] }>(key, cache => cache ? { ...cache, resumes: savedWorkPreferencesRows(cache.resumes, 1, accepted) } : cache);
  const cached = client.getQueryData<{ resumes: typeof prior[] }>(key)!;
  assert.equal(cached.resumes[0].revision, 4);
  assert.equal(cached.resumes[0].workPreferences.location, 'Казань · вкладка C');
  assert.equal(cached.resumes[1], other, 'another CV keeps its data and reference');
  assert.equal(observer.getCurrentResult().data!.resumes[0].revision, 4, 'the actual query observer receives the accepted row');
  const staleProps = currentWorkPreferencesSnapshot({ revision: prior.revision, preferences: prior.workPreferences }, accepted);
  assert.equal(staleProps, accepted);
  assert.equal(retainWorkPreferences(accepted.preferences, staleProps.preferences), accepted.preferences);
  const newer = { revision: 5, preferences: editableWorkPreferences(saved('Казань · вкладка D')) };
  const newestKnown = currentWorkPreferencesSnapshot(newer, accepted);
  assert.equal(newestKnown.revision, 5);
  assert.equal(currentWorkPreferencesSnapshot(accepted, newestKnown), newestKnown, 'a delayed old row cannot undo the newer accepted state');
  const latestRows = [{ ...prior, revision: 5, workPreferences: saved('Казань · вкладка D') }, other];
  assert.equal(savedWorkPreferencesRows(latestRows, 1, accepted)[0], latestRows[0], 'a delayed success cannot downgrade a fresh cached revision');
  unsubscribe();
  client.clear();
});
