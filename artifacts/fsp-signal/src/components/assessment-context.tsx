import { useQuery } from '@tanstack/react-query';
import { Blocks, Database, Gauge, ListChecks, ShieldCheck } from 'lucide-react';
import { api } from './product-enhancements';
import { FormField } from './form-field';
import './assessment-context.css';

export type AssessmentContextId = 'api-platform' | 'data-services' | 'reliability' | 'frontend-product' | 'frontend-platform' | 'frontend-accessibility';
export type AssessmentContextSelection = { contextId?: AssessmentContextId; invitationId?: number };
type Grade = 'Junior' | 'Middle' | 'Senior';
type Coverage = { requirement: string; families: string[]; evidence: string };
type Profile = { id: AssessmentContextId; title: string; description: string; skills: string[]; coverage: Coverage[] };
type Snapshot = { source: 'profile' | 'invitation'; context: Profile; targetGrade: Grade; vacancyGrade?: Grade; roleTitle: string; requirements: string[]; unsupportedRequirements: string[]; reason: string };
type ContextsResponse = { profiles: Profile[]; invitations: { id: number; title: string; snapshot: Snapshot }[] };
const contextIcons = { 'api-platform': Blocks, 'data-services': Database, reliability: ShieldCheck, 'frontend-product': Blocks, 'frontend-platform': Gauge, 'frontend-accessibility': ShieldCheck };

function CoverageDetails({ coverage, unsupported = [] }: { coverage: Coverage[]; unsupported?: string[] }) {
  return <details className="assessment-coverage"><summary><ListChecks size={16} /> Какие требования проверяем</summary><ul>{coverage.map(item => <li key={item.requirement}><strong>{item.requirement}</strong><span>{item.families.join(' · ')}</span><p>{item.evidence}</p></li>)}</ul>{unsupported.length > 0 && <p className="assessment-context-note">Отдельной проверки пока нет: {unsupported.join(', ')}. Эти навыки не считаются подтверждёнными этим тестом.</p>}</details>;
}

export function AssessmentContextSelector({ value, onChange, disabled = false, programId = 'backend-python' }: {
  programId?: string;
  value: AssessmentContextSelection;
  onChange: (value: AssessmentContextSelection) => void;
  disabled?: boolean;
}) {
  const query = useQuery({ queryKey: ['assessment-contexts', programId], queryFn: () => api<ContextsResponse>(`/api/assessments/contexts?programId=${encodeURIComponent(programId)}`) });
  if (query.isPending) return <p className="assessment-context-note" role="status">Загружаем направления проверки…</p>;
  if (query.isError) return <div className="form-error" role="alert">Не удалось загрузить направления проверки. <button type="button" className="text-link" onClick={() => void query.refetch()}>Повторить</button></div>;
  const selectedInvitation = query.data.invitations.find(item => item.id === value.invitationId);
  const selected = selectedInvitation?.snapshot.context ?? query.data.profiles.find(item => item.id === value.contextId);
  return <section className="assessment-context-picker" aria-label="Направление проверки">
    <fieldset disabled={disabled}><legend>Для какой роли готовитесь</legend><p className="assessment-context-note">{programId === 'frontend-typescript' ? 'Общая основа — TypeScript, состояние и доступность интерфейса. Во всех ролях действует единая шкала.' : 'Общая основа — Python и SQL. Прикладные задания учитывают задачи выбранной роли.'}</p>
      <div className="assessment-context-options">{query.data.profiles.map(profile => { const Icon = contextIcons[profile.id]; return <label key={profile.id} className={`assessment-context-option ${value.contextId === profile.id && !value.invitationId ? 'selected' : ''}`}>
        <input type="radio" name="assessment-context" checked={value.contextId === profile.id && !value.invitationId} onChange={() => onChange({ contextId: profile.id })} />
        <Icon size={20} aria-hidden="true" /><span><strong>{profile.title}</strong><small>{profile.description}</small></span>
      </label>; })}</div>
      {query.data.invitations.length > 0 && <FormField className="field assessment-invitation-select" label="Или подготовьтесь к полученному приглашению" hint="Приглашение задаёт прикладной контекст экзамена Signal. Заявленный уровень вы выбираете и подтверждаете самостоятельно; это не дополнительная задача компании."><select className="input" value={value.invitationId ?? ''} onChange={event => {
        const invitation = query.data.invitations.find(item => item.id === Number(event.target.value));
        if (!invitation) { onChange({ contextId: programId === 'frontend-typescript' ? 'frontend-product' : 'api-platform' }); return; }
        onChange({ invitationId: invitation.id });
      }}><option value="">Выбрать приглашение</option>{query.data.invitations.map(item => <option value={item.id} key={item.id}>{item.title} · вакансия {item.snapshot.vacancyGrade ?? item.snapshot.targetGrade}</option>)}</select></FormField>}
    </fieldset>
    {selected && <CoverageDetails coverage={selected.coverage} unsupported={selectedInvitation?.snapshot.unsupportedRequirements} />}
  </section>;
}

export function AssessmentContextSummary({ attemptId }: { attemptId: number }) {
  const query = useQuery({ queryKey: ['assessment-context', attemptId], queryFn: () => api<{ snapshot: Snapshot | null }>(`/api/assessments/attempts/${attemptId}/context`) });
  if (query.isPending) return <p className="assessment-context-note" role="status">Загружаем программу проверки…</p>;
  if (query.isError) return <p className="assessment-context-note">Описание программы временно недоступно. Ответы можно продолжать сохранять.</p>;
  if (!query.data.snapshot) return null;
  const snapshot = query.data.snapshot;
  return <section className="panel assessment-context-summary"><div className="assessment-context-heading"><ListChecks size={19} /><div><strong>Квалификационный экзамен Signal</strong><p>Заявленный уровень {snapshot.targetGrade} · {snapshot.context.title}</p></div></div>{snapshot.source === 'invitation' && <p className="assessment-context-note">Контекст приглашения: {snapshot.roleTitle}{snapshot.vacancyGrade ? ` · вакансия ${snapshot.vacancyGrade}` : ''}. Результат определяется общей программой Signal.</p>}<CoverageDetails coverage={snapshot.context.coverage} unsupported={snapshot.unsupportedRequirements} /></section>;
}

export function EmployerAssessmentContext({ needId }: { needId: number }) {
  const query = useQuery({ queryKey: ['employer-assessment-context', needId], queryFn: () => api<{ supported: boolean; targetGrade: Grade; context: Profile; reason: string; unsupportedRequirements: string[] }>(`/api/employer/needs/${needId}/assessment-context`), enabled: needId > 0 });
  if (!needId || query.isPending) return null;
  if (query.isError) return <p className="assessment-context-note">Не удалось загрузить программу проверки для этой роли.</p>;
  const result = query.data;
  return <section className="panel assessment-context-summary"><div className="assessment-context-heading"><Gauge size={21} /><div><strong>Контекст квалификационного экзамена Signal</strong><p>{result.supported ? `${result.context.title} · уровень вакансии ${result.targetGrade}` : 'Проверка для этой специализации готовится'}</p></div></div><p className="assessment-context-note">Кандидат самостоятельно выбирает уровень экзамена. Задания сохраняют общую программу и пороги Signal. Дополнительная практика вашей компании оценивается отдельно и не меняет грейд.</p><p className="assessment-context-note">{result.reason}</p>{result.supported && <CoverageDetails coverage={result.context.coverage} unsupported={result.unsupportedRequirements} />}</section>;
}
