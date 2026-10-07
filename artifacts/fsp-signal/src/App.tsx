import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryClient } from '@/lib/query-client';
import {
  useRegister, useVerifyEmail, useLogin, useStartDemoSession,
  useLogout, useGetCurrentUser,
  useListMyInvitations, useDecideInvitation, useRevokeInvitationContact, useListAssessmentPrograms,
  useStartAssessmentAttempt, useGetAssessmentAttempt, useSaveAssessmentAnswers,
  useSubmitAssessmentAttempt, useListEmployerNeeds, useCreateEmployerNeed,
  useGetMatches, useGetMatchExplanation, useListEmployerInvitations, useCreateInvitation,
  useGetInvitationContacts, useWithdrawInvitation,
  getGetCurrentUserQueryKey, getGetCandidateProfileQueryKey, getListMyInvitationsQueryKey,
  getListEmployerNeedsQueryKey, getListEmployerInvitationsQueryKey,
  getGetAssessmentAttemptQueryKey, getGetMatchesQueryKey,
} from '@workspace/api-client-react';
import type {
  AuthSession, AssessmentResult, CandidateProfileInput, EmployerNeedInput, Invitation, MatchCandidate,
  InvitationInput, RegistrationInput,
} from '@workspace/api-client-react';
import {
  ArrowDownRight, ArrowLeft, ArrowRight, BadgeCheck, Banknote, BriefcaseBusiness, Check,
  ChevronDown, CircleHelp, Clock3, Eye, FileBadge, FileCheck2, Fingerprint, Gauge,
  Handshake, LockKeyhole, LogOut, Mail, Menu, Moon, Monitor, Search, Send, ShieldCheck,
  SlidersHorizontal, Sparkles, Sun, Target, UserRound, Users, X,
} from 'lucide-react';
import { CandidateTrustCenter, EmployerTrustCenter, ModerationCenter, CompanyTrustActions } from '@/components/trust-center';
import { ResumeSelectionProvider, ResumeSwitcher, CandidateAvatar, useResumeSelection, useSelectedCandidateProfile, resumeHref, resumeRequest, type SelectedProfile } from '@/components/multi-resume';
import { CandidateResumeSection } from '@/components/candidate-resume';
import { CandidateJobsPage, EmployerJobsPage } from '@/components/public-jobs';
import { CandidateMicrotasksPage, EmployerMicrotasksPage } from '@/components/microtasks';
import { SkillCoverage, MatchSearchState } from '@/components/matching-support';
import { FormField } from '@/components/form-field';
import { DictionaryCombobox, DictionaryTags, useSkillDictionary } from '@/components/dictionary-input';
import { ROLE_OPTIONS, WORK_FORMAT_OPTIONS } from '@/lib/professional-dictionaries';
import { CandidateEvidenceRegistry, type EvidenceRegistryCatalog } from '@/components/candidate-evidence-registry';
import { MicroEvidenceSummary } from '@/components/micro-evidence-summary';
import { ResearchPage } from '@/components/research';
import { CandidateBankPage } from '@/components/candidate-bank';
import { PublicEntry } from '@/components/public-entry';
import { SignalBrand } from '@/components/signal-brand';
import { EnvironmentIndicator } from '@/components/environment-indicator';
import { AppBackButton, AppNavigationProvider } from '@/components/app-navigation';
import { FspConnectionSection } from '@/components/fsp-connection';
import { AssessmentContextSelector, AssessmentContextSummary, EmployerAssessmentContext, type AssessmentContextSelection } from '@/components/assessment-context';
import { CandidateActions } from '@/components/workspace-guide';
import { SignalConsultant } from '@/components/signal-consultant';
import { ErrorBoundary } from '@/components/error-boundary';
import { replaceAuthQueryCache } from '@/lib/auth-query-cache';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { api, CasePrompt, AssessmentHistory, CandidateComparison, CelebrationHost, CompanyPage, Dialog, EvidenceMap, PassportEvidence, QualityPage, celebrate, dismissCelebration, useClock, useMotionPreference } from '@/components/product-enhancements';
import { Link, Route, Switch, Router as WouterRouter, useLocation, useRoute, useSearch } from 'wouter';

type ThemePreference = 'light' | 'dark' | 'system';
type MotionPreference = 'system' | 'reduced' | 'off';

function useThemePreference() {
  const [preference, setPreference] = useState<ThemePreference>(() => {
    try { const value = localStorage.getItem('fsp-theme'); return value === 'light' || value === 'dark' ? value : 'system'; } catch { return 'system'; }
  });
  const [systemDark, setSystemDark] = useState(() => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const listener = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    mq.addEventListener('change', listener);
    return () => mq.removeEventListener('change', listener);
  }, []);
  useEffect(() => {
    const listener = (event: StorageEvent) => { if (event.key === 'fsp-theme' || event.key === null) setPreference(event.newValue === 'light' || event.newValue === 'dark' ? event.newValue : 'system'); };
    window.addEventListener('storage', listener);
    return () => window.removeEventListener('storage', listener);
  }, []);
  const resolved = preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;
  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolved === 'dark');
    document.documentElement.style.colorScheme = resolved;
  }, [resolved]);
  const choose = (value: ThemePreference) => {
    setPreference(value);
    try { localStorage.setItem('fsp-theme', value); } catch { /* session still works */ }
  };
  return { preference, resolved, choose };
}

function Brand({ href = '/', dark = false }: { href?: string; dark?: boolean }) {
  return <SignalBrand href={href} dark={dark} />;
}

function ThemePicker({ theme, onChoose }: { theme: ReturnType<typeof useThemePreference>; onChoose?: () => void }) {
  const choices: { id: ThemePreference; label: string; Icon: typeof Sun }[] = [
    { id: 'light', label: 'Светлая', Icon: Sun }, { id: 'dark', label: 'Тёмная', Icon: Moon }, { id: 'system', label: 'Как в системе', Icon: Monitor },
  ];
  return <div className="theme-picker" role="group" aria-label="Цветовая тема">
    {choices.map(({ id, label, Icon }) => <button key={id} type="button" onClick={() => { theme.choose(id); onChoose?.(); }} className={`theme-choice ${theme.preference === id ? 'selected' : ''}`} aria-pressed={theme.preference === id} data-testid={`theme-${id}`}>
      <Icon size={17} aria-hidden="true" /><span>{label}</span>{theme.preference === id && <Check size={15} aria-hidden="true" />}
    </button>)}
    <small className="theme-current" data-testid="text-current-theme">Сейчас: {theme.resolved === 'dark' ? 'тёмная' : 'светлая'}</small>
  </div>;
}

function ThemeMenu({ theme, testId = 'button-theme-menu' }: { theme: ReturnType<typeof useThemePreference>; testId?: string }) {
  const menuRef = useRef<HTMLDetailsElement>(null);
  const triggerRef = useRef<HTMLElement>(null);
  const close = (restoreFocus = false) => {
    if (!menuRef.current?.open) return;
    menuRef.current.open = false;
    if (restoreFocus) triggerRef.current?.focus();
  };
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target)) close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && menuRef.current?.open) {
        event.preventDefault();
        close(true);
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, []);
  const ThemeIcon = theme.preference === 'system' ? Monitor : theme.preference === 'dark' ? Moon : Sun;
  return <details ref={menuRef} className="theme-menu" onBlur={event => { if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) close(); }}><summary ref={triggerRef} aria-label="Настроить тему" data-testid={testId}><ThemeIcon size={17} aria-hidden="true" /><ChevronDown size={13} aria-hidden="true" /></summary><div className="theme-popover"><ThemePicker theme={theme} onChoose={() => close(true)} /></div></details>;
}

