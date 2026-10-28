import { AtsIntegration } from './components/ats-integration';
import { PublicPassportPage } from './components/public-passport';
import { SharedReviewPage } from './components/shared-selection';
import { InvitationInsights } from './components/invitation-insights';
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryClient } from '@/lib/query-client';
import {
  useRegister, useVerifyEmail, useLogin, useStartDemoSession,
  useLogout, useGetCurrentUser,
  useListMyInvitations, useDecideInvitation, useRevokeInvitationContact, useListAssessmentPrograms,
  useStartAssessmentAttempt, useGetAssessmentAttempt, useSaveAssessmentAnswers,
  useSubmitAssessmentAttempt,
  useGetMatchExplanation, useListEmployerInvitations, useCreateInvitation,
  useGetInvitationContacts, useWithdrawInvitation,
  getGetCurrentUserQueryKey, getGetCandidateProfileQueryKey, getListMyInvitationsQueryKey,
  getListEmployerInvitationsQueryKey,
  getGetAssessmentAttemptQueryKey,
} from '@workspace/api-client-react';
import type {
  AuthSession, AssessmentResult, CandidateProfileInput, Invitation, MatchCandidate,
  InvitationInput, RegistrationInput,
} from '@workspace/api-client-react';
import {
  ArrowDownRight, ArrowLeft, ArrowRight, BadgeCheck, Banknote, BriefcaseBusiness, Check,
  ChevronDown, CircleHelp, Clock3, Eye, FileBadge, FileCheck2, Fingerprint, Gauge,
  Handshake, LockKeyhole, LogOut, Mail, Menu, Moon, Monitor, Search, Send, ShieldCheck,
  SlidersHorizontal, Sparkles, Sun, Target, UserRound, Users, X,
} from 'lucide-react';
import { CandidateTrustCenter, EmployerTrustCenter, ModerationCenter, CompanyTrustActions } from '@/components/trust-center';
import { ResumeSelectionProvider, CandidateAvatar, useResumeSelection, useSelectedCandidateProfile, resumeHref, resumeRequest, ResumeRequestError, type SelectedProfile } from '@/components/multi-resume';
import { editableCandidateProfile, reconcileProfileDraft, profileFieldLabels, profileDraftValue, type CandidateProfileDraft } from '@/lib/candidate-profile-draft';
import { SkillMatrixPage, SkillPassportPage } from '@/components/skill-workspace';
import { qualificationGradeLabel } from '@/lib/qualification-presentation';
import { AccountSettings } from '@/components/account-settings';
import { InlineInfo } from '@/components/inline-info';
import { SkillChips, employerSkillChips } from '@/components/skill-chip';
import { MyResumesPage, ResumeDocumentButton, ResumeSaveRegistration, useResumeSaveBusy } from '@/components/my-resumes';
import { CandidateInvitationsPage } from '@/components/candidate-invitations';
import { InvitationCompanyCard, InvitationContextLabel, InvitationResponse, type InvitationCompanyView, type InvitationContextView } from '@/components/invitation-context';
import { CandidateWorkspaceOverview } from '@/components/workspace-overview';
import { clearWorkspaceDrafts, readWorkspaceDraft, writeWorkspaceDraft, workspaceDraftKey } from '@/lib/workspace-drafts';
import { CandidateResumeSection } from '@/components/candidate-resume';
import { CandidateJobsPage, EmployerJobsPage, EmployerApplicationsPage } from '@/components/public-jobs';
import { CandidateMicrotasksPage, EmployerMicrotasksPage } from '@/components/microtasks';
import { FormField } from '@/components/form-field';
import { DictionaryCombobox, DictionaryTags, useSkillDictionary } from '@/components/dictionary-input';
import { ROLE_OPTIONS, WORK_FORMAT_OPTIONS } from '@/lib/professional-dictionaries';
import { CandidateEvidenceRegistry, type EvidenceRegistryCatalog } from '@/components/candidate-evidence-registry';
import { MicroEvidenceSummary } from '@/components/micro-evidence-summary';
import { ResearchPage } from '@/components/research';
import { EmployerSelectionPage } from '@/components/employer-selection';
import { employerSectionPath, employerSectionTitle } from '@/lib/employer-workspace-navigation';
import { PublicEntry } from '@/components/public-entry';
import { SignalBrand } from '@/components/signal-brand';
import { EnvironmentIndicator } from '@/components/environment-indicator';
import { AppBackButton, AppHistoryButtons, AppNavigationProvider } from '@/components/app-navigation';
import './components/workspace-chrome.css';
import './components/recording-refinements.css';
import { FspBrandAttribution } from '@/components/fsp-brand-attribution';
import { AssessmentContextSelector, AssessmentContextSummary, type AssessmentContextSelection } from '@/components/assessment-context';
import { CandidateActions } from '@/components/workspace-guide';
import { SignalConsultant } from '@/components/signal-consultant';
import { ErrorBoundary } from '@/components/error-boundary';
import { currentAuthUser, expireRejectedAuthQuery, replaceAuthQueryCache } from '@/lib/auth-query-cache';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { api, CasePrompt, AssessmentHistory, CandidateComparison, CelebrationHost, CompanyPage, Dialog, EvidenceMap, PassportEvidence, QualityPage, celebrate, dismissCelebration, useClock, useMotionPreference } from '@/components/product-enhancements';
import { Link, Route, Switch, Router as WouterRouter, useLocation, useRoute, useSearch } from 'wouter';

import { normalizeThemePreference, resolveTheme, themeLabels, themeScheme, type ThemePreference } from '@/lib/theme-preference';
type MotionPreference = 'system' | 'reduced' | 'off';

function sectionAccent(path: string) {
  if (path === '/settings' || path === '/about' || path.includes('/trust') || path === '/moderation') return 'tools';
  if (path.includes('/microtasks')) return 'practice';
  if (path.includes('/kalibr') || path === '/research' || path === '/quality') return 'skills';
  return path.startsWith('/employer') ? 'employer' : 'profile';
}

