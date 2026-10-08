import { evidenceNoteForDisplay } from '../lib/qualification-presentation';
import { ArrowRight, BadgeCheck, ChevronDown, FileText, History, Info, ShieldCheck, ShieldX } from 'lucide-react';
import { FormField } from './form-field';
import './candidate-evidence-registry.css';

/** A structural owner DTO. The server alone decides compatibility/selection. */
export type EvidenceRegistryCatalog = {
  matrixVersion: string;
  resumes: { id: number; revision: number; title: string; specialization: string; visibility: string; isPrimary: boolean; verifiedGrade: string | null }[];
  evidence: {
    id: string; skill: string; canonicalSkillId: string; criterionId: string; criterion: string;
    date: string; sourceType: string; purpose: string; attemptId: number; originalResumeId: number | null;
    programId: string; programVersion: string; grade: string; result: number; status: string;
    limitation: string | null; correction: { date: string; reason: string } | null;
    applications: { resumeId: number; applied: boolean; selected: boolean; reason: string; reasonCode: string; compatibilityRuleId: string | null; nextStep: string | null }[];
  }[];
  historicalQualifications: {
    id: string; sourceType: string; specialization: string; grade: string | null; score: number | null;
    skills: string[]; date: string | null; programVersion: null; attemptId: number | null;
    limitation: string; status: string; applications: { resumeId: number; applied: boolean; reason: string }[];
  }[];
};

export type CandidateEvidenceRegistryProps = {
  catalog?: EvidenceRegistryCatalog | null;
  loading?: boolean;
  error?: string | null;
  selectedResumeId: number | null;
  onSelectResume: (resumeId: number) => void;
  onStartAssessment: (resumeId: number) => void;
  onRetry?: () => void;
};

const originalDate = (value: string | null) => value ? new Date(value).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : 'Дата источника не сохранена';

/** Account history is independent of the currently selected CV. Never infer
 * compatibility, fill missing evidence, or expose assessment answers here. */
