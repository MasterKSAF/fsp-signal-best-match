import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getGetCurrentUserQueryKey, useGetCurrentUser } from '@workspace/api-client-react';
import { Link, useLocation, useSearch } from 'wouter';
import { ChevronLeft, ChevronRight, Eye, Search, X } from 'lucide-react';
import { FormField } from './form-field';
import { InlineInfo } from './inline-info';
import { OpportunityFeedback, OpportunityStatus, Salary, opportunityApi, useOpportunityAction } from './opportunity-ui';
import { professionLabel, selectionHref } from '@/lib/employer-workspace-navigation';
import { SkillChips, SkillLegend, type SkillChipItem } from './skill-chip';
import { markApplicationViewedMutationOptions, type ApplicationViewedResponse } from '@/lib/mark-application-viewed';
import './employer-workspace.css';

type Filters = {jobId:string;status:string;q:string;dateFrom:string;dateTo:string;sort:string;page:number;pageSize:number};
type Application = {id:number;jobId:number;resumeId:number;createdAt:string;status:string;message:string;snapshot:any;resumeSnapshot:any;candidate:any;contactShared:boolean;invitationAllowed?:boolean;professionalSkills?:{resumeId:number;resumeRevision:number;items:SkillChipItem[]}|null};
type Result = {items:Application[];total:number;page:number;pageSize:number;counts:{all:number;new:number;shortlisted:number}};
function parseFilters(search:string):Filters {
  const params = new URLSearchParams(search);
  return {jobId:params.get('jobId') ?? params.get('job') ?? '',status:params.get('status') ?? '',q:params.get('q') ?? '',dateFrom:params.get('dateFrom') ?? '',dateTo:params.get('dateTo') ?? '',sort:params.get('sort') ?? 'created_desc',page:Math.max(1,Number(params.get('page')) || 1),pageSize:20};
}
function filterParams(filters:Filters) {
  const params = new URLSearchParams({page:String(filters.page),pageSize:String(filters.pageSize),sort:filters.sort});
  for (const key of ['jobId','status','q','dateFrom','dateTo'] as const) if (filters[key]) params.set(key,filters[key]);
  return params;
}
export function EmployerApplicationsPage() {
  const search = useSearch(), filters = parseFilters(search), [,navigate] = useLocation();
  const params = filterParams(filters), [draft,setDraft] = useState(filters);
  useEffect(() => setDraft(parseFilters(search)),[search]);
  const query = useQuery({queryKey:['employer-applications',params.toString()],queryFn:()=>opportunityApi<Result>(`/employer/applications?${params}`),staleTime:0,gcTime:0,refetchInterval:30000,refetchOnWindowFocus:'always'});
  const jobs = useQuery({queryKey:['employer-jobs'],queryFn:()=>opportunityApi<{id:number;title:string}[]>('/employer/jobs')});
  const qc = useQueryClient(), session = useGetCurrentUser();
  const action = useMutation(markApplicationViewedMutationOptions(qc, getGetCurrentUserQueryKey(), session.data?.user.id ?? 0,
    applicationId => opportunityApi<ApplicationViewedResponse>(`/employer/applications/${applicationId}/status`, 'POST', {status:'viewed'})));
  const selectedId = Number(new URLSearchParams(search).get('application'));
  const hasSelected = Number.isSafeInteger(selectedId) && selectedId > 0;
  const detail = useQuery({queryKey:['employer-application-detail',selectedId],queryFn:()=>opportunityApi<Application>(`/employer/applications/${selectedId}`),enabled:hasSelected,staleTime:0,gcTime:0,refetchInterval:30000,refetchOnWindowFocus:'always'});
  const apply = (value:Filters,keepSelected=true) => {const next=filterParams(value);if(keepSelected && hasSelected)next.set('application',String(selectedId));navigate(`/employer/applications?${next}`);};
  const open = (item:Application) => {
    const next = filterParams(filters); next.set('application',String(item.id)); navigate(`/employer/applications?${next}`);
    if (item.status === 'sent') action.mutate(item.id);
  };
  return <div className="opportunity-page employer-workspace">
    <header className="page-title"><h1>Отклики<InlineInfo>Здесь отклики кандидатов на опубликованные вакансии. Списки отобранных специалистов находятся в подборе.</InlineInfo></h1></header>
    <form className="panel employer-application-filters" onSubmit={event=>{event.preventDefault(); apply({...draft,page:1});}}>
      <FormField label="Вакансия" layout="vertical"><select className="input" value={draft.jobId} onChange={event=>setDraft(old=>({...old,jobId:event.target.value}))}><option value="">Все вакансии</option>{jobs.data?.map(job=><option key={job.id} value={job.id}>{job.title}</option>)}{draft.jobId && !jobs.data?.some(job=>String(job.id) === draft.jobId) && <option value={draft.jobId}>Вакансия №{draft.jobId}</option>}</select></FormField>
      <FormField label="Статус" layout="vertical"><select className="input" value={draft.status} onChange={event=>setDraft(old=>({...old,status:event.target.value}))}><option value="">Все статусы</option><option value="sent">Новый</option><option value="viewed">Просмотрен</option><option value="shortlisted">Отобранный отклик</option><option value="declined">Отказ</option><option value="withdrawn">Отозван</option></select></FormField>
      <FormField label="ФИО или псевдоним" layout="vertical"><input className="input" maxLength={160} value={draft.q} onChange={event=>setDraft(old=>({...old,q:event.target.value}))} placeholder="Имя кандидата"/></FormField>
      <FormField label="Дата от" layout="vertical"><input className="input" type="date" value={draft.dateFrom} max={draft.dateTo || undefined} onChange={event=>setDraft(old=>({...old,dateFrom:event.target.value}))}/></FormField>
      <FormField label="Дата до" layout="vertical"><input className="input" type="date" value={draft.dateTo} min={draft.dateFrom || undefined} onChange={event=>setDraft(old=>({...old,dateTo:event.target.value}))}/></FormField>
      <button className="button primary" type="submit"><Search size={16}/>Найти</button><button type="button" className="button secondary" onClick={()=>apply({...parseFilters(''),page:1})}>Сбросить</button>
    </form>
    {jobs.isError && <p role="alert">Список вакансий временно недоступен. <button className="button secondary" onClick={()=>jobs.refetch()}>Повторить</button></p>}
    <OpportunityFeedback error={action.error}/>
    {query.isLoading || query.isFetching ? <p role="status">Загружаем отклики…</p> : query.isError ? <section className="panel opportunity-empty" role="alert">Не удалось загрузить отклики. <button className="button secondary" onClick={()=>query.refetch()}>Повторить</button></section> : query.data && <>
      <div className="employer-list-toolbar"><div className="employer-response-counts"><span>Всего <b>{query.data.counts.all}</b></span><span>Новые <b>{query.data.counts.new}</b></span><span>Отобранные отклики <b>{query.data.counts.shortlisted}</b></span></div>
        <label className="employer-sort"><span>{query.data.total} найдено</span><select className="input" aria-label="Сортировка откликов" value={filters.sort} onChange={event=>apply({...filters,sort:event.target.value,page:1})}><option value="created_desc">Новые сверху</option><option value="created_asc">Старые сверху</option><option value="name_asc">По имени · А–Я</option><option value="status_asc">По статусу</option></select></label></div>
    </>}
    <div className="employer-application-layout"><div className="employer-application-list">
      {!query.isFetching && !query.isError && query.data && (query.data.items.length === 0 ? <section className="panel opportunity-empty">По выбранным условиям откликов нет.</section> : query.data.items.map(item=> <article className={`panel employer-application-row${selectedId === item.id ? ' selected' : ''}`} key={item.id}>
        <div><small>{item.snapshot.title}</small><h2>{item.candidate?.publicName || item.candidate?.alias || 'Доступ к данным отозван'}</h2>{item.candidate && <p>{item.resumeSnapshot?.title || professionLabel(item.candidate.specialization)} · {item.candidate.verifiedGrade || 'Грейд не подтверждён'}</p>}<time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleDateString('ru-RU')}</time></div><div className="employer-row-actions"><OpportunityStatus status={item.status}/><button className="button secondary" onClick={()=>open(item)} disabled={query.isFetching || (action.isPending && action.variables === item.id)}><Eye size={16}/>Открыть</button></div>
      </article>))}
    </div>{hasSelected && (detail.isLoading || detail.isFetching || (action.isPending && action.variables === selectedId) ? <aside className="panel employer-application-detail" role="status">Проверяем доступ к выбранному отклику…</aside> : detail.isError ? <aside className="panel employer-application-detail" role="alert"><p>{detail.error.message}</p><button className="button secondary" onClick={()=>detail.refetch()}>Повторить</button><button className="button secondary" onClick={()=>apply(filters,false)}>Закрыть отклик</button></aside> : detail.data && <ApplicationDetail key={detail.data.id} application={detail.data} close={()=>apply(filters,false)}/>)}</div>
    {!query.isFetching && !query.isError && query.data && query.data.total > query.data.pageSize && <div className="employer-pagination"><button className="button secondary" disabled={query.data.page <= 1} onClick={()=>apply({...filters,page:query.data!.page-1})}><ChevronLeft size={16}/>Назад</button><span>Страница {query.data.page} из {Math.ceil(query.data.total/query.data.pageSize)}</span><button className="button secondary" disabled={query.data.page*query.data.pageSize >= query.data.total} onClick={()=>apply({...filters,page:query.data!.page+1})}>Далее<ChevronRight size={16}/></button></div>}
  </div>;
}
function ApplicationDetail({application:a,close}:{application:Application;close:()=>void}) {
  const [contactsEnabled,setContactsEnabled] = useState(false);
  const action = useOpportunityAction(['employer-applications','employer-application-detail','employer-jobs']);
  const contacts = useQuery({queryKey:['employer-application-contacts',a.id],queryFn:()=>opportunityApi<any>(`/employer/applications/${a.id}/contacts`),enabled:contactsEnabled && a.contactShared && !!a.candidate,staleTime:0,gcTime:0,refetchInterval:30000,refetchOnWindowFocus:'always'});
  const professional = a.candidate && a.resumeSnapshot;
  return <aside className="panel employer-application-detail">
    <div className="opportunity-form-title"><h2>{a.candidate?.publicName || a.candidate?.alias || 'Отклик'}</h2><button className="icon-button" onClick={close} aria-label="Закрыть отклик"><X size={18}/></button></div><OpportunityStatus status={a.status}/>
    <h3>{a.snapshot.title}</h3><Salary job={a.snapshot}/>
    {professional ? <><div className="opportunity-detail"><h3>Выбранное кандидатом резюме</h3><b>{professionLabel(professional.title)}</b><p>{professionLabel(professional.specialization)} · {professional.verifiedGrade || 'Грейд не подтверждён'}</p><p>{Number.isFinite(professional.yearsExperience) ? `Опыт: ${professional.yearsExperience.toLocaleString('ru-RU')} лет` : 'Опыт не указан'}{professional.workFormat ? ` · ${professional.workFormat}` : ''}</p>{a.professionalSkills?.resumeId === a.resumeId && a.professionalSkills.items.length > 0 && <div><h4>Актуальные навыки этого резюме</h4><SkillLegend/><SkillChips items={a.professionalSkills.items}/></div>}</div><div className="opportunity-detail"><h3>Сопроводительное сообщение</h3><p className="opportunity-description">{a.message || 'Без сопроводительного сообщения'}</p></div></> : <p className="muted">Доступ к резюме и сообщению отозван. Статус и история отклика сохранены.</p>}
    <details><summary>Условия на момент отклика</summary><p className="opportunity-description">{a.snapshot.description}</p></details>
    <div className="opportunity-actions">{!['withdrawn','declined'].includes(a.status) && <><button className="button primary" disabled={action.isPending || a.status === 'shortlisted'} onClick={()=>action.mutate({path:`/employer/applications/${a.id}/status`,body:{status:'shortlisted'}})}>Отобрать отклик</button><button className="button secondary" disabled={action.isPending} onClick={()=>action.mutate({path:`/employer/applications/${a.id}/status`,body:{status:'declined'}})}>Отказать</button></>}
      {a.invitationAllowed && a.candidate?.id && <Link className="button primary" href={`${selectionHref('job',a.jobId)}&candidate=${a.candidate.id}&resume=${a.resumeId}&invite=1`}>Подготовить приглашение</Link>}
      {a.contactShared && a.candidate && <button className="button secondary" onClick={()=>{setContactsEnabled(true); if (contactsEnabled) contacts.refetch();}}>Открыть контакты</button>}</div>
    {contactsEnabled && a.contactShared && a.candidate && (contacts.isFetching ? <p role="status">Проверяем доступ к контактам…</p> : contacts.isError ? <p role="alert">Контакты недоступны. <button className="button secondary" onClick={()=>contacts.refetch()}>Повторить</button></p> : contacts.data && <div className="opportunity-contact"><b>{contacts.data.displayName}</b><span>{contacts.data.email}</span><span>{contacts.data.phone}</span></div>)}
    <OpportunityFeedback error={action.error}/>
  </aside>;
}
