import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMotionPreferences, normalizeMotionSpeed, resolveMotion, MOTION_MODE_KEY, MOTION_SPEED_KEY } from '../artifacts/fsp-signal/src/lib/motion-preference';

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}
test('legacy mode is preserved independently of a new speed default', () => {
  for (const mode of ['system', 'reduced', 'off'] as const) {
    const store = createMotionPreferences(memoryStorage({ [MOTION_MODE_KEY]: mode }));
    assert.equal(store.getSnapshot().motion, mode); assert.equal(store.getSnapshot().speed, 1);
    assert.equal(store.getSnapshot().effective, mode === 'system' ? 'full' : mode);
  }
});
test('zero, explicit off and reduced-system requests override positive speeds', () => {
  for (const speed of [0, 0.5, 1, 2, 5]) {
    assert.equal(resolveMotion('system', speed, false).effective, speed === 0 ? 'off' : 'full');
    assert.equal(resolveMotion('off', speed, false).effective, 'off');
    assert.equal(resolveMotion('system', speed, true).effective, speed === 0 ? 'off' : 'reduced');
    assert.equal(resolveMotion('reduced', speed, false).effective, speed === 0 ? 'off' : 'reduced');
  }
});
test('invalid saved speeds have a finite normal fallback; quarter steps are stable', () => {
  for (const invalid of [null, undefined, '', '   ', NaN, Infinity, 'NaN', '-1', '6', {}, true]) assert.equal(normalizeMotionSpeed(invalid), 1);
  assert.equal(normalizeMotionSpeed('0'), 0); assert.equal(normalizeMotionSpeed('0.5'), 0.5); assert.equal(normalizeMotionSpeed(2.24), 2.25);
});
test('shared state survives write failure without emitting a storage reread that resets it', () => {
  const storage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  const store = createMotionPreferences(storage);
  let changes = 0; const unsubscribe = store.subscribe(() => changes++);
  store.choose('reduced'); store.setSpeed(2); store.syncStorage();
  assert.equal(store.getSnapshot().motion, 'reduced'); assert.equal(store.getSnapshot().speed, 2); assert.equal(changes, 2);
  unsubscribe(); store.setSpeed(1); assert.equal(changes, 2);
});
test('storage sync, system change, reload and reset preserve a consistent effective state', () => {
  const storage = memoryStorage(); const store = createMotionPreferences(storage);
  store.setSpeed(0); assert.equal(store.getSnapshot().effective, 'off');
  storage.setItem(MOTION_SPEED_KEY, '5'); store.syncStorage(); assert.equal(store.getSnapshot().speed, 5);
  store.setSystemReduced(true); assert.equal(store.getSnapshot().effective, 'reduced');
  store.setSpeed(1); assert.equal(createMotionPreferences(storage, true).getSnapshot().speed, 1);
  store.setSystemReduced(false); assert.equal(store.getSnapshot().effective, 'full');
});
test('quota failure retains each local preference on internal sync but a real external change replaces its key', () => {
  const values = memoryStorage();
  const storage = { getItem: values.getItem, setItem() { throw new Error('quota'); } };
  const store = createMotionPreferences(storage);
  store.choose('off'); store.setSpeed(2); store.syncStorage();
  assert.equal(store.getSnapshot().motion, 'off'); assert.equal(store.getSnapshot().speed, 2);
  values.setItem(MOTION_MODE_KEY, 'reduced'); store.syncStorage(MOTION_MODE_KEY);
  assert.equal(store.getSnapshot().motion, 'reduced'); assert.equal(store.getSnapshot().speed, 2);
});
