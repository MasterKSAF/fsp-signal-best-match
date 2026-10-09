import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useSearch } from 'wouter';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as Popover from '@radix-ui/react-popover';
import { ArrowLeft, ArrowRight, BadgeCheck, Check, ChevronDown, CircleHelp, Search, Send, SlidersHorizontal, Star, Users, X } from 'lucide-react';
import { getGetCurrentUserQueryKey, useGetCurrentUser } from '@workspace/api-client-react';
import { FormField } from './form-field';
import { InlineInfo } from './inline-info';
import { DictionaryCombobox, useSkillDictionary } from './dictionary-input';
import { CITY_OPTIONS, WORK_FORMAT_OPTIONS, type DictionaryOption } from '../lib/professional-dictionaries';
import { catalogContextCaption, professionLabel } from '../lib/employer-workspace-navigation';
import { contextRequirements, requirementLabel, requirementModeLabel, invitationDraft, type RequirementMode, type SkillRequirement } from '../lib/context-requirements';
import { candidateGradeSummary, selectionMismatchReasons, type SelectionMatchView } from '../lib/selection-presentation';
import { reconcileSelectionAccess, selectionAccessBlocked, type SelectionAccessIdentity } from '../lib/employer-selection-access';
import { pendingInvitationConflictId, selectionContextReadOnly } from '../lib/employer-selection-actions';
import { employerSkillChips, SkillChips, SkillLegend, type SkillChipItem } from './skill-chip';
import { ResumeDocumentButton } from './my-resumes';
import {
  activeSelectionFilters, emptySelectionFilters, readSelectionState, selectionContextKey, selectionDraftKey,
  selectionHref, selectionParams, selectionScopeState, selectionViewState, splitSelectionSkills, type SelectionContext, type SelectionFilters, type SelectionState,
} from '../lib/employer-selection-state';
import './employer-selection.css';

export type EmployerSelectionContext = {
  type: 'job' | 'need'; id: number; version: number; title: string; specialization: string; grade: string;
  requiredSkills: string[]; requiredSkillLevels?: Record<string, 'Junior' | 'Middle' | 'Senior'>; desirableSkills?: string[];
  skillRequirements?: SkillRequirement[]; gradeMode?: RequirementMode;
  description?: string; workFormat: string; salaryMin: number | null; salaryMax: number | null;
  salaryPeriod: 'month' | 'year'; salaryType: 'gross' | 'net'; status?: string; shortlistCount: number; readOnly?: boolean;
};
type SelectionMatch = SelectionMatchView;
type AvailableResume = { id?: number; resumeId?: number; title: string; specialization: string; grade?: string | null; verifiedGrade?: string | null };
type SelectionCandidate = {
  candidateId: number; resumeId: number; resumeRevision?: number; title: string; specialization: string; alias: string; publicName: string | null;
  avatarDataUrl: string | null; verifiedGrade: string | null; skillChips?: SkillChipItem[]; stack: string[];
  declaredGrade?: string | null;
  skillEvidence?: { skill: string; sourceType?: string; level?: string; programVersion?: string | null }[];
  skillProofs?: { skill: string; sourceType?: string; level?: string; programVersion?: string | null }[];
  yearsExperience: number | null; workFormat: string | null; location?: string | null;
  salaryMin: number | null; salaryMax: number | null; salaryPeriod: 'month' | 'year' | null; salaryType: 'gross' | 'net' | null;
  fspHistory?: boolean; shortlisted?: boolean; savedResumeId?: number; needsReview?: boolean; match?: SelectionMatch | null;
  availableResumes?: AvailableResume[];
};
type PracticeSummary = { title?: string; status?: string; result?: string; summary?: string };
type SelectionDetail = { candidate: SelectionCandidate; availableResumes: AvailableResume[]; context: EmployerSelectionContext | null; match?: SelectionMatch | null; practiceSummary?: PracticeSummary[] };
type SelectionResponse = { items: SelectionCandidate[]; total: number; page: number; pageSize: number; context: EmployerSelectionContext | null; unavailableShortlistCount?: number; specializations?: string[]; sort?: string; orderNote?: string };
type ComparedResponse = { items: SelectionCandidate[]; context: EmployerSelectionContext | null; summary?: string };
type ComparedChoice = { candidateId: number; resumeId: number; resumeRevision?: number };

