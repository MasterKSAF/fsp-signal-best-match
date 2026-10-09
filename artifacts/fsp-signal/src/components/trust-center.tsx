import { useGetCurrentUser } from '@workspace/api-client-react';
import { FormField } from './form-field';
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { Ban, Flag, ShieldCheck, MessageSquarePlus } from 'lucide-react';
import { resumeRequest } from './multi-resume';
import { Dialog } from './product-enhancements';
import './trust-center.css';

type Complaint = { id: number; objectType: string; objectId: number; companyId: number | null; category: string; explanation: string; status: string; decisionReason: string | null; createdAt: string };
type Restriction = { id: number; scope: string; publicReason: string; expiresAt: string; liftedAt: string | null; appeal?: { status: string } | null };
const categories = { spam: 'Спам', misleading: 'Недостоверное предложение', discrimination: 'Дискриминация', inappropriate: 'Неприемлемое сообщение', privacy: 'Нарушение доступа к данным', other: 'Другая причина' };
const serviceCategories = { question:'Вопрос о сервисе', technical:'Техническая проблема', other:'Другое обращение' };
const statuses: Record<string, string> = { submitted: 'Сохранено', in_review:'На рассмотрении', open: 'Сохранено', pending: 'Ожидает рассмотрения', reviewing: 'На рассмотрении', dismissed: 'Отклонено', restricted: 'Ограничение назначено', upheld: 'Подтверждено', accepted: 'Оспаривание принято', rejected: 'Оспаривание отклонено', resolved: 'Рассмотрено' };
const restrictionScopes: Record<string, string> = { invitations: 'Приглашения', contacts: 'Доступ к контактам', publishing: 'Публикация вакансий', all: 'Все взаимодействия' };
const dt = (value: string) => new Date(value).toLocaleString('ru-RU');
function useTrustAction() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ path, body }: { path: string; body?: unknown }) => resumeRequest<any>(path, { method: path.endsWith('/block') ? 'PUT' : 'POST', body: JSON.stringify(body ?? {}) }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['trust'] }); qc.invalidateQueries({ queryKey: ['public-jobs'] }); qc.invalidateQueries({ queryKey: ['contact-permissions'] }); qc.invalidateQueries({ queryKey: ['employer-restrictions'] }); } });
}
export function CompanyTrustActions({ companyId, objectType = 'company', objectId = companyId }: { companyId: number; objectType?: 'company' | 'invitation' | 'job'; objectId?: number }) {
  const [reportOpen, setReportOpen] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);
  const [category, setCategory] = useState<keyof typeof categories>('spam');
  const [explanation, setExplanation] = useState('');
  const [intent] = useState(() => crypto.randomUUID());
  const action = useTrustAction();
  const submit = (event: FormEvent) => { event.preventDefault(); action.mutate({ path: '/me/complaints', body: { objectType, objectId, category, explanation, idempotencyKey: intent } }); };
  return <div className="trust-actions"><div className="button-row"><button className="button text-button" onClick={() => { setReportOpen(!reportOpen); action.reset(); }}><Flag size={14}/> Пожаловаться</button><button className="button text-button" disabled={action.isPending} onClick={() => setBlockOpen(true)}><Ban size={14}/> Заблокировать компанию</button></div>{blockOpen && <Dialog title="Заблокировать компанию?" onClose={() => setBlockOpen(false)}><h2>Заблокировать компанию?</h2><p>Компания не сможет приглашать вас по любому из ваших резюме. Ранее открытые контакты закроются.</p><div className="button-row"><button className="button secondary" onClick={() => setBlockOpen(false)}>Отмена</button><button className="button primary" disabled={action.isPending} onClick={() => { action.mutate({ path: `/me/companies/${companyId}/block`, body: { blocked: true } }, { onSuccess: () => setBlockOpen(false) }); }}>Подтвердить блокировку</button></div>{action.isError && <p role="alert">{action.error.message}</p>}</Dialog>}{reportOpen && <form className="panel form-panel" onSubmit={submit}><h3>Сообщить о проблеме</h3><FormField className="field" label="Причина"><select className="input" value={category} onChange={event => setCategory(event.target.value as keyof typeof categories)}>{Object.entries(categories).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></FormField><FormField className="field" label="Пояснение — необязательно"><textarea className="input textarea" maxLength={2000} value={explanation} onChange={event => setExplanation(event.target.value)}/></FormField><p className="muted">Обращение увидит модератор. Работодатель не получит ваше имя, контакты и текст обращения. Подача жалобы сама по себе не ограничивает компанию.</p><button className="button primary" disabled={action.isPending || action.isSuccess}>Отправить обращение</button></form>}{action.isError && <p role="alert">{action.error.message}</p>}{action.isSuccess && <p role="status">{action.data?.complaint ? 'Обращение сохранено. Статус доступен в разделе «Обращения и доступ».' : 'Компания заблокирована; управление доступно в разделе «Обращения и доступ».'}</p>}</div>;
}
function ServiceMessageForm({onClose}:{onClose:()=>void}) {
  const user = useGetCurrentUser().data?.user;
  const [category,setCategory] = useState<keyof typeof serviceCategories>('question');
  const [explanation,setExplanation] = useState('');
  const [intent] = useState(()=>crypto.randomUUID());
  const action=useTrustAction();
  return <Dialog title="Написать администратору" onClose={onClose}><h2>Написать администратору</h2><form className="form-panel" onSubmit={event=>{event.preventDefault();if(user&&!action.isPending)action.mutate({path:'/me/complaints',body:{objectType:'service',objectId:user.id,category,explanation,idempotencyKey:intent}},{onSuccess:onClose});}}>
    <FormField label="Тема"><select className="input" value={category} onChange={event=>setCategory(event.target.value as keyof typeof serviceCategories)}>{Object.entries(serviceCategories).map(([key,label])=><option value={key} key={key}>{label}</option>)}</select></FormField>
    <FormField label="Сообщение"><textarea className="input textarea" autoFocus required minLength={10} maxLength={2000} rows={5} value={explanation} onChange={event=>setExplanation(event.target.value)} placeholder="Опишите вопрос или проблему"/></FormField>
    <p className="muted">Ответ появится здесь после рассмотрения обращения.</p>
    {action.isError&&<p role="alert" className="form-error">{action.error.message}</p>}
    <div className="form-actions"><button className="button secondary" type="button" onClick={onClose}>Отмена</button><button className="button primary" disabled={!user||action.isPending||explanation.trim().length<10}>{action.isPending?'Отправляем…':'Отправить'}</button></div>
  </form></Dialog>;
}
function OwnComplaints() {
  const user = useGetCurrentUser().data?.user;
  const [compose,setCompose]=useState(false);
  const complaints=useQuery({queryKey:['trust','complaints',user?.id],queryFn:()=>resumeRequest<{complaints:Complaint[]}>('/me/complaints'),enabled:!!user});
  return <section className="panel"><div className="trust-section-heading"><h2>Мои обращения</h2><button className="button secondary" onClick={()=>setCompose(true)}><MessageSquarePlus size={17}/>Написать администратору</button></div>
    {complaints.isPending?<p role="status">Загружаем…</p>:complaints.isError?<p role="alert">{complaints.error.message}</p>:!complaints.data?.complaints.length?<p>У вас пока нет обращений.</p>:complaints.data.complaints.map(item=><article className="detail-section" key={item.id}><h3>Обращение №{item.id} · {serviceCategories[item.category as keyof typeof serviceCategories]||categories[item.category as keyof typeof categories]||item.category}</h3><span className="badge">{statuses[item.status]||item.status}</span><p className="trust-message">{item.explanation||'Без пояснения'}</p>{item.decisionReason&&<p>Ответ: {item.decisionReason}</p>}<time dateTime={item.createdAt}>{dt(item.createdAt)}</time></article>)}
    {compose&&<ServiceMessageForm onClose={()=>setCompose(false)}/>}
  </section>;
}
export function CandidateTrustCenter() {
  const user=useGetCurrentUser().data?.user;
  const blocks = useQuery({queryKey:['trust','blocks',user?.id],queryFn:()=>resumeRequest<{blocks:{companyId:number;companyName:string;active:boolean;blockedAt:string}[]}>('/me/company-blocks'),enabled:!!user});
  const action=useTrustAction();
  return <div className="trust-center-page"><div className="page-title"><div><h1>Обращения и доступ</h1></div><ShieldCheck size={26}/></div><div className="trust-center-panels"><OwnComplaints/><section className="panel"><h2>Заблокированные компании</h2>{blocks.isPending?<p role="status">Загружаем…</p>:blocks.isError?<p role="alert">{blocks.error.message}</p>:!blocks.data?.blocks.some(row=>row.active)?<p>Вы не блокировали компании.</p>:blocks.data.blocks.filter(row=>row.active).map(row=><article className="detail-section" key={row.companyId}><h3>{row.companyName}</h3><p>Заблокирована {dt(row.blockedAt)}</p><button className="button secondary" disabled={action.isPending} onClick={()=>action.mutate({path:`/me/companies/${row.companyId}/block`,body:{blocked:false}})}>Разблокировать</button></article>)}<p className="muted">Разблокировка не восстанавливает отозванное согласие на контакты.</p>{action.isError&&<p role="alert">{action.error.message}</p>}</section></div></div>;
}

