/** Register on window capture so a tooltip consumes Escape before dialog document handlers. */
export function createInlineInfoEscapeLayers(target: EventTarget) {
  const layers: { dismiss: () => void }[] = [];
  const escape = (event: Event) => {
    if ((event as KeyboardEvent).key !== 'Escape' || !layers.length) return;
    const top = layers.pop()!;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    if (!layers.length) target.removeEventListener('keydown', escape, true);
    top.dismiss();
  };
  return {
    register(dismiss: () => void) {
      const layer = { dismiss };
      if (!layers.length) target.addEventListener('keydown', escape, true);
      layers.push(layer);
      return () => {
        const index = layers.indexOf(layer);
        if (index >= 0) layers.splice(index, 1);
        if (!layers.length) target.removeEventListener('keydown', escape, true);
      };
    },
  };
}
