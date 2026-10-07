export type MotionMode = 'system' | 'reduced' | 'off';
export type MotionSnapshot = Readonly<{ motion: MotionMode; speed: number; systemReduced: boolean; effective: 'full' | 'reduced' | 'off' }>;
type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>;
export const MOTION_MODE_KEY = 'fsp-motion';
export const MOTION_SPEED_KEY = 'fsp-motion-speed';

export function normalizeMotionSpeed(value: unknown): number {
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '') || (typeof value !== 'string' && typeof value !== 'number')) return 1;
  const speed = Number(value);
  return Number.isFinite(speed) && speed >= 0 && speed <= 5 ? Math.round(speed * 4) / 4 : 1;
}
export function resolveMotion(motion: MotionMode, speed: number, systemReduced: boolean): MotionSnapshot {
  return Object.freeze({ motion, speed, systemReduced, effective: motion === 'off' || speed === 0 ? 'off' : motion === 'reduced' || systemReduced ? 'reduced' : 'full' });
}

/** Device preference only. Business clocks, requests and message lifetimes never use this store. */
export function createMotionPreferences(storage?: PreferenceStorage, systemReduced = false, apply?: (state: MotionSnapshot) => void) {
  const unsaved = new Set<string>();
  const read = (fallback?: MotionSnapshot) => {
    try {
      const mode = storage?.getItem(MOTION_MODE_KEY);
      const storedSpeed = normalizeMotionSpeed(storage?.getItem(MOTION_SPEED_KEY));
      return resolveMotion(fallback && unsaved.has(MOTION_MODE_KEY) ? fallback.motion : mode === 'off' || mode === 'reduced' ? mode : 'system', fallback && unsaved.has(MOTION_SPEED_KEY) ? fallback.speed : storedSpeed, systemReduced);
    } catch { return fallback ?? resolveMotion('system', 1, systemReduced); }
  };
  let snapshot = read();
  const listeners = new Set<() => void>();
  const publish = (next: MotionSnapshot) => {
    if (next.motion === snapshot.motion && next.speed === snapshot.speed && next.systemReduced === snapshot.systemReduced) return;
    snapshot = next; apply?.(snapshot); listeners.forEach(listener => listener());
  };
  const save = (key: string, value: string) => { try { if (!storage) throw new Error('unavailable'); storage.setItem(key, value); unsaved.delete(key); } catch { unsaved.add(key); } };
  apply?.(snapshot);
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    choose(motion: MotionMode) { save(MOTION_MODE_KEY, motion); publish(resolveMotion(motion, snapshot.speed, systemReduced)); },
    setSpeed(value: number) { const speed = normalizeMotionSpeed(value); save(MOTION_SPEED_KEY, String(speed)); publish(resolveMotion(snapshot.motion, speed, systemReduced)); },
    syncStorage(changedKey?: string | null) { if (changedKey === null) unsaved.clear(); else if (changedKey !== undefined) unsaved.delete(changedKey); publish(read(snapshot)); },
    setSystemReduced(value: boolean) { systemReduced = value; publish(resolveMotion(snapshot.motion, snapshot.speed, systemReduced)); },
  };
}

let browserStore: ReturnType<typeof createMotionPreferences> | undefined;
export function initializeMotionPreferences() {
  if (browserStore) return browserStore;
  let storage: PreferenceStorage | undefined;
  try { storage = window.localStorage; } catch { /* Session preference works without storage. */ }
  const media = window.matchMedia('(prefers-reduced-motion: reduce)');
  browserStore = createMotionPreferences(storage, media.matches, state => {
    const root = document.documentElement;
    root.dataset.motion = state.motion;
    root.dataset.motionEffective = state.effective;
    root.dataset.motionSpeed = String(state.speed);
    root.style.setProperty('--motion-time-scale', String(state.speed > 0 ? 1 / state.speed : 1));
  });
  const store = browserStore;
  media.addEventListener('change', event => store.setSystemReduced(event.matches));
  window.addEventListener('storage', event => {
    if (event.key === null || event.key === MOTION_MODE_KEY || event.key === MOTION_SPEED_KEY) store.syncStorage(event.key);
  });
  window.addEventListener('fsp-motion-change', () => store.syncStorage());
  return store;
}
