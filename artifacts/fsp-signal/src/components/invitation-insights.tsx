import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useGetCurrentUser } from '@workspace/api-client-react';
import { BarChart3 } from 'lucide-react';
type Context={type:'job'|'need';id:number;title:string};
type Insights={total:number|null;uniqueCompanies?:number;counts:Record<string,number>|null;statusCounts:Record<string,number>|null;declineReasons:{reason:string;count:number}[]|null;timelyResponse:{denominator:number;responses:number;rate:number|null;medianHours:number|null}|null;salary:{n:number;medianMidpoint:number|null}|null;suppressed:boolean;legacyTimelineIncomplete:boolean;budget?:{limit:number;spent:number;remaining:number;windowHours:number};definitions:Record<string,string>;market?:{state:string;reason:string}};
const labels:Record<string,string>={sent:'Отправлено',viewed:'Открыто',accepted:'Принято',declined:'Отклонено',withdrawn:'Отозвано',expired:'Истекло'};
const reasons:Record<string,string>={conditions:'Условия',format:'Формат работы',direction:'Направление',timing:'Неактуально сейчас',other:'Другая причина'};
export function InvitationInsights({audience,contexts=[]}:{audience:'candidate'|'employer';contexts?:Context[]}){
 const [open,setOpen]=useState(false),[days,setDays]=useState('28'),[context,setContext]=useState('all');
 const me=useGetCurrentUser(),userId=me.data?.user?.id;
 const query=useQuery({queryKey:['invitation-insights',userId,audience,days,context],enabled:open&&!!userId,staleTime:0,gcTime:0,retry:false,queryFn:async()=>{
  const params=new URLSearchParams({days});if(audience==='employer'&&context!=='all'){const [type,id]=context.split(':');params.set('contextType',type);params.set('contextId',id);}
  const r=await fetch(`/api/${audience==='employer'?'employer':'me'}/invitation-analytics?${params}`,{credentials:'same-origin'}).catch(()=>{throw new Error('Не удалось загрузить аналитику. Проверьте соединение и повторите попытку.');});const data=await r.json();if(!r.ok)throw new Error(data.error??'Не удалось загрузить аналитику.');return data as Insights;
 }});
 const data=query.data,unique=[...new Map(contexts.map(c=>[`${c.type}:${c.id}`,c])).values()];
 return <section className="panel invitation-insights"><button className="button ghost" type="button" aria-expanded={open} onClick={()=>setOpen(!open)}><BarChart3 size={16}/>{audience==='employer'?'Воронка и бюджет приглашений':'Входящий интерес'}</button>{open&&<div className="requirement-preview-editor"><div className="requirement-preview-fields"><label>Период<select value={days} onChange={e=>setDays(e.target.value)}>{['7','28','90'].map(n=><option key={n} value={n}>{n} дней</option>)}</select></label>{audience==='employer'&&<label>Вакансия или запрос<select value={context} onChange={e=>setContext(e.target.value)}><option value="all">Все приглашения компании</option>{unique.map(c=><option key={`${c.type}:${c.id}`} value={`${c.type}:${c.id}`}>{c.type==='job'?'Вакансия':'Запрос'} · {c.title}</option>)}</select></label>}</div>
 {query.isPending&&<p role="status">Загружаем фактические события…</p>}{query.isError&&<p role="alert">{query.error.message}<button type="button" className="button secondary" onClick={()=>void query.refetch()}>Повторить загрузку аналитики</button></p>}{data&&<>
 {data.budget&&<p>Лимит общий для всех вакансий и запросов компании. За последние 24 часа отправлено {data.budget.spent} из {data.budget.limit}. Доступно: <b>{data.budget.remaining}</b>. Отказ и отзыв не возвращают лимит.</p>}
 {data.uniqueCompanies!==undefined&&<p><b>{data.uniqueCompanies}</b> компаний пригласили вас за выбранный период.</p>}
 {data.suppressed?<p>Пока меньше пяти наблюдений. Групповые показатели скрыты, чтобы защитить участников.</p>:<><dl className="invitation-funnel">{Object.entries(data.counts??{}).map(([kind,count])=><div key={kind}><dt>{labels[kind]??kind}</dt><dd>{count}</dd></div>)}</dl><p className="muted">Первые подтверждённые события. Ожидающие ответа не считаются отказами.</p></>}
 {data.timelyResponse&&<p>Ответили за 7 дней: {data.timelyResponse.responses} из {data.timelyResponse.denominator} приглашений с завершённым окном наблюдения.{data.timelyResponse.medianHours!==null&&` Медианное время ответа — ${Math.round(data.timelyResponse.medianHours)} ч.`}</p>}
 {data.salary?.n? <p>Медиана середины предложения: {data.salary.medianMidpoint?.toLocaleString('ru-RU')} ₽ в месяц до налогов, {data.salary.n} сопоставимых предложений.</p>:<p className="muted">Пока недостаточно сопоставимых зарплатных вилок.</p>}
 {data.declineReasons?<details><summary>Причины отказов</summary><ul>{data.declineReasons.filter(r=>r.count>0).map(r=><li key={r.reason}>{reasons[r.reason]}: {r.count}</li>)}</ul></details>:<p className="muted">Разрез причин скрыт для защиты малых групп.</p>}
 {data.legacyTimelineIncomplete&&<p className="muted">У части ранних приглашений нет полного журнала событий. Даты ответов не восстанавливаются по предположению.</p>}
 {data.market&&<p className="muted">Рыночное сравнение: {data.market.reason}</p>}
 <details><summary>Как считаем</summary>{Object.values(data.definitions).map((text,i)=><p key={i}>{text}</p>)}</details>
 </>}
 </div>}</section>;
}
