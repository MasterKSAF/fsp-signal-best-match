import { useEffect, useRef, useState, type ReactNode, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation, useSearch } from 'wouter';
import { ArrowRight, BriefcaseBusiness, Check, MoreHorizontal, Plus, Search, Target, X } from 'lucide-react';
import { DictionaryCombobox, DictionaryTags, useSkillDictionary } from './dictionary-input';
import { ROLE_OPTIONS, WORK_FORMAT_OPTIONS } from '@/lib/professional-dictionaries';
import { professionLabel, selectionHref } from '@/lib/employer-workspace-navigation';
import { contextRequirements, editorRequirements, requirementLabel, requirementModeLabel, verifiedRequirementLevels, type RequirementMode, type SkillRequirement } from '@/lib/context-requirements';
import { contextActions, contextListHref, contextListOptions, contextSortOptions, filterContextList, type ContextListOptions, type ContextListTab } from '@/lib/employer-context-list';
import type { DictionaryOption } from '@/lib/professional-dictionaries';
import { JobTaskIndicator, type JobTaskAvailability } from './job-task-indicator';
import { SkillCoverage } from './matching-support';
import { SkillRequirementEditor, type MinimumSkillLevels } from './skill-requirements';
import { Dialog } from './product-enhancements';
import { FormField } from './form-field';
import { InlineInfo } from './inline-info';
import { OpportunityFeedback, OpportunityRequestError, OpportunityStatus, Salary, opportunityApi, useOpportunityAction } from './opportunity-ui';
import './employer-workspace.css';

