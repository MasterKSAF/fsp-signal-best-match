import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CircleHelp, Clock3, Fingerprint, Link2, Link2Off, ShieldCheck, Trophy } from 'lucide-react';
import { api, Dialog } from './product-enhancements';
import './fsp-connection.css';

type FspConnection = {
  status: 'unlinked' | 'pending' | 'connected_demo' | 'unavailable';
  fspId: string | null;
  demoAvailable: boolean;
  demoFixtureId: string | null;
  hasHistory: boolean;
  achievements: { id: string; title: string; event: string; occurredAt: string; kind: 'participation' | 'placement' | 'rank' }[];
  requestedAt: string | null;
  consentedAt: string | null;
  verifiedAt: string | null;
  importedAt: string | null;
  revokedAt: string | null;
  provenance: 'user_supplied' | 'synthetic_fixture' | null;
  providerVersion: string | null;
  message: string;
};
const connectionKey = ['/api/me/fsp-connection'];
const statusLabels = { unlinked: 'Не добавлен', pending: 'Ожидает подключения', connected_demo: 'История на примере', unavailable: 'Временно недоступно' };
const readableDate = (date: string) => new Date(date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Moscow' });

export function FspConnectionSection() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: connectionKey, queryFn: () => api<FspConnection>('/api/me/fsp-connection') });
  const [fspId, setFspId] = useState('');
  const [consent, setConsent] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const [feedback, setFeedback] = useState('');
  useEffect(() => { if (query.data) setFspId(query.data.fspId ?? ''); }, [query.data?.fspId]);
  const complete = (data: FspConnection) => {
    client.setQueryData(connectionKey, data);
    void client.invalidateQueries();
    setEditing(false); setConsent(false); setConfirmUnlink(false);
    setFeedback(data.status === 'unlinked' ? 'ФСП ID отвязан. Согласие на импорт отозвано, сведения удалены из профиля и подбора.' : data.status === 'connected_demo' ? 'Пример спортивной истории добавлен.' : 'ФСП ID сохранён. Пока он не подтверждён.');
  };
  const save = useMutation({ mutationFn: () => api<FspConnection>('/api/me/fsp-connection', { method: 'PUT', body: JSON.stringify({ fspId: fspId.trim(), consentImport: consent }) }), onSuccess: complete });
  const unlink = useMutation({ mutationFn: () => api<FspConnection>('/api/me/fsp-connection', { method: 'DELETE' }), onSuccess: complete });
  const data = query.data;
  const busy = save.isPending || unlink.isPending;
  const showEditor = !!data && (!data.fspId || editing);
  const mutationError = save.error || unlink.error;
  return <section className="panel fsp-connection" aria-labelledby="fsp-connection-title" data-testid="fsp-connection">
    <div className="fsp-connection-heading"><span className="fsp-connection-icon"><Fingerprint size={23} /></span><div><h2 id="fsp-connection-title">Спортивные достижения</h2><p>Свяжите профиль с ФСП ID</p></div>{data && <span className={`fsp-connection-status ${data.status}`}>{data.status === 'pending' ? <Clock3 size={13} /> : data.status === 'connected_demo' ? <Check size={13} /> : null}{statusLabels[data.status]}</span>}</div>
    {query.isLoading && <p role="status" className="fsp-connection-muted">Загружаем сведения ФСП…</p>}
    {query.isError && <div className="fsp-connection-notice" role="alert"><p>Не удалось загрузить сведения. Остальные разделы профиля доступны.</p><button type="button" className="button secondary" onClick={() => void query.refetch()}>Повторить</button></div>}
    {data && <>
      <p className="fsp-connection-message">{data.message}</p>
      {data.fspId && !editing && <div className="fsp-connection-id"><div><span>ФСП ID</span><b>{data.fspId}</b></div><div className="fsp-connection-actions no-print"><button type="button" className="button secondary" disabled={busy} onClick={() => { setEditing(true); setFeedback(''); save.reset(); unlink.reset(); }}>Изменить</button><button type="button" className="button text-button" disabled={busy} onClick={() => setConfirmUnlink(true)}><Link2Off size={15} />Отвязать</button></div></div>}
      {data.achievements.length > 0 && <ul className="fsp-achievements" aria-label="Спортивная история">{data.achievements.map((achievement) => <li key={achievement.id}><span className="fsp-achievement-icon"><Trophy size={19} /></span><div><b>{achievement.title}</b><p>{achievement.event}</p><time dateTime={achievement.occurredAt}>{readableDate(achievement.occurredAt)}</time></div></li>)}</ul>}
      {showEditor && <div className="fsp-connection-editor no-print">
        <label htmlFor="fsp-id">Ваш ФСП ID</label>
        <div className="fsp-connection-input-row"><input id="fsp-id" autoComplete="off" spellCheck={false} maxLength={100} value={fspId} onChange={(event) => { setFspId(event.target.value); setFeedback(''); }} placeholder="Введите идентификатор" aria-describedby="fsp-id-help" disabled={busy} />{data.demoAvailable && data.demoFixtureId && <button type="button" className="button secondary" disabled={busy} onClick={() => { setFspId(data.demoFixtureId!); setConsent(false); }}>Заполнить пример</button>}</div>
        <p id="fsp-id-help" className="fsp-connection-help">Идентификатор из вашего профиля Федерации спортивного программирования. Ввод ID сам по себе не подтверждает владение им.</p>
        <label className="fsp-consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} disabled={busy} /><span>Разрешаю получать сведения об участии и достижениях из реестра ФСП для моего профиля и подбора. Согласие можно отозвать в любой момент.</span></label>
        <div className="fsp-connection-actions"><button type="button" className="button primary" disabled={busy || !consent || !fspId.trim()} onClick={() => { setFeedback(''); save.mutate(); }}><Link2 size={16} />{save.isPending ? 'Сохраняем…' : fspId === data.demoFixtureId ? 'Добавить пример' : 'Сохранить ФСП ID'}</button>{editing && <button type="button" className="button text-button" disabled={busy} onClick={() => { setEditing(false); setFspId(data.fspId ?? ''); setConsent(false); }}>Отмена</button>}</div>
      </div>}
      <details className="fsp-connection-details"><summary><CircleHelp size={15} />Как используются сведения</summary><p>Спортивная история дополняет результаты проверки навыков. Отсутствие ФСП ID не мешает пройти проверку, подтвердить уровень или получить приглашение. Самостоятельно указанный ID не даёт преимуществ в подборе.</p><p>Реестр ФСП пока не подключён. После подключения сервиса потребуется подтвердить свой аккаунт ФСП и повторно разрешить импорт. Примеры достижений доступны только в аккаунтах с примерами.</p>{data.importedAt && <p>Пример обновлён {readableDate(data.importedAt)}. Источник: вымышленная спортивная история.</p>}{data.consentedAt && !data.revokedAt && <p><ShieldCheck size={14} /> Согласие на импорт сохранено {readableDate(data.consentedAt)}.</p>}{data.revokedAt && <p>Согласие отозвано {readableDate(data.revokedAt)}.</p>}</details>
    </>}
    {mutationError && <p className="fsp-connection-error" role="alert">{mutationError.message}</p>}
    {feedback && <p className="fsp-connection-feedback" role="status">{feedback}</p>}
    {confirmUnlink && <Dialog title="Отвязать ФСП ID" onClose={() => { if (!busy) setConfirmUnlink(false); }}><h2>Отвязать ФСП ID?</h2><p className="fsp-connection-message">Согласие на импорт будет отозвано, а сведения ФСП удалены из профиля и подбора. Результаты проверки навыков сохранятся. Вы сможете добавить ID снова.</p><div className="fsp-connection-actions"><button type="button" className="button primary" disabled={busy} onClick={() => { setFeedback(''); unlink.mutate(); }}>{unlink.isPending ? 'Отвязываем…' : 'Отвязать'}</button><button type="button" className="button secondary" disabled={busy} onClick={() => setConfirmUnlink(false)}>Оставить</button></div>{unlink.error && <p role="alert" className="fsp-connection-error">{unlink.error.message}</p>}</Dialog>}
  </section>;
}
