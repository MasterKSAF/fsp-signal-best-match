import assert from 'node:assert/strict';
import test from 'node:test';
import { createInlineInfoEscapeLayers } from '../artifacts/fsp-signal/src/lib/inline-info-escape';

const keydown = (key = 'Escape') => {
  const event = new Event('keydown', { cancelable: true });
  Object.defineProperty(event, 'key', { value: key });
  return event;
};
test('first Escape consumes the tooltip layer and second Escape reaches the parent dialog', () => {
  const target = new EventTarget(), layers = createInlineInfoEscapeLayers(target);
  let tooltip = true, dialog = true, restoredFocus = false;
  layers.register(() => { tooltip = false; restoredFocus = true; });
  target.addEventListener('keydown', event => { if (!event.defaultPrevented) dialog = false; });
  const first = keydown(); target.dispatchEvent(first);
  assert.equal(first.defaultPrevented, true);
  assert.equal(tooltip, false);
  assert.equal(dialog, true);
  assert.equal(restoredFocus, true);
  target.dispatchEvent(keydown());
  assert.equal(dialog, false);
});
test('nested tooltip layers dismiss one at a time without reaching lower listeners', () => {
  const target = new EventTarget(), layers = createInlineInfoEscapeLayers(target), dismissed: string[] = [];
  layers.register(() => dismissed.push('bottom'));
  layers.register(() => dismissed.push('top'));
  target.addEventListener('keydown', () => dismissed.push('dialog'));
  target.dispatchEvent(keydown()); assert.deepEqual(dismissed, ['top']);
  target.dispatchEvent(keydown()); assert.deepEqual(dismissed, ['top', 'bottom']);
  target.dispatchEvent(keydown()); assert.deepEqual(dismissed, ['top', 'bottom', 'dialog']);
});
test('outside/blur cleanup removes only its layer and ordinary keys remain unconsumed', () => {
  const target = new EventTarget(), layers = createInlineInfoEscapeLayers(target), dismissed: string[] = [];
  const removeBottom = layers.register(() => dismissed.push('bottom'));
  const removeTop = layers.register(() => dismissed.push('top'));
  removeBottom(); removeBottom();
  const ordinary = keydown('Tab'); target.dispatchEvent(ordinary);
  assert.equal(ordinary.defaultPrevented, false);
  target.dispatchEvent(keydown()); assert.deepEqual(dismissed, ['top']);
  removeTop();
  const empty = keydown(); target.dispatchEvent(empty);
  assert.equal(empty.defaultPrevented, false);
});