function AppealForm({ restriction }: { restriction: Restriction }) {
  const [explanation, setExplanation] = useState('');
  const action = useTrustAction();
  return <article className="detail-section"><h2>Ограничение №{restriction.id}</h2><p>{restriction.publicReason}</p><p>Область: {restrictionScopes[restriction.scope] || 'Взаимодействия с компанией'} · до {dt(restriction.expiresAt)}{restriction.liftedAt ? ' · снято' : ''}</p>{restriction.appeal ? <p>Оспаривание: {statuses[restriction.appeal.status] || restriction.appeal.status}</p> : <form onSubmit={event => { event.preventDefault(); action.mutate({ path: `/employer/restrictions/${restriction.id}/appeals`, body: { explanation } }); }}><FormField className="field" label="Основание оспаривания"><textarea className="input textarea" required minLength={10} maxLength={2000} value={explanation} onChange={event => setExplanation(event.target.value)}/></FormField><button className="button secondary" disabled={action.isPending}>Отправить оспаривание</button></form>}{action.isError && <p role="alert">{action.error.message}</p>}</article>;
}
export function EmployerTrustCenter() {
  const query = useQuery({ queryKey: ['trust', 'restrictions'], queryFn: () => resumeRequest<{ restrictions: Restriction[] }>('/employer/restrictions') });
  return <><div className="page-title"><div><h1>Обращения и ограничения</h1><p>Основания ограничений компании и возможность оспаривания.</p></div></div><OwnComplaints/><section className="panel">{query.isPending ? <p role="status">Загружаем…</p> : query.isError ? <p role="alert">{query.error.message}</p> : !query.data?.restrictions.length ? <p>Ограничений компании нет.</p> : query.data.restrictions.map(row => <AppealForm restriction={row} key={row.id}/>)}</section></>;
}
function ComplaintReview({ complaint }: { complaint: Complaint }) {
  const [decision, setDecision] = useState('review');
  const [reason, setReason] = useState('');
  const [scope, setScope] = useState('invitations');
  const [hours, setHours] = useState(24);
  const action = useTrustAction();
  return <article className="panel form-panel"><h2>Обращение №{complaint.id}</h2><p>{complaint.objectType==='service'?'Обращение о сервисе':`Компания №${complaint.companyId} · ${complaint.objectType} №${complaint.objectId}`}</p><span className="badge">{statuses[complaint.status] || complaint.status}</span><p>{serviceCategories[complaint.category as keyof typeof serviceCategories]||categories[complaint.category as keyof typeof categories]}</p><p>{complaint.explanation || 'Без пояснения'}</p><form onSubmit={event => { event.preventDefault(); action.mutate({ path: `/moderation/complaints/${complaint.id}/decision`, body: { action: decision, reason, scope, durationHours: hours, publicReasonCode: complaint.category } }); }}><FormField className="field" label="Решение"><select className="input" value={decision} onChange={event => setDecision(event.target.value)}><option value="review">Взять на рассмотрение</option><option value="dismiss">Отклонить обращение</option>{complaint.objectType==='service'?<option value="resolve">Ответить и завершить</option>:<option value="restrict">Подтвердить и ограничить компанию</option>}</select></FormField><FormField className="field" label="Основание решения"><textarea className="input textarea" required minLength={5} maxLength={2000} value={reason} onChange={event => setReason(event.target.value)}/></FormField>{decision === 'restrict' && <><FormField className="field" label="Область ограничения"><select className="input" value={scope} onChange={event => setScope(event.target.value)}><option value="invitations">Приглашения</option><option value="contacts">Контакты</option><option value="publishing">Публикация</option><option value="all">Все взаимодействия</option></select></FormField><FormField className="field" label="Срок, часов"><input className="input" type="number" min={1} max={720} required value={hours} onChange={event => setHours(Number(event.target.value))}/></FormField></>}<button className="button primary" disabled={action.isPending}>Сохранить решение</button></form>{action.isError && <p role="alert">{action.error.message}</p>}{action.isSuccess && <p role="status">Решение сохранено в журнале.</p>}</article>;
}
function AppealReview({ appeal }: { appeal: any }) {
  const [reason, setReason] = useState('');
  const action = useTrustAction();
  return <article className="panel form-panel"><h2>Оспаривание №{appeal.id}</h2><p>{appeal.explanation}</p><p>{statuses[appeal.status] || appeal.status}</p><FormField className="field" label="Основание"><textarea className="input textarea" minLength={5} maxLength={2000} value={reason} onChange={event => setReason(event.target.value)}/></FormField><div className="button-row">{['accept', 'reject'].map(decision => <button className="button secondary" disabled={action.isPending || reason.trim().length < 5} key={decision} onClick={() => action.mutate({ path: `/moderation/appeals/${appeal.id}/decision`, body: { action: decision, reason } })}>{decision === 'accept' ? 'Принять и снять ограничение' : 'Отклонить'}</button>)}</div>{action.isError && <p role="alert">{action.error.message}</p>}</article>;
}
export function ModerationCenter() {
  const access = useQuery({ queryKey: ['trust', 'access'], queryFn: () => resumeRequest<{ moderator: boolean }>('/me/trust-status') });
  const queue = useQuery({ queryKey: ['trust', 'queue'], queryFn: () => resumeRequest<{ complaints: Complaint[]; appeals: any[] }>('/moderation/queue'), enabled: access.data?.moderator === true });
  const audit = useQuery({ queryKey: ['trust', 'audit'], queryFn: () => resumeRequest<{ events: any[] }>('/moderation/audit'), enabled: access.data?.moderator === true });
  const [restrictionId, setRestrictionId] = useState(''); const [reason, setReason] = useState(''); const action = useTrustAction();
  if (access.isPending) return <p role="status">Проверяем права…</p>;
  if (!access.data?.moderator) return <section className="panel"><h1>Доступ ограничен</h1><p>Раздел доступен только уполномоченному модератору.</p><Link className="button secondary" href="/">На главную</Link></section>;
  return <><div className="page-title"><div><h1>Рассмотрение обращений</h1><p>Содержание обращений доступно только модераторам; жалоба не означает установленного нарушения.</p></div></div>{queue.isPending ? <p role="status">Загружаем очередь…</p> : queue.isError ? <p role="alert">{queue.error.message}</p> : <>{!queue.data?.complaints.length && <section className="panel">Очередь обращений пуста.</section>}{queue.data?.complaints.map(row => <ComplaintReview complaint={row} key={row.id}/>)}{queue.data?.appeals.map(row => <AppealReview appeal={row} key={row.id}/>)}</>}<section className="panel"><h2>Снять ограничение</h2><form onSubmit={event => { event.preventDefault(); action.mutate({ path: `/moderation/restrictions/${restrictionId}/lift`, body: { reason } }); }}><FormField className="field" label="Номер ограничения"><input className="input" type="number" min={1} required value={restrictionId} onChange={event => setRestrictionId(event.target.value)}/></FormField><FormField className="field" label="Основание снятия"><textarea className="input textarea" required minLength={5} maxLength={2000} value={reason} onChange={event => setReason(event.target.value)}/></FormField><button className="button secondary" disabled={action.isPending}>Снять ограничение</button></form>{action.isError && <p role="alert">{action.error.message}</p>}</section><section className="panel"><h2>Журнал действий</h2>{audit.isError ? <p role="alert">Журнал недоступен.</p> : audit.data?.events.map(event => <p key={event.id}>#{event.id} · {event.action} · {event.reason} · {dt(event.createdAt)}</p>)}</section></>;
}