function useThemePreference() {
  const [preference, setPreference] = useState<ThemePreference>(() => {
    try { return normalizeThemePreference(localStorage.getItem('fsp-theme')); } catch { return 'system'; }
  });
  const [systemDark, setSystemDark] = useState(() => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const listener = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    mq.addEventListener('change', listener);
    return () => mq.removeEventListener('change', listener);
  }, []);
  useEffect(() => {
    const listener = (event: StorageEvent) => { if (event.key === 'fsp-theme' || event.key === null) setPreference(normalizeThemePreference(event.newValue)); };
    window.addEventListener('storage', listener);
    return () => window.removeEventListener('storage', listener);
  }, []);
  const resolved = resolveTheme(preference,systemDark); const scheme = themeScheme(resolved);
  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
    document.documentElement.dataset.themePreference = preference;
    document.documentElement.classList.toggle('dark', scheme === 'dark');
    document.documentElement.style.colorScheme = scheme;
    try { localStorage.setItem('fsp-theme',preference); } catch {}
  }, [resolved,scheme,preference]);
  const choose = (value: ThemePreference) => {
    setPreference(value);
    try { localStorage.setItem('fsp-theme', value); } catch { /* session still works */ }
  };
  return { preference, resolved, scheme, choose };
}

function Brand({ href = '/', dark = false }: { href?: string; dark?: boolean }) {
  return <SignalBrand href={href} dark={dark} />;
}

