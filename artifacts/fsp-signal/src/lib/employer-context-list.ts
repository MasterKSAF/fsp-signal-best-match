import { professionLabel } from './employer-workspace-navigation';

export type ContextListTab = 'jobs' | 'needs';
export const contextSortOptions = [
  {value:'updated_desc',label:'Сначала обновлённые'},
  {value:'title_asc',label:'Название · А–Я'},
  {value:'title_desc',label:'Название · Я–А'},
] as const;
export type ContextListSort = typeof contextSortOptions[number]['value'];
export type ContextListOptions = {q:string;sort:ContextListSort};
export function contextListOptions(search:string,tab:ContextListTab):ContextListOptions {
  const params=new URLSearchParams(search),sort=params.get(`${tab}Sort`);
  return {q:(params.get(`${tab}Q`)??'').slice(0,160),sort:contextSortOptions.some(option=>option.value===sort)?sort as ContextListSort:'updated_desc'};
}
/** Each tab owns its filters. Preserve legacy deep-link IDs and the other tab. */
export function contextListHref(search:string,tab:ContextListTab,patch:Partial<ContextListOptions>={}) {
  const params=new URLSearchParams(search);params.set('tab',tab);
  if(patch.q!==undefined){if(patch.q)params.set(`${tab}Q`,patch.q);else params.delete(`${tab}Q`);}
  if(patch.sort!==undefined){if(patch.sort==='updated_desc')params.delete(`${tab}Sort`);else params.set(`${tab}Sort`,patch.sort);}
  return `/employer/jobs?${params}`;
}
type ListContext={id:number;title:string;specialization:string;description?:string;workFormat?:string;location?:string;grade?:string;skills?:string[];requiredSkills?:string[];desirableSkills?:string[];updatedAt?:string;createdAt?:string};
const normalized=(value:string)=>value.normalize('NFKC').trim().toLocaleLowerCase('ru-RU').replace(/\s+/g,' ');
const dateValue=(value?:string)=>{const parsed=value?Date.parse(value):NaN;return Number.isFinite(parsed)?parsed:0;};
export function filterContextList<T extends ListContext>(items:readonly T[],options:ContextListOptions):T[] {
  const tokens=normalized(options.q).split(' ').filter(Boolean);
  const selected=items.filter(item=>{
    const text=normalized([item.title,item.specialization,professionLabel(item.specialization),item.description,item.workFormat,item.location,item.grade,...(item.skills??item.requiredSkills??[]),...(item.desirableSkills??[])].filter(Boolean).join(' '));
    return tokens.every(token=>text.includes(token));
  });
  return selected.sort((left,right)=>options.sort==='updated_desc'
    ? (dateValue(right.updatedAt??right.createdAt)-dateValue(left.updatedAt??left.createdAt)||right.id-left.id)
    : (options.sort==='title_desc'?-1:1)*left.title.localeCompare(right.title,'ru',{sensitivity:'base',numeric:true})||left.id-right.id);
}
/** Moving controls into the menu does not change the accepted lifecycle rules. */
export function contextActions(kind:'job'|'need',status:string) {
  const archived=status==='archived';
  return {
    select:!archived&&(kind==='need'||['draft','published'].includes(status)),
    edit:!archived,publish:kind==='job'&&['draft','closed'].includes(status),close:kind==='job'&&status==='published',
    archive:!archived&&(kind==='need'||status!=='published'),restore:kind==='need'&&archived,
  };
}