export function CandidateEvidenceRegistry({ catalog, loading, error, selectedResumeId, onSelectResume, onStartAssessment, onRetry }: CandidateEvidenceRegistryProps) {
  const current = catalog?.resumes.find(row => row.id === selectedResumeId) ?? null;
  const selectedCount = current ? catalog?.evidence.filter(row => row.applications.some(app => app.resumeId === current.id && app.selected)).length ?? 0 : 0;
  const skills = new Set(catalog?.evidence.filter(row => row.status === 'active').map(row => row.canonicalSkillId));
  return <section className="evidence-registry" aria-labelledby="evidence-registry-heading">
    <div className="panel evidence-registry-intro">
      <div className="evidence-registry-title"><span className="evidence-registry-icon" aria-hidden="true"><ShieldCheck size={23} /></span><div><h2 id="evidence-registry-heading">Мои подтверждения</h2><p>Результаты проверок сохраняются в вашем аккаунте. Резюме используют подходящие подтверждения с исходной датой.</p></div></div>
      {loading ? <p role="status">Загружаем историю подтверждений…</p> : error ? <div className="evidence-registry-error" role="alert"><p>{error}</p>{onRetry && <button className="button secondary" onClick={onRetry}>Повторить</button>}</div> : catalog && <>
        <div className="evidence-registry-context">
          <FormField label="Применимость к резюме" layout="vertical"><select value={current?.id ?? ''} onChange={event => { const id = Number(event.target.value); if (Number.isInteger(id) && id > 0) onSelectResume(id); }}><option value="" disabled>Выберите резюме</option>{catalog.resumes.map(row => <option key={row.id} value={row.id}>{row.title}{row.isPrimary ? ' · основное' : ''}</option>)}</select></FormField>
          {current && <div className="evidence-registry-current"><span>{current.specialization}</span><b>{current.verifiedGrade ? `${current.verifiedGrade} подтверждён` : 'Грейд не подтверждён'}</b><small>{selectedCount} исходных подтверждений выбрано для навыков этого резюме</small></div>}
          {current && <button className="button secondary" onClick={() => onStartAssessment(current.id)}>Пройти проверку <ArrowRight size={15} /></button>}
        </div>
        <div className="evidence-registry-totals"><span><b>{catalog.evidence.length}</b> исходных подтверждений критериев</span><span><b>{skills.size}</b> навыков с действующими источниками в аккаунте</span><span><History size={15} /> Копирование резюме не создаёт новую проверку</span></div>
        <p className="honest-note">Уровень отдельного критерия не означает подтверждённый грейд. Для грейда требуется полный результат программы.</p>
      </>}
    </div>
    {!loading && !error && catalog && <>
      {catalog.evidence.length === 0 && <div className="panel evidence-registry-empty"><FileText size={30} aria-hidden="true" /><h3>История начинается с первой проверки</h3><p>После завершения программы здесь появятся проверенные критерии, исходная дата и список резюме, к которым они применяются.</p>{current && <button className="button primary" onClick={() => onStartAssessment(current.id)}>Проверить навыки</button>}</div>}
      <div className="evidence-registry-list">{catalog.evidence.map(proof => {
        const application = proof.applications.find(row => row.resumeId === current?.id);
        const label = proof.status === 'revoked' ? 'Отозвано · история сохранена' : application?.selected ? 'Включено в это резюме' : application?.applied ? 'Совместимо · другой источник выбран' : current ? 'Сохранено · для другого контекста' : 'Сохранено в аккаунте';
        return <article key={proof.id} className={`panel evidence-registry-proof ${proof.status === 'revoked' ? 'is-revoked' : ''}`}>
          <div className="evidence-registry-proof-head"><div className="evidence-registry-proof-skill">{proof.status === 'revoked' ? <ShieldX size={21} aria-hidden="true" /> : <BadgeCheck size={21} aria-hidden="true" />}<h3>{proof.skill}</h3><span>Критерий {proof.grade}</span></div><span className={`evidence-registry-status ${application?.selected && proof.status !== 'revoked' ? 'is-selected' : ''}`}>{label}</span></div>
          <p className="evidence-registry-criterion">{proof.criterion}</p>
          <div className="evidence-registry-source"><time dateTime={proof.date}>{originalDate(proof.date)}</time><span>Проверка навыков Signal</span><span>{proof.result}% по критерию</span></div>
          {application && <div className="evidence-registry-reason"><Info size={16} aria-hidden="true" /><div><p>{application.reason}</p>{application.nextStep && <small>{application.nextStep}</small>}</div></div>}
          {proof.correction && <div className="evidence-registry-correction"><b>Исправление от {originalDate(proof.correction.date)}</b><p>{proof.correction.reason}</p></div>}
          <details><summary>Источник и применение к резюме <ChevronDown size={16} aria-hidden="true" /></summary><div className="evidence-registry-origin"><span>Программа <code>{proof.programId}</code></span><span>Исходная версия <code>{proof.programVersion}</code></span><span>Проверка №{proof.attemptId}</span><span>Критерий <code>{proof.criterionId}</code></span></div>{evidenceNoteForDisplay(proof.limitation) && <p className="honest-note">{evidenceNoteForDisplay(proof.limitation)}</p>}
            {proof.applications.length ? <ul className="evidence-registry-applications">{proof.applications.map(app => {
              const resume = catalog.resumes.find(row => row.id === app.resumeId);
              return <li key={app.resumeId}><div><button className="evidence-registry-resume-link" onClick={() => onSelectResume(app.resumeId)}>{resume?.title ?? `Резюме №${app.resumeId}`}</button><small>{resume?.specialization}{resume?.visibility === 'private' ? ' · скрыто' : ''}</small></div><div><b>{app.selected ? 'Используется' : app.applied ? 'Совместимо' : 'Не применяется'}</b><p>{app.reason}</p></div></li>;
            })}</ul> : <p className="honest-note">Действующих резюме нет. Исходное подтверждение остаётся в аккаунте.</p>}
          </details>
        </article>;
      })}</div>
      {catalog.historicalQualifications.length > 0 && <section className="panel evidence-registry-history" aria-labelledby="evidence-registry-history"><h3 id="evidence-registry-history"><History size={19} aria-hidden="true" /> Исторические итоги</h3>{catalog.historicalQualifications.map(row => <details key={row.id}><summary>{row.specialization} · {row.grade ?? 'Без грейда'} · {originalDate(row.date)}{row.status === 'revoked' ? ' · отозвано' : ''}<ChevronDown size={16} aria-hidden="true" /></summary><p>{row.skills.join(' · ') || 'Отдельные навыки не сохранены'}</p>{row.applications.map(app => <p key={app.resumeId}><b>{catalog.resumes.find(resume => resume.id === app.resumeId)?.title ?? `Резюме №${app.resumeId}`}: </b>{app.applied ? 'Применяется' : 'Не применяется'}</p>)}</details>)}</section>}
    </>}
  </section>;
}
