import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Mail } from 'lucide-react';
import { useGetCurrentUser } from '@workspace/api-client-react';
import { FormField } from './form-field';
import { InlineInfo } from './inline-info';
import { resumeRequest } from './multi-resume';

type Account = { id:number;displayName:string;email:string;emailVerified:boolean;role:'candidate'|'employer';demoMode:boolean;reviewMode:boolean;createdAt:string;professionalAlias:string|null };
export function AccountSettings() {
  const qc=useQueryClient(); const session=useGetCurrentUser(); const accountKey=['own-account',session.data?.user.id]; const account=useQuery({queryKey:accountKey,queryFn:()=>resumeRequest<Account>('/me/account'),enabled:!!session.data?.user.id});
  const [name,setName]=useState(''); const [alias,setAlias]=useState(''); const [dirty,setDirty]=useState(false);
  useEffect(()=>{if(account.data&&!dirty){setName(account.data.displayName);setAlias(account.data.professionalAlias??'');}},[account.data,dirty]);
  const save=useMutation({mutationFn:()=>resumeRequest<Account>('/me/account',{method:'PATCH',body:JSON.stringify({displayName:name.trim(),expectedDisplayName:account.data?.displayName,...(account.data?.role==='candidate'&&account.data.professionalAlias!==null?{professionalAlias:alias.trim(),expectedProfessionalAlias:account.data.professionalAlias}:{})})}),onSuccess:async data=>{setDirty(false);qc.setQueryData(accountKey,data);await Promise.all([qc.invalidateQueries({queryKey:['selected-candidate-profile']}),qc.invalidateQueries({queryKey:['candidate-resumes']}),qc.invalidateQueries({queryKey:['/api/me']})]);}});
  if(account.isPending)return <p role="status">Загружаем аккаунт…</p>;
  if(!account.data)return <p role="alert">Не удалось загрузить аккаунт. <button className="text-link" onClick={()=>void account.refetch()}>Повторить</button></p>;
  const data=account.data;
  return <form onSubmit={e=>{e.preventDefault();if(dirty&&!save.isPending)save.mutate();}}>
    <div className="settings-data"><span><Mail size={13} aria-hidden="true"/> Email</span><b>{data.email}</b><span>Подтверждение email</span><b>{data.emailVerified?'Подтверждён':'Не подтверждён'}</b><span>Роль</span><b>{data.role==='employer'?'Работодатель':'Кандидат'}</b><span>Тип аккаунта</span><b data-testid="text-session-state">{data.reviewMode?'Demo · отдельный аккаунт':data.demoMode?'Demo':'Личный аккаунт'}</b><span>Дата регистрации</span><b>{new Date(data.createdAt).toLocaleDateString('ru-RU')}</b></div>
    <FormField label="Имя"><input className="input" required minLength={2} maxLength={120} value={name} disabled={save.isPending} onChange={e=>{setName(e.target.value);setDirty(true);save.reset();}} data-testid="input-account-name"/></FormField>
    {data.role==='candidate'&&data.professionalAlias!==null&&<FormField label="Псевдоним" hint="Используется вместо имени в анонимном поиске."><input className="input" required minLength={2} maxLength={120} value={alias} disabled={save.isPending} onChange={e=>{setAlias(e.target.value);setDirty(true);save.reset();}} data-testid="input-account-alias"/></FormField>}
    <div className="form-actions"><button className="button secondary" type="submit" disabled={!dirty||save.isPending} data-testid="button-account-save"><Check size={15}/>{save.isPending?'Сохраняем…':'Сохранить'}</button><InlineInfo label="Данные аккаунта">Эти данные доступны только владельцу аккаунта.</InlineInfo></div>
    {save.isError&&<p className="form-error" role="alert">{save.error.message}<button type="button" className="text-link" onClick={()=>{setDirty(false);void account.refetch();save.reset();}}>Обновить</button></p>}
    {save.isSuccess&&!dirty&&<p role="status">Сохранено</p>}
  </form>;
}
