import { useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';
import { ArrowUpRight, BriefcaseBusiness, FileBadge, FileText, Mail, Send, Target, type LucideIcon } from 'lucide-react';
import { CompactResumeContext, resumeHref, resumeRequest, useResumeSelection, useSelectedCandidateProfile } from './multi-resume';
import { qualificationSourceLabel } from '../lib/qualification-presentation';
import { useSkillMatrix } from './skill-workspace';
import './workspace-candidate.css';

type ListItem = { id: number; companyName?: string; title?: string; status?: string };
type Page = { items: ListItem[]; total: number };
function MetricCard({ title, count, Icon, href, lines, label, accent }: { accent: 'profile' | 'skills' | 'employer'; title: string; count: string | number; Icon: LucideIcon; href: string; lines: string[]; label: string }) {
  return <Link href={href} className="workspace-metric" data-accent={accent} aria-label={`${title}: ${count}. ${label}`}><span className="themed-icon workspace-metric-icon"><Icon size={20} aria-hidden="true"/></span><div className="workspace-metric-content"><div className={`workspace-metric-value${String(count).length > 15 ? ' workspace-metric-value--text' : ''}`}>{count}</div><h2>{title}</h2><div className="workspace-metric-lines">{lines.map((text, index) => <span key={index} title={text}>{text}</span>)}</div><span className="workspace-metric-action">{label}<ArrowUpRight size={14} aria-hidden="true"/></span></div></Link>;
}
export function CandidateWorkspaceOverview() {
  const selection = useResumeSelection();
  const profile = useSelectedCandidateProfile();
  const id = selection.resumeId;
  const context = id === null ? '' : `&resumeId=${id}`;
  const invitations = useQuery({ queryKey: ['workspace-invitations', selection.userId, id], enabled: !!selection.userId, queryFn: () => resumeRequest<Page>(`/me/invitations/search?status=pending&pageSize=3${context}`) });
  const applications = useQuery({ queryKey: ['workspace-applications', selection.userId, id], enabled: !!selection.userId, queryFn: () => resumeRequest<Page>(`/me/applications/search?pageSize=3${context}`) });
  const jobs = useQuery({ queryKey: ['workspace-jobs', profile.data?.specialization, id], enabled: !!selection.userId && !selection.loading, queryFn: () => resumeRequest<Page>(`/public/jobs/search?pageSize=3${profile.data ? `&specialization=${encodeURIComponent(profile.data.specialization)}` : ''}${context}`) });
  const matrix = useSkillMatrix();
  const loadingCount = (query: { isPending: boolean; isError: boolean; data?: Page }) => query.isPending ? '…' : query.isError ? '—' : query.data?.total ?? 0;
  const listLines = (query: { isError: boolean; data?: Page }, empty: string) => query.isError ? ['Не удалось загрузить данные'] : query.data?.items.length ? query.data.items.slice(0, 3).map(item => [item.companyName, item.title].filter(Boolean).join(' · ')) : [empty];
  const confirmed = matrix.data?.accountEvidence ?? [];
  const current = selection.resumes.find(resume => resume.id === id);
  const currentQualification = matrix.data?.historicalQualification;
  const qualificationSource = currentQualification ? qualificationSourceLabel(currentQualification) : null;
  const active = selection.resumes.filter(resume => resume.visibility !== 'private').length;
  const links = (path: string) => resumeHref(path, id);
  return <div className="candidate-overview-canvas"><div className="page-title"><div><h1>Обзор</h1><p>{profile.data?.displayName ? `${profile.data.displayName.split(' ')[0]}, ваш следующий шаг — здесь.` : 'Ваши резюме, навыки и предложения.'}</p></div><CompactResumeContext/></div>
    {(selection.error || profile.isError) && <p role="alert">Не удалось загрузить профиль. <button className="button text-button" onClick={() => profile.refetch()}>Повторить</button></p>}
    <div className="workspace-metrics-grid">
      <MetricCard accent="profile" title="Мои резюме" count={selection.loading ? '…' : `${selection.resumes.length} / 5`} Icon={FileText} href={links('/candidate/resumes')} lines={[`${active} активных`, ...selection.resumes.slice(0, 2).map(resume => resume.title)]} label="Управлять резюме"/>
      <MetricCard accent="skills" title="Подтверждённые навыки" count={matrix.isPending && id !== null ? '…' : matrix.isError ? '—' : confirmed.length} Icon={FileBadge} href={links('/candidate/passport')} lines={confirmed.length ? confirmed.slice(0, 3).map(skill => `${skill.label} · ${skill.level}`) : ['Добавьте объективные подтверждения']} label="Открыть паспорт"/>
      <MetricCard accent="skills" title="Грейд резюме" count={(currentQualification ? currentQualification.verifiedGrade : current?.verifiedGrade) ?? 'Не подтверждён'} Icon={Target} href={links('/candidate/kalibr')} lines={[current?.specialization ?? 'Выберите специализацию', `Заявлено: ${current?.assumedGrade ?? profile.data?.assumedGrade ?? 'не указано'}`, ...(qualificationSource ? [qualificationSource] : matrix.data?.qualification?.coverage.filter(item => !item.covered).slice(0, 1).map(item => `Следующий шаг: ${item.label}`) ?? [])]} label="Проверить навыки"/>
      <MetricCard accent="employer" title="Приглашения" count={loadingCount(invitations)} Icon={Mail} href={links('/candidate/invitations?status=pending')} lines={listLines(invitations, 'Новых приглашений пока нет')} label="Посмотреть условия"/>
      <MetricCard accent="employer" title="Мои отклики" count={loadingCount(applications)} Icon={Send} href={links('/candidate/jobs?tab=applications')} lines={listLines(applications, 'Вы ещё не отправляли отклики')} label="Открыть историю"/>
      <MetricCard accent="employer" title="Доступные вакансии" count={loadingCount(jobs)} Icon={BriefcaseBusiness} href={links(`/candidate/jobs${profile.data ? `?specialization=${encodeURIComponent(profile.data.specialization)}` : ''}`)} lines={listLines(jobs, 'Вакансии появятся после публикации')} label="Посмотреть вакансии"/>
    </div>
  </div>;
}
