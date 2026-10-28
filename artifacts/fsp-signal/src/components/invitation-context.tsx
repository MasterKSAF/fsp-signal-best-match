import { Link } from 'wouter';
import { BriefcaseBusiness } from 'lucide-react';
import type { InvitationContext, InvitationCompany } from '@workspace/api-client-react';
import { selectionHref } from '../lib/employer-workspace-navigation';
export type InvitationContextView = InvitationContext;
export type InvitationCompanyView = InvitationCompany;
export function InvitationResponse({invitation}:{invitation:{status:string;declineReason?:string|null;declineNote?:string|null}}) {
  if(invitation.status!=='declined')return null;
  const reasons:Record<string,string>={conditions:'Условия',format:'Формат работы',direction:'Направление',timing:'Сейчас неактуально',other:'Другая причина'};
  return <section className="invitation-response" aria-label="Ответ на приглашение"><b>Приглашение отклонено</b>{invitation.declineReason&&<p>Причина: {reasons[invitation.declineReason]||'Другая причина'}</p>}{invitation.declineNote&&<p className="prewrap">{invitation.declineNote}</p>}{!invitation.declineReason&&!invitation.declineNote&&<p className="muted">Без объяснения причины.</p>}</section>;
}
export function InvitationContextLabel({context,candidate=false}:{context?:InvitationContextView|null;candidate?:boolean}) {
  if(!context)return <span className="muted invitation-context-label">Условия из отправленного приглашения</span>;
  const label=candidate&&context.type==='need'?'Приглашение по запросу компании':`${context.type==='job'?'По вакансии':'По запросу'} «${context.title}»`;
  return <div className="invitation-context-label">{context.available&&context.id!==null?<Link href={candidate?`/candidate/jobs?job=${context.id}`:selectionHref(context.type,context.id,true)}>{label}</Link>:<span>{label}{!candidate&&<small> · Основание в архиве или удалено</small>}</span>}</div>;
}
export function InvitationCompanyCard({company,fallbackName,fallbackContact}:{company?:InvitationCompanyView|null;fallbackName:string;fallbackContact?:string}) {
  return <section className="invitation-company-profile" aria-label="Компания, которая приглашает"><div><BriefcaseBusiness size={18} aria-hidden="true"/><strong>{company?.name||fallbackName}</strong>{company?.industry&&<span className="muted">{company.industry}</span>}</div>{company?.description&&<p>{company.description}</p>}<div className="invitation-company-contacts">{company?.contactEmail&&<span>Email: {company.contactEmail}</span>}{company?.contactPhone&&<span>Телефон: {company.contactPhone}</span>}{!company?.contactEmail&&!company?.contactPhone&&fallbackContact&&<span>{fallbackContact}</span>}</div></section>;
}
