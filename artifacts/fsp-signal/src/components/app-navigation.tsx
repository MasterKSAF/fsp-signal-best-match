import { createContext, useCallback, useContext, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useLocation, useRouter, useSearch } from 'wouter';
import { browserNavigationRoute, initialNavigationTrail, navigationDestination, navigationHistoryKey, navigationHistoryState, observeNavigationRoute, performNavigationTraversal, type HistoryChange, type NavigationTrail } from '@/lib/app-navigation-trail';
import './app-navigation.css';

type NavigationContext = { canGoBack: boolean; canGoForward: boolean; home?: string; goBack: (fallback?: string) => void; goForward: () => void };
const AppNavigationContext = createContext<NavigationContext | null>(null);

/** A local route trail never sends a visitor back to another website. */
export function AppNavigationProvider({ children, userId, role }: { children: ReactNode; userId?: number; role?: 'candidate' | 'employer' }) {
  const [path, navigate] = useLocation();
  const router = useRouter();
  const search = useSearch();
  const route = `${path}${search ? `?${search.replace(/^\?/, '')}` : ''}`;
  const scope = `${userId ?? 'visitor'}:${role ?? 'public'}`;
  const [storedTrail, setTrail] = useState(() => initialNavigationTrail(scope, route));
  const [generation] = useState(() => crypto.randomUUID());
  const taggingHistory = useRef(false);
  const trailRef = useRef(storedTrail);
  const trail = storedTrail.scope === scope ? storedTrail : initialNavigationTrail(scope, route, storedTrail.nextKey);
  const commit = useCallback((next: NavigationTrail) => {
    if (next === trailRef.current) return;
    trailRef.current = next;
    setTrail(next);
  }, []);
  const tagCurrentEntry = useCallback(() => {
    const current = trailRef.current;
    const state = navigationHistoryState(window.history.state, generation, current.keys[current.index]!);
    if (state === window.history.state) return;
    taggingHistory.current = true;
    try { window.history.replaceState(state, '', window.location.href); }
    finally { taggingHistory.current = false; }
  }, [generation]);
  const home = role === 'employer' ? '/employer' : '/candidate';
  const validTarget = useCallback((target: string) => !userId || !['/', '/auth'].includes(target.split('?')[0]!), [userId]);

  // A new screen starts at its heading; changing a filter on the same screen
  // keeps the current position.
  useLayoutEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [path]);

  useLayoutEffect(() => {
    const changed = (kind: HistoryChange) => {
      if (taggingHistory.current) return;
      const currentRoute = browserNavigationRoute(window.location, router.base);
      if (currentRoute !== null) {
        commit(observeNavigationRoute(trailRef.current, scope, currentRoute, kind, navigationHistoryKey(window.history.state, generation)));
        tagCurrentEntry();
      }
    };
    const pushed = () => changed('push');
    const replaced = () => changed('replace');
    const popped = () => changed('pop');
    // Native browser traversal may render before even a capture listener runs.
    // The route acknowledgement below recognizes the preserved native key.
    window.addEventListener('pushState', pushed, true);
    window.addEventListener('replaceState', replaced, true);
    window.addEventListener('popstate', popped, true);
    return () => {
      window.removeEventListener('pushState', pushed, true);
      window.removeEventListener('replaceState', replaced, true);
      window.removeEventListener('popstate', popped, true);
    };
  }, [commit, generation, router.base, scope, tagCurrentEntry]);

  useLayoutEffect(() => {
    commit(observeNavigationRoute(trailRef.current, scope, route, 'render', navigationHistoryKey(window.history.state, generation)));
  }, [commit, generation, route, scope]);

  // Tag the initial entry of a mount/account scope. Subsequent tags belong to
  // real history events, never to a possibly early location render.
  useLayoutEffect(() => { tagCurrentEntry(); }, [scope, tagCurrentEntry]);

  const goBack = useCallback((fallback = '/') => {
    const current = trailRef.current.scope === scope ? trailRef.current : initialNavigationTrail(scope, route, trailRef.current.nextKey);
    performNavigationTraversal(current, -1, validTarget, commit, target => navigate(target, { replace: true }), userId && !validTarget(fallback) ? home : fallback);
  }, [commit, navigate, route, scope, validTarget, userId, home]);

  const goForward = useCallback(() => {
    const current = trailRef.current.scope === scope ? trailRef.current : initialNavigationTrail(scope, route, trailRef.current.nextKey);
    performNavigationTraversal(current, 1, validTarget, commit, target => navigate(target, { replace: true }));
  }, [commit, navigate, route, scope, validTarget]);

  return <AppNavigationContext.Provider value={{ home:userId?home:undefined, canGoBack: !!navigationDestination(trail, -1, validTarget), canGoForward: !!navigationDestination(trail, 1, validTarget), goBack, goForward }}>{children}</AppNavigationContext.Provider>;
}

export function AppHistoryButtons({ fallback }: { fallback?: string }) {
  const navigation = useContext(AppNavigationContext);
  return <nav className="workspace-history" aria-label="История переходов"><AppBackButton fallback={fallback}/><button className="app-back-button" type="button" aria-label="Вперёд" title="Вперёд" disabled={!navigation?.canGoForward} onClick={() => navigation?.goForward()} data-testid="button-app-forward"><ArrowRight size={19} aria-hidden="true"/></button></nav>;
}

export function AppBackButton({ fallback }: { fallback?: string }) {
  const navigation = useContext(AppNavigationContext);
  const [path] = useLocation();
  const defaultFallback = navigation?.home ?? (path.startsWith('/candidate/') ? '/candidate'
    : path.startsWith('/employer/') ? '/employer'
      : path === '/quality' ? '/about' : '/');
  const destination = fallback || defaultFallback;
  const disabled = !navigation || (!navigation.canGoBack && path === destination);
  return <button className="app-back-button" type="button" aria-label="Назад" title={disabled ? 'Вы на главной странице' : 'Назад'} disabled={disabled} onClick={() => navigation?.goBack(destination)} data-testid="button-app-back"><ArrowLeft size={19} aria-hidden="true" /></button>;
}