type Context = JobTaskAvailability & {
  id: number; title: string; specialization: string; description: string; grade: 'Junior' | 'Middle' | 'Senior';
  workFormat: string; salaryMin: number; salaryMax: number; salaryPeriod: 'month' | 'year'; salaryType: 'gross' | 'net';
  status?: string; version?: number; revision?: number; skills?: string[]; requiredSkills?: string[]; desirableSkills?: string[];
  requiredSkillLevels?: MinimumSkillLevels; skillRequirements?: SkillRequirement[]; gradeMode?: RequirementMode;
  location?: string; shortlistCount?: number; applicationCount?: number; updatedAt?: string; createdAt?: string;
};
type Kind = 'job' | 'need';
type Draft = {
  title: string; specialization: string; description: string; grade: Context['grade']; workFormat: string;
  salaryMin: number; salaryMax: number; salaryPeriod: Context['salaryPeriod']; salaryType: Context['salaryType'];
  skills: string[]; desirableSkills: string[]; skillRequirements: SkillRequirement[]; gradeMode: RequirementMode; location: string;
};
const invalidateKeys = ['employer-jobs', 'employer-needs', 'employer-applications', 'employer-selection-contexts', 'employer-selection', 'employer-shortlist'];
const initialDraft = (context?: Context): Draft => ({
  title: context?.title ?? '', specialization: context?.specialization ?? 'Backend / Python',
  description: context?.description ?? '', grade: context?.grade ?? 'Middle', workFormat: context?.workFormat ?? 'Удалённо',
  salaryMin: context?.salaryMin ?? 150000, salaryMax: context?.salaryMax ?? 220000,
  salaryPeriod: context?.salaryPeriod ?? 'month', salaryType: context?.salaryType ?? 'gross',
  skills: context?.skills ?? context?.requiredSkills ?? [], desirableSkills: context?.desirableSkills ?? [],
  skillRequirements: contextRequirements(context ?? {}), gradeMode: context?.gradeMode ?? 'verified',
  location: context?.location ?? '',
});
function contextPayload(draft: Draft, kind: Kind, dictionary: readonly DictionaryOption[] = []) {
  const { skills, skillRequirements, desirableSkills, location, ...conditions } = draft;
  const requirements = editorRequirements(skills,{skillRequirements},dictionary);
  return kind === 'need' ? {...conditions, requiredSkills: requirements.map(item=>item.skill), desirableSkills, skillRequirements:requirements,
    requiredSkillLevels: verifiedRequirementLevels(requirements)}
    : {...conditions, skills:requirements.map(item=>item.skill), location, skillRequirements:requirements};
}
export function EmployerJobsPage({ initialTab }: { initialTab?: 'jobs' | 'needs' } = {}) {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const [, navigate] = useLocation();
  const tab = params.get('tab') === 'needs' ? 'needs' : params.get('tab') === 'jobs' ? 'jobs' : initialTab ?? 'jobs';
  const jobs = useQuery({queryKey: ['employer-jobs'], queryFn: () => opportunityApi<Context[]>('/employer/jobs'), staleTime: 0});
  const needs = useQuery({queryKey: ['employer-needs'], queryFn: () => opportunityApi<Context[]>('/employer/needs'), staleTime: 0});
  const [edit, setEdit] = useState<{kind: Kind; context?: Context} | null>(null);
  const [confirm, setConfirm] = useState<{kind: Kind; context: Context} | null>(null);
  const act = useOpportunityAction(invalidateKeys);
  const query = tab === 'jobs' ? jobs : needs, kind: Kind = tab === 'jobs' ? 'job' : 'need';
  const filters=contextListOptions(search,tab),visible=filterContextList(query.data??[],filters);
  useEffect(() => { setEdit(null); setConfirm(null); act.reset(); }, [tab]);
  useEffect(() => {
    if(params.get('create')!=='1')return;
    setEdit({kind}); const next=new URLSearchParams(search);next.delete('create');
    navigate(`/employer/jobs?${next}`,{replace:true});
  },[search,kind]);
  useEffect(() => {
    if (params.get('tab') === 'applications') { const next = new URLSearchParams(search); next.delete('tab'); navigate(`/employer/applications?${next}`,{replace:true}); }
  },[search]);
  useEffect(() => {
    const jobId = params.get('jobId');
    if (tab === 'jobs' && jobId && jobs.data && !jobs.isError) document.getElementById(`context-job-${jobId}`)?.scrollIntoView({block:'nearest'});
  },[search,jobs.data,tab]);
  const changeTab = (value: ContextListTab) => navigate(contextListHref(search,value));
  const changeFilters = (patch:Partial<ContextListOptions>,replace=false) => navigate(contextListHref(search,tab,patch),{replace});
  const resetFilters = () => changeFilters({q:'',sort:'updated_desc'});
  const tabKey = (event:ReactKeyboardEvent<HTMLDivElement>) => {
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    event.preventDefault();const next=event.key==='Home'?'jobs':event.key==='End'?'needs':tab==='jobs'?'needs':'jobs';
    changeTab(next);document.getElementById(`employer-context-tab-${next}`)?.focus();
  };
  const changeStatus = (context: Context, status: string) => act.mutate({
    path: kind === 'job' ? `/employer/jobs/${context.id}/status` : `/employer/needs/${context.id}`,
    method: kind === 'job' ? 'POST' : 'PUT',
    body: kind === 'job' ? {status, version: context.version} : {status, revision: context.revision},
  });
  return <div className="opportunity-page employer-workspace">
    <header className="page-title"><h1>Мои вакансии<InlineInfo>Вакансия принимает отклики после публикации. Запрос хранит приватные требования для подбора специалистов.</InlineInfo></h1>
      <button className="button primary" onClick={() => setEdit({kind})}><Plus size={17}/>{kind === 'job' ? 'Создать вакансию' : 'Создать запрос'}</button></header>
    <div className="opportunity-tabs employer-context-tabs" role="tablist" aria-label="Тип потребности" onKeyDown={tabKey}>
      <button id="employer-context-tab-jobs" className="button secondary" type="button" role="tab" aria-controls="employer-context-panel" aria-selected={tab === 'jobs'} tabIndex={tab === 'jobs'?0:-1} onClick={() => changeTab('jobs')}><BriefcaseBusiness size={17}/>Вакансии</button>
      <button id="employer-context-tab-needs" className="button secondary" type="button" role="tab" aria-controls="employer-context-panel" aria-selected={tab === 'needs'} tabIndex={tab === 'needs'?0:-1} onClick={() => changeTab('needs')}><Target size={17}/>Запросы</button>
    </div>
    <OpportunityFeedback error={act.error}/>
    {act.isError && <button className="button secondary" onClick={() => {act.reset(); void query.refetch();}}>Обновить список</button>}
    {edit && <ContextEditor key={`${edit.kind}-${edit.context?.id ?? 'new'}-${edit.context?.version ?? edit.context?.revision ?? ''}`} {...edit} close={() => setEdit(null)} reload={() => {setEdit(null); void query.refetch();}}/>}
    <section id="employer-context-panel" className="employer-context-panel" role="tabpanel" aria-labelledby={`employer-context-tab-${tab}`}>
    <form className="employer-context-filters" role="search" aria-label={tab === 'jobs'?'Поиск по моим вакансиям':'Поиск по приватным запросам'} onSubmit={event=>event.preventDefault()}>
      <FormField label={tab === 'jobs'?'Поиск вакансий':'Поиск запросов'} layout="vertical"><input className="input" type="search" maxLength={160} value={filters.q} placeholder="Название, описание или навык" onChange={event=>changeFilters({q:event.target.value},true)}/></FormField>
      <FormField label="Сортировка" layout="vertical"><select className="input" value={filters.sort} onChange={event=>changeFilters({sort:event.target.value as ContextListOptions['sort']})}>{contextSortOptions.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select></FormField>
      <button className="button secondary" type="button" disabled={!filters.q&&filters.sort==='updated_desc'} onClick={resetFilters}>Сбросить</button>
      {!query.isLoading&&!query.isError&&query.data&&<span className="employer-context-result-count" aria-live="polite">Найдено {visible.length} из {query.data.length}</span>}
    </form>
    {query.isLoading ? <p role="status">Загружаем {tab === 'jobs' ? 'вакансии' : 'запросы'}…</p>
      : query.isError ? <div className="panel opportunity-empty" role="alert">Не удалось загрузить {tab === 'jobs' ? 'вакансии' : 'запросы'}. <button className="button secondary" onClick={() => query.refetch()}>Повторить</button></div>
      : query.data?.length === 0 ? <div className="panel opportunity-empty">{kind === 'job' ? 'Создайте первую вакансию. Она сохранится как черновик; публикация — отдельное действие.' : 'Создайте приватный запрос с требованиями к специалисту. Он будет виден только вашей компании.'}</div>
      : visible.length === 0 ? <div className="panel opportunity-empty"><p>По запросу «{filters.q}» ничего не найдено.</p><button className="button secondary" onClick={resetFilters}>Сбросить поиск</button></div>
      : <div className="employer-context-list">{visible.map(context => {
        const status = context.status ?? 'active', archived = status === 'archived';
        const available=contextActions(kind,status);
        const required = contextRequirements(context);
        return <article className="panel employer-context-row" id={`context-${kind}-${context.id}`} key={context.id} data-testid={`card-${kind}-${context.id}`}>
          <div className="employer-context-main"><div className="employer-context-heading"><h2>{professionLabel(context.title)}</h2>{kind === 'need' && !archived ? <span className="opportunity-status">Приватный запрос</span> : <OpportunityStatus status={status}/>}</div>
            <div className="employer-context-meta">{kind === 'job' && <JobTaskIndicator job={context}/>}<span>{professionLabel(context.specialization)}</span><span>Грейд от {context.grade} · {requirementModeLabel(context.gradeMode).toLocaleLowerCase('ru-RU')}</span><span>{context.workFormat}</span>{context.location && <span>{context.location}</span>}</div>
            <p className="employer-context-description">{context.description}</p><div className="employer-requirements" aria-label="Требования работодателя">{required.slice(0,6).map(item => <span className="employer-requirement-chip" key={item.skill}>{requirementLabel(item)}</span>)}{required.length > 6 && <span className="employer-requirement-chip">Ещё {required.length-6}</span>}</div>
          </div>
          <div className="employer-context-side"><Salary job={context}/><div className="employer-context-counters">
            {kind === 'job' && <Link href={`/employer/applications?jobId=${context.id}`} className="employer-counter applications" aria-label={`Отклики на ${context.title}: ${context.applicationCount ?? 'количество недоступно'}`}>Отклики <b>{context.applicationCount ?? '—'}</b></Link>}
            <Link href={selectionHref(kind, context.id, true)} className="employer-counter shortlisted" aria-label={`Отобрано для ${context.title}: ${context.shortlistCount ?? 'количество недоступно'}`}>Отобрано <b>{context.shortlistCount ?? '—'}</b></Link>
          </div><div className="opportunity-actions employer-context-actions">
            {available.select && <Link className="button primary" href={selectionHref(kind,context.id)} data-testid={`link-match-${kind}-${context.id}`}><Search size={16}/>Подобрать</Link>}
            <ContextMenu title={context.title} disabled={act.isPending}>
              {available.edit && <button type="button" disabled={act.isPending} onClick={() => setEdit({kind,context})}>Редактировать</button>}
              {available.publish && <button type="button" disabled={act.isPending} onClick={() => changeStatus(context,'published')}>Опубликовать</button>}
              {available.close && <button type="button" disabled={act.isPending} onClick={() => changeStatus(context,'closed')}>Закрыть приём</button>}
              {available.archive && <button type="button" disabled={act.isPending} onClick={() => changeStatus(context,'archived')}>Архивировать</button>}
              {available.restore && <button type="button" disabled={act.isPending} onClick={() => changeStatus(context,'active')}>Вернуть из архива</button>}
              <button type="button" className="danger" disabled={act.isPending} onClick={() => setConfirm({kind,context})}>Удалить</button>
            </ContextMenu>
          </div></div>
        </article>;
      })}</div>}
    </section>
    {confirm && <Dialog title={`Удалить ${confirm.kind === 'job' ? 'вакансию' : 'приватный запрос'}?`} onClose={() => setConfirm(null)}>
      <p>«{confirm.context.title}» исчезнет из рабочего списка вместе с его отобранными кандидатами. История приглашений и откликов сохранится.</p>
      <div className="opportunity-actions"><button className="button secondary" disabled={act.isPending} onClick={() => setConfirm(null)}>Отмена</button><button className="button primary danger" disabled={act.isPending} onClick={() => act.mutate({path: `/employer/${confirm.kind === 'job' ? 'jobs' : 'needs'}/${confirm.context.id}`, method: 'DELETE', body: confirm.kind === 'job' ? {version:confirm.context.version} : {revision:confirm.context.revision}}, {onSuccess: () => {setConfirm(null); setEdit(null);}})}>{act.isPending ? 'Удаляем…' : 'Удалить'}</button></div><OpportunityFeedback error={act.error}/>
    </Dialog>}
  </div>;
}
function ContextMenu({title, disabled, children}: {title:string; disabled:boolean; children:ReactNode}) {
  const root = useRef<HTMLDetailsElement>(null), trigger = useRef<HTMLElement>(null);
  useEffect(() => {
    const outside = (event: PointerEvent) => {if (event.target instanceof Node && !root.current?.contains(event.target) && root.current) root.current.open = false;};
    const escape = (event: KeyboardEvent) => {if (event.key === 'Escape' && root.current?.open) {event.preventDefault(); event.stopPropagation(); root.current.open = false; trigger.current?.focus();}};
    document.addEventListener('pointerdown',outside); document.addEventListener('keydown',escape);
    return () => {document.removeEventListener('pointerdown',outside); document.removeEventListener('keydown',escape);};
  },[]);
  return <details className="employer-context-menu" ref={root}><summary ref={trigger} aria-label={`Действия: ${title}`} aria-disabled={disabled} onClick={event => {if (disabled) event.preventDefault();}}><MoreHorizontal size={19}/></summary><div onClick={() => {if (root.current) root.current.open = false; trigger.current?.focus();}}>{children}</div></details>;
}
function ContextEditor({kind,context,close,reload}:{kind:Kind;context?:Context;close:()=>void;reload:()=>void}) {
  const initial = initialDraft(context), [draft,setDraft] = useState(initial);
  const action = useOpportunityAction(invalidateKeys), skills = useSkillDictionary();
  const fieldErrors = action.error instanceof OpportunityRequestError ? action.error.fieldErrors : {};
  const set = <K extends keyof Draft>(key:K,value:Draft[K]) => setDraft(old => ({...old,[key]:value}));
  const submit = (event: FormEvent) => {
    event.preventDefault(); const payload = contextPayload(draft,kind,skills.data), before = contextPayload(initial,kind,skills.data);
    const changed = context ? Object.fromEntries(Object.entries(payload).filter(([key,value]) => JSON.stringify(value) !== JSON.stringify(before[key as keyof typeof before]))) : payload;
    action.mutate({path:context ? `/employer/${kind === 'job' ? 'jobs' : 'needs'}/${context.id}` : `/employer/${kind === 'job' ? 'jobs' : 'needs'}`, method:context ? 'PUT' : 'POST', body:context ? {...changed,...(kind === 'job' ? {version:context.version} : {revision:context.revision})} : changed},{onSuccess:close});
  };
  return <form className="panel opportunity-form employer-context-editor" onSubmit={submit}>
    <div className="opportunity-form-title"><h2>{context ? 'Редактирование' : kind === 'job' ? 'Новая вакансия' : 'Новый приватный запрос'}<InlineInfo>{kind==='job'?'После публикации кандидаты смогут отправлять отклики.':'Запрос видит только ваша компания. По нему можно самостоятельно подобрать и пригласить специалистов.'}</InlineInfo></h2><button type="button" className="icon-button" aria-label="Закрыть редактор" onClick={close}><X size={18}/></button></div>
    <fieldset disabled={action.isPending}><div className="opportunity-form-grid">
      <FormField label={kind==='need'?'Внутреннее название запроса':'Название роли'} layout="vertical" error={fieldErrors.title}><DictionaryCombobox required minLength={3} maxLength={160} options={ROLE_OPTIONS} value={draft.title} onChange={value=>set('title',value)}/></FormField>
      <FormField label="Направление" layout="vertical"><select className="input" value={draft.specialization} onChange={event=>set('specialization',event.target.value)}><option value="Backend / Python">Backend-разработчик</option><option value="Frontend / TypeScript">Frontend-разработчик</option>{!['Backend / Python','Frontend / TypeScript'].includes(draft.specialization) && <option value={draft.specialization}>{professionLabel(draft.specialization)}</option>}</select></FormField>
      <FormField label="Требуемый грейд" layout="vertical"><select className="input" value={draft.grade} onChange={event=>set('grade',event.target.value as Draft['grade'])}><option>Junior</option><option>Middle</option><option>Senior</option></select></FormField>
      <FormField label="Подтверждение общего грейда" layout="vertical" error={fieldErrors.gradeMode} hint="Общий грейд выбранного резюме и уровни отдельных навыков проверяются отдельно."><select className="input" value={draft.gradeMode} onChange={event=>set('gradeMode',event.target.value as RequirementMode)}><option value="declared_or_verified">Достаточно заявленного</option><option value="verified">Требуется подтверждение</option></select></FormField>
      <FormField label="Формат работы" layout="vertical"><DictionaryCombobox required maxLength={120} options={WORK_FORMAT_OPTIONS} value={draft.workFormat} onChange={value=>set('workFormat',value)}/></FormField>
      <FormField label="Зарплата от, ₽" layout="vertical"><input className="input" type="number" required min={1} max={100000000} value={draft.salaryMin} onChange={event=>set('salaryMin',Number(event.target.value))}/></FormField>
      <FormField label="Зарплата до, ₽" layout="vertical"><input className="input" type="number" required min={draft.salaryMin} max={100000000} value={draft.salaryMax} onChange={event=>set('salaryMax',Number(event.target.value))}/></FormField>
      <FormField label="Период" layout="vertical"><select className="input" value={draft.salaryPeriod} onChange={event=>set('salaryPeriod',event.target.value as Draft['salaryPeriod'])}><option value="month">В месяц</option><option value="year">В год</option></select></FormField>
      <FormField label="Налоги" layout="vertical"><select className="input" value={draft.salaryType} onChange={event=>set('salaryType',event.target.value as Draft['salaryType'])}><option value="gross">До вычета налогов</option><option value="net">На руки</option></select></FormField>
      {kind === 'job' && <FormField label="Локация" layout="vertical"><input className="input" maxLength={160} value={draft.location} onChange={event=>set('location',event.target.value)}/></FormField>}
      <FormField label="Обязательные навыки" layout="vertical" error={fieldErrors.skills ?? fieldErrors.requiredSkills}><DictionaryTags required options={skills.data ?? []} maxItems={kind === 'job' ? 20 : 40} maxLength={kind === 'job' ? 60 : 100} value={draft.skills} onChange={value=>setDraft(old=>({...old,skills:value,skillRequirements:editorRequirements(value,old,skills.data)}))}/></FormField>
      {!!draft.skills.length && <SkillRequirementEditor dictionary={skills.data} value={editorRequirements(draft.skills,draft,skills.data)} onChange={value=>set('skillRequirements',value)} error={fieldErrors.skillRequirements ?? fieldErrors.requiredSkillLevels}/>}
      {kind === 'need' && <FormField label="Желательные навыки" layout="vertical"><DictionaryTags options={skills.data ?? []} maxItems={40} maxLength={100} value={draft.desirableSkills} onChange={value=>set('desirableSkills',value)}/></FormField>}
    </div>{draft.skillRequirements.some(item=>item.mode!=='declared_or_verified')&&<div className="employer-requirement-info">Проверки навыков<SkillCoverage specialization={draft.specialization} requirements={draft.skillRequirements.filter(item=>item.mode!=='declared_or_verified').map(item=>item.skill)}/></div>}
      <FormField label={kind==='need'?'Внутренние задачи и заметки':'Задачи и условия'} layout="vertical" error={fieldErrors.description} hint={kind==='need'?'Эти заметки не отправляются кандидату. Условия приглашения вы проверите перед отправкой.':undefined}><textarea className="input" required minLength={kind === 'job' ? 30 : 10} maxLength={6000} rows={4} value={draft.description} onChange={event=>set('description',event.target.value)}/></FormField>
      <div className="form-actions"><button className="button primary" type="submit"><Check size={16}/>{action.isPending ? 'Сохраняем…' : context ? 'Сохранить изменения' : kind === 'job' ? 'Сохранить черновик' : 'Создать запрос'}<ArrowRight size={15}/></button></div>
    </fieldset><OpportunityFeedback error={action.error}/>{action.isError && context && <button type="button" className="button secondary" onClick={reload}>Загрузить актуальную карточку</button>}
  </form>;
}
