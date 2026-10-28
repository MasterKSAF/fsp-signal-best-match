import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { FlaskConical, Check, X, RefreshCw } from 'lucide-react';
import type { EmployerSelectionContext } from './employer-selection';
import { supportsRequirementLevel, type SkillRequirement } from '../lib/context-requirements';

type Preview = {id:string;baseRevision:number;currentPool:string;expectedPool:string;emptyResult:boolean;expiresAt:string;patch:Record<string,unknown>;diff:{field:string;before:unknown;after:unknown}[]};
export async function refinementRequest<T>(url:string,body?:unknown):Promise<T> {
  const response=await fetch(url,{credentials:'same-origin',method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}).catch(()=>{throw new Error('Не удалось связаться с сервером. Повторите попытку.');});
  const data=await response.json();
  if(!response.ok) throw Object.assign(new Error(data.error??'Не удалось выполнить запрос.'),{status:response.status,data});
  return data;
}
const fieldNames:Record<string,string>={grade:'Грейд',gradeMode:'Подтверждение грейда',requiredSkills:'Обязательные навыки',skillRequirements:'Требования к навыкам',workFormat:'Формат работы'};
const modeLabel=(mode:unknown)=>mode==='declared_or_verified'?'Можно заявленный':'Подтверждённый';
export function RequirementDiff({diff}:{diff:{field:string;before:unknown;after:unknown}[]}){
 return <dl>{diff.filter(d=>JSON.stringify(d.before)!==JSON.stringify(d.after)).map(d=><div key={d.field}><dt>{fieldNames[d.field]??d.field}</dt><dd>{readable(d.before)} → {readable(d.after)}</dd></div>)}</dl>;
}
function readable(value:unknown):string {
  if(Array.isArray(value)) return value.map(item=>typeof item==='string'?item:`${item.skill}: ${modeLabel(item.mode)}${item.level?`, ${item.level}+`:''}`).join('; ');
  if(value==='verified'||value==='declared_or_verified')return modeLabel(value);
  return String(value??'Не задано');
}
export function RequirementPreviewTools({context}:{context:EmployerSelectionContext}) {
  const [open,setOpen]=useState(false),[grade,setGrade]=useState(context.grade),[gradeMode,setGradeMode]=useState(context.gradeMode??'verified');
  const [workFormat,setWorkFormat]=useState(context.workFormat),[skills,setSkills]=useState<SkillRequirement[]>(context.skillRequirements??context.requiredSkills.map(skill=>({skill,mode:'verified'})));
  const [preview,setPreview]=useState<Preview|null>(null),[pending,setPending]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const qc=useQueryClient();
  const calculate=async()=>{
    setPending(true);setError('');setNotice('');setPreview(null);
    try {setPreview(await refinementRequest<Preview>('/api/employer/requirements/preview',{context:{type:context.type,id:context.id},patch:{grade,gradeMode,workFormat,requiredSkills:skills.map(s=>s.skill),skillRequirements:skills},commandKey:crypto.randomUUID()}));}
    catch(e){setError((e as Error).message);}finally{setPending(false);}
  };
  const apply=async()=>{
    if(!preview)return;setPending(true);setError('');
    try {await refinementRequest(`/api/employer/requirements/preview/${preview.id}/apply`,{commandKey:`apply:${preview.id}`});setPreview(null);setNotice('Требования сохранены. Прежний отбор требует повторной проверки.');await qc.invalidateQueries({predicate:q=>String(q.queryKey[0]).startsWith('employer-selection')});}
    catch(e){const failure=e as Error&{data?:{preview?:Preview}};setError(failure.message);if(failure.data?.preview)setPreview(failure.data.preview);}
    finally{setPending(false);}
  };
  if(context.readOnly)return null;
  return <div className="requirement-preview-tools">
    <button type="button" className="button ghost" onClick={()=>{setOpen(!open);setPreview(null);setError('');}} aria-expanded={open}><FlaskConical size={15}/>Что изменится в подборе</button>
    {notice&&<p role="status">{notice}</p>}
    {open&&<div className="requirement-preview-editor">
      <p>Проверьте другие требования перед сохранением. Кандидаты с заявленными навыками будут отличаться от кандидатов с подтверждениями.</p>
      <div className="requirement-preview-fields">
        <label>Грейд<select value={grade} onChange={e=>{setGrade(e.target.value);setPreview(null);}}>{['Junior','Middle','Senior'].map(v=><option key={v}>{v}</option>)}</select></label>
        <label>Режим грейда<select value={gradeMode} onChange={e=>{setGradeMode(e.target.value as typeof gradeMode);setPreview(null);}}><option value="verified">Подтверждённый</option><option value="declared_or_verified">Заявленный или подтверждённый</option></select></label>
        <label>Формат<select value={workFormat} onChange={e=>{setWorkFormat(e.target.value);setPreview(null);}}>{[...new Set([context.workFormat,'Удалённо','Офис','Гибрид'])].map(v=><option key={v}>{v}</option>)}</select></label>
      </div>
      <div className="requirement-preview-skills">{skills.map((skill,index)=><div key={skill.skill}><strong>{skill.skill}</strong><select aria-label={`Подтверждение ${skill.skill}`} value={skill.mode??'verified'} onChange={e=>{setSkills(skills.map((s,i)=>i===index?{...s,mode:e.target.value as SkillRequirement['mode'],level:undefined}:s));setPreview(null);}}><option value="verified">Подтверждённый</option><option value="declared_or_verified">Можно заявленный</option></select>{skill.mode!=='declared_or_verified'&&supportsRequirementLevel(skill.skill)&&<select aria-label={`Уровень ${skill.skill}`} value={skill.level??''} onChange={e=>{setSkills(skills.map((s,i)=>i===index?{...s,level:(e.target.value||undefined) as SkillRequirement['level']}:s));setPreview(null);}}><option value="">Без минимального уровня</option>{['Junior','Middle','Senior'].map(v=><option key={v}>{v}</option>)}</select>}<button type="button" className="button ghost" disabled={skills.length===1} aria-label={`Убрать обязательность ${skill.skill}`} onClick={()=>{setSkills(skills.filter((_,i)=>i!==index));setPreview(null);}}><X size={14}/></button></div>)}</div>
      <button type="button" className="button secondary" disabled={pending} onClick={calculate}><RefreshCw size={14}/>{pending?'Рассчитываем…':'Рассчитать изменения'}</button>
      {error&&<p role="alert">{error}</p>}
      {preview&&<div className="requirement-preview-result" aria-live="polite"><h3>Предварительный результат</h3><p>Сейчас: <b>{preview.currentPool}</b>. После изменения: <b>{preview.expectedPool}</b> специалистов.</p><p className="muted">Размер пула показан диапазоном для защиты небольших групп. Расчёт действует 10 минут.</p><dl>{preview.diff.filter(d=>JSON.stringify(d.before)!==JSON.stringify(d.after)).map(d=><div key={d.field}><dt>{fieldNames[d.field]??d.field}</dt><dd>{readable(d.before)} → {readable(d.after)}</dd></div>)}</dl>{preview.emptyResult&&<p>Подходящих специалистов сейчас нет. Можно сохранить эти требования или изменить их самостоятельно.</p>}<div className="requirement-preview-actions"><button type="button" className="button primary" onClick={apply} disabled={pending}><Check size={14}/>Применить требования</button><button type="button" className="button ghost" disabled={pending} onClick={()=>setPreview(null)}>Отменить расчёт</button></div></div>}
    </div>}
  </div>;
}
