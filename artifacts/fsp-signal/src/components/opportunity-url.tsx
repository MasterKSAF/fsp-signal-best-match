import { useLocation, useSearch } from 'wouter';
export function useOpportunityUrl() {
  const [location, navigate] = useLocation(), search = useSearch();
  const params = new URLSearchParams(search);
  const change = (values: Record<string, string | number | null>, replace = false) => {
    const next = new URLSearchParams(search);
    for (const [key, value] of Object.entries(values)) value === null || value === '' ? next.delete(key) : next.set(key, String(value));
    navigate(`${location}${next.size ? `?${next}` : ''}`, { replace });
  };
  return { params, change, search };
}
export type OpportunityPage<T> = { items: T[]; total: number; page: number; pageSize: number; pageCount: number; exportLimit?: number; applicationPolicy?: string };
export function opportunityCount(count:number, one:string, few:string, many:string) {
  const form = new Intl.PluralRules('ru-RU').select(count);
  return `${count.toLocaleString('ru-RU')} ${form==='one'?one:form==='few'?few:many}`;
}
export function ResultsPager({ total, page, pageCount, change }: { total: number; page: number; pageCount: number; change: (page: number) => void }) {
  return <nav className="discovery-pagination" aria-label="Страницы результатов"><span>{opportunityCount(total,'результат','результата','результатов')}</span>{pageCount > 1 && <><button className="button secondary" disabled={page <= 1} onClick={() => change(page-1)} aria-label="Предыдущая страница">Назад</button><span>{page} / {pageCount}</span><button className="button secondary" disabled={page >= pageCount} onClick={() => change(page+1)} aria-label="Следующая страница">Далее</button></>}</nav>;
}
