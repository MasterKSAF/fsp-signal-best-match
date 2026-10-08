import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useLocation, useSearch } from 'wouter';
import './app-navigation.css';

type Trail = { entries: string[]; index: number };
type NavigationContext = { canGoBack: boolean; canGoForward: boolean; goBack: (fallback?: string) => void; goForward: () => void };
const AppNavigationContext = createContext<NavigationContext | null>(null);

/** A local route trail never sends a visitor back to another website. */
export function AppNavigationProvider({ children }: { children: ReactNode }) {
  const [path, navigate] = useLocation();
  const search = useSearch();
  const route = `${path}${search ? `?${search.replace(/^\?/, '')}` : ''}`;
  const [trail, setTrail] = useState<Trail>(() => ({ entries: [route], index: 0 }));
  const changeType = useRef<'push' | 'replace' | 'pop'>('push');

  // A new screen starts at its heading; changing a filter on the same screen
  // keeps the current position.
  useLayoutEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [path]);

  useEffect(() => {
    const pushed = () => { changeType.current = 'push'; };
    const replaced = () => { changeType.current = 'replace'; };
    const popped = () => { changeType.current = 'pop'; };
    window.addEventListener('pushState', pushed);
    window.addEventListener('replaceState', replaced);
    window.addEventListener('popstate', popped);
    return () => {
      window.removeEventListener('pushState', pushed);
      window.removeEventListener('replaceState', replaced);
      window.removeEventListener('popstate', popped);
    };
  }, []);

  useLayoutEffect(() => {
    const kind = changeType.current;
    changeType.current = 'push';
    setTrail(current => {
      if (current.entries[current.index] === route) return current;
      if (kind === 'replace') {
        const entries = [...current.entries];
        entries[current.index] = route;
        return { entries, index: current.index };
      }
      if (kind === 'pop') {
        const previous = current.entries.lastIndexOf(route, current.index - 1);
        const next = current.entries.indexOf(route, current.index + 1);
        if (current.index > 0 && previous >= 0) return { ...current, index: previous };
        if (next >= 0) return { ...current, index: next };
        return { entries: [route], index: 0 };
      }
      const entries = [...current.entries.slice(0, current.index + 1), route].slice(-80);
      return { entries, index: entries.length - 1 };
    });
  }, [route]);

  const goBack = useCallback((fallback = '/') => {
    const target = trail.index > 0 ? trail.entries[trail.index - 1] : fallback;
    // The trail contains only Wouter locations. Keep the fallback local as well.
    if (!target.startsWith('/') || target.startsWith('//') || target === route) return;
    if (trail.index > 0) setTrail(current => ({ ...current, index: Math.max(0, current.index - 1) }));
    navigate(target, { replace: true });
  }, [navigate, route, trail]);

  const goForward = useCallback(() => {
    const target = trail.entries[trail.index + 1];
    if (!target || !target.startsWith('/') || target.startsWith('//')) return;
    setTrail(current => ({ ...current, index: Math.min(current.entries.length - 1, current.index + 1) }));
    navigate(target, { replace: true });
  }, [navigate, trail]);

  return <AppNavigationContext.Provider value={{ canGoBack: trail.index > 0, canGoForward: trail.index < trail.entries.length - 1, goBack, goForward }}>{children}</AppNavigationContext.Provider>;
}

export function AppHistoryButtons({ fallback }: { fallback?: string }) {
  const navigation = useContext(AppNavigationContext);
  return <nav className="workspace-history" aria-label="История переходов"><AppBackButton fallback={fallback}/><button className="app-back-button" type="button" aria-label="Вперёд" title="Вперёд" disabled={!navigation?.canGoForward} onClick={() => navigation?.goForward()} data-testid="button-app-forward"><ArrowRight size={19} aria-hidden="true"/></button></nav>;
}

export function AppBackButton({ fallback }: { fallback?: string }) {
  const navigation = useContext(AppNavigationContext);
  const [path] = useLocation();
  const defaultFallback = path.startsWith('/candidate/') ? '/candidate'
    : path.startsWith('/employer/') ? '/employer'
      : path === '/quality' ? '/about' : '/';
  const destination = fallback || defaultFallback;
  const disabled = !navigation || (!navigation.canGoBack && path === destination);
  return <button className="app-back-button" type="button" aria-label="Назад" title={disabled ? 'Вы на главной странице' : 'Назад'} disabled={disabled} onClick={() => navigation?.goBack(destination)} data-testid="button-app-back"><ArrowLeft size={22} strokeWidth={2.1} aria-hidden="true" /></button>;
}
