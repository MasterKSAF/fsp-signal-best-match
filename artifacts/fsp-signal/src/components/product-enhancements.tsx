import { EvidenceProofDetails, FspSignalDetails, type SportingSignal, type EvidenceProof } from './matching-support';
import { createPortal } from 'react-dom';
import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from 'react';
import { initializeMotionPreferences } from '@/lib/motion-preference';
import { FormField } from './form-field';
import { InlineInfo } from './inline-info';
import { employerSkillChips, SkillChips, SkillLegend } from './skill-chip';
import { DictionaryCombobox } from './dictionary-input';
import { DOMAIN_OPTIONS } from '@/lib/professional-dictionaries';
import { companyInnError } from '../../../../lib/api-zod/src/company-inn';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, Building2, Check, CircleHelp, FileBadge, FlaskConical, Gauge, Handshake, Printer, ShieldCheck, Sparkles, X } from 'lucide-react';
import { Link } from 'wouter';
import { useGetMatchExplanation } from '@workspace/api-client-react';
import type { CandidateProfile, MatchCandidate, MatchExplanation } from '@workspace/api-client-react';

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin', ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Не удалось выполнить запрос. Повторите попытку.');
  return data as T;
}

/** Render a deliberately small, safe Markdown subset. Prompt text never becomes HTML. */
export function CasePrompt({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const inline = (value: string) => value.split(/(`[^`\n]+`)/g).map((part, index) => part.startsWith('`') && part.endsWith('`') ? <code key={index}>{part.slice(1, -1)}</code> : part);
  const pattern = /```([a-zA-Z0-9_-]*)\r?\n([\s\S]*?)```/g;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    if ((match.index ?? 0) > cursor) blocks.push(<p className="case-prompt" key={`text-${cursor}`}>{inline(text.slice(cursor, match.index).trim())}</p>);
    blocks.push(<div className="case-code" key={`code-${match.index}`}><span>{match[1] || 'Код'}</span><pre tabIndex={0} aria-label={`Фрагмент кода ${match[1] || ''}`}><code>{match[2].replace(/\n$/, '')}</code></pre></div>);
    cursor = (match.index ?? 0) + match[0].length;
  }
  if (cursor < text.length) blocks.push(<p className="case-prompt" key={`text-${cursor}`}>{inline(text.slice(cursor).trim())}</p>);
  return <div className="case-prompt-content">{blocks}</div>;
}

export function useMotionPreference() {
  const store = initializeMotionPreferences();
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return { ...state, choose: store.choose, setSpeed: store.setSpeed };
}

/** A server result is the only source of these events. Storage suppresses replay on refresh. */
export function celebrate(eventId: string, title: string, detail: string, kind: 'grade' | 'contact') {
  const key = `fsp-event-seen:${eventId}`;
  try { if (localStorage.getItem(key)) return; localStorage.setItem(key, '1'); } catch { /* an ephemeral browser session can still show feedback */ }
  window.dispatchEvent(new CustomEvent('fsp-celebrate', { detail: { eventId, title, detail, kind } }));
}

export function dismissCelebration(eventId: string) {
  window.dispatchEvent(new CustomEvent('fsp-celebration-dismiss', { detail: { eventId } }));
}

export function CelebrationHost() {
  const [event, setEvent] = useState<{ eventId: string; title: string; detail: string; kind: string } | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const listener = (e: Event) => { setEvent((e as CustomEvent).detail); clearTimeout(timer); timer = setTimeout(() => setEvent(null), 6500); };
    const dismiss = (e: Event) => { const id = (e as CustomEvent).detail?.eventId; setEvent(current => current?.eventId === id ? null : current); };
    window.addEventListener('fsp-celebrate', listener);
    window.addEventListener('fsp-celebration-dismiss', dismiss);
    return () => { window.removeEventListener('fsp-celebrate', listener); window.removeEventListener('fsp-celebration-dismiss', dismiss); clearTimeout(timer); };
  }, []);
  if (!event) return null;
  return <div className="milestone-toast" role="status" aria-live="polite"><div className="milestone-icon">{event.kind === 'grade' ? <BadgeCheck size={28} /> : <Handshake size={28} />}</div><div><span className="eyebrow">{event.kind === 'grade' ? 'НОВОЕ ПОДТВЕРЖДЕНИЕ' : 'НОВЫЙ ДИАЛОГ'}</span><b>{event.title}</b><p>{event.detail}</p></div><button className="icon-button" aria-label="Закрыть уведомление" onClick={() => setEvent(null)}><X size={17} /></button><span className="milestone-shimmer" aria-hidden="true" /></div>;
}

export function Dialog({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLElement>(null);
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const prior = document.activeElement as HTMLElement | null;
    const priorOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close.current(); }
      if (event.key !== 'Tab') return;
      const controls = Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]') || []).filter(el => el.getClientRects().length);
      if (!controls.length) { event.preventDefault(); return; }
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === ref.current)) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = priorOverflow; document.removeEventListener('keydown', onKey); prior?.focus(); };
  }, []);
  return createPortal(<div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><section ref={ref} tabIndex={-1} className={`modal panel ${wide ? 'wide-modal' : ''}`} role="dialog" aria-modal="true" aria-label={title}><button className="modal-close icon-button" aria-label="Закрыть" onClick={onClose}><X size={18} /></button>{children}</section></div>, document.body);
}

const date = (value?: string | null) => value ? new Date(value).toLocaleDateString('ru-RU') : 'Нет данных';

export function useClock() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  return now;
}

type HistoricalAttempt = { resumeId?: number | null; resumeSpecialization?: string | null; dueAt?: string; id: number; programId: string; grade: string; status: string; score: number | null; verified: boolean; correctionReason?: string | null; startedAt: string; submittedAt: string | null; bankVersion: string };
export function AssessmentHistory() {
  const now = useClock();
  const query = useQuery({ queryKey: ['assessment-history'], queryFn: () => api<{ attempts: HistoricalAttempt[] }>('/api/assessments/history'), retry: false });
  return <section className="panel assessment-history"><div className="panel-heading"><div><h2>История проверок</h2></div><FileBadge size={22} /></div>{query.isLoading ? <p role="status">Загружаем результаты…</p> : query.isError ? <div role="alert"><p>Не удалось загрузить историю проверок.</p><button className="button secondary" onClick={() => query.refetch()}>Повторить</button></div> : !query.data?.attempts.length ? <p className="muted">Вы ещё не проходили проверку. Здесь будут результаты и разборы ваших ответов.</p> : <div className="history-list">{query.data.attempts.map(attempt => {
    const corrected = Boolean(attempt.correctionReason);
    const expired = attempt.status === 'in_progress' && now >= (attempt.dueAt ? Date.parse(attempt.dueAt) : Date.parse(attempt.startedAt) + 45 * 60_000);
    return <article key={attempt.id}><div><span className="history-grade">{attempt.grade}</span><small>{attempt.resumeSpecialization || attempt.programId}{attempt.resumeId ? ` · резюме №${attempt.resumeId}` : ' · исторический контекст'}</small><span>{date(attempt.submittedAt || attempt.startedAt)}</span>{corrected && <small>{attempt.correctionReason}</small>}</div><span className={`badge badge-${!corrected && attempt.verified ? 'verified' : 'neutral'}`}>{corrected ? 'Аннулировано' : expired ? 'Время истекло' : attempt.status === 'in_progress' ? 'В процессе' : attempt.verified ? 'Уровень подтверждён' : attempt.status === 'submitted' ? 'Уровень не подтверждён' : 'Завершено'}</span><strong className="mono" title={corrected ? 'Исходная оценка сохранена в истории и не подтверждает уровень' : undefined}>{attempt.score == null ? '—' : `${attempt.score}/100`}</strong><Link className="button text-button" href={corrected || expired ? '/candidate/kalibr' : `/candidate/kalibr?attempt=${attempt.id}${attempt.resumeId ? `&resumeId=${attempt.resumeId}` : ''}`}>{corrected ? 'Новая проверка' : expired ? 'К проверкам' : attempt.status === 'in_progress' ? 'Продолжить' : 'Посмотреть разбор'}</Link></article>;
  })}</div>}<p className="muted history-note">Новая попытка сохраняет ранее подтверждённый уровень. Уровень в Signal — оценка профессиональных навыков, а не спортивный разряд.</p></section>;
}

export function PassportEvidence({ profile }: { profile: CandidateProfile & { resumeId: number } }) {
  const proofs = useQuery({ queryKey: ['own-skill-evidence', profile.resumeId, profile.latestAssessmentAt, profile.verifiedSkills], queryFn: ({signal}) => api<{ evidence: EvidenceProof[] }>(`/api/me/evidence?resumeId=${profile.resumeId}`,{signal,cache:'no-store'}), staleTime:0,gcTime:0,retry:false,refetchOnWindowFocus:'always' });
  const chips = employerSkillChips([...profile.stack, ...profile.skills], !proofs.isError ? proofs.data?.evidence ?? [] : []);
  return <section className="panel evidence-panel passport-evidence" data-accent="skills" data-testid="passport-evidence"><div className="panel-heading"><div><h2>Подтверждённые навыки</h2></div><span className="themed-icon"><Gauge size={20} aria-hidden="true" /></span></div>
    <div className="passport-proof-summary"><div><span>Подтверждённый уровень</span><strong>{profile.verifiedGrade || 'Нет подтверждения'}</strong></div><div><span>Дата подтверждения</span><strong>{date(profile.latestAssessmentAt)}</strong></div><div><span>Заявленный уровень</span><strong>{profile.assumedGrade}</strong></div></div>
    <p>Здесь отображаются результаты квалификационного экзамена Signal. Опыт и остальные навыки указаны вами и не относятся к результатам проверки.</p>
    {chips.length ? <div className="verified-skills"><SkillLegend/><SkillChips items={chips}/></div> : <div className="honest-note"><CircleHelp size={17} /><p>Подтвердите навыки квалификационным экзаменом Signal. Результат появится здесь и будет доступен работодателям, если вы откроете профиль для подбора.</p></div>}
    {proofs.isPending ? <p role="status">Загружаем основания подтверждений…</p> : proofs.isError ? <p role="alert">Не удалось загрузить основания. <button className="button text-button" onClick={() => proofs.refetch()}>Повторить</button></p> : proofs.data?.evidence.map((proof, index) => <details className="requirement-evidence" key={`${proof.skill}-${index}`}><summary><span><BadgeCheck size={15}/>{proof.skill}</span><span>Основание</span></summary><EvidenceProofDetails proof={proof}/></details>)}
    <div className="passport-actions"><Link className="button primary" href={`/candidate/kalibr?resumeId=${profile.resumeId}`}>Проверить навыки</Link><button className="button secondary" onClick={() => window.print()} data-testid="button-print-passport"><Printer size={16} />Печать / сохранить PDF</button></div>
    <div className="print-passport"><h1>Signal · Паспорт навыков</h1><h2>{profile.displayName}</h2><p>{profile.specialization} · {profile.yearsExperience} лет опыта</p><p>Имя в подборе: {profile.professionalAlias}</p><p>Подтверждённый уровень: {profile.verifiedGrade || 'Нет'} · указанный кандидатом: {profile.assumedGrade}</p><h3>Подтверждённые навыки</h3><p>{chips.filter(item=>item.status==='verified').map(item=>`${item.label} · ${item.level}`).join(', ') || 'Не подтверждены'} · {date(profile.latestAssessmentAt)}</p><h3>Технологии, указанные кандидатом</h3><p>{profile.stack.join(', ') || 'Не указаны'}</p><h3>Предпочтения</h3><p>{profile.workFormat} · {profile.salaryMin ?? '—'}–{profile.salaryMax ?? '—'} ₽ / {profile.salaryPeriod === 'month' ? 'месяц' : 'год'} · {profile.salaryType === 'gross' ? 'до вычета' : 'на руки'}</p><p>Сформировано {new Date().toLocaleDateString('ru-RU')}. Уровень в Signal — оценка профессиональных навыков, а не спортивный разряд.</p><p>Контакты в печатный паспорт не включаются.</p></div>
  </section>;
}

export function EvidenceMap({ explanation }: { explanation: MatchExplanation & {fspSignal?:SportingSignal} }) {
  const factorLabels: Record<string, string> = { 'Подтверждённое покрытие навыков': 'Совпадение подтверждённых навыков', 'Результат релевантной оценки': 'Результат проверки навыков', 'Контекст работы': 'Формат работы', 'Свежесть свидетельств': 'Давность проверки' };
  return <div className="evidence-map"><h3>Соответствие требованиям</h3><p className="muted">Нажмите на навык, чтобы посмотреть подтверждение и дату проверки.</p>{explanation.evidence.map((e, i) => <details key={`${e.requirement}-${i}`} className="requirement-evidence"><summary><span><BadgeCheck size={16} />{e.requirement}</span><span className={`badge badge-${e.status === 'verified' ? 'verified' : e.status === 'not_fit' ? 'warning' : 'neutral'}`}>{e.status === 'verified' ? 'Подтверждено' : e.status === 'stated' ? 'Указано кандидатом' : e.status === 'not_fit' ? 'Не соответствует' : 'Нет данных'}</span></summary><div className="requirement-body"><p>{e.evidence.replace('Подтверждено КАЛИБР:', 'Подтверждено проверкой навыков:')}</p>{(e as typeof e & { provenance?: EvidenceProof }).provenance ? <EvidenceProofDetails proof={(e as typeof e & { provenance: EvidenceProof }).provenance}/> : <dl><dt>Источник</dt><dd>{e.source}</dd><dt>Дата</dt><dd>{e.date ? date(e.date) : 'Не указана'}</dd></dl>}</div></details>)}
    {explanation.ranking && <section className="honest-note" style={{display:'block'}} aria-label="Порядок подбора"><strong>{explanation.ranking.qualityStatus === 'measured' ? `Результат своей проверки: ${explanation.ranking.qualityScore} / 100` : 'Подробный результат проверки не сохранён'}</strong><p>Соответствие потребности: {explanation.ranking.businessFitScore.toFixed(2)} / 100.{explanation.ranking.position != null && <> Позиция в подборе: {explanation.ranking.position} из {explanation.ranking.poolSize}.</>}</p><details><summary>Почему такое место</summary><p>{explanation.ranking.note}</p></details></section>}
    <details className="score-breakdown"><summary>Как рассчитаны {explanation.score} баллов</summary><div className="factor-list">{explanation.factors.map(f => <div className="factor" key={f.name}><div><span>{factorLabels[f.name] || f.name}</span><b className="mono">{f.score === null ? 'Не установлено' : f.scope === 'within_comparable_group' ? `${(f.score * 100).toFixed(2)} / 100` : `${(f.score * (f.effectiveWeight ?? f.weight) * 100).toFixed(1)} / ${((f.effectiveWeight ?? f.weight) * 100).toFixed(2)}`}</b></div><>{f.score !== null && <progress max={1} value={f.score} aria-label={factorLabels[f.name] || f.name} />}</><small>{f.scope === 'within_comparable_group' ? 'Влияет на порядок сопоставимых результатов при одинаковом соответствии; не входит в общий балл' : f.score === null ? 'Не включено в расчёт; доступные факторы пересчитаны' : `Вклад в общий балл · максимум ${((f.effectiveWeight ?? f.weight) * 100).toFixed(2)}`}</small></div>)}</div><p>Соответствие требованиям: <b>{explanation.score}/100</b>. ФСП не входит в этот балл.</p><small>Грейд потребности — минимальный. Сырые баллы тестов разных грейдов не считаются равными по квалификации. Свежесть учитывается по интервалам 30, 90 и 180 дней. Балл соответствия помогает сравнить профили по требованиям и не прогнозирует найм.</small></details>
    <FspSignalDetails signal={explanation.fspSignal}/>
  </div>;
}

type ComparedResumeCandidate = MatchCandidate & {resumeId?:number;resumeRevision?:number;title?:string;fspSignal?:SportingSignal;eligible?:boolean};
type PairComparisonResponse={summary:string;differences:{kind:string;text:string}[];limitations:string[];comparable:boolean;sameCategory:boolean;orderContext:{leftPosition:number|null;rightPosition:number|null;poolSize:number;note:string};left:ComparedResumeCandidate & {evaluation:{eligible:boolean;baseScore:number;fspBonus:number;fspSignal:SportingSignal;gaps:string[]}};right:ComparedResumeCandidate & {evaluation:{eligible:boolean;baseScore:number;fspBonus:number;fspSignal:SportingSignal;gaps:string[]}}};
function ComparedCandidate({candidate,needId}:{candidate:ComparedResumeCandidate;needId:number}) {
  const explanation=useQuery({queryKey:['resume-explanation',needId,candidate.candidateId,candidate.resumeId],enabled:!!candidate.resumeId&&candidate.eligible!==false,queryFn:()=>api<MatchExplanation>(`/api/matches/explanation?needId=${needId}&candidateId=${candidate.candidateId}&resumeId=${candidate.resumeId}`)});
  return <article className="comparison-candidate"><div className="comparison-heading"><div className="candidate-avatar big">{candidate.alias[0]}</div><div><h3>{candidate.alias}</h3><span>{candidate.verifiedGrade || 'Грейд не подтверждён'} · {candidate.specialization}</span><small> · {candidate.title}</small></div></div><div className="comparison-score"><strong className="mono">{candidate.eligible===false?'—':candidate.score}{candidate.eligible!==false&&<small>/100</small>}</strong><span>{candidate.eligible===false?'Не допущен к подбору':'Соответствие требованиям'}</span></div><FspSignalDetails signal={candidate.fspSignal}/><div className="chip-row">{candidate.stack.map(skill=><span className="skill-chip" key={skill}>{skill}</span>)}</div><p className="muted">Последняя проверка: {date(candidate.evidenceDate)}</p><h4>Уточнить на собеседовании</h4><p>{candidate.gaps.join(' · ') || 'По указанным требованиям вопросов не выявлено.'}</p>{candidate.eligible===false?<p className="honest-note">Для обычного подбора нужны подходящий подтверждённый грейд и все обязательные навыки.</p>:explanation.isLoading ? <p role="status">Загружаем результаты проверки…</p> : explanation.isError ? <p role="alert">Выбранное резюме недоступно для подбора. <button className="button secondary" onClick={()=>explanation.refetch()}>Повторить загрузку</button></p> : explanation.data && <EvidenceMap explanation={explanation.data}/>}</article>;
}

export function CandidateComparison({candidates,needId,onClose}:{candidates:ComparedResumeCandidate[];needId:number;onClose:()=>void}) {
  const left=candidates[0],right=candidates[1];
  const comparison=useQuery({queryKey:['resume-comparison',needId,left?.resumeId,right?.resumeId],enabled:!!left?.resumeId && !!right?.resumeId,queryFn:()=>api<PairComparisonResponse>(`/api/employer/compare?needId=${needId}&leftResumeId=${left!.resumeId}&rightResumeId=${right!.resumeId}`)});
  const current=comparison.data ? [comparison.data.left,comparison.data.right].map((row,index)=>({...candidates[index]!,...row,score:row.evaluation.baseScore,fspBonus:row.evaluation.fspBonus,fspSignal:row.evaluation.fspSignal,eligible:row.evaluation.eligible,gaps:row.evaluation.gaps})) : candidates;
  return <Dialog title="Сравнение резюме" onClose={onClose} wide><h2>Сравнение резюме</h2><p>Соответствие одной потребности по выбранным резюме и действующим подтверждениям.</p>
    {comparison.isPending ? <p role="status">Проверяем основания и полный контекст выдачи…</p> : comparison.isError ? <div className="honest-note" role="alert"><p>Сравнение недоступно: резюме могло быть скрыто или изменено.</p><button className="button secondary" onClick={()=>comparison.refetch()}>Повторить</button></div> : comparison.data && <section className="honest-note comparison-conclusion" style={{display:'block'}} aria-label="Краткое сравнение"><strong>Различия соответствия</strong><p>{comparison.data.summary}</p>{comparison.data.limitations.map((item,index)=><p className="muted" key={index}>{item}</p>)}<details><summary>Почему такой порядок в выдаче</summary><p>{comparison.data.orderContext.note}</p><p>Первое резюме: {comparison.data.orderContext.leftPosition ?? 'нет места'}, второе: {comparison.data.orderContext.rightPosition ?? 'нет места'}; людей в пуле: {comparison.data.orderContext.poolSize}.</p></details></section>}
    {!comparison.isError && <div className="comparison-grid">{current.map(candidate=><ComparedCandidate key={`${candidate.candidateId}-${candidate.resumeId}`} candidate={candidate} needId={needId}/>)}</div>}
  </Dialog>;
}

type Company = { id: number; name: string; description: string; industry: string; inn: string; contactEmail: string; contactPhone: string | null; contactMethod: 'Электронная почта' | 'Телефон' | 'Мессенджер' };

export function CompanyPage() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['employer-company'], queryFn: async () => (await api<{ company: Company }>('/api/employer/company')).company });
  const [notice, setNotice] = useState('');
  const [industry, setIndustry] = useState<string | null>(null);
  const [inn,setInn]=useState<string|null>(null);
  const [innError,setInnError]=useState<string|null>(null);
  const save = useMutation({ mutationFn: (data: Omit<Company, 'id'>) => api<{ company: Company }>('/api/employer/company', { method: 'PUT', body: JSON.stringify(data) }), onSuccess: data => { qc.setQueryData(['employer-company'], data.company);setInn(data.company.inn);setInnError(null);setNotice('Профиль компании сохранён.'); } });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setNotice('');
    const data = new FormData(event.currentTarget); const get = (key: string) => String(data.get(key) || '').trim();
    const taxId=get('inn'),error=companyInnError(taxId);setInnError(error);
    if(error){event.currentTarget.querySelector<HTMLInputElement>('[name="inn"]')?.focus();return;}
    save.mutate({ name: get('name'), description: get('description'), industry: get('industry'), inn:taxId, contactMethod: get('contactMethod') as Company['contactMethod'], contactEmail: get('contactEmail'), contactPhone: get('contactPhone') || null });
  };
  return <><div className="page-title" data-accent="employer"><div><h1>Компания<InlineInfo label="Профиль компании: видимость">Сведения о компании и контакты представителя видны кандидатам в ваших приглашениях.</InlineInfo></h1></div><span className="themed-icon"><Building2 size={20} aria-hidden="true" /></span></div>{query.isLoading ? <div className="state-panel" role="status">Загружаем профиль…</div> : query.isError ? <div className="state-panel" role="alert"><p>Не удалось загрузить компанию.</p><button className="button secondary" onClick={() => query.refetch()}>Повторить</button></div> : query.data && <form className="panel form-panel company-form" onSubmit={submit}><h2>О компании</h2><div className="form-grid"><FormField className="field" label="Название" layout="vertical"><input className="input" name="name" required minLength={2} maxLength={160} defaultValue={query.data.name} /></FormField><FormField className="field" label="Предметная область" layout="vertical"><DictionaryCombobox name="industry" required maxLength={120} options={DOMAIN_OPTIONS} value={industry ?? query.data.industry} onChange={setIndustry} /></FormField><FormField className="field" label="ИНН · необязательно" layout="vertical" error={innError??undefined} hint="10 цифр для организации или 12 для ИП. Проверяются формат и контрольные цифры."><input className="input" type="text" name="inn" inputMode="numeric" maxLength={12} autoComplete="off" value={inn??query.data.inn??''} onChange={event=>{const value=event.currentTarget.value;setInn(value);if(innError)setInnError(companyInnError(value));}} onBlur={event=>setInnError(companyInnError(event.currentTarget.value))} /></FormField></div><FormField className="field" label="Чем занимается компания"><textarea className="input textarea" name="description" required minLength={10} maxLength={3000} rows={4} defaultValue={query.data.description} /></FormField><h2>Представитель компании<InlineInfo label="Контакты компании">Кандидат видит эти рабочие контакты в приглашении. Его контакты откроются только после адресного согласия.</InlineInfo></h2><div className="form-grid"><FormField className="field" label="Предпочтительный способ связи"><select className="input" name="contactMethod" defaultValue={query.data.contactMethod}><option>Электронная почта</option><option>Телефон</option><option>Мессенджер</option></select></FormField><FormField className="field" label="Рабочая почта"><input className="input" type="email" name="contactEmail" required defaultValue={query.data.contactEmail} /></FormField><FormField className="field" label="Телефон · необязательно"><input className="input" type="tel" name="contactPhone" defaultValue={query.data.contactPhone || ''} /></FormField></div>{save.isError && <p className="form-error" role="alert">{save.error.message}</p>}{notice && <p className="success-note" role="status"><Check size={16} />{notice}</p>}<div className="form-actions"><Link href="/employer/jobs" className="button secondary">Мои вакансии</Link><button type="submit" className="button primary" disabled={save.isPending}>{save.isPending ? 'Сохраняем…' : 'Сохранить изменения'}<Check size={16} /></button></div></form>}</>;
}

export { QualityPage } from "./public-quality-page";