const filterLabels: Record<keyof SelectionFilters, string> = {
  q: 'Имя', specialization: 'Должность', grade: 'Грейд', verifiedSkills: 'Подтверждённые', verifiedSkillsMode: 'Условие навыков',
  verifiedSkillLevel: 'Уровень навыков', declaredSkills: 'Заявленные', declaredSkillsMode: 'Условие навыков', experienceMin: 'Опыт от',
  workFormat: 'Формат', location: 'Локация', salaryMin: 'Зарплата от', salaryMax: 'Зарплата до', salaryPeriod: 'Период',
  salaryType: 'Расчёт', fsp: 'История ФСП', experienceMax: 'Опыт до', hasPhoto: 'Фото', readyForOffers: 'Готовность', checkedWithinDays: 'Проверка',
};
const displayName = (candidate: SelectionCandidate) => candidate.publicName?.trim() || candidate.alias;
const skillItems = (candidate: SelectionCandidate) => candidate.skillChips ?? employerSkillChips(candidate.stack ?? [], candidate.skillEvidence ?? candidate.skillProofs ?? []);
const contextClosed = (context: EmployerSelectionContext) => ['closed', 'archived', 'deleted'].includes(context.status ?? '');
const candidateSaveLabel = (candidate: SelectionCandidate) => candidate.shortlisted ? 'Убрать из отобранных' : candidate.savedResumeId && candidate.savedResumeId !== candidate.resumeId ? 'Выбрать это резюме' : 'В отобранные';
const salaryLabel = (candidate: Pick<SelectionCandidate, 'salaryMin' | 'salaryMax' | 'salaryPeriod' | 'salaryType'>) => {
  if (candidate.salaryMin == null && candidate.salaryMax == null) return 'Не указаны';
  const amount = candidate.salaryMin != null && candidate.salaryMax != null ? `${candidate.salaryMin.toLocaleString('ru-RU')}–${candidate.salaryMax.toLocaleString('ru-RU')}`
    : candidate.salaryMin != null ? `от ${candidate.salaryMin.toLocaleString('ru-RU')}` : `до ${candidate.salaryMax!.toLocaleString('ru-RU')}`;
  return `${amount} ₽${candidate.salaryPeriod ? ` / ${candidate.salaryPeriod === 'year' ? 'год' : 'месяц'}` : ''}${candidate.salaryType ? ` · ${candidate.salaryType === 'net' ? 'на руки' : 'до вычета'}` : ''}`;
};
class SelectionRequestError extends Error {
  constructor(message: string, readonly status: number, readonly retryAt?: string, readonly code?: string, readonly existingInvitationId?: number) { super(message); }
}
async function selectionRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...init, headers: { 'Content-Type': 'application/json', ...init.headers } });
  const data = await response.json();
  if (!response.ok) throw new SelectionRequestError(data.error || 'Не удалось выполнить запрос. Повторите попытку.', response.status, data.retryAt, data.code, data.existingInvitationId);
  return data as T;
}
function ScopeParams({ context, children }: { context: EmployerSelectionContext; children?: ReactNode }) {
  return <div className="selection-context-summary"><span className="selection-context-kind">{context.type === 'job' ? 'Моя вакансия' : 'Мой запрос'}</span><strong>{context.title}</strong><span>{context.grade || 'Грейд не указан'} · {requirementModeLabel(context.gradeMode).toLocaleLowerCase('ru-RU')}</span>{context.requiredSkills?.length > 0 && <span className="selection-requirement-text">{context.requiredSkills.slice(0, 4).join(' · ')}{context.requiredSkills.length > 4 ? ` +${context.requiredSkills.length - 4}` : ''}</span>}<InlineInfo label="Условия выбранной вакансии или запроса"><b>{context.title}</b><br/>{context.description || 'Описание не указано'}<br/>{context.workFormat} · {salaryLabel(context)}{context.requiredSkills?.length > 0 && <><br/>Требования: {contextRequirements(context).map(requirementLabel).join('; ')}</>}</InlineInfo>{children}</div>;
}
function ContextSelector({ contexts, value, onChange, disabled = false, label = 'Контекст подбора', allowCatalog = true, id, 'aria-describedby': describedBy }: {
  contexts: EmployerSelectionContext[]; value: SelectionContext; onChange: (value: SelectionContext) => void;
  disabled?: boolean; label?: string; allowCatalog?: boolean; id?: string; 'aria-describedby'?: string;
}) {
  const [open, setOpen] = useState(false), [search, setSearch] = useState(''), [active, setActive] = useState(0);
  const optionsId = `selection-context-${useId()}`;
  const selected = contexts.find(item => selectionContextKey(item) === selectionContextKey(value));
  const options = contexts.filter(item => `${item.title} ${professionLabel(item.specialization)}`.toLocaleLowerCase('ru-RU').includes(search.toLocaleLowerCase('ru-RU'))).sort((a,b) => a.type.localeCompare(b.type) || a.title.localeCompare(b.title, 'ru-RU') || a.id - b.id);
  const catalogVisible = allowCatalog && (!search || 'весь каталог'.includes(search.toLocaleLowerCase('ru-RU')));
  const flat: SelectionContext[] = [...(catalogVisible ? [null] : []), ...options];
  useEffect(() => { if (open) document.getElementById(`${optionsId}-${selectionContextKey(flat[active] ?? null)}`)?.scrollIntoView({ block: 'nearest' }); }, [active, open, search, options.length, optionsId]);
  const choose = (context: SelectionContext) => { onChange(context); setOpen(false); setSearch(''); setActive(0); };
  return <Popover.Root open={open} onOpenChange={next => { setOpen(next); if (!next) { setSearch(''); setActive(0); } }}><Popover.Trigger asChild><button type="button" disabled={disabled} id={id} aria-describedby={describedBy} className="selection-context-trigger input" aria-label={`${label}: ${selected?.title ?? (value ? 'Выбранный контекст' : 'Весь каталог')}`}><span>{selected ? `${selected.type==='job'?'Вакансия':'Запрос'}: ${selected.title}` : (value ? 'Выбранный контекст' : allowCatalog ? 'Весь каталог' : 'Выберите вакансию или запрос')}</span><ChevronDown size={16}/></button></Popover.Trigger><Popover.Portal><Popover.Content className="selection-context-popover" align="start" sideOffset={7} onEscapeKeyDown={event => event.stopPropagation()}><input className="input" placeholder="Найти вакансию или запрос" role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={optionsId} aria-label="Поиск вакансии или запроса" value={search} onChange={event => { setSearch(event.target.value); setActive(0); }} onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setActive(previous => flat.length ? (previous + (event.key === 'ArrowDown' ? 1 : -1) + flat.length) % flat.length : 0); } else if (event.key === 'Enter' && flat[active] !== undefined) { event.preventDefault(); choose(flat[active]); } }} aria-activedescendant={flat.length ? `${optionsId}-${selectionContextKey(flat[active] ?? null)}` : undefined}/><div className="selection-context-options" id={optionsId} role="listbox" aria-label={label}>{catalogVisible && <button type="button" role="option" id={`${optionsId}-catalog`} aria-selected={!value} className={active === 0 ? 'is-active' : ''} onClick={() => choose(null)}><Users size={15}/><span>Весь каталог</span>{!value && <Check size={14}/>}</button>}{(['job', 'need'] as const).map(type => <div key={type}>{options.some(item => item.type === type) && <div className="selection-context-group">{type === 'job' ? 'Вакансии' : 'Запросы'}</div>}{options.filter(item => item.type === type).map(item => <button type="button" role="option" id={`${optionsId}-${selectionContextKey(item)}`} key={selectionContextKey(item)} aria-selected={selectionContextKey(item) === selectionContextKey(value)} className={selectionContextKey(flat[active] ?? null) === selectionContextKey(item) ? 'is-active' : ''} onClick={() => choose(item)}><span><b>{item.title}</b><small>{item.grade || 'Без требуемого грейда'}</small></span>{selectionContextKey(item) === selectionContextKey(value) && <Check size={14}/>}</button>)}</div>)}{!flat.length && <p role="status">Ничего не найдено.</p>}</div></Popover.Content></Popover.Portal></Popover.Root>;
}
function SkillsFilter({ label, value, mode, level, onChange, onMode, onLevel, options, id, 'aria-describedby': describedBy }: {
  label: string; value: string; mode: string; level?: string; onChange: (value: string) => void;
  onMode: (value: string) => void; onLevel?: (value: string) => void; options: readonly DictionaryOption[]; id?: string; 'aria-describedby'?: string;
}) {
  const [search, setSearch] = useState('');
  const selected = splitSelectionSkills(value);
  const matches = options.filter(option => [option.value, ...(option.aliases ?? [])].some(text => text.toLocaleLowerCase().includes(search.toLocaleLowerCase()))).slice(0, 30);
  const toggle = (skill: string) => onChange((selected.includes(skill) ? selected.filter(item => item !== skill) : [...selected, skill]).join(','));
  return <Popover.Root><Popover.Trigger asChild><button type="button" id={id} aria-describedby={describedBy} className="input selection-filter-trigger" aria-label={`${label}: ${selected.length ? selected.join(', ') : 'любые'}`}><span>{selected.length ? `${selected[0]}${selected.length > 1 ? ` +${selected.length - 1}` : ''}` : 'Любые навыки'}</span><ChevronDown size={14}/></button></Popover.Trigger><Popover.Portal><Popover.Content className="selection-skills-popover" align="start" sideOffset={7} onEscapeKeyDown={event => event.stopPropagation()}><strong>{label}</strong><input className="input" placeholder="Найти или добавить навык" aria-label={`Найти: ${label.toLocaleLowerCase()}`} value={search} maxLength={100} onChange={event => setSearch(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && search.trim()) { event.preventDefault(); if (!selected.includes(search.trim())) toggle(search.trim()); setSearch(''); } }}/><div className="selection-skills-options">{selected.filter(item => !matches.some(option => option.value === item)).map(item => <label key={item}><input type="checkbox" checked onChange={() => toggle(item)}/>{item}</label>)}{matches.map(option => <label key={option.id ?? option.value}><input type="checkbox" checked={selected.includes(option.value)} onChange={() => toggle(option.value)}/>{option.label ?? option.value}</label>)}</div>{search.trim() && !matches.some(option => option.value.toLocaleLowerCase() === search.trim().toLocaleLowerCase()) && <button type="button" className="button ghost" onClick={() => { if (!selected.includes(search.trim())) toggle(search.trim()); setSearch(''); }}>Добавить «{search.trim()}»</button>}<label className="selection-small-label">Условие<select className="input" value={mode} onChange={event => onMode(event.target.value)}><option value="all">Все выбранные навыки (И)</option><option value="any">Любой выбранный навык (ИЛИ)</option></select></label>{onLevel && <label className="selection-small-label">Минимальный подтверждённый уровень<select className="input" value={level ?? ''} onChange={event => onLevel(event.target.value)}><option value="">Любой подтверждённый</option>{['Junior', 'Middle', 'Senior'].map(item => <option key={item}>{item}</option>)}</select></label>}</Popover.Content></Popover.Portal></Popover.Root>;
}
function SelectionDialog({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const returnFocus = useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  return <DialogPrimitive.Root open onOpenChange={open => { if (!open) onClose(); }}><DialogPrimitive.Portal><DialogPrimitive.Overlay className="selection-overlay"/><DialogPrimitive.Content className={`selection-dialog ${wide ? 'selection-dialog--wide' : ''}`} aria-describedby={undefined} onCloseAutoFocus={event => { event.preventDefault(); returnFocus.current?.focus(); }} onEscapeKeyDown={event => event.stopPropagation()}><DialogPrimitive.Title className="selection-dialog-title">{title}</DialogPrimitive.Title><DialogPrimitive.Close className="icon-button selection-dialog-close" aria-label="Закрыть"><X size={18}/></DialogPrimitive.Close>{children}</DialogPrimitive.Content></DialogPrimitive.Portal></DialogPrimitive.Root>;
}
function CandidateAvatar({ candidate, onZoom }: { candidate: SelectionCandidate; onZoom?: () => void }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [candidate.avatarDataUrl]);
  const photo = candidate.publicName?.trim() && candidate.avatarDataUrl && !failed;
  const contents = photo ? <img src={candidate.avatarDataUrl!} alt={`Фото: ${displayName(candidate)}`} onError={() => setFailed(true)}/> : <span aria-hidden="true">{displayName(candidate).trim().slice(0, 1).toLocaleUpperCase('ru-RU') || '?'}</span>;
  return photo && onZoom ? <button className="selection-avatar" type="button" onClick={onZoom} aria-label={`Увеличить фото: ${displayName(candidate)}`}>{contents}</button> : <div className="selection-avatar">{contents}</div>;
}
function CandidateFacts({ candidate }: { candidate: SelectionCandidate }) {
  return <dl className="selection-facts">{candidate.yearsExperience != null && <><dt>Опыт</dt><dd>{candidate.yearsExperience} лет <InlineInfo label="Источник опыта">Общий опыт указан кандидатом.</InlineInfo></dd></>}{candidate.workFormat && <><dt>Формат</dt><dd>{candidate.workFormat}</dd></>}{candidate.location && <><dt>Локация</dt><dd>{candidate.location}</dd></>}<dt>Ожидания</dt><dd>{salaryLabel(candidate)}</dd></dl>;
}
function CandidateGrades({ candidate }: { candidate: SelectionCandidate }) {
  return <section className="selection-grade-facts" aria-label="Грейд выбранного резюме"><div className="selection-grade"><span>Подтверждённый грейд</span><strong>{candidate.verifiedGrade ? <><BadgeCheck size={17}/>{candidate.verifiedGrade}</> : <><CircleHelp className="selection-grade-unverified" size={17}/>Не подтверждён</>}</strong></div><div className="selection-grade selection-grade-declared"><span>Заявленный грейд</span><strong>{candidate.declaredGrade || 'Не указан'}</strong></div></section>;
}
function MatchSummary({ match, context }: { match?: SelectionMatch | null; context?: EmployerSelectionContext | null }) {
  const reasons = selectionMismatchReasons(match, context);
  return <div className="selection-match"><div><span>Соответствие требованиям</span><strong>{match?.score != null ? `${Number(match.score.toFixed(1))} / 100` : 'Не рассчитано'}</strong></div>{match?.summary && <InlineInfo label="Расчёт соответствия">{match.summary}</InlineInfo>}{reasons.length > 0 && <><ul className="selection-match-reasons" aria-label="Причины расхождения">{reasons.map(reason => <li key={reason}>{reason}</li>)}</ul><small>Резюме можно сохранить в отбор. Приглашение доступно после выполнения требований.</small></>}{match?.salaryNote && <span className="selection-salary-note">Зарплата не сопоставлена<InlineInfo label="Почему зарплата не сопоставлена">{match.salaryNote}</InlineInfo></span>}</div>;
}
function CompareDialog({ choices, state, userKey, onClose }: { choices: ComparedChoice[]; state: SelectionState; userKey: number | undefined; onClose: () => void }) {
  const compare = useQuery({ queryKey: ['employer-selection-compare', userKey, selectionContextKey(state.context), state.view, state.mode, choices], queryFn: ({ signal }) => selectionRequest<ComparedResponse>('/api/employer/selection/compare', { method: 'POST', signal, body: JSON.stringify({ context: state.context, view: state.view, ...(state.mode && state.view !== 'shortlisted' ? { mode: state.mode } : {}), resumeIds: choices.map(item => item.resumeId) }) }), staleTime: 0, gcTime: 0, retry: false, refetchInterval: 5000, refetchOnWindowFocus: 'always' });
  return <SelectionDialog title={`Сравнение специалистов · ${choices.length}`} wide onClose={onClose}>{compare.isPending ? <p role="status">Проверяем доступ и сравниваем резюме…</p> : compare.isError ? <p role="alert">{compare.error.message}<button className="button secondary" onClick={() => compare.refetch()}>Повторить</button></p> : compare.data && <>{compare.data.summary && <p className="muted">{compare.data.summary}</p>}<SkillLegend/><div className="selection-compare-grid">{compare.data.items.map(candidate => <article className="selection-compare-person" key={candidate.candidateId}><h3>{displayName(candidate)}</h3><p>{professionLabel(candidate.title || candidate.specialization)}</p><CandidateGrades candidate={candidate}/>{state.context && <MatchSummary match={candidate.match} context={compare.data.context}/>}<SkillChips items={skillItems(candidate)} limit={6}/><CandidateFacts candidate={candidate}/></article>)}</div></>}</SelectionDialog>;
}
function InviteDialog({ context, candidate, userKey, onClose, onSent }: { context: EmployerSelectionContext; candidate: ComparedChoice; userKey: number | undefined; onClose: () => void; onSent: () => void }) {
  const [, navigate] = useLocation();
  const intent = useRef(crypto.randomUUID());
  const fresh = useQuery({ queryKey: ['employer-selection-invite-access', userKey, selectionContextKey(context), candidate.resumeId], queryFn: ({ signal }) => selectionRequest<SelectionDetail>(`/api/employer/selection/resumes/${candidate.resumeId}?contextType=${context.type}&contextId=${context.id}`, { signal }), staleTime: 0, gcTime: 0, retry: false, refetchInterval: 5000, refetchOnWindowFocus: 'always' });
  const send = useMutation({ mutationFn: (payload: Record<string, unknown>) => selectionRequest('/api/employer/invitations', { method: 'POST', body: JSON.stringify(payload) }), onSuccess: onSent });
  const conflictId = send.error instanceof SelectionRequestError ? pendingInvitationConflictId(send.error.status, send.error.code, send.error.existingInvitationId) : null;
  const liveContext = fresh.data?.context ?? context;
  const initialText = invitationDraft(context);
  const visible = !fresh.isPending && !fresh.isError && fresh.data?.candidate.candidateId === candidate.candidateId;
  const changed = liveContext.version !== context.version || (candidate.resumeRevision != null && fresh.data?.candidate.resumeRevision !== candidate.resumeRevision);
  const allowed = visible && !changed && fresh.data?.match?.eligible === true && !contextClosed(liveContext) && !selectionContextReadOnly(liveContext);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!allowed || send.isPending || conflictId) return;
    const fields = new FormData(event.currentTarget);
    send.mutate({ idempotencyKey: intent.current, ...(context.type === 'job' ? { jobId: context.id } : { needId: context.id }), contextVersion: context.version, candidateId: candidate.candidateId, resumeId: candidate.resumeId, resumeRevision: candidate.resumeRevision ?? fresh.data?.candidate.resumeRevision, title: String(fields.get('title')), message: String(fields.get('message')), reason: String(fields.get('reason')), salaryMin: Number(fields.get('salaryMin')), salaryMax: Number(fields.get('salaryMax')), salaryPeriod: fields.get('salaryPeriod'), salaryType: fields.get('salaryType'), workFormat: String(fields.get('workFormat')) });
  };
  return <SelectionDialog title="Подготовить приглашение" onClose={() => { if (!send.isPending) onClose(); }}>{fresh.isPending ? <p role="status">Проверяем выбранное резюме…</p> : fresh.isError ? <p role="alert">{fresh.error.message}<button className="button secondary" onClick={() => fresh.refetch()}>Повторить</button></p> : visible && <><p><b>{displayName(fresh.data!.candidate)}</b> · {professionLabel(fresh.data!.candidate.title)}</p><ScopeParams context={liveContext}/>{fresh.data?.match?.eligible === false && <MatchSummary match={fresh.data.match} context={liveContext}/>}<p className="muted">Ниже — текст и условия, которые получит кандидат, вместе с профилем компании. Внутренние заметки запроса не отправляются.</p><form className="selection-invite-form" onSubmit={submit}><FormField label="Тема"><input className="input" name="title" required minLength={3} maxLength={160} defaultValue={initialText.title}/></FormField><FormField label="Сообщение кандидату"><textarea className="input" rows={3} name="message" required minLength={10} maxLength={3000} defaultValue={initialText.message}/></FormField><FormField label="Почему мы заинтересованы"><textarea className="input" rows={2} name="reason" required minLength={10} maxLength={3000} defaultValue="Нам интересно ваше резюме. Хотели бы подробнее обсудить опыт и задачи команды."/></FormField><fieldset className="selection-invite-conditions" disabled={send.isPending}><legend>Отправляемые условия</legend><FormField label="Зарплата от, ₽" layout="vertical"><input className="input" name="salaryMin" type="number" required min={1} max={100000000} defaultValue={liveContext.salaryMin??undefined}/></FormField><FormField label="Зарплата до, ₽" layout="vertical"><input className="input" name="salaryMax" type="number" required min={1} max={100000000} defaultValue={liveContext.salaryMax??undefined}/></FormField><FormField label="Период" layout="vertical"><select className="input" name="salaryPeriod" defaultValue={liveContext.salaryPeriod}><option value="month">В месяц</option><option value="year">В год</option></select></FormField><FormField label="Налоги" layout="vertical"><select className="input" name="salaryType" defaultValue={liveContext.salaryType}><option value="gross">До вычета налогов</option><option value="net">На руки</option></select></FormField><FormField label="Формат работы" layout="vertical"><input className="input" name="workFormat" required maxLength={120} defaultValue={liveContext.workFormat}/></FormField></fieldset>{!allowed && <p role="alert">{changed ? 'Условия или резюме изменились. Закройте подготовку и откройте приглашение снова.' : 'Приглашение сейчас недоступно для этого контекста и резюме.'}</p>}{send.isError && <div className="selection-error" role="alert"><p>{send.error.message}{send.error instanceof SelectionRequestError && send.error.retryAt && <> Следующая отправка: {new Date(send.error.retryAt).toLocaleString('ru-RU')}.</>}</p>{conflictId && <><p>Новое приглашение с выбранным резюме или условиями не отправлено. Действующее приглашение сохранено.</p><button type="button" className="button secondary" onClick={() => { onClose(); navigate(`/employer/invitations?invitationId=${conflictId}`); }}>Открыть существующее приглашение</button></>}</div>}<button className="button primary" type="submit" disabled={!allowed || send.isPending || !!conflictId}>{send.isPending ? 'Отправляем…' : 'Отправить приглашение'}<Send size={16}/></button></form></>}</SelectionDialog>;
}