function Shell({ children, theme }: { children: ReactNode; theme: ReturnType<typeof useThemePreference> }) {
  const [location] = useLocation();
  const userQuery = useGetCurrentUser();
  const user = userQuery.data?.user;
  const role = user?.role || (location.startsWith('/employer') ? 'employer' : 'candidate');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [smallScreen, setSmallScreen] = useState(() => window.matchMedia('(max-width: 700px)').matches);
  const sidebarRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 700px)');
    const change = () => { setSmallScreen(mq.matches); if (!mq.matches) setMobileOpen(false); };
    mq.addEventListener('change', change);
    return () => mq.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    if (!smallScreen || !mobileOpen) return;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    sidebarRef.current?.querySelector<HTMLElement>('a')?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setMobileOpen(false); }
      if (event.key !== 'Tab') return;
      const items = Array.from(sidebarRef.current?.querySelectorAll<HTMLElement>('a,button') || []);
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', trap);
    return () => { document.removeEventListener('keydown', trap); document.body.style.overflow = oldOverflow; menuRef.current?.focus(); };
  }, [smallScreen, mobileOpen]);
  const logout = useLogout();
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const candidateNav = [
    ['/candidate', 'Обзор', Gauge], ['/candidate/passport', 'Паспорт навыков', FileBadge],
    ['/candidate/kalibr', 'Проверка навыков', Target], ['/candidate/invitations', 'Приглашения', Mail],
    ['/candidate/jobs', 'Вакансии и отклики', BriefcaseBusiness], ['/candidate/trust', 'Обращения и доступ', ShieldCheck], ['/candidate/microtasks', 'Практика', Sparkles],
  ] as const;
  const employerNav = [
    ['/employer', 'Запросы на подбор', Target], ['/employer/matches', 'Подбор', Search],
    ['/employer/candidates', 'Каталог специалистов', Users], ['/employer/jobs', 'Публикации и отклики', BriefcaseBusiness], ['/employer/microtasks', 'Задания кандидатам', Sparkles],
    ['/employer/invitations', 'Приглашения', Send], ['/employer/trust', 'Обращения и ограничения', ShieldCheck], ['/employer/company', 'Компания', BriefcaseBusiness],
  ] as const;
  const nav = role === 'employer' ? employerNav : candidateNav;
  const trustAccess = useQuery({ queryKey: ['trust', 'access', user?.id], queryFn: () => resumeRequest<{moderator:boolean}>('/me/trust-status'), enabled: !!user });
  const roleName = role === 'employer' ? 'Работодатель' : 'Кандидат';
  return <div className="app-shell"><a className="skip-link" href="#main-content">Перейти к содержимому</a>
    <header className="topbar">
      <button ref={menuRef} className="icon-button mobile-menu" aria-label={mobileOpen ? "Закрыть меню" : "Открыть меню"} aria-expanded={mobileOpen} aria-controls="workspace-sidebar" onClick={() => setMobileOpen(!mobileOpen)} data-testid="button-mobile-menu">{mobileOpen ? <X /> : <Menu />}</button>
      <div className="header-brand-group"><Brand href={role === 'employer' ? '/employer' : role === 'candidate' ? '/candidate' : '/'} /></div>
      <span className="topbar-divider" />
      <span className="topbar-context">{roleName}<span className="role-dot" /></span>
      <div className="topbar-right">
        {user && <EnvironmentIndicator isDemo={user.demoMode} isReview={user.reviewMode} />}
        <ThemeMenu theme={theme} />
        {user && <><Link href="/settings" className="account-chip" aria-label={`Настройки аккаунта: ${user.displayName}`}><span className="account-avatar">{user.displayName.slice(0, 1).toUpperCase()}</span><span className="account-name">{user.displayName}</span></Link><button className="icon-button" aria-label="Выйти из аккаунта" title="Выйти" onClick={() => { logout.mutate(undefined, { onSuccess: async () => { await replaceAuthQueryCache(qc, getGetCurrentUserQueryKey(), null); setLocation('/'); } }); }} data-testid="button-logout"><LogOut size={17} /></button></>}
      </div>
    </header>
    <div className="workspace">
      <aside ref={sidebarRef} id="workspace-sidebar" inert={smallScreen && !mobileOpen ? true : undefined} aria-hidden={smallScreen && !mobileOpen ? true : undefined} className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`}>
        <div className="side-label">РАБОЧЕЕ ПРОСТРАНСТВО</div>
        <nav aria-label="Основная навигация">{nav.map(([href, label, Icon]) => <Link key={href} href={href} onClick={() => setMobileOpen(false)} className={`nav-link ${location === href ? 'active' : ''}`} data-testid={`nav-${href.split('/').filter(Boolean).join('-') || 'home'}`}><Icon size={19} /><span>{label}</span></Link>)}</nav>
        <div className="sidebar-bottom">{trustAccess.data?.moderator && <Link className="nav-link" href="/moderation"><ShieldCheck size={18}/><span>Модерация</span></Link>}
          <Link className="nav-link settings-link" href="/settings" onClick={() => setMobileOpen(false)} data-testid="nav-settings"><SlidersHorizontal size={18} /><span>Настройки</span></Link>
          <Link className="nav-link" href="/about" onClick={() => setMobileOpen(false)}><CircleHelp size={18} /><span>О сервисе</span></Link>
        </div>
      </aside>
      {mobileOpen && <button className="scrim" aria-label="Закрыть меню" onClick={() => setMobileOpen(false)} data-testid="button-close-menu" />}
      <main className="main-area" id="main-content" tabIndex={-1} inert={smallScreen && mobileOpen ? true : undefined}><div className="page-wrap page-enter"><div className="app-back-row workspace-back-row"><AppBackButton fallback={location === '/settings' ? role === 'employer' ? '/employer' : '/candidate' : undefined} /></div>{role === 'candidate' && <ResumeSwitcher/>}{children}</div></main>
    </div>
  </div>;
}

function LoadingState({ label = 'Загружаем данные' }: { label?: string }) {
  return <div className="state-panel" role="status" data-testid="status-loading"><div className="skeleton-line wide" /><div className="skeleton-line" /><p>{label}</p></div>;
}
function ErrorState({ label = 'Не удалось загрузить данные', retry }: { label?: string; retry?: () => void }) {
  return <div className="state-panel error-panel" role="alert" data-testid="status-error"><ShieldCheck size={24} /><b>{label}</b><p>Проверьте соединение и попробуйте ещё раз.</p>{retry && <button className="button secondary" onClick={retry} data-testid="button-retry">Повторить</button>}</div>;
}
function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return <div className="empty-state" data-testid="state-empty"><div className="empty-mark"><FileCheck2 size={25} /></div><h3>{title}</h3><p>{body}</p>{action}</div>;
}
function PageTitle({ eyebrow, title, intro, action }: { eyebrow?: string; title: string; intro?: string; action?: ReactNode }) {
  return <div className="page-title"><div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h1>{title}</h1>{intro && <p>{intro}</p>}</div>{action && <div className="title-action">{action}</div>}</div>;
}
function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: string }) { return <span className={`badge badge-${tone}`}>{children}</span>; }
function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) { return <FormField className="field" label={label} hint={hint}>{children}</FormField>; }
function Input(props: React.InputHTMLAttributes<HTMLInputElement>) { return <input {...props} className={`input ${props.className || ''}`} />; }
function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) { return <textarea {...props} className={`input textarea ${props.className || ''}`} />; }

function PublicHeader({ theme }: { theme: ReturnType<typeof useThemePreference> }) {
  const session = useGetCurrentUser({ query: { retry: false, queryKey: getGetCurrentUserQueryKey() } });
  const user = session.data?.user;
  return <><header className="public-nav"><div className="header-brand-group"><Brand /></div><div className="public-actions"><ThemeMenu theme={theme} testId="button-theme-menu-public" /><Link className="text-link" href={user ? user.role === 'employer' ? '/employer' : '/candidate' : '/auth'} data-testid="link-signin">{user ? 'В кабинет' : 'Вход'} <ArrowRight size={15} /></Link></div></header><div className="app-back-row public-back-row"><AppBackButton /></div></>;
}

function AboutPage({ theme }: { theme: ReturnType<typeof useThemePreference> }) {
  return <div className="landing"><PublicHeader theme={theme} /><main className="service-info"><PageTitle title="Совпадение начинается с понимания" intro="Signal соединяет подтверждённые навыки специалиста, задачи команды и ожидания от работы." /><section className="panel"><h2>Кандидатам — возможность показать больше</h2><p>Опыт, проекты и результаты квалификационного экзамена Signal складываются в паспорт навыков. Работодатели видят ваши подтверждения, а вы получаете приглашения с задачами, зарплатой и условиями до начала общения.</p><h2>Работодателям — основания для выбора</h2><p>Опишите задачи команды. Signal сопоставит требования с навыками кандидатов и покажет совпадения и пробелы. Сравнивайте подтверждения, изучайте профиль и приглашайте подходящих специалистов.</p><h2>Попробуйте с готовым профилем</h2><p>Откройте «Вход», включите Demo и выберите роль. Данные подставятся автоматически. В демонстрационном кабинете используются вымышленные профили; жёлтый индикатор отличает его от личного аккаунта.</p><h2>Что означает подтверждённый уровень</h2><p>Программы квалификационного экзамена Signal доступны для Backend / Python и Frontend / TypeScript. Результат отражает выполнение заданий по заданным критериям; он не гарантирует успешный найм и не является спортивным разрядом. Методика продолжает развиваться.</p><h2>История спортивного программирования</h2><p>Можно указать свой ФСП ID. До подключения официального источника он ожидает проверки; неподтверждённые сведения не добавляют достижения или бонус. Участие в соревнованиях не требуется для работы с Signal.</p><Link href="/quality" className="text-link" data-testid="link-public-quality">Методика и проверка качества <ArrowRight size={15} /></Link></section></main></div>;
}

function CandidateOverview() {
  const profile = useSelectedCandidateProfile();
  const invitations = useListMyInvitations();
  if (profile.isLoading) return <LoadingState />;
  if (profile.isError) return <ErrorState retry={() => profile.refetch()} />;
  const p = profile.data;
  if (!p && !profile.isFetching) return <EmptyState title="Добавьте резюме" body="Создайте резюме в блоке выше: у каждого будет собственная специализация и подтверждённый уровень."/>;
  const incoming = invitations.data || [];
  const pending = incoming.filter(i => i.status === 'sent' || i.status === 'viewed');
  const searchable = !!p?.verifiedGrade && p.consentMatching && p.visibility !== 'private';
  const next = !p?.verifiedGrade
    ? { title: 'Подтвердите свой уровень', text: p && ['Backend / Python', 'Frontend / TypeScript'].includes(p.specialization) ? `Пройдите квалификационный экзамен Signal ${p.specialization}. Результат появится в профиле.` : 'Выберите доступную программу квалификационного экзамена Signal. Результат появится в профиле.', href: '/candidate/kalibr', button: 'Выбрать проверку' }
    : !searchable
      ? { title: 'Ваш профиль скрыт от подбора', text: 'Настройте видимость и разрешите подбор, если готовы получать предложения.', href: '/candidate/passport', button: 'Настроить видимость' }
      : pending.length
        ? { title: 'Вам поступило приглашение', text: 'Посмотрите задачи, зарплату и условия. Вы сами решаете, открывать ли контакты.', href: '/candidate/invitations', button: 'Посмотреть условия' }
        : { title: 'Профиль участвует в подборе', text: 'Проверьте, актуальны ли ваши технологии, формат работы и ожидания по зарплате.', href: '/candidate/passport', button: 'Проверить профиль' };
  return <><PageTitle title={`Здравствуйте${p?.displayName ? `, ${p.displayName.split(' ')[0]}` : ''}`} intro="Ваш профиль, результаты и предложения от компаний." action={<Link className="button secondary" href="/candidate/passport" data-testid="link-edit-passport">Редактировать профиль <ArrowRight size={16} /></Link>} />
    <div className="overview-status-grid"><div className="status-tile"><BadgeCheck size={19} /><span>Уровень</span><strong>{p?.verifiedGrade || 'Не подтверждён'}</strong><small>{p?.latestAssessmentAt ? `Проверка от ${new Date(p.latestAssessmentAt).toLocaleDateString('ru-RU')}` : 'Пройдите проверку навыков'}</small></div><div className="status-tile"><Target size={19} /><span>Подтверждённые навыки</span><strong>{p?.verifiedSkills.length || 0}</strong><small>По результатам проверки</small></div><div className="status-tile"><Eye size={19} /><span>Видимость</span><strong>{searchable ? 'В подборе' : p?.consentMatching && p.visibility !== 'private' ? 'Нужна проверка' : 'Профиль скрыт'}</strong><small>Контакты доступны с вашего согласия</small></div></div>
    <div className="next-step-card"><div className="next-step-icon"><Sparkles size={22} /></div><div><h2>{next.title}</h2><p>{next.text}</p></div><Link className="button primary" href={next.href} data-testid="link-next-step">{next.button} <ArrowRight size={16} /></Link></div>
    <div className="overview-grid"><section className="panel passport-summary"><div className="panel-heading"><h2>Мой профиль</h2><FileBadge size={20} /></div><div className="summary-name">{p?.professionalAlias || p?.displayName || 'Профиль'}</div><div className="summary-role">{p?.specialization || 'Добавьте специализацию'}</div><div className="summary-grade"><span>Уровень</span><Badge tone={p?.verifiedGrade ? 'verified' : 'neutral'}>{p?.verifiedGrade ? `Подтверждён ${p.verifiedGrade}` : `Указан ${p?.assumedGrade || 'не указан'}`}</Badge></div><div className="chip-row">{(p?.stack || []).slice(0, 4).map(skill => <span className="skill-chip" key={skill}>{skill}</span>)}</div><Link className="panel-link" href="/candidate/passport" data-testid="link-passport-details">Открыть профиль <ArrowRight size={15} /></Link></section>
      <section className="panel invitation-summary"><div className="panel-heading"><h2>Приглашения</h2><Mail size={20} /></div>{invitations.isLoading ? <p role="status">Загружаем приглашения…</p> : invitations.isError ? <button className="button text-button" onClick={() => invitations.refetch()}>Повторить загрузку</button> : incoming.length ? <><div className="invitation-count"><span className="mono">{pending.length}</span><span>ждут вашего ответа</span></div><p>{pending[0] ? `${pending[0].companyName} · ${pending[0].title}` : 'На все приглашения уже есть ответ.'}</p><Link className="panel-link" href="/candidate/invitations" data-testid="link-invitations">Открыть приглашения <ArrowRight size={15} /></Link></> : <><p className="muted">Здесь появятся предложения от компаний. Зарплата и условия будут видны до вашего ответа.</p><Link className="panel-link" href="/candidate/passport" data-testid="link-visibility">Настроить видимость <ArrowRight size={15} /></Link></>}</section></div>
    <CandidateActions />
  </>;
}

function CandidatePassport() {
  const { resumeId } = useResumeSelection();
  return resumeId ? <CandidatePassportForm key={resumeId}/> : <EmptyState title="Добавьте первое резюме" body="Укажите название и специализацию в блоке «Мои резюме»."/>;
}
function CandidatePassportForm() {
  const query = useSelectedCandidateProfile(); const qc = useQueryClient();
  const selection = useResumeSelection();
  const [draftRevision, setDraftRevision] = useState<number | null>(null);
  const serverProfile = useRef<string | null>(null);
  const save = useMutation({ mutationFn: ({ data }: { data: CandidateProfileInput & { title: string; consentCatalog: boolean; readyForOffers: boolean } }) => resumeRequest<SelectedProfile>('/me/candidate-profile', { method: 'PUT', body: JSON.stringify({ ...data, resumeId: selection.resumeId, revision: draftRevision }) }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['candidate-resumes'] }); qc.invalidateQueries({ queryKey: ['candidate-evidence-registry'] }); qc.invalidateQueries({ queryKey: ['candidate-resume'] }); qc.invalidateQueries({ queryKey: ['selected-candidate-profile'] }); } });
  const [draft, setDraft] = useState<(CandidateProfileInput & { title: string; consentCatalog: boolean; readyForOffers: boolean }) | null>(null);
  const [stackText, setStackText] = useState('');
  const [skillsText, setSkillsText] = useState('');
  const skillDictionary = useSkillDictionary();
  const [, navigate] = useLocation();
  const registry = useQuery({ queryKey: ['candidate-evidence-registry', selection.userId], enabled: !!selection.userId, queryFn: () => api<EvidenceRegistryCatalog>('/api/me/evidence/registry') });
  const editableProfile = (p: SelectedProfile) => ({ title: p.title, consentCatalog: p.consentCatalog, readyForOffers: p.readyForOffers, displayName: p.displayName, professionalAlias: p.professionalAlias, specialization: p.specialization, assumedGrade: p.assumedGrade, stack: p.stack, skills: p.skills, yearsExperience: p.yearsExperience, workFormat: p.workFormat, salaryMin: p.salaryMin, salaryMax: p.salaryMax, salaryPeriod: p.salaryPeriod, salaryType: p.salaryType, visibility: p.visibility, consentMatching: p.consentMatching, phone: p.phone, contactEmail: p.contactEmail });
  useEffect(() => {
    if (!query.data) return;
    const profile = editableProfile(query.data), fingerprint = JSON.stringify(profile);
    if (!draft) { serverProfile.current = fingerprint; setDraftRevision(query.data.revision); setStackText(profile.stack.join(', ')); setSkillsText(profile.skills.join(', ')); setDraft(profile); }
    else if (fingerprint === serverProfile.current) setDraftRevision(query.data.revision);
  }, [query.data, draft]);
  if (query.isLoading || !draft) return query.isError ? <ErrorState retry={() => query.refetch()} /> : <LoadingState />;
  const set = <K extends keyof NonNullable<typeof draft>>(key: K, value: NonNullable<typeof draft>[K]) => setDraft(old => old ? { ...old, [key]: value } : old);
  const split = (value: string) => value.split(',').map(x => x.trim()).filter(Boolean);
  const submit = (e: FormEvent) => { e.preventDefault(); save.mutate({ data: { ...draft, stack: split(stackText), skills: split(skillsText) } }, { onSuccess: value => { const profile = editableProfile(value); serverProfile.current = JSON.stringify(profile); setDraft(profile); setStackText(profile.stack.join(', ')); setSkillsText(profile.skills.join(', ')); setDraftRevision(value.revision); qc.setQueryData(['selected-candidate-profile', selection.userId, selection.resumeId], value); }, }); };
  return <><PageTitle eyebrow="ПАСПОРТ НАВЫКОВ" title="Мой профиль" intro="Опыт, технологии, условия работы и настройки доступа." />
    <form className="form-layout" onSubmit={submit}>
      <section className="panel form-panel"><div className="panel-heading"><div><span className="eyebrow">О СЕБЕ</span><h2>Профессиональный профиль</h2></div><UserRound size={20} /></div>
        <CandidateAvatar profile={query.data!} onSaved={() => qc.invalidateQueries({ queryKey: ['selected-candidate-profile'] })}/>
        <Field label="Название этого резюме"><DictionaryCombobox required minLength={2} maxLength={120} options={ROLE_OPTIONS} value={draft.title} onChange={value => set('title', value)}/></Field>
        <div className="form-grid"><Field label="Имя для профиля"><Input value={draft.displayName} onChange={e => set('displayName', e.target.value)} required data-testid="input-profile-name" /></Field><Field label="Имя для подбора" hint="Показывается вместо полного имени при анонимном поиске"><Input value={draft.professionalAlias} onChange={e => set('professionalAlias', e.target.value)} required data-testid="input-alias" /></Field><Field label="Специализация"><select className="input" value={draft.specialization} onChange={e => set('specialization', e.target.value)} data-testid="input-specialization"><option>Backend / Python</option><option>Frontend / TypeScript</option></select></Field><Field label="Заявленная категория"><select className="input" value={draft.assumedGrade} onChange={e => set('assumedGrade', e.target.value as CandidateProfileInput['assumedGrade'])} data-testid="select-assumed-grade"><option>Junior</option><option>Middle</option><option>Senior</option></select></Field><Field label="Технологический стек" hint="Выбранные технологии — ваше заявление, подтверждения показаны отдельно"><DictionaryTags data-multivalue="true" options={skillDictionary.data ?? []} maxItems={30} maxLength={100} value={split(stackText)} onChange={value => setStackText(value.join(', '))} data-testid="input-stack" /></Field><Field label="Навыки, заявленные вами" hint="Подтверждение навыка показывается отдельно"><DictionaryTags data-multivalue="true" options={skillDictionary.data ?? []} maxItems={40} maxLength={100} value={split(skillsText)} onChange={value => setSkillsText(value.join(', '))} data-testid="input-skills" /></Field><Field label="Опыт, лет"><Input type="number" min="0" max="60" value={draft.yearsExperience} onChange={e => set('yearsExperience', Number(e.target.value))} data-testid="input-experience" /></Field><Field label="Формат работы"><DictionaryCombobox options={WORK_FORMAT_OPTIONS} value={draft.workFormat} onChange={value => set('workFormat', value)} maxLength={120} data-testid="input-work-format" /></Field></div>
      </section>
      <section className="panel form-panel"><div className="panel-heading"><div><span className="eyebrow">УСЛОВИЯ И ДОСТУП</span><h2>Предпочтения и видимость</h2></div><Eye size={20} /></div>
        <div className="form-grid"><Field label="Ожидания по зарплате, от"><Input type="number" min="0" value={draft.salaryMin ?? ''} onChange={e => set('salaryMin', e.target.value ? Number(e.target.value) : null)} data-testid="input-salary-min" /></Field><Field label="До"><Input type="number" min="0" value={draft.salaryMax ?? ''} onChange={e => set('salaryMax', e.target.value ? Number(e.target.value) : null)} data-testid="input-salary-max" /></Field><Field label="Период"><select className="input" value={draft.salaryPeriod} onChange={e => set('salaryPeriod', e.target.value as CandidateProfileInput['salaryPeriod'])} data-testid="select-salary-period"><option value="month">В месяц</option><option value="year">В год</option></select></Field><Field label="Сумма"><select className="input" value={draft.salaryType} onChange={e => set('salaryType', e.target.value as CandidateProfileInput['salaryType'])} data-testid="select-salary-type"><option value="gross">До вычета налогов</option><option value="net">На руки</option></select></Field>
          <Field label="Видимость профиля"><select className="input" value={draft.visibility} onChange={e => set('visibility', e.target.value as CandidateProfileInput['visibility'])} data-testid="select-visibility"><option value="private">Скрыт</option><option value="pseudonymous">Псевдоним для работодателей</option><option value="public">Открытое имя</option></select></Field><Field label="Контактная почта"><Input type="email" value={draft.contactEmail || ''} onChange={e => set('contactEmail', e.target.value)} data-testid="input-contact-email" /></Field><Field label="Телефон"><Input type="tel" value={draft.phone || ''} onChange={e => set('phone', e.target.value)} data-testid="input-phone" /></Field></div>
        <label className="consent-row"><input type="checkbox" checked={draft.consentMatching} onChange={e => set('consentMatching', e.target.checked)} data-testid="checkbox-consent-matching" /><span><b>Разрешить поиск по моему профилю</b><small>Работодатель увидит только данные, разрешённые текущей настройкой видимости.</small></span></label>
        <label className="consent-row"><input type="checkbox" checked={draft.consentCatalog} onChange={e => set('consentCatalog', e.target.checked)}/><span>Разрешаю показывать это резюме в каталоге специалистов работодателям</span></label>
        <label className="consent-row"><input type="checkbox" checked={draft.readyForOffers} onChange={e => set('readyForOffers', e.target.checked)}/><span>Готов получать предложения по этому резюме</span></label>
        <div className="privacy-note"><LockKeyhole size={16} /><span>Контакты не передаются в подборе. Они открываются конкретной компании только после принятия её приглашения.</span></div>
      </section>
      <div className="form-actions"><span>{save.isSuccess ? 'Изменения сохранены' : save.isError ? save.error.message : ''}</span><button className="button primary" type="submit" disabled={save.isPending} data-testid="button-save-profile">{save.isPending ? 'Сохраняем…' : 'Сохранить профиль'} <Check size={16} /></button></div>
    </form>
    <div id="resume"><CandidateResumeSection key={`${selection.resumeId}-${query.data?.specialization}`} resumeId={selection.resumeId!} specialization={query.data!.specialization}/></div>
    {query.data && <PassportEvidence profile={query.data} />}<CandidateEvidenceRegistry catalog={registry.data} loading={registry.isPending} error={registry.isError ? "Не удалось загрузить общую историю подтверждений." : null} selectedResumeId={selection.resumeId} onSelectResume={selection.select} onStartAssessment={id => navigate(resumeHref('/candidate/kalibr', id))} onRetry={() => registry.refetch()}/><FspConnectionSection /><AssessmentHistory />
  </>;
}

function CandidateInvitations() {
  const query = useListMyInvitations(); const decide = useDecideInvitation(); const revoke = useRevokeInvitationContact(); const qc = useQueryClient();
  const profile = useSelectedCandidateProfile();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [viewError, setViewError] = useState('');
  const [contacts, setContacts] = useState<{ [id: number]: { displayName?: string; email?: string; phone?: string | null } | null }>({});
  if (query.isLoading) return <LoadingState label="Загружаем приглашения" />;
  if (query.isError) return <ErrorState retry={() => query.refetch()} />;
  const list = query.data || [], selected = list.find(i => i.id === selectedId);
  const openInvitation = async (id: number) => {
    setSelectedId(id); setViewError('');
    try { await api(`/api/me/invitations/${id}/view`, { method: 'POST' }); await qc.invalidateQueries({ queryKey: getListMyInvitationsQueryKey() }); }
    catch { setViewError('Не удалось отметить просмотр. Условия доступны; попробуйте открыть предложение ещё раз.'); }
  };
  const onDecision = (id: number, decision: 'accept' | 'decline') => decide.mutate({ id, data: { decision } }, { onSuccess: result => { setContacts(old => ({ ...old, [id]: result.disclosedContacts || null })); if (decision === 'accept' && result.invitation.contactShared) celebrate(`contact-${profile.data?.userId}-${id}`, 'Приглашение принято', 'Ваши контакты открыты этой компании. Можно начинать разговор.', 'contact'); qc.invalidateQueries({ queryKey: getListMyInvitationsQueryKey() }); } });
  const onRevoke = (id: number) => revoke.mutate({ id }, { onSuccess: () => { dismissCelebration(`contact-${profile.data?.userId}-${id}`); setContacts({}); qc.invalidateQueries({ queryKey: getListMyInvitationsQueryKey() }); qc.invalidateQueries({queryKey:['candidate-applications']}); } });
  const status:Record<string,string> = {sent:'Новое',viewed:'Просмотрено',accepted:'Принято',declined:'Отклонено',withdrawn:'Отозвано',expired:'Истекло'};
  return <><PageTitle eyebrow="ВАШ ВЫБОР" title="Приглашения" intro="Изучите условия и решите, продолжать ли разговор. Контакты откроются только при принятии." />
    {!list.length ? <EmptyState title="Пока нет предложений" body="Когда работодатель заинтересуется вашим опытом, предложение появится здесь. Ваши контакты останутся скрыты." action={<Link className="button secondary" href="/candidate/passport" data-testid="link-empty-profile">Проверить профиль <ArrowRight size={15} /></Link>} /> : <div className="invitation-list">{list.map(item => <article className="panel invitation-card" key={item.id} data-testid={`card-invitation-summary-${item.id}`}><div className="invitation-card-top"><div><span className="eyebrow">{item.companyName}</span><h2>{item.title}</h2></div><Badge tone={item.status==='sent'?'accent':'neutral'}>{status[item.status]||item.status}</Badge></div><div className="invitation-terms"><span><Banknote size={16}/><b>{item.salaryMin.toLocaleString('ru-RU')}–{item.salaryMax.toLocaleString('ru-RU')} ₽</b> / {item.salaryPeriod==='month'?'мес.':'год'} · {item.salaryType==='gross'?'до вычета':'на руки'}</span><span>{item.workFormat}</span></div><button className="button secondary" onClick={()=>void openInvitation(item.id)} data-testid={`button-open-invitation-${item.id}`}>Посмотреть предложение <ArrowRight size={15}/></button></article>)}</div>}
    {selected && <Dialog title={selected.title} onClose={()=>setSelectedId(null)}><InvitationCard invitation={selected} candidate onDecision={onDecision} onRevoke={onRevoke} pending={decide.isPending||revoke.isPending} disclosed={contacts[selected.id] ?? (selected.contactShared && selected.status==='accepted' && profile.data ? {displayName:profile.data.displayName,email:profile.data.contactEmail||undefined,phone:profile.data.phone}:undefined)}/>{viewError&&<p role="status">{viewError}</p>}{(decide.isError||revoke.isError)&&<p className="form-error" role="alert">{decide.error?.message||revoke.error?.message||'Не удалось сохранить решение.'}</p>}</Dialog>}
  </>;
}

function InvitationCard({ invitation: i, candidate, onDecision, onRevoke, pending, disclosed }: { invitation: Invitation; candidate: boolean; onDecision?: (id: number, decision: 'accept' | 'decline') => void; onRevoke?: (id: number) => void; pending?: boolean; disclosed?: { displayName?: string; email?: string; phone?: string | null } | null }) {
  const statusNames: Record<string, string> = { sent: 'Ожидает ответа', viewed: 'Просмотрено', accepted: 'Принято', declined: 'Отклонено', withdrawn: 'Отозвано', expired: 'Истекло' };
  return <article className="panel invitation-card" data-testid={`card-invitation-${i.id}`}><div className="invitation-card-top"><div><span className="eyebrow">{candidate ? i.companyName : i.candidateAlias}</span><h2>{i.title}</h2></div><Badge tone={i.status === 'accepted' ? 'verified' : i.status === 'declined' ? 'muted' : 'accent'}>{statusNames[i.status] || i.status}</Badge></div>
    <p className="invitation-message">{i.message}</p>{candidate && <div className="company-contact"><BriefcaseBusiness size={16} /><span><b>Контакт компании</b>{i.companyContact || 'Компания не указала контакт'}</span></div>}<div className="invitation-terms"><span><Banknote size={16} /> <b className="mono">{i.salaryMin.toLocaleString('ru-RU')}–{i.salaryMax.toLocaleString('ru-RU')} ₽</b> / {i.salaryPeriod === 'month' ? 'мес.' : 'год'} · {i.salaryType === 'gross' ? 'до вычета' : 'на руки'}</span><span><BriefcaseBusiness size={15} /> {i.workFormat}</span></div><div className="interest-reason"><b>Почему интерес:</b> {i.reason}</div>
    {candidate && i.status === 'accepted' && i.contactShared && <div className="contact-release"><UnlockMark /><div><b>Контакты открыты для {i.companyName}</b>{disclosed ? <span>{disclosed.displayName || ''}{disclosed.email ? ` · ${disclosed.email}` : ''}{disclosed.phone ? ` · ${disclosed.phone}` : ''}</span> : <span>Вы дали согласие на передачу данных этой компании. Контактные данные можно обновить в паспорте.</span>}<button className="button text-button" disabled={pending} onClick={() => onRevoke?.(i.id)} data-testid={`button-revoke-contact-${i.id}`}>Отозвать дальнейший доступ</button></div></div>}
    {candidate && i.status === 'accepted' && !i.contactShared && <div className="contact-release"><LockKeyhole size={16} /><div><b>Доступ к контактам отозван</b><span>Компания больше не может запрашивать ваши контакты через Signal.</span></div></div>}
    {candidate && (i.status === 'sent' || i.status === 'viewed') && <div className="decision-row"><p><LockKeyhole size={15} /> При принятии контакты будут переданы только этой компании.</p><div><button className="button secondary" disabled={pending} onClick={() => onDecision?.(i.id, 'decline')} data-testid={`button-decline-${i.id}`}>Отклонить</button><button className="button primary" disabled={pending} onClick={() => onDecision?.(i.id, 'accept')} data-testid={`button-accept-${i.id}`}>Принять и открыть контакты <ArrowRight size={15} /></button></div></div>}
    {candidate && i.companyId && <CompanyTrustActions companyId={i.companyId} objectType="invitation" objectId={i.id}/>}
  </article>;
}
function UnlockMark() { return <span className="unlock-mark"><Check size={16} /></span>; }

function AssessmentResultView({ result }: { result: AssessmentResult }) {
  useEffect(() => { if (result.verified && result.gradeChanged) celebrate(`grade-attempt-${result.attemptId}`, `${result.grade} подтверждён`, 'Новая категория добавлена в паспорт по результатам проверки навыков.', 'grade'); }, [result.attemptId, result.grade, result.verified, result.gradeChanged]);
  return <><PageTitle eyebrow="КВАЛИФИКАЦИЯ SIGNAL" title="Результат экзамена Signal" intro={result.statusText} /><AssessmentContextSummary attemptId={result.attemptId} />
    <section className="result-hero panel"><div className="result-score mono">{result.score}<small>/100</small></div><div><Badge tone={result.verified ? 'verified' : 'warning'}>{result.verified ? `Подтверждён ${result.grade}` : 'Недостаточно для подтверждения'}</Badge><h2>{result.verified ? 'Уровень подтверждён экзаменом Signal' : 'Пока недостаточно данных для подтверждения'}</h2><p>{result.nextStep}</p></div></section>
    <section className="panel evidence-panel"><div className="eyebrow">ДОКАЗАТЕЛЬСТВА И КРИТЕРИИ</div>{result.evidence.map((e, i) => <div className="evidence-row" key={`${e.skill}-${i}`}><div><b>{e.skill}</b><span>{e.criterion}</span></div><span className="mono">{e.score}</span><small>{e.source.replace(/КАЛИБР/gi, 'Проверка навыков')} · {new Date(e.date).toLocaleDateString('ru-RU')}</small></div>)}</section>
    <Link className="button secondary" href={resumeHref("/candidate/passport", result.resumeId ?? null)} data-testid="link-result-passport">К паспорту навыков <ArrowRight size={15} /></Link>
  </>;
}

function KalibrPage() {
  const now = useClock();
  const selection = useResumeSelection();
  const programs = useListAssessmentPrograms();
  const start = useStartAssessmentAttempt(); const save = useSaveAssessmentAnswers(); const submit = useSubmitAssessmentAttempt();
  const qc = useQueryClient();
  const search = useSearch();
  const params = new URLSearchParams(search); const attemptId = Number(params.get('attempt')) || 0;
  const fixedAttemptResumeId = params.get('resumeId');
  const attemptParams = fixedAttemptResumeId ? { resumeId: Number(fixedAttemptResumeId) } : undefined;
  const attempt = useGetAssessmentAttempt(attemptId, attemptParams, { query: { enabled: attemptId > 0, queryKey: getGetAssessmentAttemptQueryKey(attemptId, attemptParams) } });
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const hydratedAttempt = useRef(0);
  const [grade, setGrade] = useState<'Junior' | 'Middle' | 'Senior'>(() => { const value = params.get('grade'); return value === 'Junior' || value === 'Senior' ? value : 'Middle'; });
  const [assessmentContext, setAssessmentContext] = useState<AssessmentContextSelection>({ contextId: 'api-platform' });
  const [gradeConfirmed, setGradeConfirmed] = useState(false);
  const [finishConfirmation, setFinishConfirmation] = useState(false);
  useEffect(() => { setGradeConfirmed(false); }, [grade, selection.resumeId, assessmentContext.contextId, assessmentContext.invitationId]);
  const user = useGetCurrentUser().data?.user;
  const profile = useSelectedCandidateProfile();
  const specialization = profile.data?.specialization || 'Backend / Python';
  const selectedProgramId = specialization === 'Frontend / TypeScript' ? 'frontend-typescript' : 'backend-python';
  useEffect(() => { setAssessmentContext({ contextId: selectedProgramId === 'frontend-typescript' ? 'frontend-product' : 'api-platform' }); }, [selectedProgramId]);
  const resume = useQuery({ queryKey: ['candidate-resume', user?.id, selection.resumeId], queryFn: () => api<{ recommendation: { grade: string; completedCount: number; totalQuestions: number }; questionnaire: { specialization: string } }>(`/api/me/resumes/${selection.resumeId}`), enabled: !attemptId && !!user && !!selection.resumeId, retry: false });
  const [result, setResult] = useState<AssessmentResult | null>(null);
  useEffect(() => { setResult(null); }, [attemptId]);
  const [, setLocation] = useLocation();
  useEffect(() => {
    if (!attempt.data || hydratedAttempt.current === attemptId) return;
    hydratedAttempt.current = attemptId;
    const fromServer = Object.fromEntries(attempt.data.cases.map(c => [c.id, c.savedAnswer || '']));
    try {
      const local = JSON.parse(localStorage.getItem(`fsp-kalibr-draft-${attemptId}`) || '{}');
      setAnswers({ ...fromServer, ...(local && typeof local === 'object' ? local : {}) });
    } catch { setAnswers(fromServer); }
  }, [attempt.data, attemptId]);
  useEffect(() => {
    if (!attempt.data || attempt.data.status !== 'in_progress' || hydratedAttempt.current !== attemptId) return;
    try { localStorage.setItem(`fsp-kalibr-draft-${attemptId}`, JSON.stringify(answers)); } catch { /* the server remains the authoritative copy */ }
  }, [answers, attempt.data, attemptId]);
  const program = programs.data?.find(p => p.id === selectedProgramId);
  const startAttempt = () => { if (!program || !gradeConfirmed) return; start.mutate({ data: { purpose: 'signal_qualification', gradeConfirmed: true, programId: program.id, grade, resumeId: selection.resumeId!, ...assessmentContext } }, { onSuccess: data => { setAnswers(Object.fromEntries(data.cases.map(c => [c.id, c.savedAnswer || '']))); setLocation(`/candidate/kalibr?attempt=${data.id}&resumeId=${selection.resumeId}`); } }); };
  if (programs.isLoading) return <LoadingState label="Загружаем программы оценки" />;
  if (programs.isError) return <ErrorState retry={() => programs.refetch()} />;
  if (attemptId && attempt.isLoading) return <LoadingState label="Восстанавливаем попытку" />;
  if (attemptId && attempt.isError) return (attempt.error as Error & { status?: number })?.status === 404 ? <EmptyState title="Попытка недоступна" body="Она не найдена или принадлежит другому аккаунту. Откройте свою проверку из истории." action={<Link className="button secondary" href="/candidate/kalibr">К своим проверкам <ArrowRight size={15}/></Link>}/> : <ErrorState label="Не удалось восстановить попытку" retry={() => attempt.refetch()} />;
  if (!attemptId && !(user?.demoMode && !user.reviewMode) && resume.isLoading) return <LoadingState label="Проверяем готовность профиля" />;
  if (!attemptId && !(user?.demoMode && !user.reviewMode) && resume.isError) return <ErrorState label="Не удалось загрузить опрос" retry={() => resume.refetch()} />;
  if (!attemptId && !(user?.demoMode && !user.reviewMode) && (!resume.data || resume.data.recommendation.completedCount < 6 || resume.data.questionnaire.specialization !== specialization)) return <><PageTitle title="Начните с короткого опроса" intro="Расскажите о своём опыте, затем выберите уровень и пройдите квалификационный экзамен Signal." /><section className="panel"><Target size={28} /><h2>Шесть вопросов по специализации</h2><p>Опрос поможет выбрать подходящий уровень проверки. Подтверждённую категорию определит результат экзамена Signal.</p><Link className="button primary" href={resumeHref("/candidate/passport#resume", selection.resumeId)}>Заполнить профиль и опрос <ArrowRight size={16} /></Link></section></>;
  if (!attemptId || !attempt.data) return <><PageTitle eyebrow="КВАЛИФИКАЦИЯ SIGNAL" title="Квалификационный экзамен" intro="Выберите заявленный уровень. Полная программа Signal определит подтверждённый грейд этого резюме." />
    <div className="kalibr-intro-grid"><section className="panel kalibr-start"><div className="target-illustration"><Target size={28} /></div><Badge tone="accent">{specialization}</Badge><h2>Экзамен Signal</h2><p>{program?.description}</p><p className="muted">Общая программа, обязательные компетенции и пороги одинаковы для выбранного уровня. Задачи компании находятся в разделе «Практика» и не присваивают грейд Signal.</p><div className="kalibr-facts"><span><Clock3 size={16} /> Около {program?.estimatedMinutes || 25} минут</span><span><FileCheck2 size={16} /> Ответы можно сохранить и продолжить позже</span><span><ShieldCheck size={16} /> Результат с критериями</span></div><AssessmentContextSelector programId={selectedProgramId} value={assessmentContext} onChange={setAssessmentContext} disabled={start.isPending} /><Field label="Ваш заявленный уровень"><select disabled={start.isPending} className="input" value={grade} onChange={e => setGrade(e.target.value as typeof grade)} data-testid="select-kalibr-grade"><option>Junior</option><option>Middle</option><option>Senior</option></select></Field><label className="opportunity-check"><input type="checkbox" checked={gradeConfirmed} disabled={start.isPending} onChange={event => setGradeConfirmed(event.target.checked)} data-testid="checkbox-confirm-grade"/><span>Подтверждаю выбор: {specialization}, {grade}. Прохожу квалификационный экзамен Signal.</span></label><button className="button primary" onClick={startAttempt} disabled={!program || !selection.resumeId || !gradeConfirmed || start.isPending} data-testid="button-start-assessment">{start.isPending ? 'Создаём попытку…' : 'Начать экзамен Signal'} <ArrowRight size={16} /></button>{start.isError && <p className="form-error">{start.error instanceof Error ? start.error.message.replace(/^HTTP \d{3}[^:]*:\s*/, '') : 'Не удалось начать попытку.'}</p>}</section>
      <aside className="kalibr-side"><div className="eyebrow">ЧТО БУДЕТ ПРОВЕРЕНО</div>{(selectedProgramId === 'frontend-typescript' ? ['TypeScript', 'Состояние интерфейса', 'Производительность', 'Доступность', 'Архитектура интерфейса', 'Асинхронный интерфейс'] : ['Контракты API', 'Запросы и данные SQL', 'Диагностика инцидента', 'Идемпотентность', 'Архитектурный выбор', 'Безопасность повторов']).map((label, i) => <div className="case-family" key={label}><span>0{i + 1}</span><b>{label}</b><Check size={15} /></div>)}<div className="honest-note"><CircleHelp size={16} /><p>Проверка занимает до 45 минут. Категория отражает результат заданий; независимая проверка точности оценки ещё не завершена.</p></div></aside></div>
    <AssessmentHistory />
    {program && <div className="program-note"><span>{program.title}</span><Badge>{program.available ? 'Программа доступна' : 'Нет активной программы'}</Badge></div>}
  </>;
  if (attempt.isLoading) return <LoadingState label="Восстанавливаем сохранённую попытку" />;
  if (attempt.isError) return <ErrorState label="Не удалось восстановить попытку" retry={() => attempt.refetch()} />;
  const current = attempt.data;
  if (current.status === 'submitted') return current.result ? <AssessmentResultView result={current.result} /> : <><PageTitle eyebrow="ПРОВЕРКА ЗАВЕРШЕНА" title="Попытка уже отправлена" intro="Результат этой проверки уже сохранён." /><section className="panel evidence-panel"><Badge tone="verified">Отправлено</Badge><h2>Результат сохранён</h2><p>Детальный разбор для этой старой попытки недоступен.</p></section><Link className="button secondary" href="/candidate" data-testid="link-submitted-overview">К обзору кандидата <ArrowRight size={15} /></Link></>;
  const expired = now >= Date.parse(current.dueAt);
  const filledCount = current.cases.filter(c => !!answers[c.id]?.trim()).length;
  const saveAnswers = () => { if (Date.now() >= Date.parse(current.dueAt)) return; save.mutate({ id: current.id, data: { answers: current.cases.map(c => ({ caseId: c.id, answer: answers[c.id] || '' })) } }); };
  const finish = () => { if (Date.now() >= Date.parse(current.dueAt)) return; setFinishConfirmation(false); save.mutate({ id: current.id, data: { answers: current.cases.map(c => ({ caseId: c.id, answer: answers[c.id] || '' })) } }, { onSuccess: () => submit.mutate({ id: current.id }, { onSuccess: value => { setResult(value); qc.invalidateQueries({ queryKey: ['assessment-history'] }); try { localStorage.removeItem(`fsp-kalibr-draft-${current.id}`); } catch {} qc.invalidateQueries({ queryKey: ['selected-candidate-profile'] }); qc.invalidateQueries({ queryKey: ['candidate-resumes'] }); qc.invalidateQueries({ queryKey: ['candidate-evidence-registry'] }); } }) }); };
  if (result) return <AssessmentResultView result={result} />;
  return <><PageTitle eyebrow="КВАЛИФИКАЦИЯ SIGNAL" title="Экзамен Signal" intro={`${current.qualificationBasis?.specialization ?? "Программа Signal"} · заявленный уровень ${current.grade}. Сохраняйте ответы, чтобы продолжить позже.`} action={<Badge tone="warning">{expired ? 'Срок истёк' : 'В процессе'}</Badge>} />
    {expired && <section className="panel evidence-panel" role="status" data-testid="status-attempt-expired"><h2>Срок попытки истёк</h2><p>Ответы доступны для просмотра. Сохранение и отправка этой попытки закрыты.</p><Link className="button primary" href="/candidate/kalibr" data-testid="link-new-assessment">Перейти к новой попытке <ArrowRight size={16} /></Link></section>}
    {finishConfirmation && <Dialog title="Завершить экзамен?" onClose={() => setFinishConfirmation(false)}><p>Заполнено {filledCount} из {current.cases.length} кейсов. Пустые ответы будут оценены как невыполненные. После отправки ответы изменить нельзя.</p><div className="multi-resume-actions"><button className="button secondary" onClick={() => setFinishConfirmation(false)}>Продолжить экзамен</button><button className="button primary" onClick={finish}>Отправить ответы</button></div></Dialog>}
    <AssessmentContextSummary attemptId={current.id} /><div className="attempt-progress"><div><b>{filledCount} из {current.cases.length} кейсов заполнено</b><span>Категория проверки: {current.grade} · срок до {new Date(current.dueAt).toLocaleString('ru-RU')}</span></div><div className="progress-track"><span style={{ width: `${current.cases.length ? (filledCount / current.cases.length) * 100 : 0}%` }} /></div></div>
    <div className="case-list">{current.cases.map((item, index) => <article className="panel case-card" key={item.id}><div className="case-heading"><span className="case-index">КЕЙС {String(index + 1).padStart(2, '0')}</span><Badge>{item.family}</Badge></div><h2>{item.title}</h2><CasePrompt text={item.prompt} />{item.responseType === 'choice' ? <div className="choice-list">{item.options.map(option => <label key={option} className={`choice-option ${answers[item.id] === option ? 'chosen' : ''}`}><input type="radio" disabled={expired} name={`case-${item.id}`} checked={answers[item.id] === option} onChange={() => setAnswers(old => ({ ...old, [item.id]: option }))} data-testid={`input-answer-${item.id}-${option}`} /><span>{option}</span></label>)}</div> : <Textarea disabled={expired} value={answers[item.id] || ''} maxLength={3000} rows={5} aria-label={`Ответ на кейс ${index + 1}: ${item.title}`} spellCheck={false} placeholder="Введите ответ точно в формате, указанном в условии" onChange={e => setAnswers(old => ({ ...old, [item.id]: e.target.value }))} data-testid={`input-answer-${item.id}`} />}</article>)}</div>
    <div className="attempt-actions"><span className="save-state" data-testid="status-answer-save">{expired ? 'Срок попытки истёк' : save.isPending ? 'Сохраняем ответы…' : save.isSuccess ? 'Ответы сохранены' : save.isError ? save.error.message : 'Черновик на этом устройстве. Нажмите «Сохранить ответы», чтобы продолжить с другого.'}</span><button className="button secondary" onClick={saveAnswers} disabled={expired || save.isPending || submit.isPending} data-testid="button-save-answers">Сохранить ответы</button><button className="button primary" onClick={() => filledCount < current.cases.length ? setFinishConfirmation(true) : finish()} disabled={expired || save.isPending || submit.isPending} data-testid="button-submit-assessment">{submit.isPending ? 'Отправляем…' : 'Завершить проверку'} <ArrowRight size={16} /></button></div>{submit.isError && <p className="form-error" role="alert">{submit.error.message}</p>}
  </>;
}

function EmployerHome() {
  const needs = useListEmployerNeeds(); const create = useCreateEmployerNeed(); const qc = useQueryClient(); const [, setLocation] = useLocation();
  const [open, setOpen] = useState(false);
  const [requiredSkills, setRequiredSkills] = useState('');
  const [desirableSkills, setDesirableSkills] = useState<string[]>([]);
  const [needTitle, setNeedTitle] = useState('');
  const [workFormat, setWorkFormat] = useState('');
  const skillDictionary = useSkillDictionary();
  const [specialization, setSpecialization] = useState('Backend / Python');
  const submit = (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const d = new FormData(e.currentTarget); const arr = (key: string) => String(d.get(key)).split(',').map(x => x.trim()).filter(Boolean); const salaryMin = Number(d.get('salaryMin')); const salaryMax = Number(d.get('salaryMax'));
    const input: EmployerNeedInput = { title: String(d.get('title')), specialization: String(d.get('specialization')), grade: String(d.get('grade')) as EmployerNeedInput['grade'], requiredSkills: arr('requiredSkills'), desirableSkills: arr('desirableSkills'), description: String(d.get('description')), workFormat: String(d.get('workFormat')), salaryMin, salaryMax, salaryPeriod: String(d.get('salaryPeriod')) as EmployerNeedInput['salaryPeriod'], salaryType: String(d.get('salaryType')) as EmployerNeedInput['salaryType'] };
    create.mutate({ data: input }, { onSuccess: value => { qc.invalidateQueries({ queryKey: getListEmployerNeedsQueryKey() }); setOpen(false); setLocation(`/employer/matches?need=${value.id}`); } });
  };
  return <><PageTitle eyebrow="РАБОТОДАТЕЛЬ" title="Запросы на подбор" intro="Управляйте запросами на подбор: требованиями, задачами и условиями работы." action={<button className="button primary" onClick={() => setOpen(!open)} data-testid="button-create-need">{open ? 'Закрыть форму' : 'Создать запрос'} {open ? <X size={16} /> : <ArrowRight size={16} />}</button>} />
    {open && <form className="panel need-form" onSubmit={submit}><div className="panel-heading"><div><span className="eyebrow">ЗАПРОС НА ПОДБОР</span><h2>Опишите роль и условия</h2></div></div><div className="form-grid"><Field label="Название роли"><DictionaryCombobox name="title" required minLength={3} maxLength={160} options={ROLE_OPTIONS} value={needTitle} onChange={setNeedTitle} data-testid="input-need-title" /></Field><Field label="Специализация"><select className="input" name="specialization" value={specialization} onChange={e=>setSpecialization(e.target.value)} data-testid="input-need-specialization"><option>Backend / Python</option><option>Frontend / TypeScript</option></select></Field><Field label="Минимальная категория"><select name="grade" defaultValue="Middle" className="input" data-testid="select-need-grade"><option>Junior</option><option>Middle</option><option>Senior</option></select></Field><Field label="Формат"><DictionaryCombobox name="workFormat" required maxLength={120} options={WORK_FORMAT_OPTIONS} value={workFormat} onChange={setWorkFormat} placeholder="Выберите или укажите условия" data-testid="input-need-format" /></Field><Field label="Обязательные навыки" hint="Неизвестный навык сохранится как требование; покрытие проверки показано ниже"><DictionaryTags data-multivalue="true" name="requiredSkills" required options={skillDictionary.data ?? []} maxItems={40} maxLength={100} value={requiredSkills.split(',').map(value=>value.trim()).filter(Boolean)} onChange={values=>setRequiredSkills(values.join(', '))} placeholder="Выберите или добавьте навык" data-testid="input-required-skills" /></Field><Field label="Желательные навыки" hint="Можно выбрать из каталога или добавить своё значение"><DictionaryTags data-multivalue="true" name="desirableSkills" options={skillDictionary.data ?? []} maxItems={40} maxLength={100} value={desirableSkills} onChange={setDesirableSkills} data-testid="input-desirable-skills" /></Field><Field label="Зарплата от, ₽"><Input name="salaryMin" type="number" min="1" required data-testid="input-need-salary-min" /></Field><Field label="До, ₽"><Input name="salaryMax" type="number" min="1" required data-testid="input-need-salary-max" /></Field><Field label="Период"><select className="input" name="salaryPeriod" data-testid="select-need-period"><option value="month">В месяц</option><option value="year">В год</option></select></Field><Field label="Зарплата"><select className="input" name="salaryType" data-testid="select-need-salary-type"><option value="gross">До вычета налогов</option><option value="net">На руки</option></select></Field></div><SkillCoverage specialization={specialization} requirements={requiredSkills.split(',').map(s=>s.trim()).filter(Boolean)} /><Field label="Задачи и контекст команды"><Textarea name="description" required minLength={10} rows={4} placeholder="Опишите задачи, которые будет решать специалист…" data-testid="input-need-description" /></Field><div className="form-actions"><span>{create.isError ? (create.error instanceof Error ? create.error.message : 'Не удалось сохранить вакансию.') : 'Запрос виден только вам. Для открытого набора создайте публикацию в разделе «Публикации и отклики».'}</span><button className="button primary" disabled={create.isPending} type="submit" data-testid="button-save-need">{create.isPending ? 'Сохраняем…' : 'Создать и перейти к подбору'} <ArrowRight size={15} /></button></div></form>}
    {needs.isLoading ? <LoadingState label="Загружаем вакансии" /> : needs.isError ? <ErrorState retry={() => needs.refetch()} /> : !needs.data?.length ? <EmptyState title="Добавьте первую вакансию" body="Создайте первую роль с обязательными навыками, задачами и прозрачным диапазоном зарплаты." action={<button className="button primary" onClick={() => setOpen(true)} data-testid="button-empty-create-need">Добавить вакансию <ArrowRight size={15} /></button>} /> : <div className="need-list">{needs.data.map(need => <article className="panel need-row" key={need.id} data-testid={`card-need-${need.id}`}><div><Badge tone="accent">{need.grade}</Badge><h2>{need.title}</h2><p>{need.specialization} · {need.workFormat}</p><div className="chip-row">{need.requiredSkills.map(skill => <span className="skill-chip required" key={skill}>{skill}</span>)}</div></div><div className="need-side"><span className="mono">{need.salaryMin.toLocaleString('ru-RU')}–{need.salaryMax.toLocaleString('ru-RU')} ₽<small> / {need.salaryPeriod === 'month' ? 'мес.' : 'год'} · {need.salaryType === 'gross' ? 'до вычета' : 'на руки'}</small></span><Link href={`/employer/matches?need=${need.id}`} className="button secondary" data-testid={`link-match-need-${need.id}`}>Открыть подбор <ArrowRight size={15} /></Link></div></article>)}</div>}
  </>;
}

function EmployerMatches() {
  const needs = useListEmployerNeeds();
  const [, setLocation] = useLocation();
  const search = useSearch();
  const needId = Number(new URLSearchParams(search).get('need')) || needs.data?.[0]?.id || 0;
  const [resumeChoices,setResumeChoices]=useState<Record<number,number>>({});
  const choiceIds=Object.values(resumeChoices).sort((a,b)=>a-b).join(',');
  const candidates=useQuery<(MatchCandidate & {resumeRevision:number;availableResumes?:{resumeId:number;title:string;verifiedGrade:string|null;specialization:string}[]})[]>({queryKey:['resume-aware-matches',needId,choiceIds],enabled:needId>0,queryFn:()=>api(`/api/matches?needId=${needId}${choiceIds ? `&resumeIds=${choiceIds}` : ''}`)});
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [filters, setFilters] = useState(() => { try { const saved = JSON.parse(localStorage.getItem('fsp-match-filters') || '{}'); return { search: typeof saved.search === 'string' ? saved.search : '', grade: ['Junior','Middle','Senior'].includes(saved.grade) ? saved.grade : '', fsp: ['yes','no'].includes(saved.fsp) ? saved.fsp : '' }; } catch { return { search: '', grade: '', fsp: '' }; } });
  const [compareIds, setCompareIds] = useState<number[]>([]);
  const [comparisonOpen, setComparisonOpen] = useState(false);
  const invitationIntent = useRef(crypto.randomUUID());
  const [draftCandidate, setDraftCandidate] = useState<MatchCandidate | null>(null);
  const create = useCreateInvitation();
  const currentNeed = needs.data?.find(n => n.id === needId);
  const sendConstraint=(create.error as (Error & {data?:{retryAt?:string;code?:string;error?:string}}) | null)?.data;
  const visible = useMemo(() => (candidates.data || []).filter(c => `${c.alias} ${c.specialization} ${c.stack.join(' ')}`.toLowerCase().includes(filters.search.toLowerCase()) && (!filters.grade || c.verifiedGrade === filters.grade) && (!filters.fsp || c.fspHistory === (filters.fsp === 'yes'))), [candidates.data, filters]);
  const candidate = visible.find(c => c.candidateId === selectedId) || visible[0] || null;
  const explanation = useGetMatchExplanation({ needId, candidateId: candidate?.candidateId || 0, resumeId: candidate?.resumeId || 0 }, { query: { enabled: !!candidate && needId > 0, queryKey: ['/api/matches/explanation', needId, candidate?.candidateId || 0, candidate?.resumeId || 0] } });
  useEffect(() => { setSelectedId(null); setResumeChoices({}); setCompareIds([]); setComparisonOpen(false); setDraftCandidate(null); }, [needId]);
  useEffect(() => { try { localStorage.setItem('fsp-match-filters', JSON.stringify(filters)); } catch {} }, [filters]);
  const comparison = (candidates.data || []).filter(c => compareIds.includes(c.candidateId));
  const toggleCompare = (id: number) => setCompareIds(old => old.includes(id) ? old.filter(x => x !== id) : old.length < 2 ? [...old, id] : old);
  const hasFilters = !!(filters.search || filters.grade || filters.fsp);
  const clearFilters = () => setFilters({ search: '', grade: '', fsp: '' });
  const sendInvite = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draftCandidate || !currentNeed) return;
    const data = new FormData(event.currentTarget);
    const payload: InvitationInput = { idempotencyKey: invitationIntent.current, needId: currentNeed.id, candidateId: draftCandidate.candidateId, resumeId: draftCandidate.resumeId, title: String(data.get('title')), message: String(data.get('message')), reason: String(data.get('reason')), salaryMin: currentNeed.salaryMin, salaryMax: currentNeed.salaryMax, salaryPeriod: currentNeed.salaryPeriod, salaryType: currentNeed.salaryType, workFormat: currentNeed.workFormat };
    create.mutate({ data: payload }, { onSuccess: () => { setDraftCandidate(null); setLocation('/employer/invitations'); } });
  };
  return <><PageTitle eyebrow="ОБЪЯСНИМЫЙ ПОДБОР" title="Подбор специалистов" intro="Выберите вакансию, изучите навыки кандидатов и отправьте приглашение." />
    {needs.isLoading ? <LoadingState /> : needs.isError ? <ErrorState retry={() => needs.refetch()} /> : !currentNeed ? <EmptyState title="Сначала добавьте вакансию" body="Выберите роль, обязательные навыки и зарплатный диапазон — затем появится подбор." action={<Link className="button primary" href="/employer">К вакансиям <ArrowRight size={15} /></Link>} /> : <>
      <EmployerAssessmentContext needId={currentNeed.id} /><div className="match-toolbar"><FormField className="need-select" label="Вакансия" layout="vertical"><select className="input" value={needId} onChange={e => setLocation(`/employer/matches?need=${e.target.value}`)} data-testid="select-match-need">{needs.data?.map(n => <option key={n.id} value={n.id}>{n.title}</option>)}</select></FormField><FormField className="match-search-field" label="Поиск по имени и стеку" layout="vertical"><input className="input" maxLength={160} value={filters.search} onChange={e => setFilters(old => ({ ...old, search: e.target.value }))} placeholder="Имя или технология" data-testid="input-match-search" /></FormField><span className="match-total"><Users size={15} /> {visible.length} из {candidates.data?.length ?? '—'}</span></div>
      <div className="match-filter-row"><label><span>Подтверждённая категория</span><select className="input" value={filters.grade} onChange={e => setFilters(old => ({ ...old, grade: e.target.value }))} data-testid="filter-grade"><option value="">Все категории</option><option>Junior</option><option>Middle</option><option>Senior</option></select></label><label><span>История ФСП</span><select className="input" value={filters.fsp} onChange={e => setFilters(old => ({ ...old, fsp: e.target.value }))} data-testid="filter-fsp"><option value="">Все кандидаты</option><option value="yes">С историей ФСП</option><option value="no">Без истории ФСП</option></select></label>{hasFilters && <button className="button text-button" onClick={clearFilters}>Сбросить фильтры</button>}</div>
      {candidates.isLoading ? <LoadingState label="Подбираем специалистов" /> : candidates.isError ? <ErrorState retry={() => candidates.refetch()} /> : !visible.length ? <MatchSearchState needId={needId} totalMatches={candidates.data?.length || 0} filteredCount={visible.length} resetFilters={clearFilters} /> : <>
        <div className="compare-bar"><div><Users size={18} /><span>{compareIds.length ? `Выбрано ${compareIds.length} из 2 для сравнения` : 'Отметьте два профиля для сравнения'}</span></div><button className="button secondary" disabled={comparison.length !== 2} onClick={() => setComparisonOpen(true)} data-testid="button-compare-candidates">Сравнить {comparison.length ? `(${comparison.length})` : ''}</button></div>
        <div className="match-workbench"><div className="candidate-list">{visible.map(c => <article key={c.candidateId} className={`candidate-choice ${candidate?.candidateId === c.candidateId ? 'chosen' : ''}`}><button className={`candidate-row ${candidate?.candidateId === c.candidateId ? 'chosen' : ''}`} onClick={() => setSelectedId(c.candidateId)} aria-pressed={candidate?.candidateId === c.candidateId} data-testid={`button-select-candidate-${c.candidateId}`}><div className="candidate-avatar">{c.alias[0]}</div><div className="candidate-row-main"><div className="candidate-name">{c.alias}<span className="mono fit-score">{c.score}<small>/100</small></span></div><div className="candidate-specialty">{c.specialization} · {c.verifiedGrade || 'Не подтверждено'}</div>{c.ranking && <small className="muted">{c.ranking.qualityStatus === 'measured' ? `Проверка: ${c.ranking.qualityScore} / 100` : 'Подробный протокол не сохранён'}</small>}<div className="candidate-reasons">{c.strengths.slice(0, 2).map((item, i) => <span key={`${item}-${i}`}><Check size={12} />{item}</span>)}</div>{c.fspBonus > 0 && <span className="fsp-rank-bonus">Есть история соревнований</span>}</div><ArrowRight size={16} /></button><label className="compare-check"><input type="checkbox" checked={compareIds.includes(c.candidateId)} disabled={!compareIds.includes(c.candidateId) && compareIds.length >= 2} onChange={() => toggleCompare(c.candidateId)} aria-label={`Сравнить: ${c.alias}`} /><span>В сравнение</span></label></article>)}</div>
        {candidate && <aside className="panel candidate-detail" aria-label={`Профиль ${candidate.alias}`}><div className="detail-head"><div className="candidate-avatar big">{candidate.alias[0]}</div><div><span className="eyebrow">ПАСПОРТ НАВЫКОВ</span><h2>{candidate.alias}</h2><span>{candidate.specialization} · {candidate.verifiedGrade}</span></div></div>{(candidate.availableResumes?.length ?? 0)>1 && <label className="field"><span>Резюме для подбора и приглашения</span><select className="input" value={candidate.resumeId} aria-label="Резюме кандидата для подбора" onChange={event=>{setResumeChoices(old=>({...old,[candidate.candidateId]:Number(event.target.value)}));setDraftCandidate(null);}}>{candidate.availableResumes!.map(resume=><option value={resume.resumeId} key={resume.resumeId}>{resume.title} · {resume.verifiedGrade ?? 'Грейд не подтверждён'}</option>)}</select></label>}<small className="muted">{candidate.title} · версия резюме {candidate.resumeRevision}</small><div className="fit-meter"><div className="fit-score-large mono">{candidate.score}<span>/100</span></div><div><b>Соответствие требованиям</b><small>По навыкам, уровню и условиям</small></div></div><div className="detail-section"><h3>Сильные стороны</h3>{candidate.strengths.map((item, i) => <div className="detail-evidence positive" key={`${item}-${i}`}><Check size={14} />{item}</div>)}</div><div className="detail-section"><h3>Что стоит обсудить</h3>{candidate.gaps.length ? candidate.gaps.map((item, i) => <div className="detail-evidence caution" key={`${item}-${i}`}><CircleHelp size={14} />{item}</div>) : <p className="muted">По текущему запросу пробелы не отмечены.</p>}</div><div className="detail-section"><h3>Заявленный стек</h3><div className="chip-row">{candidate.stack.map(skill => <span className="skill-chip" key={skill}>{skill}</span>)}</div></div>
        {explanation.isLoading ? <p role="status">Загружаем доказательства…</p> : explanation.isError ? <button className="button secondary" onClick={() => explanation.refetch()}>Повторить загрузку доказательств</button> : explanation.data && <EvidenceMap explanation={explanation.data} />}
        {candidate.resumeId != null && <MicroEvidenceSummary candidateId={candidate.candidateId} resumeId={candidate.resumeId} />}<div className="contact-hidden"><LockKeyhole size={16} /><span>Контакты открываются только после согласия кандидата.</span></div><button className="button primary full" onClick={() => { create.reset(); invitationIntent.current = crypto.randomUUID(); setDraftCandidate(candidate); }} data-testid={`button-invite-${candidate.candidateId}`}>Подготовить приглашение <Send size={15} /></button></aside>}</div></>}
    </>}
    {comparisonOpen && comparison.length === 2 && <CandidateComparison candidates={comparison} needId={needId} onClose={() => setComparisonOpen(false)} />}
    {draftCandidate && currentNeed && <Dialog title={`Приглашение для ${draftCandidate.alias}`} onClose={() => { if (!create.isPending) setDraftCandidate(null); }}><span className="eyebrow">ПЕРЕД ОТПРАВКОЙ</span><h2>Приглашение для {draftCandidate.alias}</h2><p>{currentNeed.workFormat} · персональное предложение по резюме «{draftCandidate.title}»</p><div className="offer-summary"><b>{currentNeed.title}</b><span className="mono">{currentNeed.salaryMin.toLocaleString('ru-RU')}–{currentNeed.salaryMax.toLocaleString('ru-RU')} ₽ / {currentNeed.salaryPeriod === 'month' ? 'месяц' : 'год'} · {currentNeed.salaryType === 'gross' ? 'до вычета' : 'на руки'}</span><span>Кандидат увидит профиль и контакт вашей компании до решения.</span></div><form className="modal-form" onSubmit={sendInvite}><Field label="Тема"><Input name="title" defaultValue={`Приглашение: ${currentNeed.title}`} required minLength={3} data-testid="input-invite-title" /></Field><Field label="Сообщение кандидату"><Textarea name="message" required minLength={10} rows={3} defaultValue={`Здравствуйте! Мы заинтересовались вашим профилем и хотели бы обсудить роль ${currentNeed.title}.`} data-testid="input-invite-message" /></Field><Field label="Почему мы заинтересованы"><Textarea name="reason" required minLength={10} rows={3} defaultValue={`Ваши подтверждённые навыки ${draftCandidate.strengths.slice(0, 3).join(', ')} соответствуют задачам нашей роли.`} data-testid="input-invite-reason" /></Field>{create.isError && <p className="form-error" role="alert">{sendConstraint?.error ?? (create.error instanceof Error ? create.error.message : 'Не удалось отправить приглашение.')}{sendConstraint?.retryAt && <><br/>Следующая отправка: {new Date(sendConstraint.retryAt).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'})} МСК.</>}</p>}<button className="button primary full" type="submit" disabled={create.isPending} data-testid="button-send-invitation">{create.isPending ? 'Отправляем…' : 'Отправить приглашение'} <Send size={15} /></button></form></Dialog>}
  </>;
}

function EmployerInvitations() {
  const query = useListEmployerInvitations(); const withdraw = useWithdrawInvitation(); const qc = useQueryClient();
  if (query.isLoading) return <LoadingState label="Загружаем статусы приглашений" />;
  if (query.isError) return <ErrorState retry={() => query.refetch()} />;
  const invitations = query.data || [];
  const retract = (id: number) => withdraw.mutate({ id }, { onSuccess: () => qc.invalidateQueries({ queryKey: getListEmployerInvitationsQueryKey() }) });
  return <><PageTitle eyebrow="ДИАЛОГИ" title="Исходящие приглашения" intro="Отслеживайте решения кандидатов. Контакты раскрываются только после принятия предложения." />
    {!invitations.length ? <EmptyState title="Вы ещё не отправляли приглашений" body="Откройте подбор, сравните навыки и опыт и подготовьте персональное предложение." action={<Link className="button primary" href="/employer/matches" data-testid="link-empty-matches">К подбору <ArrowRight size={15} /></Link>} /> : <div className="invitation-list">{invitations.map(i => <div key={i.id}><InvitationCard invitation={i} candidate={false} /><div className="outgoing-controls">{i.status === 'accepted' && i.contactShared && <EmployerContact id={i.id} />}{i.status === 'accepted' && !i.contactShared && <div className="contact-release"><LockKeyhole size={16} /><span>Кандидат отозвал доступ к контактам.</span></div>} {(i.status === 'sent' || i.status === 'viewed') && <button className="button text-button" disabled={withdraw.isPending} onClick={() => retract(i.id)} data-testid={`button-withdraw-${i.id}`}>Отозвать приглашение</button>}</div></div>)}</div>}
  </>;
}
function EmployerContact({ id }: { id: number }) {
  const contacts = useGetInvitationContacts(id, { query: { queryKey: ['/api/employer/invitations', id, 'contacts'] } });
  useEffect(() => { if (contacts.data?.email) celebrate(`employer-contact-${id}`, 'Контакты открыты', 'Кандидат принял приглашение и разрешил связаться с ним.', 'contact'); }, [contacts.data, id]);
  return <div className="contact-release"><UnlockMark /><div><b>Согласие получено</b>{contacts.isLoading ? <span>Загружаем контакты…</span> : contacts.isError ? <span>Контакты недоступны: нет разрешённого доступа или возникла ошибка.</span> : <span>{contacts.data?.displayName} · {contacts.data?.email}{contacts.data?.phone ? ` · ${contacts.data.phone}` : ''}</span>}</div></div>;
}

function SettingsPage({ theme }: { theme: ReturnType<typeof useThemePreference> }) {
  const { motion, speed, effective, systemReduced, choose: setMotionPreference, setSpeed } = useMotionPreference();
  const query = useGetCurrentUser();
  const researchAccess = useQuery({queryKey:['research-access'],queryFn:()=>api<{operator:boolean;candidate:boolean}>('/api/research/access'),enabled:!!query.data?.user&&!query.data.user.demoMode});
  return <><PageTitle eyebrow="ПЕРСОНАЛЬНЫЕ НАСТРОЙКИ" title="Настройки" intro="Оформление и параметры вашего аккаунта." />
    <section className="panel settings-panel"><div className="settings-icon"><Sun size={20} /></div><div className="settings-content"><h2>Оформление</h2><p>Выберите тему интерфейса. Системная тема переключается автоматически при изменении настроек устройства.</p><ThemePicker theme={theme} /></div></section>
    <section className="panel settings-panel"><div className="settings-icon"><Sparkles size={20} /></div><div className="settings-content"><h2>Анимации</h2><p>Выберите характер движения и его скорость. Настройка действует на этом устройстве.</p><div className="motion-options">{([['system', 'По системе'], ['reduced', 'Уменьшенные'], ['off', 'Выключены']] as const).map(([key, label]) => <button key={key} className={`motion-option ${motion === key ? 'selected' : ''}`} aria-pressed={motion === key} onClick={() => setMotionPreference(key)} data-testid={`motion-${key}`}>{label}</button>)}</div><div className="motion-speed-control"><div className="motion-speed-heading"><label htmlFor="motion-speed">Скорость анимаций</label><output htmlFor="motion-speed" aria-live="polite">{speed === 0 ? 'Выключены' : `${speed.toLocaleString('ru-RU')}×`}</output></div><input id="motion-speed" type="range" min="0" max="5" step="0.25" value={speed} onChange={event => setSpeed(Number(event.target.value))} aria-valuetext={speed === 0 ? 'Выключены' : `${speed} от нормальной скорости`} aria-describedby="motion-speed-description" /><div className="motion-speed-scale"><span>0 — без движения</span><button type="button" className="text-link" onClick={() => setSpeed(1)}>Вернуть 1×</button><span>5×</span></div><p id="motion-speed-description" role="status">{effective === 'off' ? 'Движение выключено. Все действия и сообщения доступны.' : effective === 'reduced' ? systemReduced ? 'Система просит уменьшить движение: декоративные циклы выключены.' : 'Уменьшенное движение: декоративные циклы выключены.' : 'Скорость применяется к оформлению. Таймеры экзамена и сроки сообщений идут в реальном времени.'}</p></div></div></section>
    <section className="panel settings-panel"><div className="settings-icon"><UserRound size={20} /></div><div className="settings-content"><h2>Аккаунт</h2><div className="settings-data"><span>Имя</span><b>{query.data?.user.displayName || '—'}</b><span>Роль</span><b>{query.data?.user.role === 'employer' ? 'Работодатель' : 'Кандидат'}</b><span>Тип аккаунта</span><b data-testid="text-session-state">{query.data?.user.reviewMode ? 'Самостоятельная проверка — вымышленные данные' : query.data?.user.demoMode ? 'Demo — вымышленные данные' : 'Личный аккаунт'}</b></div><Link href="/about" className="text-link">О сервисе <ArrowRight size={15} /></Link></div></section>
    {(researchAccess.data?.operator || researchAccess.data?.candidate) && <section className="panel settings-panel"><div className="settings-icon"><Target size={20}/></div><div className="settings-content"><h2>Исследование проверки навыков</h2><p>Добровольное сравнение двух форм по отдельному приглашению. Рабочая категория не меняется.</p><Link href="/research" className="text-link">{researchAccess.data.operator ? 'Панель исследования' : 'Об участии'} <ArrowRight size={15}/></Link></div></section>}
  </>;
}

function RouteContent({ theme }: { theme: ReturnType<typeof useThemePreference> }) {
  const [location] = useLocation();
  const session = useGetCurrentUser({ query: { retry: false, queryKey: getGetCurrentUserQueryKey(), enabled: location !== '/' && location !== '/auth' && location !== '/about' } });
  const isHome = location === '/';
  if (isHome || location === '/auth') return <PublicEntry themeSlot={<ThemeMenu theme={theme}/>} navigationSlot={<AppBackButton/>} brandSlot={<Brand/>} openAuth={location === '/auth'} initialRole={new URLSearchParams(window.location.search).get('role') === 'employer' ? 'employer' : 'candidate'}/>;
  if (location === '/about') return <AboutPage theme={theme} />;
  if (location === '/jobs') return <div className="landing"><PublicHeader theme={theme} /><main className="service-info"><CandidateJobsPage publicOnly /></main></div>;
  if (location === '/quality') return <div className="landing"><PublicHeader theme={theme} /><main className="service-info"><Link className="back-link" href="/about"><ArrowLeft size={15} /> О сервисе</Link><QualityPage /></main></div>;
  if (location !== '/quality' && session.isLoading) return <div className="landing"><PublicHeader theme={theme} /><LoadingState label="Проверяем сессию" /></div>;
  if (location !== '/quality' && !session.data?.user) return <main className="auth-required"><div className="auth-required-header"><PublicHeader theme={theme} /></div><EmptyState title="Войдите, чтобы продолжить" body="Паспорт и рабочее пространство доступны после входа в аккаунт." action={<Link className="button primary" href="/auth">Войти в Signal</Link>} /></main>;
  const expectedRole = location.startsWith('/employer') ? 'employer' : location.startsWith('/candidate') ? 'candidate' : null;
  if (expectedRole && session.data?.user.role !== expectedRole) return <Shell theme={theme}><EmptyState title="Это пространство другой роли" body="Перейдите в свой кабинет, чтобы продолжить работу." action={<Link className="button primary" href={session.data?.user.role === 'employer' ? '/employer' : '/candidate'}>В мой кабинет</Link>} /></Shell>;
  return <Shell theme={theme}><Switch>
    <Route path="/candidate" component={CandidateOverview} />
    <Route path="/candidate/passport" component={CandidatePassport} />
    <Route path="/candidate/kalibr" component={KalibrPage} />
    <Route path="/candidate/trust" component={CandidateTrustCenter} />
    <Route path="/employer/trust" component={EmployerTrustCenter} />
    <Route path="/moderation" component={ModerationCenter} />
    <Route path="/candidate/invitations" component={CandidateInvitations} />
    <Route path="/candidate/jobs">{() => <CandidateJobsPage />}</Route>
    <Route path="/candidate/microtasks" component={CandidateMicrotasksPage} />
    <Route path="/employer/jobs" component={EmployerJobsPage} />
    <Route path="/employer/microtasks" component={EmployerMicrotasksPage} />
    <Route path="/employer" component={EmployerHome} />
    <Route path="/employer/matches" component={EmployerMatches} />
    <Route path="/employer/candidates" component={CandidateBankPage} />
    <Route path="/employer/invitations" component={EmployerInvitations} />
    <Route path="/employer/company" component={CompanyPage} />
    <Route path="/quality" component={QualityPage} />
    <Route path="/settings">{() => <SettingsPage theme={theme} />}</Route>
    <Route path="/research">{() => <ResearchPage />}</Route>
    <Route path="/research/:id">{params => <ResearchPage studyId={Number(params.id)} />}</Route>
    <Route component={NotFound} />
  </Switch></Shell>;
}
function Router() {
  const theme = useThemePreference();
  const [location, navigate] = useLocation();
  const user = useGetCurrentUser({ query: { retry: false, queryKey: getGetCurrentUserQueryKey() } }).data?.user;
  useMotionPreference();
  const isPublic = location === '/' || location === '/auth' || location === '/about';
  return <ResumeSelectionProvider key={user?.id ?? "visitor"} userId={user?.role === 'candidate' ? user.id : null}><AppNavigationProvider><ErrorBoundary resetKey={location}><RouteContent theme={theme} /><SignalConsultant key={user?.id ?? 'visitor'} role={isPublic ? undefined : user?.role} location={location} onOpenAuth={() => { if (location === '/' || location === '/auth') window.dispatchEvent(new CustomEvent('signal-open-auth')); else navigate('/auth'); }} /><CelebrationHost /></ErrorBoundary></AppNavigationProvider></ResumeSelectionProvider>;
}
function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}
export default App;
