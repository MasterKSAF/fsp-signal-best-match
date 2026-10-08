import { ResumeDocumentButton, ResumeSaveRegistration, useResumeSaveBusy } from './my-resumes';
import { useEffect, useRef, useState, type ComponentProps, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, BriefcaseBusiness, Check, ChevronDown, ClipboardList, Download, FileText, FolderGit2, GraduationCap, Link2, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { Link } from 'wouter';
import { FormField } from './form-field';
import { DictionaryCombobox, DictionaryTags } from './dictionary-input';
import { DOMAIN_OPTIONS, ROLE_OPTIONS, SOFT_SKILL_OPTIONS } from '@/lib/professional-dictionaries';
import { InlineInfo } from './inline-info';
import './candidate-resume.css';
import { readWorkspaceDraft, writeWorkspaceDraft, workspaceDraftKey } from '@/lib/workspace-drafts';
import { useResumeSelection } from './multi-resume';
import { prepareResumeDraftRecovery, resolveResumeDraftRecovery, resumeContentEqual, resumeContentFields, resumeContentLabels, resumeContentValue, resumeDraftBaseline, type ResumeAnswerKey as AnswerKey, type ResumeQuestionnaire as Questionnaire, type ResumeInput, type ResumeContentField } from '@/lib/candidate-resume-draft';

type Grade = 'Junior' | 'Middle' | 'Senior';
type ResumeResponse = ResumeInput & {
  updatedAt: string | null; revision: number;
  questionnaireHistory: { completedAt: string; recommendedGrade: Grade; questionnaire: Questionnaire }[];
  recommendation: { grade: Grade | null; completedCount: number; totalQuestions: number; explanation: string };
  questions: { key: AnswerKey; title: string; question: string }[];
  questionSets: Record<Questionnaire['specialization'], { key: AnswerKey; title: string; question: string }[]>;
  answerScale: { value: number; label: string }[];
};
type ContentDraftSnapshot = { draft: ResumeInput; revision: number | null; baseline: ResumeInput | null };
type ContentDraftCache = Omit<ContentDraftSnapshot, 'baseline'> & { baseline: ResumeInput | string | null; backup?: ContentDraftSnapshot | null; retiredQuestionnaires?: Questionnaire[] };
class ResumeContentError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}