function ThemePicker({ theme, onChoose }: { theme: ReturnType<typeof useThemePreference>; onChoose?: () => void }) {
  const choices: { id: ThemePreference; label: string; Icon: typeof Sun }[] = [
    { id:'pearl',label:themeLabels.pearl,Icon:Sun },{ id:'cashmere',label:themeLabels.cashmere,Icon:Sun },{ id:'graphite',label:themeLabels.graphite,Icon:Moon },{ id:'midnight',label:themeLabels.midnight,Icon:Moon },{ id:'system',label:themeLabels.system,Icon:Monitor },
  ];
  return <div className="theme-picker" role="group" aria-label="Цветовая тема">
    {choices.map(({ id, label, Icon }) => <button key={id} type="button" onClick={() => { theme.choose(id); onChoose?.(); }} className={`theme-choice ${theme.preference === id ? 'selected' : ''}`} aria-pressed={theme.preference === id} data-palette={id} data-testid={`theme-${id}`}>
      <span className="theme-choice__swatch" aria-hidden="true">{id==='system'&&<Icon size={17}/>}</span><span>{label}</span>{theme.preference === id && <Check size={15} aria-hidden="true" />}
    </button>)}
    <small className="theme-current" data-testid="text-current-theme">{theme.preference==='system'?'По системе':'Сейчас'}: {themeLabels[theme.resolved]}</small>
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
  const ThemeIcon = theme.preference === 'system' ? Monitor : theme.scheme === 'dark' ? Moon : Sun;
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
    ['/candidate', 'Обзор', Gauge], ['/candidate/resumes', 'Мои резюме', FileCheck2], ['/candidate/passport', 'Паспорт навыков', FileBadge],
    ['/candidate/kalibr', 'Проверка навыков', Target], ['/candidate/invitations', 'Приглашения', Mail],
    ['/candidate/jobs', 'Вакансии и отклики', BriefcaseBusiness], ['/candidate/microtasks', 'Практика', Sparkles], ['/candidate/trust', 'Обращения и доступ', ShieldCheck],
  ] as const;
  const employerNav = [
    ['/employer/jobs', 'Мои вакансии', BriefcaseBusiness], ['/employer/selection', 'Подбор специалистов', Search],
    ['/employer/applications', 'Отклики', Mail], ['/employer/microtasks', 'Задания кандидатам', Sparkles],
    ['/employer/invitations', 'Приглашения', Send], ['/employer/trust', 'Обращения и ограничения', ShieldCheck],
  ] as const;
  const nav = role === 'employer' ? employerNav : candidateNav;
  const activePath = role === 'employer' ? employerSectionPath(location) : location;
  useEffect(() => { const title = role === 'employer' ? employerSectionTitle(location) : candidateNav.find(([path]) => path === location)?.[1]; document.title = title ? `${title} · Signal` : 'Signal'; }, [location, role]);
  const trustAccess = useQuery({ queryKey: ['trust', 'access', user?.id], queryFn: () => resumeRequest<{moderator:boolean}>('/me/trust-status'), enabled: !!user });
  const roleName = role === 'employer' ? 'Работодатель' : 'Кандидат';
  const ownCompany = useQuery({queryKey:['employer-company',user?.id],queryFn:()=>resumeRequest<{company:{id:number;name:string}|null}>('/employer/company'),enabled:user?.role==='employer',staleTime:0,gcTime:0,retry:false});
  const companyName = user?.role==='employer'&&!ownCompany.isError?ownCompany.data?.company?.name:undefined;
  return <div className="app-shell"><a className="skip-link" href="#main-content">Перейти к содержимому</a>
    <header className="topbar">
      <button ref={menuRef} className="icon-button mobile-menu" aria-label={mobileOpen ? "Закрыть меню" : "Открыть меню"} aria-expanded={mobileOpen} aria-controls="workspace-sidebar" onClick={() => setMobileOpen(!mobileOpen)} data-testid="button-mobile-menu">{mobileOpen ? <X /> : <Menu />}</button>
      <div className="header-brand-group"><Brand href={role === 'employer' ? '/employer' : role === 'candidate' ? '/candidate' : '/'} /></div>
      <span className="topbar-divider" />
      <span className="topbar-context" title={companyName?`${roleName} · ${companyName}`:user?.role==='candidate'?`${roleName} · ${user.displayName}`:roleName}><span className="topbar-role-label">{roleName}{companyName&&<> · <span className="topbar-company">{companyName}</span></>}{user?.role==='candidate'&&<span className="topbar-own-name"> · {user.displayName}</span>}</span></span>
      <div className="topbar-right">
        {user && <EnvironmentIndicator isDemo={user.demoMode} isReview={user.reviewMode} />}
        <ThemeMenu theme={theme} />
        {user && <><Link href="/settings" className="account-chip" aria-label={`Настройки аккаунта: ${user.displayName}`}><span className="account-avatar">{user.displayName.slice(0, 1).toUpperCase()}</span><span className="account-name">{user.displayName}</span></Link><button className="icon-button" aria-label="Выйти из аккаунта" title="Выйти" onClick={() => { logout.mutate(undefined, { onSuccess: async () => { clearWorkspaceDrafts(); await replaceAuthQueryCache(qc, getGetCurrentUserQueryKey(), null); setLocation('/'); } }); }} data-testid="button-logout"><LogOut size={17} /></button></>}
      </div>
    </header>
    <div className="workspace">
      <aside ref={sidebarRef} id="workspace-sidebar" inert={smallScreen && !mobileOpen ? true : undefined} aria-hidden={smallScreen && !mobileOpen ? true : undefined} className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`}>
        <div className="side-label">РАБОЧЕЕ ПРОСТРАНСТВО</div>
        <nav aria-label="Основная навигация">{nav.map(([href, label, Icon]) => <Link key={href} href={href} onClick={() => setMobileOpen(false)} className={`nav-link ${activePath === href ? 'active' : ''}`} aria-current={activePath === href ? 'page' : undefined} data-accent={sectionAccent(href)} data-testid={`nav-${href.split('/').filter(Boolean).join('-') || 'home'}`}><Icon size={19} aria-hidden="true" /><span>{label}</span></Link>)}</nav>
        <div className="sidebar-bottom">{trustAccess.data?.moderator && <Link className="nav-link" href="/moderation"><ShieldCheck size={18}/><span>Модерация</span></Link>}
          <Link className={`nav-link settings-link${location === '/settings' ? ' active' : ''}`} aria-current={location === '/settings' ? 'page' : undefined} data-accent="tools" href="/settings" onClick={() => setMobileOpen(false)} data-testid="nav-settings"><SlidersHorizontal size={18} aria-hidden="true" /><span>Настройки</span></Link>
          <Link className="nav-link" data-accent="tools" href="/about" onClick={() => setMobileOpen(false)}><CircleHelp size={18} aria-hidden="true" /><span>О сервисе</span></Link>
        </div>
      </aside>
      {mobileOpen && <button className="scrim" aria-label="Закрыть меню" onClick={() => setMobileOpen(false)} data-testid="button-close-menu" />}
      <main className="main-area" data-accent={sectionAccent(location)} id="main-content" tabIndex={-1} inert={smallScreen && mobileOpen ? true : undefined}><div className="page-wrap page-enter"><div className="app-back-row workspace-back-row"><AppHistoryButtons fallback={location === '/settings' ? role === 'employer' ? '/employer' : '/candidate' : undefined} /></div>{children}</div></main>
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
  return <div className="empty-state" data-accent="tools" data-testid="state-empty"><div className="empty-mark"><FileBadge size={25} aria-hidden="true" /></div><h3>{title}</h3><p>{body}</p>{action}</div>;
}
function PageTitle({ eyebrow, title, intro, help, action }: { eyebrow?: string; title: string; intro?: string; help?: string; action?: ReactNode }) {
  return <div className="page-title"><div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h1>{title}{help && <InlineInfo label={`О разделе «${title}»`}>{help}</InlineInfo>}</h1>{intro && <p>{intro}</p>}</div>{action && <div className="title-action">{action}</div>}</div>;
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
  return <div className="landing"><PublicHeader theme={theme}/><main className="service-info"><PageTitle title="Как работает Signal" intro="Выбирайте работу и специалистов по задачам, навыкам и условиям."/><FspBrandAttribution/>
    <div className="about-role-grid"><section className="panel"><h2>Кандидату</h2><ol><li>Создайте резюме: опыт, навыки и ожидания от работы.</li><li>При желании подтвердите навыки проверками Signal. Результаты останутся в вашем паспорте.</li><li>Выбирайте опубликованные вакансии и отправляйте отклики подходящим резюме.</li><li>Изучайте приглашения с условиями. Вы решаете, кому открыть контакты.</li></ol></section>
    <section className="panel"><h2>Работодателю</h2><ol><li>Заполните данные компании и опишите вакансию или приватный запрос.</li><li>Укажите нужные навыки и уровень: достаточно заявления или требуется подтверждение.</li><li>Подберите специалистов, сохраните их в отбор конкретной вакансии или запроса и сравните.</li><li>Пригласите кандидата на собеседование. При необходимости предложите задание по вакансии.</li></ol></section></div>
    <section className="panel"><h2>Что подтверждает Signal</h2><p>Подтверждение отдельного навыка и общий грейд — разные результаты. Общий грейд подтверждается по обязательным требованиям программы; заявленный уровень остаётся отдельной отметкой.</p><p>ФСП ID можно сохранить в профиле. Подключение к реестру и проверка спортивных результатов пока недоступны.</p><Link href="/quality" className="text-link">Методика проверки <ArrowRight size={15}/></Link></section>
    <p>Для знакомства с сервисом откройте «Вход» и включите Demo. В нём используются вымышленные данные.</p></main></div>;
}

function CandidatePassport() {
  return <SkillPassportPage/>;
}
function CandidateSkillChecks() {
  const search = useSearch();
  return new URLSearchParams(search).has('attempt') ? <KalibrPage/> : <SkillMatrixPage/>;
}
export function CandidateResumeEditor({ resumeId }: { resumeId?: number }) {
  const query = useSelectedCandidateProfile(resumeId); const qc = useQueryClient();
  const profileFormRef = useRef<HTMLFormElement>(null); const globalBusy = useResumeSaveBusy();
  const baseSelection = useResumeSelection();
  const selection = { ...baseSelection, resumeId: resumeId ?? baseSelection.resumeId };
  const draftKey = workspaceDraftKey(selection.userId, selection.resumeId, 'profile');
  const cached = useMemo(() => readWorkspaceDraft<{ draft: CandidateProfileDraft; baseline: CandidateProfileDraft | null; revision: number | null; identityRevision: string | null; stackText: string; skillsText: string }>(draftKey), [draftKey]);
  const [draftRevision, setDraftRevision] = useState<number | null>(cached?.revision ?? null);
  const [draftIdentityRevision, setDraftIdentityRevision] = useState<string | null>(cached?.identityRevision ?? null);
  const serverProfile = useRef<CandidateProfileDraft | null>(cached?.baseline ?? null);
  const save = useMutation({ mutationFn: async ({ data, latest = false }: { data: CandidateProfileDraft; latest?: boolean }) => {
    let revision = draftRevision; let identityRevision = draftIdentityRevision;
    if (latest) {
      const current = await resumeRequest<SelectedProfile>(`/me/candidate-profile?resumeId=${selection.resumeId}`);
      if (JSON.stringify(editableCandidateProfile(current)) !== JSON.stringify(serverProfile.current)) throw new ResumeRequestError('Профиль изменился в другой вкладке. Ваши правки остались в форме; обновите данные перед сохранением.', 409);
      revision = current.revision; identityRevision = current.identityRevision;
    }
    return resumeRequest<SelectedProfile>('/me/candidate-profile', { method: 'PUT', body: JSON.stringify({ ...data, resumeId: selection.resumeId, revision, identityRevision }) });
  }, onSuccess: () => { qc.invalidateQueries({ queryKey: ['candidate-resumes'] }); qc.invalidateQueries({ queryKey: ['candidate-evidence-registry'] }); qc.invalidateQueries({ queryKey: ['candidate-resume'] }); qc.invalidateQueries({ queryKey: ['selected-candidate-profile'] }); qc.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() }); } });
  const [draft, setDraft] = useState<CandidateProfileDraft | null>(cached?.draft ?? null);
  const [stackText, setStackText] = useState(cached?.stackText ?? '');
  const [skillsText, setSkillsText] = useState(cached?.skillsText ?? '');
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState('');
  const [draftNotice, setDraftNotice] = useState('');
  const [overlap, setOverlap] = useState<{ current: CandidateProfileDraft; fields: (keyof CandidateProfileDraft)[] } | null>(null);
  const skillDictionary = useSkillDictionary();
  const [, navigate] = useLocation();
  const registry = useQuery({ queryKey: ['candidate-evidence-registry', selection.userId], enabled: !!selection.userId, queryFn: () => api<EvidenceRegistryCatalog>('/api/me/evidence/registry') });
  useEffect(() => {
    if (!query.data) return;
    const profile = editableCandidateProfile(query.data);
    if (!draft) { serverProfile.current = profile; setDraftRevision(query.data.revision); setDraftIdentityRevision(query.data.identityRevision); setStackText(profile.stack.join(', ')); setSkillsText(profile.skills.join(', ')); setDraft(profile); }
    else if (JSON.stringify(profile) === JSON.stringify(serverProfile.current)) { setDraftRevision(query.data.revision); setDraftIdentityRevision(query.data.identityRevision); }
  }, [query.data, draft]);
  useEffect(() => {
    if (draft) writeWorkspaceDraft(draftKey, { draft, baseline: serverProfile.current, revision: draftRevision, identityRevision: draftIdentityRevision, stackText, skillsText });
  }, [draftKey, draft, draftRevision, draftIdentityRevision, stackText, skillsText]);
  if (query.isLoading || !draft) return query.isError ? <ErrorState retry={() => query.refetch()} /> : <LoadingState />;
  const set = <K extends keyof NonNullable<typeof draft>>(key: K, value: NonNullable<typeof draft>[K]) => setDraft(old => old ? { ...old, [key]: value } : old);
  const split = (value: string) => value.split(',').map(x => x.trim()).filter(Boolean);
  const conflict = save.isError && save.error instanceof ResumeRequestError && save.error.status === 409;
  const busy = save.isPending || refreshing;
  const refreshDraft = async () => {
    setRefreshing(true); setRefreshError('');
    try {
      const result = await query.refetch();
      if (result.error || !result.data) throw result.error ?? new Error('Не удалось обновить профиль.');
      const current = editableCandidateProfile(result.data);
      const local = { ...draft, stack: split(stackText), skills: split(skillsText) };
      const merged = reconcileProfileDraft(serverProfile.current ?? local, local, current);
      serverProfile.current = current;
      setDraft(merged.draft); setStackText(merged.draft.stack.join(', ')); setSkillsText(merged.draft.skills.join(', '));
      setDraftRevision(result.data.revision); setDraftIdentityRevision(result.data.identityRevision);
      setOverlap(merged.overlappingFields.length ? { current, fields: merged.overlappingFields } : null);
      setDraftNotice('Данные обновлены. Ваши правки сохранены в форме. Проверьте их и нажмите «Сохранить резюме».');
      save.reset();
    } catch (error) { setRefreshError(error instanceof Error ? error.message : 'Не удалось обновить профиль. Повторите попытку.'); }
    finally { setRefreshing(false); }
  };
  const useCurrent = (key: keyof CandidateProfileDraft) => {
    if (!overlap) return;
    setDraft(old => old ? { ...old, [key]: overlap.current[key] } : old);
    if (key === 'stack') setStackText(overlap.current.stack.join(', '));
    if (key === 'skills') setSkillsText(overlap.current.skills.join(', '));
    const fields = overlap.fields.filter(field => field !== key);
    setOverlap(fields.length ? { ...overlap, fields } : null);
  };
  const profileDirty = JSON.stringify({ ...draft, stack: split(stackText), skills: split(skillsText) }) !== JSON.stringify(serverProfile.current);
  const saveProfile = async (latest = false) => {
    if (busy || conflict) return false;
    setDraftNotice(''); setRefreshError('');
    try {
      const value = await save.mutateAsync({ data: { ...draft, stack: split(stackText), skills: split(skillsText) }, latest });
      const profile = editableCandidateProfile(value); serverProfile.current = profile; setDraft(profile); setStackText(profile.stack.join(', ')); setSkillsText(profile.skills.join(', ')); setDraftRevision(value.revision); setDraftIdentityRevision(value.identityRevision); setOverlap(null); qc.setQueryData(['selected-candidate-profile', selection.userId, selection.resumeId], value);
      return true;
    } catch { return false; }
  };
  const submit = (e: FormEvent) => { e.preventDefault(); if (!globalBusy) void saveProfile(); };
  return <><PageTitle title="Редактирование резюме" />
    <ResumeSaveRegistration id="profile" section={{order:20,dirty:profileDirty,pending:busy,blocked:conflict,validate:()=>profileFormRef.current?.reportValidity()??false,save:()=>saveProfile(true),focus:()=>profileFormRef.current?.scrollIntoView({block:'center'})}}/>
    <form ref={profileFormRef} className="form-layout" onSubmit={submit}>
      <fieldset className="profile-edit-fields" disabled={busy || globalBusy} aria-label="Данные профиля">
      <section className="panel form-panel" data-accent="profile"><div className="panel-heading"><div><span className="eyebrow">О СЕБЕ</span><h2>Профессиональный профиль</h2></div><span className="themed-icon"><UserRound size={20} aria-hidden="true" /></span></div>
        <CandidateAvatar profile={query.data!} onSaved={() => qc.invalidateQueries({ queryKey: ['selected-candidate-profile'] })}/>
        <Field label="Название этого резюме"><DictionaryCombobox required minLength={2} maxLength={120} options={ROLE_OPTIONS} value={draft.title} onChange={value => set('title', value)}/></Field>
        <div className="form-grid"><Field label="Имя для профиля"><Input value={draft.displayName} onChange={e => set('displayName', e.target.value)} required data-testid="input-profile-name" /></Field><Field label="Псевдоним"><Input value={draft.professionalAlias} onChange={e => set('professionalAlias', e.target.value)} required data-testid="input-alias" /></Field><Field label="Специализация"><select className="input" value={draft.specialization} onChange={e => set('specialization', e.target.value)} data-testid="input-specialization"><option>Backend-разработчик</option><option>Frontend-разработчик</option></select></Field><Field label="Заявленный грейд"><select className="input" value={draft.assumedGrade} onChange={e => set('assumedGrade', e.target.value as CandidateProfileInput['assumedGrade'])} data-testid="select-assumed-grade"><option>Junior</option><option>Middle</option><option>Senior</option></select></Field><Field label="Технологический стек" hint="Выбранные технологии — ваше заявление, подтверждения показаны отдельно"><DictionaryTags data-multivalue="true" options={skillDictionary.data ?? []} maxItems={30} maxLength={100} value={split(stackText)} onChange={value => setStackText(value.join(', '))} data-testid="input-stack" /></Field><Field label="Навыки, заявленные вами" hint="Подтверждение навыка показывается отдельно"><DictionaryTags data-multivalue="true" options={skillDictionary.data ?? []} maxItems={40} maxLength={100} value={split(skillsText)} onChange={value => setSkillsText(value.join(', '))} data-testid="input-skills" /></Field><Field label="Опыт, лет"><Input type="number" min="0" max="60" value={draft.yearsExperience} onChange={e => set('yearsExperience', Number(e.target.value))} data-testid="input-experience" /></Field><Field label="Формат работы"><DictionaryCombobox options={WORK_FORMAT_OPTIONS} value={draft.workFormat} onChange={value => set('workFormat', value)} maxLength={120} data-testid="input-work-format" /></Field></div>
      </section>
      <section className="panel form-panel" data-accent="tools"><div className="panel-heading"><div><span className="eyebrow">УСЛОВИЯ И ДОСТУП</span><h2>Предпочтения и видимость</h2></div><span className="themed-icon"><Eye size={20} aria-hidden="true" /></span></div>
        <div className="form-grid"><Field label="Ожидания по зарплате, от"><Input type="number" min="0" value={draft.salaryMin ?? ''} onChange={e => set('salaryMin', e.target.value ? Number(e.target.value) : null)} data-testid="input-salary-min" /></Field><Field label="До"><Input type="number" min="0" value={draft.salaryMax ?? ''} onChange={e => set('salaryMax', e.target.value ? Number(e.target.value) : null)} data-testid="input-salary-max" /></Field><Field label="Период"><select className="input" value={draft.salaryPeriod} onChange={e => set('salaryPeriod', e.target.value as CandidateProfileInput['salaryPeriod'])} data-testid="select-salary-period"><option value="month">В месяц</option><option value="year">В год</option></select></Field><Field label="Сумма"><select className="input" value={draft.salaryType} onChange={e => set('salaryType', e.target.value as CandidateProfileInput['salaryType'])} data-testid="select-salary-type"><option value="gross">До вычета налогов</option><option value="net">На руки</option></select></Field>
          <Field label="Видимость профиля"><select className="input" value={draft.visibility} onChange={e => set('visibility', e.target.value as CandidateProfileInput['visibility'])} data-testid="select-visibility"><option value="private">Скрыт</option><option value="pseudonymous">Псевдоним для работодателей</option><option value="public">Открытое имя</option></select></Field><Field label="Контактная почта"><Input type="email" value={draft.contactEmail || ''} onChange={e => set('contactEmail', e.target.value)} data-testid="input-contact-email" /></Field><Field label="Телефон"><Input type="tel" value={draft.phone || ''} onChange={e => set('phone', e.target.value)} data-testid="input-phone" /></Field></div>
        <label className="consent-row"><input type="checkbox" checked={draft.consentMatching} onChange={e => set('consentMatching', e.target.checked)} data-testid="checkbox-consent-matching" /><span><b>Разрешить поиск по моему профилю</b><small>Работодатель увидит только данные, разрешённые текущей настройкой видимости.</small></span></label>
        <label className="consent-row"><input type="checkbox" checked={draft.consentCatalog} onChange={e => set('consentCatalog', e.target.checked)}/><span>Разрешаю показывать это резюме в каталоге специалистов работодателям</span></label>
        <label className="consent-row"><input type="checkbox" checked={draft.readyForOffers} onChange={e => set('readyForOffers', e.target.checked)}/><span>Готов получать предложения по этому резюме</span></label>
        <InlineInfo label="Доступ к контактам">Контакты не передаются в подборе. Они открываются конкретной компании только после адресного согласия.</InlineInfo>
      </section>
      </fieldset>
      {conflict && <div className="profile-conflict panel" role="alert" data-testid="profile-save-conflict"><strong>Профиль изменился в другой вкладке</strong><p>{save.error.message} Ваши правки остались в форме. Обновите данные, чтобы продолжить.</p><button type="button" className="button secondary" disabled={refreshing || globalBusy} onClick={refreshDraft} data-testid="button-refresh-profile">{refreshing ? 'Обновляем…' : 'Обновить данные, сохранив правки'} <ArrowDownRight size={16}/></button></div>}
      {overlap && <div className="profile-conflict panel" role="status" data-testid="profile-overlapping-fields"><strong>Эти поля изменили и вы, и другая вкладка</strong><p>В форме оставлен ваш вариант. Вы можете принять актуальное значение или сохранить свою правку.</p>{overlap.fields.map(key => <div className="profile-conflict-field" key={key}><b>{profileFieldLabels[key] ?? key}</b><span>Актуальное: {profileDraftValue(overlap.current[key])}</span><span>Ваш вариант: {profileDraftValue(key === 'stack' ? split(stackText) : key === 'skills' ? split(skillsText) : draft[key])}</span><button type="button" className="button text-button" disabled={busy || globalBusy} onClick={() => useCurrent(key)}>Использовать актуальное</button></div>)}</div>}
      {refreshError && <p role="alert" className="profile-refresh-error">{refreshError}</p>}
      <div className="form-actions"><span role="status">{draftNotice || (save.isSuccess ? 'Изменения сохранены' : save.isError && !conflict ? save.error.message : '')}</span><button className="button primary" type="submit" disabled={busy || globalBusy || conflict} data-testid="button-save-profile">{save.isPending ? 'Сохраняем…' : 'Сохранить резюме'} <Check size={16} /></button></div>
    </form>
    <div id="resume"><CandidateResumeSection key={`${selection.resumeId}-${query.data?.specialization}`} resumeId={selection.resumeId!} specialization={query.data!.specialization}/></div>

  </>;
}

function InvitationCard({ invitation: i, candidate, onDecision, onRevoke, pending, disclosed }: { invitation: Invitation & {context?:InvitationContextView|null;company?:InvitationCompanyView|null}; candidate: boolean; onDecision?: (id: number, decision: 'accept' | 'decline') => void; onRevoke?: (id: number) => void; pending?: boolean; disclosed?: { displayName?: string; email?: string; phone?: string | null } | null }) {
  const statusNames: Record<string, string> = { sent: 'Ожидает ответа', viewed: 'Просмотрено', accepted: 'Принято', declined: 'Отклонено', withdrawn: 'Отозвано', expired: 'Истекло' };
  return <article className="panel invitation-card" data-testid={`card-invitation-${i.id}`}><div className="invitation-card-top"><div><span className={candidate ? "eyebrow" : "outgoing-candidate-name"}>{candidate ? i.companyName : i.candidateAlias}</span><h2>{i.title}</h2></div><Badge tone={i.status === 'accepted' ? 'verified' : i.status === 'declined' ? 'muted' : 'accent'}>{statusNames[i.status] || i.status}</Badge></div>
    <InvitationContextLabel context={i.context} candidate={candidate}/><p className="invitation-message">{i.message}</p>{candidate && <InvitationCompanyCard company={i.company} fallbackName={i.companyName} fallbackContact={i.companyContact}/>}<div className="invitation-terms"><span><Banknote size={16} /> <b className="mono">{i.salaryMin.toLocaleString('ru-RU')}–{i.salaryMax.toLocaleString('ru-RU')} ₽</b> / {i.salaryPeriod === 'month' ? 'мес.' : 'год'} · {i.salaryType === 'gross' ? 'до вычета' : 'на руки'}</span><span><BriefcaseBusiness size={15} /> {i.workFormat}</span></div><div className="interest-reason"><b>Почему интерес:</b> {i.reason}</div>
    <InvitationResponse invitation={i}/>
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
  if (!attemptId && !(user?.demoMode && !user.reviewMode) && (!resume.data || resume.data.recommendation.completedCount < 6 || resume.data.questionnaire.specialization !== specialization)) return <><PageTitle title="Начните с короткого опроса" intro="Расскажите о своём опыте, затем выберите уровень и пройдите квалификационный экзамен Signal." /><section className="panel"><Target size={28} /><h2>Шесть вопросов по специализации</h2><p>Опрос поможет выбрать подходящий уровень проверки. Подтверждённую категорию определит результат экзамена Signal.</p><Link className="button primary" href={resumeHref("/candidate/resumes", selection.resumeId)}>Заполнить профиль и опрос <ArrowRight size={16} /></Link></section></>;
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

function EmployerInvitations() {
  const query = useListEmployerInvitations(); const withdraw = useWithdrawInvitation(); const qc = useQueryClient();
  const search = useSearch(), selectedId = Number(new URLSearchParams(search).get('invitationId'));
  useEffect(() => { if (selectedId && query.data?.some(item => item.id === selectedId)) { const selected = document.getElementById(`employer-invitation-${selectedId}`); selected?.scrollIntoView({block:'nearest'}); selected?.focus({preventScroll:true}); } }, [selectedId,query.data]);
  if (query.isLoading) return <LoadingState label="Загружаем статусы приглашений" />;
  if (query.isError) return <ErrorState retry={() => query.refetch()} />;
  const invitations = query.data || [];
  const retract = (id: number) => withdraw.mutate({ id }, { onSuccess: () => qc.invalidateQueries({ queryKey: getListEmployerInvitationsQueryKey() }) });
  return <><PageTitle eyebrow="ДИАЛОГИ" title="Исходящие приглашения" intro="Отслеживайте решения кандидатов. Контакты раскрываются только после принятия предложения." /><InvitationInsights audience="employer" contexts={invitations.flatMap(i=>i.context&&i.context.id?[{type:i.context.type,id:i.context.id,title:i.context.title}]:[])}/>
    {!invitations.length ? <EmptyState title="Вы ещё не отправляли приглашений" body="Откройте подбор, сравните навыки и опыт и подготовьте персональное предложение." action={<Link className="button primary" href="/employer/selection" data-testid="link-empty-matches">К подбору <ArrowRight size={15} /></Link>} /> : <div className="invitation-list">{invitations.map(i => <div key={i.id} id={`employer-invitation-${i.id}`} tabIndex={selectedId === i.id ? -1 : undefined} aria-label={selectedId === i.id ? 'Выбранное приглашение' : undefined}><InvitationCard invitation={i} candidate={false} /><div className="outgoing-controls">{i.status === 'accepted' && i.contactShared && <EmployerContact id={i.id} />}{i.status === 'accepted' && !i.contactShared && <div className="contact-release"><LockKeyhole size={16} /><span>Кандидат отозвал доступ к контактам.</span></div>} {(i.status === 'sent' || i.status === 'viewed') && <button className="button text-button" disabled={withdraw.isPending} onClick={() => retract(i.id)} data-testid={`button-withdraw-${i.id}`}>Отозвать приглашение</button>}</div></div>)}</div>}
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
  const search = useSearch(); const [, navigate] = useLocation();
  const requested = new URLSearchParams(search).get('tab');
  const employer = query.data?.user.role === 'employer';
  const tab = requested === 'interface' ? 'interface' : requested === 'company' && employer ? 'company' : 'account';
  const tabs = [{id:'account',label:'Аккаунт'},{id:'interface',label:'Интерфейс'},...(employer ? [{id:'company',label:'О компании'}] : [])];
  const researchAccess = useQuery({queryKey:['research-access',query.data?.user.id],queryFn:()=>api<{operator:boolean;candidate:boolean}>('/api/research/access'),enabled:!!query.data?.user&&!query.data.user.demoMode});
  return <><PageTitle title="Настройки"/><div className="settings-tabs" role="tablist" aria-label="Разделы настроек">{tabs.map((item,index)=><button key={item.id} role="tab" type="button" id={`settings-tab-${item.id}`} aria-controls={`settings-panel-${item.id}`} aria-selected={tab===item.id} tabIndex={tab===item.id?0:-1} className={`button ${tab===item.id?'primary':'secondary'}`} onClick={()=>navigate(`/settings?tab=${item.id}`)} onKeyDown={event=>{const next=event.key==='ArrowRight'?(index+1)%tabs.length:event.key==='ArrowLeft'?(index+tabs.length-1)%tabs.length:event.key==='Home'?0:event.key==='End'?tabs.length-1:null;if(next!==null){event.preventDefault();navigate(`/settings?tab=${tabs[next]!.id}`);document.getElementById(`settings-tab-${tabs[next]!.id}`)?.focus();}}}>{item.label}</button>)}</div>
    <div role="tabpanel" id={`settings-panel-${tab}`} aria-labelledby={`settings-tab-${tab}`} tabIndex={0}>
    {tab==='account' && <>
    <section className="panel settings-panel" data-accent="profile"><div className="settings-icon"><UserRound size={20} /></div><div className="settings-content"><h2>Аккаунт</h2><AccountSettings/></div></section>
    {(researchAccess.data?.operator || researchAccess.data?.candidate) && <section className="panel settings-panel" data-accent="skills"><div className="settings-icon"><Target size={20}/></div><div className="settings-content"><h2>Исследование проверки навыков<InlineInfo>Добровольное сравнение двух форм по отдельному приглашению. Рабочая категория не меняется.</InlineInfo></h2><Link href="/research" className="text-link">{researchAccess.data.operator ? 'Панель исследования' : 'Об участии'} <ArrowRight size={15}/></Link></div></section>}
    </>}
    {tab==='interface' && <>
    <section className="panel settings-panel" data-accent="tools"><div className="settings-icon"><Sun size={20} /></div><div className="settings-content"><h2>Оформление<InlineInfo>Системная тема следует настройкам устройства.</InlineInfo></h2><ThemePicker theme={theme} /></div></section>
    <section className="panel settings-panel" data-accent="tools"><div className="settings-icon"><Sparkles size={20} /></div><div className="settings-content"><h2>Анимации<InlineInfo>Настройка действует на этом устройстве.</InlineInfo></h2><div className="motion-options">{([['system', 'По системе'], ['reduced', 'Уменьшенные'], ['off', 'Выключены']] as const).map(([key, label]) => <button key={key} className={`motion-option ${motion === key ? 'selected' : ''}`} aria-pressed={motion === key} onClick={() => setMotionPreference(key)} data-testid={`motion-${key}`}>{label}</button>)}</div><div className="motion-speed-control"><div className="motion-speed-heading"><label htmlFor="motion-speed">Скорость анимаций</label><InlineInfo label="Скорость анимаций: подробнее">Скорость действует только на оформление. Таймеры проверок и сроки сообщений идут в реальном времени.</InlineInfo><output htmlFor="motion-speed" aria-live="polite">{speed === 0 ? 'Выключены' : `${speed.toLocaleString('ru-RU')}×`}</output></div><input id="motion-speed" type="range" min="0" max="5" step="0.25" value={speed} onChange={event => setSpeed(Number(event.target.value))} aria-valuetext={speed === 0 ? 'Выключены' : `${speed} от нормальной скорости`} aria-describedby="motion-speed-description" /><div className="motion-speed-scale"><span>0 — без движения</span><button type="button" className="text-link" onClick={() => setSpeed(1)}>Вернуть 1×</button><span>5×</span></div><p id="motion-speed-description" className="sr-only" role="status">{effective === 'off' ? 'Движение выключено. Все действия и сообщения доступны.' : effective === 'reduced' ? systemReduced ? 'Система просит уменьшить движение: декоративные циклы выключены.' : 'Уменьшенное движение: декоративные циклы выключены.' : 'Скорость применяется к оформлению. Таймеры экзамена и сроки сообщений идут в реальном времени.'}</p></div></div></section>

    </>}
    {tab==='company' && <div className="settings-company"><CompanyPage embedded/><AtsIntegration/></div>}
    </div></>;
}

function CompanySettingsRedirect() {
  const [, navigate] = useLocation();
  useEffect(()=>navigate('/settings?tab=company',{replace:true}),[navigate]);
  return <LoadingState label="Открываем настройки компании"/>;
}
function AuthenticatedEntryRedirect({role}:{role:'candidate'|'employer'}) {
  const [, navigate] = useLocation();
  useEffect(()=>navigate(role==='employer'?'/employer':'/candidate',{replace:true}),[navigate,role]);
  return <LoadingState label="Открываем рабочее пространство"/>;
}

function RouteContent({ theme }: { theme: ReturnType<typeof useThemePreference> }) {
  const [location] = useLocation();
  const session = useGetCurrentUser({ query: { retry: false, queryKey: getGetCurrentUserQueryKey(), enabled: location !== '/' && location !== '/about' } });
  const user = currentAuthUser(session.data, session.error);
  if (location === '/review') return <SharedReviewPage/>;
  if (location === '/verify') return <PublicPassportPage/>;
  const isHome = location === '/';
  if (location === '/auth' && session.isLoading) return <LoadingState label="Проверяем сессию"/>;
  if (location === '/auth' && user) return <AuthenticatedEntryRedirect role={user.role}/>;
  if (isHome || location === '/auth') return <PublicEntry themeSlot={<ThemeMenu theme={theme}/>} navigationSlot={<AppBackButton/>} brandSlot={<Brand/>} openAuth={location === '/auth'} initialRole={new URLSearchParams(window.location.search).get('role') === 'employer' ? 'employer' : 'candidate'}/>;
  if (location === '/about') return <AboutPage theme={theme} />;
  if (location === '/jobs') return <div className="landing"><PublicHeader theme={theme} /><main className="service-info"><CandidateJobsPage publicOnly /></main></div>;
  if (location === '/quality') return <div className="landing"><PublicHeader theme={theme} /><main className="service-info"><Link className="back-link" href="/about"><ArrowLeft size={15} /> О сервисе</Link><QualityPage /></main></div>;
  if (location !== '/quality' && session.isLoading) return <div className="landing"><PublicHeader theme={theme} /><LoadingState label="Проверяем сессию" /></div>;
  if (location !== '/quality' && !user) return <main className="auth-required"><div className="auth-required-header"><PublicHeader theme={theme} /></div><EmptyState title="Войдите, чтобы продолжить" body="Паспорт и рабочее пространство доступны после входа в аккаунт." action={<Link className="button primary" href="/auth">Войти в Signal</Link>} /></main>;
  const expectedRole = location.startsWith('/employer') ? 'employer' : location.startsWith('/candidate') ? 'candidate' : null;
  if (expectedRole && user?.role !== expectedRole) return <Shell theme={theme}><EmptyState title="Это пространство другой роли" body="Перейдите в свой кабинет, чтобы продолжить работу." action={<Link className="button primary" href={user?.role === 'employer' ? '/employer' : '/candidate'}>В мой кабинет</Link>} /></Shell>;
  return <Shell theme={theme}><Switch>
    <Route path="/candidate" component={CandidateWorkspaceOverview} />
    <Route path="/candidate/resumes">{() => <MyResumesPage renderEditor={id => <CandidateResumeEditor key={id} resumeId={id}/>}/>}</Route>
    <Route path="/candidate/passport" component={CandidatePassport} />
    <Route path="/candidate/kalibr" component={CandidateSkillChecks} />
    <Route path="/candidate/trust" component={CandidateTrustCenter} />
    <Route path="/employer/trust" component={EmployerTrustCenter} />
    <Route path="/moderation" component={ModerationCenter} />
    <Route path="/candidate/invitations" component={CandidateInvitationsPage} />
    <Route path="/candidate/jobs">{() => <CandidateJobsPage />}</Route>
    <Route path="/candidate/microtasks" component={CandidateMicrotasksPage} />
    <Route path="/employer/jobs">{() => <EmployerJobsPage/>}</Route>
    <Route path="/employer/needs">{() => <EmployerJobsPage initialTab="needs"/>}</Route>
    <Route path="/employer/applications" component={EmployerApplicationsPage} />
    <Route path="/employer/microtasks" component={EmployerMicrotasksPage} />
    <Route path="/employer">{() => <EmployerJobsPage/>}</Route>
    <Route path="/employer/selection" component={EmployerSelectionPage} />
    <Route path="/employer/matches" component={EmployerSelectionPage} />
    <Route path="/employer/candidates" component={EmployerSelectionPage} />
    <Route path="/employer/invitations" component={EmployerInvitations} />
    <Route path="/employer/company" component={CompanySettingsRedirect} />
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
  const qc = useQueryClient();
  const session = useGetCurrentUser({ query: { retry: false, queryKey: getGetCurrentUserQueryKey() } });
  const user = currentAuthUser(session.data, session.error);
  useEffect(() => { void expireRejectedAuthQuery(qc, getGetCurrentUserQueryKey(), session.error).then(expired => { if (expired) clearWorkspaceDrafts(); }); }, [qc, session.error]);
  useMotionPreference();
  const isPublic = location === '/' || location === '/auth' || location === '/about' || location === '/review' || location === '/verify';
  return <ResumeSelectionProvider key={user?.id ?? "visitor"} userId={user?.role === 'candidate' ? user.id : null}><AppNavigationProvider userId={user?.id} role={user?.role}><ErrorBoundary resetKey={location}><RouteContent theme={theme} />{!['/review','/verify'].includes(location)&&<SignalConsultant key={user?.id ?? 'visitor'} role={isPublic ? undefined : user?.role} location={location} onOpenAuth={() => { if (location === '/' || location === '/auth') window.dispatchEvent(new CustomEvent('signal-open-auth')); else navigate('/auth'); }} />}<CelebrationHost /></ErrorBoundary></AppNavigationProvider></ResumeSelectionProvider>;
}
function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}
export default App;
