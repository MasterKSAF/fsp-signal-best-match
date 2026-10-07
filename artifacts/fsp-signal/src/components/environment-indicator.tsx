import { useEffect, useId, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import './environment-indicator.css';

/** The lamp distinguishes account mode from an observed connection failure. */
export function EnvironmentIndicator({ isDemo, isReview = false }: { isDemo: boolean; isReview?: boolean }) {
  const [open, setOpen] = useState(false);
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const changed = () => setOnline(navigator.onLine);
    window.addEventListener('online', changed); window.addEventListener('offline', changed);
    return () => { window.removeEventListener('online', changed); window.removeEventListener('offline', changed); };
  }, []);
  const health = useQuery({
    queryKey: ['service-connection'],
    queryFn: async ({ signal }) => {
      const response = await fetch('/api/healthz', { signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]), cache: 'no-store' });
      if (!response.ok || (await response.json()).status !== 'ok') throw new Error('Server is not reachable');
      return true;
    },
    enabled: online, staleTime: 30000, refetchInterval: 60000, refetchIntervalInBackground: false, retry: 1,
  });
  const root = useRef<HTMLDivElement>(null);
  const tooltipId = useId();
  const unavailable = !online || health.isError;
  const label = unavailable ? 'Нет связи с сервером' : isReview ? 'Самостоятельная проверка' : isDemo ? 'Demo' : 'Личный аккаунт';
  const explanation = unavailable
    ? `Проверьте подключение. Последний режим: ${isDemo ? 'Demo' : 'личный аккаунт'}. Повторим проверку автоматически.`
    : isReview
    ? 'Ваш отдельный проверочный аккаунт. Экзамен формируется и оценивается сервером; результаты и ограничения сохраняются только для вас. Данные вымышленные.'
    : isDemo
    ? 'Демонстрационный аккаунт с вымышленными данными для знакомства с сервисом.'
    : 'Вы работаете со своими данными и настройками.';

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);

  return <div ref={root} className={`environment-indicator ${unavailable ? 'environment-indicator--unavailable' : isDemo ? 'environment-indicator--demo' : 'environment-indicator--personal'}`}
    onPointerEnter={event => { if (event.pointerType !== 'touch') setOpen(true); }}
    onPointerLeave={event => { if (event.pointerType !== 'touch' && !root.current?.contains(document.activeElement)) setOpen(false); }}>
    <button type="button" className="environment-indicator__trigger" aria-label={`Режим аккаунта: ${label}`} aria-describedby={open ? tooltipId : undefined} aria-expanded={open} aria-controls={tooltipId}
      onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onClick={() => setOpen(true)} data-testid="account-environment">
      <span className="environment-indicator__lamp" aria-hidden="true" />
    </button>
    {open && <div className="environment-indicator__tooltip" id={tooltipId} role="tooltip"><strong>{label}</strong><span>{explanation}</span></div>}
  </div>;
}
