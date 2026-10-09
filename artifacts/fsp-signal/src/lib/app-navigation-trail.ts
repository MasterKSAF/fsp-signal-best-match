export type NavigationTrail = {
  scope: string;
  entries: string[];
  keys: number[];
  nextKey: number;
  index: number;
  pending: { target: string; index: number } | null;
};
export type HistoryChange = 'push' | 'replace' | 'pop' | 'render';
export type NavigationDestination = { target: string; index: number };

/** Match the browser's URL spelling without admitting another origin. */
export function localNavigationRoute(value: string): string | null {
  const pathname = value.split(/[?#]/, 1)[0]!;
  if (!pathname.startsWith('/') || pathname.startsWith('//') || /[\\\u0000-\u001f]/.test(pathname)) return null;
  try {
    const url = new URL(value, 'https://signal.invalid');
    return url.origin === 'https://signal.invalid' ? `${url.pathname}${url.search}` : null;
  } catch { return null; }
}

export function browserNavigationRoute(location: { pathname: string; search: string }, base = ''): string | null {
  const decode = (value: string) => { try { return decodeURI(value); } catch { return value; } };
  const pathname = decode(location.pathname), prefix = decode(base === '/' ? '' : base);
  if (prefix && !(pathname.toLowerCase() + '/').startsWith(prefix.toLowerCase() + '/')) return null;
  return localNavigationRoute(`${pathname.slice(prefix.length) || '/'}${location.search}`);
}

export function initialNavigationTrail(scope: string, route: string, key = 0): NavigationTrail {
  return { scope, entries: [localNavigationRoute(route) ?? '/'], keys: [key], nextKey: key + 1, index: 0, pending: null };
}

const HISTORY_MARKER = '__signalAppNavigationV1';
const stateRecord = (state: unknown): state is Record<string, unknown> => !!state && typeof state === 'object' && (Object.getPrototypeOf(state) === Object.prototype || Object.getPrototypeOf(state) === null);
const markerRecord = (marker: unknown): marker is { generation: string; key: number } => stateRecord(marker) && typeof marker.generation === 'string' && Number.isSafeInteger(marker.key) && Number(marker.key) >= 0;

export function navigationHistoryKey(state: unknown, generation: string): number | null {
  if (!stateRecord(state)) return null;
  const marker = state[HISTORY_MARKER];
  return markerRecord(marker) && marker.generation === generation ? marker.key : null;
}

/** Preserve other native state fields; do not reshape arrays/primitive state. */
export function navigationHistoryState(state: unknown, generation: string, key: number): unknown {
  if (state != null && !stateRecord(state)) return state;
  const record = state as Record<string, unknown> | null | undefined;
  if (record && HISTORY_MARKER in record && !markerRecord(record[HISTORY_MARKER])) return state;
  if (navigationHistoryKey(state, generation) === key) return state;
  return { ...record, [HISTORY_MARKER]: { generation, key } };
}

/** Enabled state and the click handler use the exact same destination. */
export function navigationDestination(trail: NavigationTrail, direction: -1 | 1, allowed: (route: string) => boolean): NavigationDestination | null {
  const current = trail.entries[trail.index];
  for (let index = trail.index + direction; index >= 0 && index < trail.entries.length; index += direction) {
    const target = trail.entries[index]!;
    if (target !== current && allowed(target)) return { target, index };
  }
  return null;
}

/** Commit both the cursor and intended URL before calling the router. */
export function beginNavigationTraversal(trail: NavigationTrail, direction: -1 | 1, allowed: (route: string) => boolean, fallback?: string) {
  const destination = navigationDestination(trail, direction, allowed);
  const fallbackRoute = fallback === undefined ? null : localNavigationRoute(fallback);
  const target = destination?.target ?? (fallbackRoute && allowed(fallbackRoute) ? fallbackRoute : null);
  if (!target || target === trail.entries[trail.index]) return null;
  const index = destination?.index ?? trail.index;
  const entries = destination ? trail.entries : trail.entries.map((entry, at) => at === index ? target : entry);
  return { trail: { ...trail, entries, index, pending: { target, index } }, target };
}

/** Both provider buttons use this ordering, including synchronous router events. */
export function performNavigationTraversal(trail: NavigationTrail, direction: -1 | 1, allowed: (route: string) => boolean,
  commit: (next: NavigationTrail) => void, navigate: (target: string) => void, fallback?: string) {
  const next = beginNavigationTraversal(trail, direction, allowed, fallback);
  if (!next) return null;
  commit(next.trail);
  navigate(next.target);
  return next.target;
}

/** A traversal acknowledgement must never replace the destination's trail slot. */
export function observeNavigationRoute(trail: NavigationTrail, scope: string, value: string, kind: HistoryChange, nativeKey: number | null = null): NavigationTrail {
  const route = localNavigationRoute(value);
  if (!route) return trail;
  if (trail.scope !== scope) return initialNavigationTrail(scope, route, trail.nextKey);
  if (kind === 'pop') {
    const index = nativeKey === null ? -1 : trail.keys.indexOf(nativeKey);
    return index >= 0 && trail.entries[index] === route
      ? { ...trail, index, pending: null }
      : initialNavigationTrail(scope, route, trail.nextKey);
  }
  // Native navigation can render before our popstate listener. A render is an
  // acknowledgement, never evidence of a new push: preserve the browser's key
  // until the actual history operation classifies an untracked entry.
  if (kind === 'render') {
    if (trail.pending?.target === route) return { ...trail, index: trail.pending.index, pending: null };
    if (trail.pending) return trail;
    const index = nativeKey === null ? -1 : trail.keys.indexOf(nativeKey);
    return index >= 0 && trail.entries[index] === route && index !== trail.index
      ? { ...trail, index }
      : trail;
  }
  if (trail.pending?.target === route) return { ...trail, index: trail.pending.index, pending: null };
  if (trail.entries[trail.index] === route) return trail.pending ? { ...trail, pending: null } : trail;
  if (kind === 'replace') {
    const entries = [...trail.entries]; entries[trail.index] = route;
    return { ...trail, entries, pending: null };
  }
  const entries = [...trail.entries.slice(0, trail.index + 1), route].slice(-80);
  const keys = [...trail.keys.slice(0, trail.index + 1), trail.nextKey].slice(-80);
  return { scope, entries, keys, nextKey: trail.nextKey + 1, index: entries.length - 1, pending: null };
}
