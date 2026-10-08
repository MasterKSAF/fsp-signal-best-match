import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fingerprint, Link2Off, Save } from 'lucide-react';
import { api, Dialog } from './product-enhancements';
import { InlineInfo } from './inline-info';
import { useResumeSelection } from './multi-resume';
import './fsp-connection.css';

type FspConnection = {
  status: 'unlinked' | 'pending' | 'connected_demo' | 'unavailable'; fspId: string | null;
  importAvailable: boolean; verifiedAt: string | null; provenance: 'user_supplied' | 'synthetic_fixture' | null;
};
const statusLabels = { unlinked: 'Не добавлен', pending: 'Не подтверждён', connected_demo: 'Demo · спортивная история', unavailable: 'Не подтверждён' };

/** The same identity operation is used in normal and isolated demo accounts. */
export function FspConnectionSection() {
  const owner = useResumeSelection().userId; const connectionKey = ['/api/me/fsp-connection', owner];
  const client = useQueryClient();
  const query = useQuery({ queryKey: connectionKey, queryFn: () => api<FspConnection>('/api/me/fsp-connection'), enabled: !!owner });
  const [open, setOpen] = useState(false); const [fspId, setFspId] = useState('');
  const [consent, setConsent] = useState(false); const [confirmUnlink, setConfirmUnlink] = useState(false); const [feedback, setFeedback] = useState('');
  useEffect(() => { if (query.data) setFspId(query.data.fspId ?? ''); }, [query.data?.fspId]);
  const complete = (data: FspConnection) => {
    client.setQueryData(connectionKey, data); void client.invalidateQueries({queryKey:['selected-candidate-profile']}); void client.invalidateQueries({queryKey:['candidate-resumes']});
    setFspId(data.fspId ?? ''); setConsent(false); setConfirmUnlink(false);
    setFeedback(data.status === 'unlinked' ? 'ФСП ID отвязан.' : 'ФСП ID сохранён.');
  };
  const save = useMutation({ mutationFn: () => api<FspConnection>('/api/me/fsp-connection', { method: 'PUT', body: JSON.stringify({ fspId: fspId.trim() }) }), onSuccess: complete });
  const unlink = useMutation({ mutationFn: () => api<FspConnection>('/api/me/fsp-connection', { method: 'DELETE' }), onSuccess: complete });
  const importHistory = useMutation({mutationFn: () => api<FspConnection>('/api/me/fsp-connection/import',{method:'POST',body:JSON.stringify({consentImport:true})}),onSuccess:complete});
  const data = query.data; const busy = save.isPending || unlink.isPending || importHistory.isPending;
  const mutationError = save.error || unlink.error || importHistory.error;
  const close = () => { if (!busy) { setOpen(false); setConfirmUnlink(false); setConsent(false); } };
  return <><button type="button" className="button secondary fsp-id-button" aria-haspopup="dialog" onClick={() => { setFspId(data?.fspId ?? ''); setOpen(true); setFeedback(''); save.reset(); unlink.reset(); importHistory.reset(); }}><Fingerprint size={16}/>ФСП ID</button>
    {open && <Dialog title="ФСП ID" onClose={close}><div className="fsp-id-dialog" data-testid="fsp-connection"><h2><Fingerprint size={19}/>ФСП ID<InlineInfo label="О ФСП ID">Сохранение ID не подтверждает владение им и не даёт преимуществ в подборе. Импорт достижений требует отдельного согласия и подключённого реестра.</InlineInfo></h2>
      {query.isPending && <p role="status">Загружаем…</p>}{query.isError && <div className="form-error" role="alert">Не удалось загрузить ФСП ID.<button type="button" className="text-link" onClick={() => void query.refetch()}>Повторить</button></div>}
      {data && <><form className="fsp-id-form" onSubmit={e => { e.preventDefault(); if (!busy && fspId.trim()) { setFeedback(''); save.mutate(); } }}><label htmlFor="fsp-id">Идентификатор</label><input id="fsp-id" className="input" autoComplete="off" spellCheck={false} maxLength={100} value={fspId} onChange={e => { setFspId(e.target.value); setFeedback(''); save.reset(); }} disabled={busy}/>{data.fspId && <span className="fsp-id-status">{statusLabels[data.status]}</span>}<div className="fsp-connection-actions"><button type="submit" className="button primary" disabled={busy || !fspId.trim()}><Save size={16}/>{save.isPending ? 'Сохраняем…' : 'Сохранить'}</button>{data.fspId && <button type="button" className="button text-button" disabled={busy} onClick={() => { setConfirmUnlink(true); setFeedback(''); }}><Link2Off size={15}/>Отвязать</button>}</div></form>
      <div className="fsp-import"><span>Импорт достижений</span><InlineInfo label="Доступность импорта ФСП">{data.importAvailable ? 'Достижения загружаются только после отдельного согласия и подтверждения аккаунта ФСП.' : 'Реестр ФСП ещё не подключён. Введённый ID хранится без официального подтверждения.'}</InlineInfo>{data.importAvailable && <><label className="fsp-consent"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} disabled={busy}/><span>Разрешаю получать сведения об участии и достижениях из реестра ФСП для профиля и подбора. Согласие можно отозвать.</span></label><button type="button" className="button secondary" disabled={busy || !consent || !data.fspId} onClick={() => importHistory.mutate()}>Импортировать</button></>}</div></>}
      {mutationError && <p className="form-error" role="alert">{mutationError.message}</p>}{feedback && <p className="fsp-connection-feedback" role="status">{feedback}</p>}
      {confirmUnlink && <div className="fsp-unlink-confirm"><strong>Отвязать ФСП ID?</strong><p>Согласие на импорт будет отозвано, сведения ФСП удалятся из профиля и подбора. Проверки навыков сохранятся.</p><div className="fsp-connection-actions"><button type="button" className="button primary" disabled={busy} onClick={() => unlink.mutate()}>{unlink.isPending ? 'Отвязываем…' : 'Отвязать'}</button><button type="button" className="button secondary" disabled={busy} onClick={() => setConfirmUnlink(false)}>Отмена</button></div></div>}
    </div></Dialog>}
  </>;
}