export function EmployerSelectionPage() {
  const [pathname, navigate] = useLocation();
  const search = useSearch();
  const state = useMemo(() => readSelectionState(search, pathname), [search, pathname]);
  const [draft, setDraft] = useState<SelectionState>(state);
  const [extraOpen, setExtraOpen] = useState(false);
  const [choices, setChoices] = useState<ComparedChoice[]>([]);
  const [comparisonOpen, setComparisonOpen] = useState(false);
  const [photoOpen, setPhotoOpen] = useState(false);
  const [contextAction, setContextAction] = useState<'save' | 'invite' | null>(null);
  const [actionContext, setActionContext] = useState<SelectionContext>(null);
  const [invite, setInvite] = useState<{ context: EmployerSelectionContext; candidate: ComparedChoice } | null>(null);
  const [notice, setNotice] = useState('');
  const [mutationError, setMutationError] = useState('');
  const consumedInvite = useRef('');
  const photoIntent = useRef<number | null>(null);
  const invalidatedAccessChange = useRef('');
  const qc = useQueryClient();
  const session = useGetCurrentUser({ query: { retry: false, queryKey: getGetCurrentUserQueryKey() } });
  const userKey = session.data?.user.id;
  const contexts = useQuery({ queryKey: ['employer-selection-contexts', userKey], queryFn: ({ signal }) => selectionRequest<{ contexts: EmployerSelectionContext[] }>('/api/employer/selection/contexts', { signal }), staleTime: 0, gcTime: 0, retry: false, refetchOnWindowFocus: 'always' });
  const contextItems = contexts.isError ? [] : contexts.data?.contexts ?? [];
  const dictionary = useSkillDictionary();
  useEffect(() => { setDraft(state); setMutationError(''); setNotice(''); }, [state]);
  const draftKey = selectionDraftKey(draft), appliedKey = selectionDraftKey(state);
  const dirty = draftKey !== appliedKey;
  const appliedScope = `${appliedKey}:${state.sort}:${state.direction}:${state.view}`;
  useEffect(() => { setChoices([]); setComparisonOpen(false); setPhotoOpen(false); photoIntent.current = null; setContextAction(null); setInvite(null); setMutationError(''); }, [draftKey, appliedScope]);
  const params = selectionParams(state, true).toString();
  const searchable = state.applied && !dirty && !state.invalidContext;
  const list = useQuery({ queryKey: ['employer-selection', userKey, params], enabled: searchable, queryFn: ({ signal }) => selectionRequest<SelectionResponse>(`/api/employer/selection?${params}`, { signal }), staleTime: 0, gcTime: 0, retry: false, refetchOnWindowFocus: 'always' });
  const results = searchable && !list.isError && !list.isPending ? list.data : undefined;
  const visibleResumeIds = useMemo(() => results?.items.map(item => item.resumeId) ?? [], [results]);
  const accessMode = state.view === 'shortlisted' ? undefined : state.mode;
  const access = useQuery({
    queryKey: ['employer-selection-access', userKey, params, list.dataUpdatedAt, visibleResumeIds],
    enabled: searchable && visibleResumeIds.length > 0,
    queryFn: ({ signal }) => selectionRequest<{ items: SelectionAccessIdentity[] }>('/api/employer/selection/access', { method: 'POST', signal, body: JSON.stringify({ context: state.context, view: state.view, ...(accessMode ? { mode: accessMode } : {}), resumeIds: visibleResumeIds }) }),
    staleTime: 0, gcTime: 0, retry: false, refetchInterval: 5000, refetchOnWindowFocus: 'always',
  });
  const accessBlocked = selectionAccessBlocked(access);
  const selectedResumeId = state.resumeId ?? results?.items[0]?.resumeId ?? null;
  const detailContextParams = new URLSearchParams();
  if (state.context) { detailContextParams.set('contextType', state.context.type); detailContextParams.set('contextId', String(state.context.id)); }
  if (accessMode) detailContextParams.set('mode', accessMode);
  detailContextParams.set('view', state.view);
  const detail = useQuery({ queryKey: ['employer-selection-detail', userKey, selectionContextKey(state.context), accessMode, state.view, selectedResumeId], enabled: searchable && !!selectedResumeId && !!results, queryFn: ({ signal }) => selectionRequest<SelectionDetail>(`/api/employer/selection/resumes/${selectedResumeId}?${detailContextParams}`, { signal }), staleTime: 0, gcTime: 0, retry: false, refetchInterval: 5000, refetchOnWindowFocus: 'always' });
  const rawProfile = searchable && results && !detail.isError && !detail.isPending ? detail.data : undefined;
  const rowAccess = reconcileSelectionAccess(results?.items ?? [], access.data?.items, { failed: accessBlocked, detail: rawProfile?.candidate, detailCheckedAt: detail.dataUpdatedAt, accessCheckedAt: access.dataUpdatedAt, sourceCheckedAt: list.dataUpdatedAt });
  const visibleCandidates = rowAccess.items;
  const sourceCandidate = results?.items.find(item => item.resumeId === rawProfile?.candidate.resumeId);
  const sourceProfile = rawProfile && sourceCandidate && list.dataUpdatedAt > detail.dataUpdatedAt
    ? sourceCandidate.resumeRevision === rawProfile.candidate.resumeRevision
      ? { ...rawProfile.candidate, alias: sourceCandidate.alias, publicName: sourceCandidate.publicName, avatarDataUrl: sourceCandidate.publicName?.trim() ? sourceCandidate.avatarDataUrl : null }
      : undefined
    : rawProfile?.candidate;
  const checkedProfile = sourceProfile && (visibleResumeIds.includes(sourceProfile.resumeId)
    ? reconcileSelectionAccess([sourceProfile], access.data?.items, { failed: accessBlocked, detail: sourceProfile, detailCheckedAt: detail.dataUpdatedAt, accessCheckedAt: access.dataUpdatedAt, sourceCheckedAt: list.dataUpdatedAt }).items[0]
    : accessBlocked ? undefined : sourceProfile);
  const profile = rawProfile && checkedProfile ? { ...rawProfile, candidate: checkedProfile } : undefined;
  const selected = profile?.candidate;
  const accessChange = rowAccess.changedResumeIds.length ? JSON.stringify([params, rowAccess.changedResumeIds, visibleCandidates.filter(item => rowAccess.changedResumeIds.includes(item.resumeId)).map(item => [item.resumeId, item.alias, item.publicName, item.avatarDataUrl])]) : '';
  useEffect(() => {
    if (!accessChange && access.isSuccess && !accessBlocked && !list.isFetching) { invalidatedAccessChange.current = ''; return; }
    if (!accessChange || invalidatedAccessChange.current === accessChange) return;
    invalidatedAccessChange.current = accessChange;
    void qc.invalidateQueries({ queryKey: ['employer-selection', userKey, params], exact: true });
  }, [accessChange, access.isSuccess, accessBlocked, list.isFetching, qc, userKey, params]);
  const draftContext = contextItems.find(item => selectionContextKey(item) === selectionContextKey(draft.context));
  const liveContext = profile?.context ?? results?.context ?? contextItems.find(item => selectionContextKey(item) === selectionContextKey(state.context)) ?? null;
  const readOnly = selectionContextReadOnly(liveContext);
  const draftReadOnly = selectionContextReadOnly(draftContext) || selectionContextKey(draft.context) === selectionContextKey(state.context) && readOnly;
  const searchLabel = draftReadOnly ? 'Применить фильтры' : draft.context ? 'Подобрать' : 'Найти';
  useEffect(() => { if (readOnly) { setInvite(null); setContextAction(null); } }, [readOnly]);
  const changedRequirements = !!profile?.context && !!results?.context && profile.context.version !== results.context.version;
  useEffect(() => {
    if (!changedRequirements) return;
    setChoices([]); setComparisonOpen(false); setInvite(null); setContextAction(null);
    void qc.invalidateQueries({queryKey:['employer-selection',userKey]});
    void qc.invalidateQueries({queryKey:['employer-selection-contexts',userKey]});
  }, [changedRequirements,profile?.context?.version,results?.context?.version,qc,userKey]);
  useEffect(() => { if (!searchable || detail.isError || list.isError || accessBlocked || rowAccess.hiddenResumeIds.includes(selectedResumeId ?? -1)) { setPhotoOpen(false); photoIntent.current = null; setInvite(null); setContextAction(null); setComparisonOpen(false); setChoices([]); } }, [searchable, detail.isError, list.isError, accessBlocked, selectedResumeId, rowAccess.hiddenResumeIds.join(',')]);
  useEffect(() => { if (photoOpen && (!selected?.publicName || !selected?.avatarDataUrl)) setPhotoOpen(false); }, [photoOpen, selected?.publicName, selected?.avatarDataUrl]);
  useEffect(() => { if (selected?.resumeId === photoIntent.current) { photoIntent.current = null; if (selected.publicName && selected.avatarDataUrl) setPhotoOpen(true); } }, [selected]);
  useEffect(() => {
    if (!state.invite || readOnly || !profile || !liveContext || !selected || (state.candidateId && state.candidateId !== selected.candidateId)) return;
    const key = `${selectionContextKey(state.context)}:${selected.resumeId}:${search}`;
    if (consumedInvite.current === key) return;
    consumedInvite.current = key;
    setInvite({ context: liveContext, candidate: { candidateId: selected.candidateId, resumeId: selected.resumeId, resumeRevision: selected.resumeRevision } });
  }, [state.invite, readOnly, profile, liveContext, selected, state.candidateId, state.context, search]);
  const invalidate = async () => {
    await Promise.all([['employer-selection'], ['employer-selection-contexts'], ['employer-shortlist'], ['employer-jobs'], ['employer-needs']].map(queryKey => qc.invalidateQueries({ queryKey })));
    window.dispatchEvent(new CustomEvent('signal-shortlist-changed'));
  };
  const shortlist = useMutation({ mutationFn: (input: { context: EmployerSelectionContext; candidate: ComparedChoice; remove: boolean }) => selectionRequest<{ shortlistCount: number; item?: { needsReview?: boolean; match?: SelectionMatch | null } }>('/api/employer/shortlist', { method: input.remove ? 'DELETE' : 'PUT', body: JSON.stringify({ context: { type: input.context.type, id: input.context.id }, candidateId: input.candidate.candidateId, ...(!input.remove ? { resumeId: input.candidate.resumeId, contextVersion: input.context.version } : {}) }) }), onSuccess: async (_result, input) => { setMutationError(''); setNotice(input.remove ? 'Кандидат убран из отобранных.' : _result.item?.needsReview ? 'Резюме сохранено. Есть расхождение с требованиями — пересмотрите его перед приглашением.' : 'Кандидат сохранён в этом контексте.'); setContextAction(null); if(!state.context)go({...state,context:{type:input.context.type,id:input.context.id},mode:'catalog',applied:true,resumeId:input.candidate.resumeId,candidateId:input.candidate.candidateId,invite:false}); await invalidate(); }, onError: error => { setMutationError(error.message); } });
  const update = (key: keyof SelectionFilters, value: string) => setDraft(current => ({ ...current, filters: { ...current.filters, [key]: value } }));
  const go = (next: SelectionState) => navigate(selectionHref(next));
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); go({ ...draft, ...(draftReadOnly ? { view: 'shortlisted' as const, mode: undefined } : {}), applied: true, page: 1, resumeId: null, candidateId: null, invite: false }); };
  const switchContext = (context: SelectionContext) => {
    const next = selectionScopeState(draft, context, selectionContextReadOnly(contextItems.find(item => selectionContextKey(item) === selectionContextKey(context))));
    setDraft(next); go(next);
  };
  const saveCandidate = (candidate: SelectionCandidate) => {
    if (readOnly) return;
    setMutationError('');
    if (!liveContext) { setContextAction('save'); setActionContext(null); return; }
    shortlist.mutate({ context: liveContext, candidate, remove: !!candidate.shortlisted });
  };
  const prepareInvite = () => {
    if (!selected || readOnly) return;
    if (!liveContext || state.mode === 'catalog') { setContextAction('invite'); setActionContext(liveContext ?? null); return; }
    setInvite({ context: liveContext, candidate: selected });
  };
  const contextActionContinue = () => {
    const selectedContext = contextItems.find(item => selectionContextKey(item) === selectionContextKey(actionContext));
    if (!selectedContext || !selected || contextClosed(selectedContext) || readOnly) return;
    if (contextAction === 'save') shortlist.mutate({ context: selectedContext, candidate: selected, remove: false });
    if (contextAction === 'invite') { setContextAction(null); go({...state,context:{type:selectedContext.type,id:selectedContext.id},mode:'catalog',applied:true,invalidContext:false,resumeId:selected.resumeId,candidateId:selected.candidateId,invite:true,page:1}); }
  };
  const toggleCompare = (candidate: SelectionCandidate) => {
    setChoices(current => current.some(item => item.candidateId === candidate.candidateId) ? current.filter(item => item.candidateId !== candidate.candidateId) : current.length < 4 ? [...current, { candidateId: candidate.candidateId, resumeId: candidate.resumeId }] : current);
  };
  const chooseResume = (resumeId: number, candidateId: number) => {
    setChoices(current => current.map(item => item.candidateId === candidateId ? { candidateId, resumeId } : item));
    setInvite(null); setPhotoOpen(false); go({ ...state, resumeId, candidateId, invite: false });
  };
  const zoomCandidate = (candidate: SelectionCandidate) => {
    if (selected?.resumeId === candidate.resumeId) setPhotoOpen(true);
    else { photoIntent.current = candidate.resumeId; chooseResume(candidate.resumeId, candidate.candidateId); }
  };
  const input = (key: keyof SelectionFilters, label: string, numeric = false, placeholder?: string) => <FormField label={label} layout="vertical" className="selection-field"><input className="input" id={`selection-${key}`} type={numeric ? 'number' : 'text'} min={numeric ? 0 : undefined} max={numeric ? key === 'experienceMin' || key === 'experienceMax' ? 80 : 2000000000 : undefined} step={numeric ? 1 : undefined} value={draft.filters[key]} onChange={event => update(key, event.target.value)} placeholder={placeholder} maxLength={numeric ? undefined : key === 'q' ? 120 : 160}/></FormField>;
  const select = (key: keyof SelectionFilters, label: string, options: { value: string; label: string }[]) => <FormField label={label} layout="vertical" className="selection-field"><select id={`selection-${key}`} className="input" value={draft.filters[key]} onChange={event => update(key, event.target.value)}>{options.map(option => <option value={option.value} key={option.value}>{option.label}</option>)}</select></FormField>;
  const activeFilters = activeSelectionFilters(draft.filters);
  const returnContext = !draft.context && draft.returnContext ? contextItems.find(item => selectionContextKey(item) === selectionContextKey(draft.returnContext!)) : undefined;
  const specializations = [...new Set([...contextItems.map(item => item.specialization), ...(results?.specializations ?? []), 'Backend / Python', 'Frontend / TypeScript'])].filter(Boolean);
  const totalPages = results ? Math.max(1, Math.ceil(results.total / results.pageSize)) : 1;
  return <section className="employer-selection" data-accent="employer">
    <div className="page-title selection-title"><h1>Подбор специалистов<InlineInfo label="О подборе специалистов">Выберите весь каталог, свою вакансию или приватный запрос. Фильтры применяются к одному целому резюме; контакты доступны по отдельному согласию.</InlineInfo></h1></div>
    <form className="panel selection-filters" onSubmit={submit} aria-label="Поиск специалистов">
      <div className="selection-context-row"><FormField label="Искать для" layout="vertical" className="selection-context-field"><ContextSelector contexts={contextItems} value={draft.context} onChange={switchContext}/></FormField><button type="submit" className="button primary selection-search-button" disabled={draft.invalidContext || list.isFetching && !dirty}><Search size={16}/>{searchLabel}</button><button type="button" className="button ghost selection-more-button" onClick={() => setExtraOpen(previous => !previous)} aria-expanded={extraOpen} aria-controls="selection-extra"><SlidersHorizontal size={15}/>Ещё фильтры{activeFilters.length > 0 && <span className="selection-filter-count">{activeFilters.length}</span>}</button></div>
      {(draftContext || returnContext) && <div className="selection-quick-view">{draftContext && <label className="selection-shortlist-filter"><input type="checkbox" checked={draft.view === 'shortlisted'} disabled={draftReadOnly} onChange={event => go(selectionViewState(draft, event.target.checked))}/><Star size={15} aria-hidden="true"/><span>Только отобранные</span><b>{draftContext.shortlistCount}</b></label>}{returnContext && <button type="button" className="selection-return-shortlist" onClick={() => switchContext(returnContext)}><Star size={15} aria-hidden="true"/><span>Вернуться к отобранным <b>{returnContext.title}</b></span><ArrowRight size={15} aria-hidden="true"/></button>}</div>}
      {contexts.isPending && <p className="selection-inline-state" role="status">Загружаем ваши вакансии и запросы…</p>}{contexts.isError && <div className="selection-inline-state" role="alert">{contexts.error.message}<button type="button" className="button ghost" onClick={() => contexts.refetch()}>Повторить</button></div>}
      {draftContext && <ScopeParams context={draftContext}/>} {draftReadOnly && <p className="selection-inline-state" role="status">Основание закрыто. Можно просматривать и фильтровать прежний отбор. Изменение списка и новые приглашения недоступны.</p>} {draft.mode === 'catalog' && draftContext && <p className="selection-inline-state">{catalogContextCaption(draftContext.type)}</p>}
      <div className="selection-filter-grid">
        {input('q', 'ФИО или псевдоним', false, 'Разрешённое имя')}
        {select('specialization', 'Должность / направление', [{ value: '', label: 'Любое направление' }, ...specializations.map(value => ({ value, label: professionLabel(value) }))])}
        {select('grade', 'Подтверждённый грейд', [{ value: '', label: 'Любой' }, ...['Junior', 'Middle', 'Senior'].map(value => ({ value, label: value })), ...(!draft.context || draft.mode === 'catalog' ? [{ value: 'unconfirmed', label: 'Не подтверждён' }] : [])])}
        {input('experienceMin', 'Опыт от, лет', true)}
        <FormField label="Подтверждённые навыки" layout="vertical" className="selection-field"><SkillsFilter label="Подтверждённые навыки" value={draft.filters.verifiedSkills} mode={draft.filters.verifiedSkillsMode} level={draft.filters.verifiedSkillLevel} onChange={value => update('verifiedSkills', value)} onMode={value => update('verifiedSkillsMode', value)} onLevel={value => update('verifiedSkillLevel', value)} options={dictionary.data ?? []}/></FormField>
        <FormField label="Заявленные навыки" layout="vertical" className="selection-field"><SkillsFilter label="Заявленные навыки" value={draft.filters.declaredSkills} mode={draft.filters.declaredSkillsMode} onChange={value => update('declaredSkills', value)} onMode={value => update('declaredSkillsMode', value)} options={dictionary.data ?? []}/></FormField>
        <FormField label="Формат работы" layout="vertical" className="selection-field"><DictionaryCombobox value={draft.filters.workFormat} onChange={value => update('workFormat', value)} options={WORK_FORMAT_OPTIONS} placeholder="Любой формат" maxLength={120}/></FormField>
      </div>
      {extraOpen && <div id="selection-extra" className="selection-extra-grid">
        <FormField label="Локация" layout="vertical" className="selection-field"><DictionaryCombobox value={draft.filters.location} onChange={value => update('location', value)} options={CITY_OPTIONS} placeholder="Любая или свой вариант" maxLength={160}/></FormField>
        {input('salaryMin', 'Зарплата от, ₽', true)}{input('salaryMax', 'Зарплата до, ₽', true)}
        {select('salaryPeriod', 'Период зарплаты', [{ value: 'month', label: 'Месяц' }, { value: 'year', label: 'Год' }])}
        {select('salaryType', 'Расчёт зарплаты', [{ value: 'gross', label: 'До вычета налогов' }, { value: 'net', label: 'На руки' }])}
        {select('fsp', 'История ФСП', [{ value: '', label: 'Неважно' }, { value: 'yes', label: 'Есть подтверждённая история' }, { value: 'no', label: 'Нет подтверждённой истории' }])}
        {input('experienceMax', 'Опыт до, лет', true)}
        {select('hasPhoto', 'Доступное фото', [{ value: '', label: 'Неважно' }, { value: 'yes', label: 'Есть' }, { value: 'no', label: 'Нет' }])}
        {select('readyForOffers', 'Готов к предложениям', [{ value: '', label: 'Неважно' }, { value: 'yes', label: 'Готов' }, { value: 'no', label: 'Не указано' }])}
        {select('checkedWithinDays', 'Проверка навыков', [{ value: '', label: 'Любая давность' }, { value: '30', label: 'За 30 дней' }, { value: '90', label: 'За 90 дней' }, { value: '180', label: 'За 180 дней' }])}
      </div>}
      {activeFilters.length > 0 && <div className="selection-active-filters" aria-label="Выбранные фильтры">{activeFilters.map(key => <button type="button" className="selection-filter-chip" key={key} onClick={() => update(key, '')} aria-label={`Убрать фильтр: ${filterLabels[key]}`}><span>{filterLabels[key]}: {key === 'specialization' ? professionLabel(draft.filters[key]) : key === 'grade' && draft.filters[key] === 'unconfirmed' ? 'не подтверждён' : key === 'fsp' || key === 'hasPhoto' || key === 'readyForOffers' ? draft.filters[key] === 'yes' ? 'да' : 'нет' : key === 'verifiedSkills' || key === 'declaredSkills' ? `${splitSelectionSkills(draft.filters[key]).join(', ')} · ${draft.filters[key === 'verifiedSkills' ? 'verifiedSkillsMode' : 'declaredSkillsMode'] === 'any' ? 'ИЛИ' : 'И'}` : draft.filters[key]}</span><X size={12}/></button>)}<button type="button" className="button ghost" onClick={() => setDraft(current => ({ ...current, filters: { ...emptySelectionFilters } }))}>Сбросить</button></div>}
    </form>
    {notice && <p className="selection-notice" role="status">{notice}</p>}{mutationError && <p className="selection-error" role="alert">{mutationError}</p>}
    {state.invalidContext ? <div className="state-panel selection-work-state" role="alert"><h2>Проверьте выбранный контекст</h2><p>В ссылке некорректно указана вакансия или запрос. Выберите контекст заново.</p></div> : dirty ? <div className="state-panel selection-work-state" role="status"><Search size={22}/><h2>Фильтры изменены</h2><p>Нажмите «{searchLabel}», чтобы получить результаты по новым условиям.</p></div> : !state.applied ? <div className="state-panel selection-work-state"><Search size={24}/><h2>{draftReadOnly ? 'Просмотр прежнего отбора' : 'Начните с поиска'}</h2><p>Выберите контекст и нужные условия, затем нажмите «{searchLabel}».</p></div> : list.isError ? <div className="state-panel selection-work-state" role="alert"><p>{list.error.message}</p><button className="button secondary" onClick={() => list.refetch()}>Повторить поиск</button></div> : list.isPending ? <div className="state-panel selection-work-state" role="status" aria-busy="true"><div className="skeleton-line wide"/><p>Ищем специалистов…</p></div> : changedRequirements ? <div className="state-panel selection-work-state" role="status"><p>Требования изменились. Обновляем подбор…</p></div> : results && <>
      <div className="selection-results-bar"><div className="selection-results-count"><strong role="status">Найдено: {results.total}</strong>{list.isFetching && <span role="status">Обновляем…</span>}{results.orderNote && <InlineInfo label="Порядок результатов">{results.orderNote}</InlineInfo>}</div><div className="selection-sort"><label className="sr-only" htmlFor="selection-sort">Сортировка специалистов</label><select id="selection-sort" className="input" value={state.sort} onChange={event => go({ ...state, sort: event.target.value, page: 1, resumeId: null, candidateId: null, invite: false })}>{state.context && <option value="recommended">По соответствию</option>}<option value="grade">Подтверждённый грейд</option><option value="experience">Опыт</option><option value="salary">Зарплатные ожидания</option><option value="updated">Дата обновления</option><option value="name">Имя</option></select><button type="button" className="button secondary" aria-label={state.direction === 'desc' ? 'По убыванию. Изменить на возрастание' : 'По возрастанию. Изменить на убывание'} onClick={() => go({ ...state, direction: state.direction === 'desc' ? 'asc' : 'desc', page: 1, resumeId: null, candidateId: null, invite: false })}>{state.direction === 'desc' ? '↓' : '↑'}</button></div>{choices.length >= 2 && <button className="button secondary selection-compare-button" onClick={() => setComparisonOpen(true)}>Сравнить · {choices.length}</button>}{choices.length > 0 && <button className="button ghost" onClick={() => setChoices([])}>Сбросить выбор</button>}</div>
      {choices.length === 4 && <p className="selection-inline-state" role="status">Для сравнения можно выбрать до четырёх разных специалистов.</p>}
      {!!rowAccess.hiddenResumeIds.length && !accessBlocked && <p className="selection-inline-state" role="status">Доступ к части резюме или их версия изменились. Обновляем выдачу…</p>}
      {!!results.unavailableShortlistCount && <p className="selection-inline-state">Недоступных записей в отобранных: {results.unavailableShortlistCount}. Личные данные скрыты по текущим разрешениям.</p>}
      {accessBlocked ? <div className="state-panel selection-work-state" role="alert"><p>Не удалось проверить доступ к резюме. Личные данные скрыты.</p><button className="button secondary" disabled={access.isFetching} onClick={() => access.refetch()}>Повторить проверку</button></div> : results.items.length > 0 && !visibleCandidates.length ? <div className="state-panel selection-work-state" role="status"><p>Доступ к резюме или их версия изменились. Обновляем выдачу…</p></div> : !visibleCandidates.length ? <div className="state-panel selection-work-state"><Users size={24}/><h2>{state.view === 'shortlisted' ? 'В этом списке пока нет доступных специалистов' : 'По этим условиям никого не найдено'}</h2><p>{readOnly ? 'В прежнем отборе нет доступных резюме.' : state.view === 'shortlisted' ? 'Сохраните специалиста из результатов подбора.' : 'Измените фильтры и запустите поиск снова.'}</p></div> : <div className="selection-workbench"><div className="selection-list" aria-label="Специалисты">{visibleCandidates.map(candidate => { const checked = choices.some(item => item.candidateId === candidate.candidateId); const isSelected = selectedResumeId === candidate.resumeId || selected?.candidateId === candidate.candidateId; return <article key={candidate.candidateId} className={`selection-person ${isSelected ? 'is-selected' : ''}`}><div className="selection-person-main"><CandidateAvatar candidate={candidate} onZoom={() => zoomCandidate(candidate)}/><button type="button" className="selection-person-open" onClick={() => chooseResume(candidate.resumeId, candidate.candidateId)} aria-pressed={isSelected}><strong>{displayName(candidate)}</strong><span>{professionLabel(candidate.title || candidate.specialization)}</span><small>{candidateGradeSummary(candidate)}{candidate.yearsExperience != null ? ` · ${candidate.yearsExperience} лет опыта` : ''}{candidate.workFormat ? ` · ${candidate.workFormat}` : ''}</small></button>{state.context && candidate.match?.score != null && <span className="selection-row-match" aria-label={`Соответствие: ${Number(candidate.match.score.toFixed(1))} из 100`}>{Number(candidate.match.score.toFixed(1))}<small>/100</small></span>}</div><SkillChips items={skillItems(candidate)} limit={3}/><div className="selection-person-actions"><label className="selection-compare-check"><input type="checkbox" checked={checked} disabled={!checked && choices.length >= 4} onChange={() => toggleCompare(candidate)} aria-label={`Сравнить: ${displayName(candidate)}`}/><span>В сравнение</span></label>{(candidate.needsReview || candidate.shortlisted && candidate.match?.eligible===false) && <span className="selection-review">Есть расхождение</span>}<button type="button" className={`selection-save-button ${candidate.shortlisted ? 'is-saved' : ''}`} disabled={shortlist.isPending || readOnly} aria-label={`${candidateSaveLabel(candidate)}: ${displayName(candidate)}`} aria-pressed={!!candidate.shortlisted} onClick={() => { if (liveContext) shortlist.mutate({ context: liveContext, candidate, remove: !!candidate.shortlisted }); else { chooseResume(candidate.resumeId, candidate.candidateId); setContextAction('save'); setActionContext(null); } }}><Star size={16} fill={candidate.shortlisted ? 'currentColor' : 'none'}/><span>{candidate.shortlisted ? 'Отобран' : candidateSaveLabel(candidate)}</span></button></div></article>; })}</div>
        <aside className="panel selection-profile" aria-label="Выбранный специалист">{detail.isPending ? <p role="status">Загружаем выбранное резюме…</p> : detail.isError ? <div role="alert"><p>{detail.error.message}</p><button className="button secondary" onClick={() => detail.refetch()}>Повторить</button></div> : selected && profile && <><div className="selection-profile-head"><CandidateAvatar candidate={selected} onZoom={() => setPhotoOpen(true)}/><div><h2>{displayName(selected)}</h2><p>{professionLabel(selected.title || selected.specialization)}</p></div></div><CandidateGrades candidate={selected}/>{state.context && <MatchSummary match={profile.match ?? selected.match} context={liveContext}/>}<section className="selection-profile-section"><h3>Навыки</h3><SkillLegend/><SkillChips items={skillItems(selected)} limit={8}/>{!skillItems(selected).length && <p className="muted">Навыки не указаны.</p>}</section><section className="selection-profile-section"><h3>Резюме</h3>{profile.availableResumes.length > 1 && <label className="selection-small-label">Доступное резюме<select className="input" value={selected.resumeId} onChange={event => chooseResume(Number(event.target.value), selected.candidateId)}>{profile.availableResumes.map(resume => <option value={resume.id ?? resume.resumeId} key={resume.id ?? resume.resumeId}>{professionLabel(resume.title || resume.specialization)} · {resume.grade ?? resume.verifiedGrade ? `подтверждён ${resume.grade ?? resume.verifiedGrade}` : 'грейд не подтверждён'}</option>)}</select></label>}<CandidateFacts candidate={selected}/><ResumeDocumentButton key={selected.resumeId} resumeId={selected.resumeId} label="Просмотр · PDF / Word"/></section>{!!profile.practiceSummary?.length && <details className="selection-practice"><summary>Практика от компаний · {profile.practiceSummary.length}</summary>{profile.practiceSummary.map((practice, index) => <div key={index}><strong>{practice.title || 'Практическое задание'}</strong><span>{[practice.status, practice.result || practice.summary].filter(Boolean).join(' · ')}</span></div>)}<InlineInfo label="Практика от компаний">Результат практики помогает обсудить опыт и не меняет квалификационный грейд Signal.</InlineInfo></details>}<div className="selection-profile-actions"><button type="button" className="button primary" disabled={readOnly || !!liveContext && contextClosed(liveContext)} onClick={prepareInvite}>Подготовить приглашение<Send size={15}/></button><button className="button secondary" type="button" disabled={shortlist.isPending || readOnly} aria-pressed={!!selected.shortlisted} onClick={() => saveCandidate(selected)}><Star size={16} fill={selected.shortlisted ? 'currentColor' : 'none'}/>{candidateSaveLabel(selected)}</button></div></>}</aside>
      </div>}
      <div className="selection-pagination"><span>{results.total ? `${(results.page - 1) * results.pageSize + 1}–${Math.min(results.page * results.pageSize, results.total)} из ${results.total}` : '0 специалистов'}</span><button className="button secondary" disabled={results.page <= 1 || list.isFetching} onClick={() => go({ ...state, page: results.page - 1, resumeId: null, candidateId: null, invite: false })}><ArrowLeft size={14}/>Назад</button><span>{results.page} / {totalPages}</span><button className="button secondary" disabled={results.page >= totalPages || list.isFetching} onClick={() => go({ ...state, page: results.page + 1, resumeId: null, candidateId: null, invite: false })}>Далее<ArrowRight size={14}/></button></div>
    </>}
    {comparisonOpen && choices.length >= 2 && searchable && !accessBlocked && <CompareDialog choices={choices} state={state} userKey={userKey} onClose={() => setComparisonOpen(false)}/>}
    {photoOpen && selected?.publicName && selected.avatarDataUrl && <SelectionDialog title={`Фото: ${displayName(selected)}`} onClose={() => setPhotoOpen(false)}><img className="selection-photo-full" src={selected.avatarDataUrl} alt={`Фото: ${displayName(selected)}`} onError={() => setPhotoOpen(false)}/></SelectionDialog>}
    {contextAction && selected && !readOnly && <SelectionDialog title={contextAction === 'save' ? 'Сохранить в отобранные' : 'Выбрать контекст приглашения'} onClose={() => setContextAction(null)}><p>Выберите одну свою вакансию или приватный запрос для {displayName(selected)}.</p><InlineInfo label="Чем отличаются основания">Вакансия принимает отклики. Приватный запрос служит самостоятельному поиску и приглашениям.</InlineInfo>{!contextItems.some(item=>!contextClosed(item))&&<div className="selection-create-context"><p>Сначала сохраните вакансию или запрос.</p><Link className="button secondary" href="/employer/jobs?tab=jobs&create=1">Создать вакансию</Link><Link className="button secondary" href="/employer/jobs?tab=needs&create=1">Создать запрос</Link></div>}<ContextSelector contexts={contextItems.filter(item => !contextClosed(item))} value={actionContext} onChange={setActionContext} allowCatalog={false} label="Вакансия или запрос"/>{mutationError && <p role="alert">{mutationError}</p>}<button type="button" className="button primary" disabled={!actionContext || shortlist.isPending} onClick={contextActionContinue}>{shortlist.isPending ? 'Сохраняем…' : contextAction === 'save' ? 'В отобранные' : 'Подготовить приглашение'}</button></SelectionDialog>}
    {invite && searchable && selected && !readOnly && <InviteDialog context={invite.context} candidate={invite.candidate} userKey={userKey} onClose={() => { setInvite(null); if (state.invite) navigate(selectionHref({ ...state, invite: false }), { replace: true }); }} onSent={() => { setInvite(null); void qc.invalidateQueries({queryKey:['/api/employer/invitations']}); navigate('/employer/invitations'); }}/>}
  </section>;
}
