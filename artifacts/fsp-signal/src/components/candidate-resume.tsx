import { useEffect, useRef, useState, type ComponentProps, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, BriefcaseBusiness, Check, ChevronDown, ClipboardList, Download, FileText, FolderGit2, GraduationCap, Link2, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { Link } from 'wouter';
import { FormField } from './form-field';
import { DictionaryCombobox, DictionaryTags } from './dictionary-input';
import { DOMAIN_OPTIONS, ROLE_OPTIONS, SOFT_SKILL_OPTIONS } from '@/lib/professional-dictionaries';
import './candidate-resume.css';

type Grade = 'Junior' | 'Middle' | 'Senior';
type AnswerKey = 'python' | 'databases' | 'api' | 'testing' | 'reliability' | 'ownership' | 'typescript' | 'state' | 'accessibility' | 'performance' | 'architecture';
type Questionnaire = { version: 'backend-python-v1' | 'frontend-typescript-v1'; industry: string; specialization: 'Backend / Python' | 'Frontend / TypeScript'; answers: Partial<Record<AnswerKey, number | null>> };
type Experience = { company: string; role: string; start: string; end: string | null; description: string };
type Project = { title: string; role: string; description: string; url: string | null };
type Education = { institution: string; qualification: string; start: string; end: string | null };
type PortfolioLink = { title: string; url: string };
type ResumeInput = { summary: string; softSkills: string[]; experience: Experience[]; projects: Project[]; education: Education[]; portfolio: PortfolioLink[]; questionnaire: Questionnaire };
type ResumeResponse = ResumeInput & {
  updatedAt: string | null; revision: number;
  questionnaireHistory: { completedAt: string; recommendedGrade: Grade; questionnaire: Questionnaire }[];
  recommendation: { grade: Grade | null; completedCount: number; totalQuestions: number; explanation: string };
  questions: { key: AnswerKey; title: string; question: string }[];
  questionSets: Record<Questionnaire['specialization'], { key: AnswerKey; title: string; question: string }[]>;
  answerScale: { value: number; label: string }[];
};


function inputFrom(response: ResumeResponse): ResumeInput {
  const { summary, softSkills, experience, projects, education, portfolio, questionnaire } = response;
  return { summary, softSkills, experience, projects, education, portfolio, questionnaire };
}
async function loadResume(resumeId: number, init?: RequestInit): Promise<ResumeResponse> {
  const response = await fetch(`/api/me/resumes/${resumeId}`, { credentials: 'same-origin', ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  const data = await response.json();
  if (!response.ok) throw new Error([data.error, data.details?.[0]?.message].filter(Boolean).join(' ') || 'Не удалось загрузить резюме.');
  return data;
}
function Field(props: ComponentProps<typeof FormField>) {
  return <FormField {...props} className={`resume-field ${props.className ?? ''}`} />;
}
function ResumeGroup({ title, icon, count, children }: { title: string; icon: ReactNode; count: number; children: ReactNode }) {
  return <details className="resume-group"><summary>{icon}<span>{title}</span><span className="resume-count">{count || 'Добавить'}</span><ChevronDown size={16} className="resume-chevron" /></summary><div className="resume-group-content">{children}</div></details>;
}

export function CandidateResumeSection({ resumeId, specialization }: { resumeId: number; specialization: string }) {
  const queryKey = ['candidate-resume', resumeId, specialization];
  const query = useQuery({ queryKey, queryFn: () => loadResume(resumeId) });
  const qc = useQueryClient();
  const [draft, setDraft] = useState<ResumeInput | null>(null);
  const [draftRevision, setDraftRevision] = useState<number | null>(null);
  const serverContent = useRef<string | null>(null);
  const [pdfPending, setPdfPending] = useState(false);
  const [pdfError, setPdfError] = useState('');
  const save = useMutation({ mutationFn: (input: ResumeInput) => loadResume(resumeId, { method: 'PUT', body: JSON.stringify({ ...input, revision: draftRevision }) }), onSuccess: (result) => { serverContent.current = JSON.stringify(inputFrom(result)); qc.setQueryData(queryKey, result); setDraft(inputFrom(result)); setDraftRevision(result.revision); qc.invalidateQueries({ queryKey: ['selected-candidate-profile'] }); qc.invalidateQueries({ queryKey: ['candidate-resumes'] }); qc.invalidateQueries({ queryKey: ['candidate-evidence-registry'] }); } });
  useEffect(() => {
    if (!query.data) return;
    const content = inputFrom(query.data);
    const fingerprint = JSON.stringify(content);
    if (!draft) { serverContent.current = fingerprint; setDraft(content); setDraftRevision(query.data.revision); }
    // A profile-only save shares the row revision, but cannot conflict with this
    // editor. An external content change must retain the old revision and fail
    // safely instead of silently replacing or rebasing the user's draft.
    else if (fingerprint === serverContent.current) setDraftRevision(query.data.revision);
  }, [query.data, draft]);
  if (query.isLoading || (!draft && !query.isError)) return <section className="panel resume-panel" role="status">Загружаем резюме…</section>;
  if (query.isError || !draft || !query.data) return <section className="panel resume-panel" role="alert"><p>Не удалось загрузить резюме.</p><button className="button secondary" onClick={() => query.refetch()}>Повторить</button></section>;
  const payload = draft;
  const dirty = JSON.stringify(payload) !== JSON.stringify(inputFrom(query.data));
  const questionnaireDirty = JSON.stringify(draft.questionnaire) !== JSON.stringify(query.data.questionnaire);
  const completed = Object.values(draft.questionnaire.answers).filter(value => value !== null).length;
  const questions = query.data.questionSets?.[draft.questionnaire.specialization] ?? query.data.questions;
  const set = <K extends keyof ResumeInput>(key: K, value: ResumeInput[K]) => { setDraft(old => old ? { ...old, [key]: value } : old); save.reset(); };
  const editRow = <K extends 'experience' | 'projects' | 'education' | 'portfolio'>(key: K, index: number, value: Partial<ResumeInput[K][number]>) => set(key, draft[key].map((row, rowIndex) => rowIndex === index ? { ...row, ...value } : row) as ResumeInput[K]);
  const removeRow = <K extends 'experience' | 'projects' | 'education' | 'portfolio'>(key: K, index: number) => set(key, draft[key].filter((_, rowIndex) => rowIndex !== index) as ResumeInput[K]);
  const submit = (event: FormEvent) => { event.preventDefault(); setPdfError(''); save.mutate(payload); };
  const download = async () => {
    setPdfPending(true); setPdfError('');
    try {
      const response = await fetch(`/api/me/resumes/${resumeId}/pdf`, { credentials: 'same-origin' });
      if (!response.ok) throw new Error('Не удалось скачать PDF. Повторите попытку.');
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'Signal-Resume.pdf'; document.body.appendChild(anchor); anchor.click(); anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (error) { setPdfError(error instanceof Error ? error.message : 'Не удалось скачать PDF.'); }
    finally { setPdfPending(false); }
  };
  return <form className="resume-layout" onSubmit={submit} onInvalidCapture={event => { const details = (event.target as HTMLElement).closest('details'); if (details) details.open = true; }} data-testid="form-resume">
    <fieldset className="resume-fieldset" disabled={save.isPending}>
      <section className="panel resume-panel" aria-labelledby="resume-heading">
        <div className="panel-heading"><div><span className="eyebrow">ОПЫТ И РЕЗУЛЬТАТЫ</span><h2 id="resume-heading">Моё резюме</h2></div><FileText size={21} /></div>
        <p className="resume-intro">Расскажите, что вы делали и каких результатов достигли. Резюме можно сохранить в PDF.</p>
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
          {draft.education.map((item, index) => <div className="resume-entry" key={index}><div className="resume-entry-heading"><b>Образование {index + 1}</b><button type="button" className="icon-button" aria-label={`Удалить образование ${index + 1}`} onClick={() => removeRow('education', index)}><Trash2 size={16} /></button></div><div className="resume-grid"><Field label="Учебное заведение или платформа"><input className="input" required maxLength={200} value={item.institution} onChange={event => editRow('education', index, { institution: event.target.value })} /></Field><Field label="Направление или курс"><input className="input" required maxLength={200} value={item.qualification} onChange={event => editRow('education', index, { qualification: event.target.value })} /></Field><Field label="Начало"><input className="input" type="month" required min="1900-01" max="2199-12" value={item.start} onChange={event => editRow('education', index, { start: event.target.value })} /></Field><Field label="Окончание"><input className="input" type="month" min={item.start || '1900-01'} max="2199-12" value={item.end || ''} onChange={event => editRow('education', index, { end: event.target.value || null })} /><small>Оставьте пустым, если ещё учитесь</small></Field></div></div>)}
          <button type="button" className="button secondary" disabled={draft.education.length >= 5} onClick={() => set('education', [...draft.education, { institution: '', qualification: '', start: '', end: null }])} data-testid="button-add-education"><Plus size={16} /> Добавить образование</button>
        </ResumeGroup>
        <ResumeGroup title="Портфолио и ссылки" count={draft.portfolio.length} icon={<Link2 size={19} />}>
          {draft.portfolio.map((item, index) => <div className="resume-entry" key={index}><div className="resume-entry-heading"><b>Ссылка {index + 1}</b><button type="button" className="icon-button" aria-label={`Удалить ссылку ${index + 1}`} onClick={() => removeRow('portfolio', index)}><Trash2 size={16} /></button></div><div className="resume-grid"><Field label="Название"><input className="input" required maxLength={100} value={item.title} onChange={event => editRow('portfolio', index, { title: event.target.value })} placeholder="GitHub или личный сайт" /></Field><Field label="Адрес"><input className="input" type="url" required maxLength={600} value={item.url} onChange={event => editRow('portfolio', index, { url: event.target.value })} placeholder="https://…" /></Field></div></div>)}
          <button type="button" className="button secondary" disabled={draft.portfolio.length >= 8} onClick={() => set('portfolio', [...draft.portfolio, { title: '', url: '' }])} data-testid="button-add-portfolio"><Plus size={16} /> Добавить ссылку</button>
        </ResumeGroup>
      </section>
      <section className="panel resume-panel" id="professional-questionnaire" aria-labelledby="questionnaire-heading">
        <div className="panel-heading"><div><span className="eyebrow">ПЕРЕД ПЕРВОЙ ПРОВЕРКОЙ</span><h2 id="questionnaire-heading">Профессиональный опрос</h2></div><ClipboardList size={21} /></div>
        <p className="resume-intro">Шесть вопросов помогут выбрать сложность заданий. Отвечайте по своему практическому опыту — итоговый уровень проверки вы выбираете сами.</p>
        <div className="resume-grid"><Field label="Предметная область" hint="Сфера продуктов и задач: например, финтех или образование. Можно указать свою."><DictionaryCombobox required maxLength={120} value={draft.questionnaire.industry} onChange={value => set('questionnaire', { ...draft.questionnaire, industry: value })} options={DOMAIN_OPTIONS} placeholder="Выберите или напишите область" data-testid="input-questionnaire-industry" /></Field><Field label="IT-направление" hint="Поддерживаемая программа выбранного резюме. Предметная область не меняет направление экзамена."><input className="input" readOnly value={draft.questionnaire.specialization}/></Field></div>
        <div className="resume-progress"><span>Ответов: {completed} из {query.data.questions.length}</span><progress value={completed} max={query.data.questions.length} aria-label="Прогресс профессионального опроса" /></div>
        <div className="resume-question-list">{questions.map((question, index) => <Field label={`${index + 1}. ${question.question}`} key={question.key}><select className="input" value={draft.questionnaire.answers[question.key] ?? ''} onChange={event => set('questionnaire', { ...draft.questionnaire, answers: { ...draft.questionnaire.answers, [question.key]: event.target.value === '' ? null : Number(event.target.value) } })} data-testid={`select-questionnaire-${question.key}`}><option value="">Выберите ответ</option>{query.data!.answerScale.map(answer => <option key={answer.value} value={answer.value}>{answer.label}</option>)}</select></Field>)}</div>
        <div className="resume-recommendation" role="status"><ShieldCheck size={22} /><div><b>{questionnaireDirty ? completed === 6 ? 'Ответы готовы — сохраните опрос' : 'Можно продолжить позже' : query.data.recommendation.grade ? `Рекомендуем начать с ${query.data.recommendation.grade}` : 'Подберём начальный уровень'}</b><p>{questionnaireDirty ? 'Ваши ответы сохраняются вместе с резюме. Самооценка не подтверждает навыки.' : query.data.recommendation.explanation}</p>{!questionnaireDirty && query.data.recommendation.grade && <Link className="panel-link" href={`/candidate/kalibr?grade=${query.data.recommendation.grade}&resumeId=${resumeId}`} data-testid="link-questionnaire-assessment">Перейти к выбору проверки <ArrowRight size={15} /></Link>}</div></div>
        {query.data.questionnaireHistory.length > 0 && <details className="resume-history"><summary>История опроса · {query.data.questionnaireHistory.length}<ChevronDown size={15} /></summary>{[...query.data.questionnaireHistory].reverse().map((item, index) => <div className="resume-history-item" key={`${item.completedAt}-${index}`}><span>{new Date(item.completedAt).toLocaleString('ru-RU')}</span><b>Рекомендован {item.recommendedGrade}</b><small>{item.questionnaire.industry} · {item.questionnaire.specialization}</small></div>)}</details>}
      </section>
      <div className="resume-footer"><div className="resume-save"><span role="status">{save.isError ? save.error.message : save.isSuccess && !dirty ? 'Резюме и ответы сохранены' : dirty ? 'Есть несохранённые изменения' : query.data.updatedAt ? 'Изменения сохранены' : 'Заполните разделы в удобном порядке'}</span><button className="button primary" type="submit" data-testid="button-save-resume">{save.isPending ? 'Сохраняем…' : 'Сохранить резюме и опрос'} <Check size={16} /></button></div><div className="resume-download"><div><b>Резюме в PDF</b><p>В файл войдут сохранённые имя, опыт, ссылки и навыки. Контактные поля аккаунта не добавляются.{dirty ? ' Сначала сохраните изменения.' : ''}</p>{pdfError && <p role="alert">{pdfError}</p>}</div><button type="button" className="button secondary" disabled={dirty || pdfPending} onClick={download} data-testid="button-download-resume"><Download size={16} /> {pdfPending ? 'Готовим PDF…' : 'Скачать PDF'}</button></div></div>
    </fieldset>
  </form>;
}