function inputFrom(response: ResumeResponse): ResumeInput {
  const { summary, softSkills, experience, projects, education, portfolio, questionnaire } = response;
  return { summary, softSkills, experience, projects, education, portfolio, questionnaire };
}
async function loadResume(resumeId: number, init?: RequestInit): Promise<ResumeResponse> {
  const response = await fetch(`/api/me/resumes/${resumeId}`, { credentials: 'same-origin', ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  const data = await response.json();
  if (!response.ok) throw new ResumeContentError([data.error, data.details?.[0]?.message].filter(Boolean).join(' ') || 'Не удалось загрузить резюме.', response.status);
  return data;
}
function Field(props: ComponentProps<typeof FormField>) {
  return <FormField {...props} className={`resume-field ${props.className ?? ''}`} />;
}
function ResumeGroup({ title, icon, count, children }: { title: string; icon: ReactNode; count: number; children: ReactNode }) {
  return <details className="resume-group"><summary>{icon}<span>{title}</span><span className="resume-count">{count || 'Добавить'}</span><ChevronDown size={16} className="resume-chevron" /></summary><div className="resume-group-content">{children}</div></details>;
}

export function CandidateResumeSection({ resumeId, specialization }: { resumeId: number; specialization: string }) {
  const { userId } = useResumeSelection();
  const formRef = useRef<HTMLFormElement>(null); const globalBusy = useResumeSaveBusy();
  const draftKey = workspaceDraftKey(userId, resumeId, 'content');
  const [cached] = useState(() => readWorkspaceDraft<ContentDraftCache>(draftKey));
  const queryKey = ['candidate-resume', resumeId, specialization];
  const query = useQuery({ queryKey, queryFn: () => loadResume(resumeId) });
  const qc = useQueryClient();
  const [draft, setDraft] = useState<ResumeInput | null>(cached?.draft ?? null);
  const [draftRevision, setDraftRevision] = useState<number | null>(cached?.revision ?? null);
  const [baseline, setBaseline] = useState<ResumeInput | null>(() => resumeDraftBaseline(cached?.baseline));
  const [backup, setBackup] = useState<ContentDraftSnapshot | null>(cached?.backup ?? null);
  const [retiredQuestionnaires, setRetiredQuestionnaires] = useState<Questionnaire[]>(() => {
    const retired = cached?.retiredQuestionnaires ?? [];
    const previous = cached?.draft.questionnaire;
    if (previous && previous.specialization !== specialization && Object.values(previous.answers).some(value => value !== null && value !== undefined)) {
      return retired.some(item => resumeContentEqual(item, previous)) ? retired : [...retired, previous];
    }
    return retired;
  });
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState('');
  const [draftNotice, setDraftNotice] = useState('');
  const [reloadConfirm, setReloadConfirm] = useState(false);
  const [comparison, setComparison] = useState<{ response: ResumeResponse; choices: Partial<Record<ResumeContentField, 'local' | 'current'>>; acceptedProgram: boolean } | null>(null);
  const [pdfPending, setPdfPending] = useState(false);
  const [pdfError, setPdfError] = useState('');
  const save = useMutation({ mutationFn: (input: ResumeInput) => loadResume(resumeId, { method: 'PUT', body: JSON.stringify({ ...input, revision: draftRevision }) }), onSuccess: (result) => { const content = inputFrom(result); setBaseline(content); qc.setQueryData(queryKey, result); setDraft(content); setDraftRevision(result.revision); setComparison(null); setReloadConfirm(false); setRefreshError(''); setDraftNotice('Резюме и ответы сохранены'); qc.invalidateQueries({ queryKey: ['selected-candidate-profile'] }); qc.invalidateQueries({ queryKey: ['candidate-resumes'] }); qc.invalidateQueries({ queryKey: ['candidate-evidence-registry'] }); } });
  useEffect(() => {
    if (!query.data) return;
    const content = inputFrom(query.data);
    // Only a clean draft or an unchanged content baseline can follow a newer
    // revision automatically. A restored dirty cache takes the same recovery path.
    if (!draft || resumeContentEqual(draft, baseline) || resumeContentEqual(draft, content)) { if (!resumeContentEqual(baseline, content)) setBaseline(content); if (!resumeContentEqual(draft, content)) setDraft(content); setDraftRevision(query.data.revision); }
    else if (resumeContentEqual(content, baseline)) setDraftRevision(query.data.revision);
  }, [query.data, draft, baseline]);
  useEffect(() => { if (draft) writeWorkspaceDraft(draftKey, { draft, revision: draftRevision, baseline, backup, retiredQuestionnaires }); }, [draftKey, draft, draftRevision, baseline, backup, retiredQuestionnaires]);
  if (query.isLoading || (!draft && !query.isError)) return <section className="panel resume-panel" role="status">Загружаем резюме…</section>;
  if (!draft || !query.data) return <section className="panel resume-panel" role="alert"><p>Не удалось загрузить резюме. Сохранённый в этой вкладке черновик не удалён.</p><button className="button secondary" onClick={() => query.refetch()}>Повторить</button></section>;
  const payload = draft;
  const dirty = !resumeContentEqual(payload, inputFrom(query.data));
  const conflictError = save.isError && save.error instanceof ResumeContentError && save.error.status === 409;
  const programMismatch = draft.questionnaire.specialization !== specialization || draft.questionnaire.version !== query.data.questionnaire.version;
  const staleContent = dirty && !resumeContentEqual(inputFrom(query.data), baseline);
  const needsRecovery = conflictError || programMismatch || staleContent;
  const localBusy = save.isPending || refreshing;
  const busy = localBusy || globalBusy;
  const recovery = comparison ? prepareResumeDraftRecovery(baseline, draft, inputFrom(comparison.response)) : null;
  const unresolved = recovery?.overlappingFields.filter(key => !comparison?.choices[key]) ?? [];
  const comparedFields = comparison ? resumeContentFields.filter(key => !resumeContentEqual(draft[key], inputFrom(comparison.response)[key]) || !resumeContentEqual(baseline?.[key], inputFrom(comparison.response)[key])) : [];
  const questionnaireDirty = !resumeContentEqual(draft.questionnaire, query.data.questionnaire);
  const completed = Object.values(draft.questionnaire.answers).filter(value => value != null).length;
  const questions = query.data.questionSets?.[draft.questionnaire.specialization] ?? query.data.questions;
  const set = <K extends keyof ResumeInput>(key: K, value: ResumeInput[K]) => { setDraft(old => old ? { ...old, [key]: value } : old); setDraftNotice(''); setComparison(old => old ? { ...old, choices: { ...old.choices, [key]: undefined }, acceptedProgram: key === 'questionnaire' ? false : old.acceptedProgram } : old); if (!conflictError) save.reset(); };
  const editRow = <K extends 'experience' | 'projects' | 'education' | 'portfolio'>(key: K, index: number, value: Partial<ResumeInput[K][number]>) => set(key, draft[key].map((row, rowIndex) => rowIndex === index ? { ...row, ...value } : row) as ResumeInput[K]);
  const removeRow = <K extends 'experience' | 'projects' | 'education' | 'portfolio'>(key: K, index: number) => set(key, draft[key].filter((_, rowIndex) => rowIndex !== index) as ResumeInput[K]);
  const refreshForComparison = async () => {
    setRefreshing(true); setRefreshError(''); setReloadConfirm(false);
    try {
      const result = await query.refetch();
      if (result.error || !result.data) throw result.error ?? new Error('Не удалось обновить резюме.');
      setComparison({ response: result.data, choices: {}, acceptedProgram: false });
    } catch (error) { setRefreshError(error instanceof Error ? error.message : 'Не удалось обновить резюме. Ваш черновик остался в форме.'); }
    finally { setRefreshing(false); }
  };
  const archiveQuestionnaire = (questionnaire: Questionnaire | null) => {
    if (questionnaire) setRetiredQuestionnaires(old => old.some(item => resumeContentEqual(item, questionnaire)) ? old : [...old, questionnaire]);
  };
  const applyRecovery = () => {
    if (!comparison || !recovery) return;
    const content = resolveResumeDraftRecovery(recovery, inputFrom(comparison.response), comparison.choices, comparison.acceptedProgram);
    if (!content) return;
    setBackup({ draft, baseline, revision: draftRevision });
    archiveQuestionnaire(recovery.previousQuestionnaire);
    setBaseline(inputFrom(comparison.response)); setDraft(content); setDraftRevision(comparison.response.revision); setComparison(null); setReloadConfirm(false); save.reset();
    setDraftNotice('Черновик объединён с актуальной версией. Проверьте форму и нажмите «Сохранить резюме и опрос».');
  };
  const loadCurrent = () => {
    if (!comparison) return;
    setBackup({ draft, baseline, revision: draftRevision });
    if (recovery?.programChanged) archiveQuestionnaire(draft.questionnaire);
    const content = inputFrom(comparison.response);
    setBaseline(content); setDraft(content); setDraftRevision(comparison.response.revision); setComparison(null); setReloadConfirm(false); save.reset();
    setDraftNotice('В форме сохранённая версия. Прежний черновик остался в памяти этой вкладки — его можно вернуть.');
  };
  const restoreBackup = () => {
    if (!backup) return;
    setBackup({ draft, baseline, revision: draftRevision }); setDraft(backup.draft); setBaseline(backup.baseline); setDraftRevision(backup.revision); setComparison(null); setReloadConfirm(false); save.reset();
    setDraftNotice('Черновик возвращён. Если сохранённая версия изменилась, сначала сравните данные.');
  };
  const saveContent = async () => {
    if (localBusy || needsRecovery || comparison) return false;
    setPdfError(''); setRefreshError(''); setDraftNotice('');
    try { await save.mutateAsync(payload); return true; } catch { return false; }
  };
  const submit = (event: FormEvent) => { event.preventDefault(); if (!globalBusy) void saveContent(); };
  const download = async (format: 'pdf' | 'docx') => {
    setPdfPending(true); setPdfError('');
    try {
      const response = await fetch(`/api/resumes/${resumeId}/document.${format}`, { credentials: 'same-origin' });
      if (!response.ok) throw new Error('Не удалось скачать PDF. Повторите попытку.');
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `Signal-Resume.${format}`; document.body.appendChild(anchor); anchor.click(); anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (error) { setPdfError(error instanceof Error ? error.message : 'Не удалось скачать PDF.'); }
    finally { setPdfPending(false); }
  };
  return <form ref={formRef} className="resume-layout" onSubmit={submit} onInvalidCapture={event => { const details = (event.target as HTMLElement).closest('details'); if (details) details.open = true; }} data-testid="form-resume">
    <ResumeSaveRegistration id="content" section={{order:10,dirty,pending:localBusy,blocked:needsRecovery||!!comparison,validate:()=>formRef.current?.reportValidity()??false,save:saveContent,focus:()=>formRef.current?.scrollIntoView({block:'center'})}}/>
    {needsRecovery && !comparison && <section className="panel resume-conflict" role="alert" data-testid="resume-content-conflict"><strong>{programMismatch ? 'Специализация резюме изменилась' : 'Сохранённая версия резюме изменилась'}</strong><p>{programMismatch ? 'Ваш текст и прежние ответы остались в черновике. Для новой специализации нужна другая анкета.' : 'Ваши правки остались в форме. Сравните версии и выберите, что сохранить.'}</p><button type="button" className="button secondary" disabled={busy} onClick={refreshForComparison} data-testid="button-refresh-resume-content">{refreshing ? 'Загружаем…' : 'Обновить и сравнить, сохранив черновик'}</button></section>}
    {comparison && recovery && <section className="panel resume-conflict" aria-labelledby="resume-comparison-heading" data-testid="resume-content-comparison">
      <strong id="resume-comparison-heading">Сравнение с сохранённой версией</strong><p>Обновление не сохранило и не заменило ваши правки. Выберите вариант для пересекающихся изменений, затем примените его к актуальной версии.</p>
      {comparedFields.length === 0 && <p>Содержание совпадает. Можно использовать актуальную версию для следующего сохранения.</p>}
      {comparedFields.map(key => <div className="resume-conflict-field" key={key} data-testid={`resume-compare-${key}`}><b>{resumeContentLabels[key]}</b><div className="resume-conflict-values"><div><span>Ваш черновик</span><pre>{resumeContentValue(key, draft[key])}</pre></div><div><span>Сохранённая версия</span><pre>{resumeContentValue(key, inputFrom(comparison.response)[key])}</pre></div></div>{baseline && <details className="resume-conflict-baseline"><summary>Исходная версия</summary><pre>{resumeContentValue(key, baseline[key])}</pre></details>}{recovery.overlappingFields.includes(key) && <div className="resume-conflict-choices" role="group" aria-label={`Вариант раздела «${resumeContentLabels[key]}»`}><button type="button" className="button secondary" disabled={busy} aria-pressed={comparison.choices[key] === 'local'} onClick={() => setComparison(old => old ? { ...old, choices: { ...old.choices, [key]: 'local' } } : old)} data-testid={`resume-keep-local-${key}`}>Оставить мой вариант</button><button type="button" className="button secondary" disabled={busy} aria-pressed={comparison.choices[key] === 'current'} onClick={() => setComparison(old => old ? { ...old, choices: { ...old.choices, [key]: 'current' } } : old)} data-testid={`resume-use-current-${key}`}>Использовать сохранённый</button></div>}</div>)}
      {recovery.programChanged && <div className="resume-program-change" role="note"><p>Новая анкета: <b>{comparison.response.questionnaire.specialization}</b>. Ответы прежней программы не переносятся. Они останутся отдельным черновиком в этой вкладке; предметная область и текст резюме сохранятся.</p><label><input type="checkbox" checked={comparison.acceptedProgram} disabled={busy} onChange={event => setComparison(old => old ? { ...old, acceptedProgram: event.target.checked } : old)} data-testid="resume-accept-new-questionnaire"/><span>Перейти к анкете новой специализации</span></label></div>}
      <div className="resume-conflict-actions"><button type="button" className="button primary" disabled={busy || unresolved.length > 0 || (recovery.programChanged && !comparison.acceptedProgram)} onClick={applyRecovery} data-testid="button-rebase-resume-content">Применить выбранные правки к актуальной версии</button><button type="button" className="button secondary" disabled={busy} onClick={() => setReloadConfirm(true)} data-testid="button-load-saved-resume-content">Загрузить сохранённую версию</button><button type="button" className="button text-button" disabled={busy} onClick={() => { setComparison(null); setReloadConfirm(false); }}>Вернуться к черновику</button></div>
      {unresolved.length > 0 && <p role="status">Выберите вариант для {unresolved.length === 1 ? 'раздела' : 'разделов'}: {unresolved.map(key => resumeContentLabels[key]).join(', ')}.</p>}
      {reloadConfirm && <div className="resume-reload-confirm" role="alert"><p>Заменить форму сохранёнными данными? Нынешний черновик останется в памяти этой вкладки, и его можно будет вернуть.</p><div className="resume-conflict-actions"><button type="button" className="button secondary" disabled={busy} onClick={loadCurrent} data-testid="button-confirm-load-resume-content">Да, загрузить сохранённую версию</button><button type="button" className="button text-button" onClick={() => setReloadConfirm(false)}>Отмена</button></div></div>}
    </section>}
    {refreshError && <p className="resume-recovery-error" role="alert">{refreshError} Ваш черновик сохранён в форме.</p>}
    {backup && <div className="resume-draft-backup" role="status"><span>Предыдущий черновик доступен в памяти этой вкладки.</span><button type="button" className="button text-button" disabled={busy} onClick={restoreBackup} data-testid="button-restore-resume-content">Вернуть предыдущий черновик</button></div>}
    <fieldset className="resume-fieldset" disabled={busy}>
      <section className="panel resume-panel" aria-labelledby="resume-heading">
        <div className="panel-heading"><div><span className="eyebrow">ОПЫТ И РЕЗУЛЬТАТЫ</span><h2 id="resume-heading">Моё резюме<InlineInfo label="Разделы резюме">Опыт, проекты, образование и ссылки. Сохранённые данные доступны в предпросмотре, Word и PDF.</InlineInfo></h2></div><FileText size={21} /></div>
        <Field label="О себе"><textarea className="input resume-textarea" rows={4} maxLength={3000} value={draft.summary} onChange={event => set('summary', event.target.value)} placeholder="В чём ваша специализация, какой опыт хотите применить и какие задачи вам интересны" data-testid="input-resume-summary" /></Field>
        <Field label="Личные навыки" layout="vertical" hint="Выберите подсказку или добавьте свой навык. Это ваша самооценка, а не подтверждение экзаменом."><DictionaryTags value={draft.softSkills} onChange={value => set('softSkills', value)} options={SOFT_SKILL_OPTIONS} maxItems={20} maxLength={100} placeholder="Например, командная работа" data-testid="input-resume-soft-skills" /></Field>
        <ResumeGroup title="Опыт работы" count={draft.experience.length} icon={<BriefcaseBusiness size={19} />}>
          {!draft.experience.length && <p className="resume-empty">Добавьте работу, стажировку или фриланс. Если опыта пока нет, расскажите о проектах ниже.</p>}
          {draft.experience.map((item, index) => <div className="resume-entry" key={index}><div className="resume-entry-heading"><b>Место работы {index + 1}</b><button type="button" className="icon-button" aria-label={`Удалить место работы ${index + 1}`} onClick={() => removeRow('experience', index)}><Trash2 size={16} /></button></div><div className="resume-grid"><Field label="Компания"><input className="input" required maxLength={160} value={item.company} onChange={event => editRow('experience', index, { company: event.target.value })} /></Field><Field label="Должность" hint="Выберите вариант или укажите свою должность."><DictionaryCombobox required maxLength={160} value={item.role} onChange={value => editRow('experience', index, { role: value })} options={ROLE_OPTIONS} placeholder="Выберите или напишите должность" /></Field><Field label="Начало"><input className="input" type="month" required min="1900-01" max="2199-12" value={item.start} onChange={event => editRow('experience', index, { start: event.target.value })} /></Field><Field label="Окончание"><input className="input" type="month" min={item.start || '1900-01'} max="2199-12" value={item.end || ''} onChange={event => editRow('experience', index, { end: event.target.value || null })} /><small>Оставьте пустым, если работаете сейчас</small></Field></div><Field label="Задачи и достижения"><textarea className="input resume-textarea" rows={3} maxLength={2400} value={item.description} onChange={event => editRow('experience', index, { description: event.target.value })} placeholder="Ваша зона ответственности и конкретные результаты" /></Field></div>)}
          <button type="button" className="button secondary" disabled={draft.experience.length >= 10} onClick={() => set('experience', [...draft.experience, { company: '', role: '', start: '', end: null, description: '' }])} data-testid="button-add-experience"><Plus size={16} /> Добавить место работы</button>
        </ResumeGroup>
        <ResumeGroup title="Проекты" count={draft.projects.length} icon={<FolderGit2 size={19} />}>
          {!draft.projects.length && <p className="resume-empty">Рабочие, учебные и собственные проекты помогут показать ваши навыки.</p>}
          {draft.projects.map((item, index) => <div className="resume-entry" key={index}><div className="resume-entry-heading"><b>Проект {index + 1}</b><button type="button" className="icon-button" aria-label={`Удалить проект ${index + 1}`} onClick={() => removeRow('projects', index)}><Trash2 size={16} /></button></div><div className="resume-grid"><Field label="Название"><input className="input" required maxLength={160} value={item.title} onChange={event => editRow('projects', index, { title: event.target.value })} /></Field><Field label="Ваша роль" hint="Покажите вашу ответственность в проекте."><DictionaryCombobox maxLength={160} value={item.role} onChange={value => editRow('projects', index, { role: value })} options={ROLE_OPTIONS} placeholder="Выберите или напишите роль" /></Field></div><Field label="Задача, решение и результат"><textarea className="input resume-textarea" rows={3} maxLength={2400} value={item.description} onChange={event => editRow('projects', index, { description: event.target.value })} /></Field><Field label="Ссылка на проект"><input className="input" type="url" maxLength={600} value={item.url || ''} onChange={event => editRow('projects', index, { url: event.target.value || null })} placeholder="https://…" /></Field></div>)}
          <button type="button" className="button secondary" disabled={draft.projects.length >= 10} onClick={() => set('projects', [...draft.projects, { title: '', role: '', description: '', url: null }])} data-testid="button-add-project"><Plus size={16} /> Добавить проект</button>
        </ResumeGroup>
        <ResumeGroup title="Образование и курсы" count={draft.education.length} icon={<GraduationCap size={19} />}>
          {draft.education.map((item, index) => <div className="resume-entry" key={index}><div className="resume-entry-heading"><b>Образование {index + 1}</b><button type="button" className="icon-button" aria-label={`Удалить образование ${index + 1}`} onClick={() => removeRow('education', index)}><Trash2 size={16} /></button></div><div className="resume-grid"><Field label="Учебное заведение или платформа"><input className="input" required maxLength={200} value={item.institution} onChange={event => editRow('education', index, { institution: event.target.value })} /></Field><Field label="Направление или курс"><input className="input" required maxLength={200} value={item.qualification} onChange={event => editRow('education', index, { qualification: event.target.value })} /></Field><Field label="Начало" hint="Год или год-месяц"><input className="input" type="text" required maxLength={7} pattern="(?:19|20|21)[0-9]{2}(?:-(?:0[1-9]|1[0-2]))?" placeholder="2022 или 2022-09" value={item.start} onChange={event => editRow('education', index, { start: event.target.value })} /></Field><Field label="Окончание" hint="Год или год-месяц"><input className="input" type="text" maxLength={7} pattern="(?:19|20|21)[0-9]{2}(?:-(?:0[1-9]|1[0-2]))?" placeholder="2026 или 2026-06" value={item.end || ''} onChange={event => editRow('education', index, { end: event.target.value || null })} /><small>Оставьте пустым, если ещё учитесь</small></Field></div></div>)}
          <button type="button" className="button secondary" disabled={draft.education.length >= 5} onClick={() => set('education', [...draft.education, { institution: '', qualification: '', start: '', end: null }])} data-testid="button-add-education"><Plus size={16} /> Добавить образование</button>
        </ResumeGroup>
        <ResumeGroup title="Портфолио и ссылки" count={draft.portfolio.length} icon={<Link2 size={19} />}>
          {draft.portfolio.map((item, index) => <div className="resume-entry" key={index}><div className="resume-entry-heading"><b>Ссылка {index + 1}</b><button type="button" className="icon-button" aria-label={`Удалить ссылку ${index + 1}`} onClick={() => removeRow('portfolio', index)}><Trash2 size={16} /></button></div><div className="resume-grid"><Field label="Название"><input className="input" required maxLength={100} value={item.title} onChange={event => editRow('portfolio', index, { title: event.target.value })} placeholder="GitHub или личный сайт" /></Field><Field label="Адрес"><input className="input" type="url" required maxLength={600} value={item.url} onChange={event => editRow('portfolio', index, { url: event.target.value })} placeholder="https://…" /></Field></div></div>)}
          <button type="button" className="button secondary" disabled={draft.portfolio.length >= 8} onClick={() => set('portfolio', [...draft.portfolio, { title: '', url: '' }])} data-testid="button-add-portfolio"><Plus size={16} /> Добавить ссылку</button>
        </ResumeGroup>
      </section>
      <section className="panel resume-panel" id="professional-questionnaire" aria-labelledby="questionnaire-heading">
        <div className="panel-heading"><div><span className="eyebrow">СТАРТОВЫЙ УРОВЕНЬ</span><h2 id="questionnaire-heading">Профессиональный опрос<InlineInfo label="Профессиональный опрос: назначение">Шесть вопросов помогают рекомендовать стартовый уровень. Проверку и уровень можно выбрать самостоятельно, даже если опрос не завершён. Самооценка не подтверждает навыки или грейд.</InlineInfo></h2></div><ClipboardList size={21} /></div>
        {programMismatch && <p className="resume-program-note" role="status">В форме ответы прежней специализации. Сначала сравните версии и перейдите к новой анкете.</p>}
        <div className="resume-grid"><Field label="Предметная область" hint="Сфера продуктов и задач: например, финтех или образование. Можно указать свою."><DictionaryCombobox required maxLength={120} value={draft.questionnaire.industry} onChange={value => set('questionnaire', { ...draft.questionnaire, industry: value })} options={DOMAIN_OPTIONS} placeholder="Выберите или напишите область" data-testid="input-questionnaire-industry" /></Field><Field label="IT-направление" hint="Поддерживаемая программа выбранного резюме. Предметная область не меняет направление экзамена."><input className="input" readOnly value={draft.questionnaire.specialization}/></Field></div>
        <div className="resume-progress"><span>Ответов: {completed} из {query.data.questions.length}</span><progress value={completed} max={query.data.questions.length} aria-label="Прогресс профессионального опроса" /></div>
        <div className="resume-question-list">{questions.map((question, index) => <Field label={`${index + 1}. ${question.question}`} key={question.key}><select className="input" value={draft.questionnaire.answers[question.key] ?? ''} onChange={event => set('questionnaire', { ...draft.questionnaire, answers: { ...draft.questionnaire.answers, [question.key]: event.target.value === '' ? null : Number(event.target.value) } })} data-testid={`select-questionnaire-${question.key}`}><option value="">Выберите ответ</option>{query.data!.answerScale.map(answer => <option key={answer.value} value={answer.value}>{answer.label}</option>)}</select></Field>)}</div>
        <div className="resume-recommendation" role="status"><ShieldCheck size={22} /><div><b>{questionnaireDirty ? completed === 6 ? 'Ответы готовы — сохраните опрос' : 'Можно продолжить позже' : query.data.recommendation.grade ? `Рекомендуем начать с ${query.data.recommendation.grade}` : 'Рекомендация стартового уровня'}</b><p>{questionnaireDirty ? 'Ваши ответы сохраняются вместе с резюме. Самооценка не подтверждает навыки.' : query.data.recommendation.explanation}</p>{!questionnaireDirty && query.data.recommendation.grade && <Link className="panel-link" href={`/candidate/kalibr?grade=${query.data.recommendation.grade}&resumeId=${resumeId}`} data-testid="link-questionnaire-assessment">Перейти к выбору проверки <ArrowRight size={15} /></Link>}</div></div>
        {query.data.questionnaireHistory.length > 0 && <details className="resume-history"><summary>История опроса · {query.data.questionnaireHistory.length}<ChevronDown size={15} /></summary>{[...query.data.questionnaireHistory].reverse().map((item, index) => <div className="resume-history-item" key={`${item.completedAt}-${index}`}><span>{new Date(item.completedAt).toLocaleString('ru-RU')}</span><b>Рекомендован {item.recommendedGrade}</b><small>{item.questionnaire.industry} · {item.questionnaire.specialization}</small></div>)}</details>}
        {retiredQuestionnaires.length > 0 && <details className="resume-history resume-questionnaire-drafts"><summary>Черновики прежних ответов · {retiredQuestionnaires.length}<ChevronDown size={15}/></summary>{retiredQuestionnaires.map((item, index) => <div className="resume-questionnaire-draft" key={index}><pre>{resumeContentValue('questionnaire', item)}</pre>{item.version === query.data!.questionnaire.version && item.specialization === specialization && <button type="button" className="button secondary" onClick={() => set('questionnaire', item)}>Вернуть эти ответы в форму</button>}</div>)}<small>Доступны только в памяти этой вкладки до выхода из аккаунта.</small></details>}
      </section>
      <div className="resume-footer"><div className="resume-save"><span role="status">{needsRecovery ? 'Сравните версии перед сохранением' : comparison ? 'Завершите сравнение версий' : draftNotice || (save.isError ? save.error.message : save.isSuccess && !dirty ? 'Резюме и ответы сохранены' : dirty ? 'Есть несохранённые изменения' : query.data.updatedAt ? 'Изменения сохранены' : 'Заполните разделы в удобном порядке')}</span>{dirty && !needsRecovery && !comparison && <button type="button" className="button secondary" onClick={refreshForComparison} data-testid="button-compare-resume-content">Сравнить версии</button>}<button className="button primary" type="submit" disabled={needsRecovery || !!comparison} data-testid="button-save-resume">{save.isPending ? 'Сохраняем…' : 'Сохранить резюме и опрос'} <Check size={16} /></button></div><div className="resume-download"><div><b>Документы резюме</b><p>Предпросмотр и файлы содержат сохранённые данные этого резюме.{dirty ? ' Сначала сохраните изменения.' : ''}</p>{pdfError && <p role="alert">{pdfError}</p>}</div><button type="button" className="button secondary" disabled={dirty || pdfPending} onClick={() => download('pdf')} data-testid="button-download-resume"><Download size={16} /> {pdfPending ? 'Готовим PDF…' : 'Скачать PDF'}</button><button type="button" className="button secondary" disabled={dirty || pdfPending} onClick={() => download('docx')}>Word</button><ResumeDocumentButton resumeId={resumeId} label="Предпросмотр"/></div></div>
    </fieldset>
  </form>;
}
