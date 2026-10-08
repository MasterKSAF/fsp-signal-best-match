import { FormField } from './form-field';
import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, BadgeCheck, BriefcaseBusiness, Check, Code2, Handshake, LogIn, Mail, Play, ShieldCheck, Target, UserRound } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { getGetCurrentUserQueryKey, useGetCurrentUser, useLogin, useRegister, useStartDemoSession, useVerifyEmail, type AuthSession, type RegistrationInput } from '@workspace/api-client-react';
import { Dialog } from './product-enhancements';
import { replaceAuthQueryCache } from '@/lib/auth-query-cache';
import './public-entry.css';

type EntryRole = 'candidate' | 'employer';
type AuthMode = 'login' | 'register' | 'verify';
export type PublicEntryProps = {
  themeSlot: ReactNode;
  brandSlot?: ReactNode;
  navigationSlot?: ReactNode;
  initialRole?: EntryRole;
  openAuth?: boolean;
};

export function PublicEntry({ themeSlot, brandSlot, navigationSlot, initialRole = 'candidate', openAuth = false }: PublicEntryProps) {
  const [location, setLocation] = useLocation();
  const [modal, setModal] = useState<'auth' | null>(openAuth ? 'auth' : null);
  const [demoMode, setDemoMode] = useState(false);
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<EntryRole>(initialRole);
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [resendSeconds, setResendSeconds] = useState(0);
  // Kept only while this form is mounted; never persisted to storage or logs.
  const registrationInput = useRef<RegistrationInput | null>(null);
  const registrationId = useRef<string | null>(null);
  const register = useRegister(); const verify = useVerifyEmail(); const login = useLogin(); const demo = useStartDemoSession();
  const queryClient = useQueryClient();
  const session = useGetCurrentUser({ query: { retry: false, queryKey: getGetCurrentUserQueryKey() } });
  const user = session.data?.user;
  const pending = register.isPending || verify.isPending || login.isPending || demo.isPending;
  useEffect(() => { if (openAuth) { setRole(initialRole); setModal('auth'); } }, [openAuth, initialRole]);
  useEffect(() => {
    if (resendSeconds <= 0) return;
    const timeout = window.setTimeout(() => setResendSeconds(value => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timeout);
  }, [resendSeconds]);
  useEffect(() => () => { registrationInput.current = null; registrationId.current = null; }, []);
  useEffect(() => {
    const open = () => { registrationInput.current = null; registrationId.current = null; setModal('auth'); setMode('login'); setDemoMode(false); setError(''); setNotice(''); };
    window.addEventListener('signal-open-auth', open);
    return () => window.removeEventListener('signal-open-auth', open);
  }, []);

  const close = () => {
    if (pending) return;
    setModal(null); setError(''); setNotice(''); setCode(''); setMode('login'); setDemoMode(false); setPassword('');
    registrationInput.current = null;
    registrationId.current = null;
    if (location === '/auth') setLocation('/');
  };
  const openLogin = () => { setMode('login'); setModal('auth'); setDemoMode(false); setPassword(''); setError(''); setNotice(''); setCode(''); registrationInput.current = null; registrationId.current = null; };
  const routeAfter = async (result: AuthSession, afterVerification = false) => {
    registrationInput.current = null;
    registrationId.current = null;
    await replaceAuthQueryCache(queryClient, getGetCurrentUserQueryKey(), result);
    setLocation(result.user.role === 'employer' ? '/employer' : afterVerification ? '/candidate/passport' : '/candidate');
  };
  const authError = (value: unknown) => setError(value instanceof Error ? value.message : 'Не удалось выполнить запрос. Попробуйте ещё раз.');
  const registerResult = (result: { email: string; notice: string; verificationRequired: boolean; registrationId: string }) => {
    registrationId.current = result.registrationId;
    setEmail(result.email); setNotice(result.notice); setCode(''); setResendSeconds(60);
    setMode(result.verificationRequired ? 'verify' : 'login');
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError(''); setNotice('');
    if (pending) return;
    if (demoMode) {
      demo.mutate({ data: { role } }, { onSuccess: result => routeAfter(result), onError: authError });
      return;
    }
    const data = new FormData(event.currentTarget);
    if (mode === 'register') {
      const payload: RegistrationInput = { email: String(data.get('email')), password: String(data.get('password')), displayName: String(data.get('name')), role, consentTerms: data.get('terms') === 'on', consentPrivacy: data.get('privacy') === 'on' };
      registrationInput.current = payload;
      registrationId.current = null;
      register.mutate({ data: payload }, { onSuccess: registerResult, onError: authError });
    } else if (mode === 'verify') {
      if (!registrationId.current) { setError('Начните регистрацию заново, чтобы получить код для этой заявки.'); return; }
      verify.mutate({ data: { email, registrationId: registrationId.current, code: String(data.get('code')) } }, { onSuccess: result => routeAfter(result, true), onError: authError });
    } else {
      login.mutate({ data: { email: String(data.get('email')), password: String(data.get('password')) } }, { onSuccess: result => routeAfter(result), onError: authError });
    }
  };
  const resend = () => {
    if (!registrationInput.current || pending || resendSeconds > 0) return;
    setError(''); setNotice('');
    registrationId.current = null;
    // The registration endpoint already safely reissues a code for unverified
    // accounts. No separate, nonexistent resend endpoint is assumed.
    register.mutate({ data: registrationInput.current }, { onSuccess: registerResult, onError: authError });
  };
  const switchMode = (next: AuthMode) => { setMode(next); setDemoMode(false); setPassword(''); setError(''); setNotice(''); setCode(''); registrationInput.current = null; registrationId.current = null; };
  const toggleDemo = () => { setDemoMode(value => !value); setPassword(''); setError(''); setNotice(''); registrationInput.current = null; registrationId.current = null; };
  // These read-only labels represent the demo preset, not credentials for real authentication.
  const demoLogin = role === 'candidate' ? 'candidate@demo.signal' : 'employer@demo.signal';

  return <>
    <div className="public-entry" inert={modal ? true : undefined}>
      <SeasonalBackdrop />
      <header className="entry-header">
        <div className="entry-header-brand">{brandSlot || <Link href="/" className="brand-lockup" aria-label="Signal — на главную"><span className="signal-wordmark">Signal</span></Link>}</div>
        <div className="entry-header-actions">{themeSlot}{user && <Link className="entry-cabinet-link" href={user.role === 'employer' ? '/employer' : '/candidate'}>В кабинет<ArrowRight size={14} /></Link>}<button type="button" className="entry-login-button" onClick={openLogin} data-testid="button-open-login">Вход<LogIn size={16} /></button></div>
      </header>
      <div className="entry-back-row app-back-row">{navigationSlot}</div>
      <main className="entry-main" id="main-content">
        <section className="entry-intro" aria-labelledby="entry-title"><h1 id="entry-title">Нужные люди.<br /><span>Подходящая работа.</span></h1><p>Проверенные навыки. Предложения с зарплатой.</p></section>
        <section className="entry-role-grid" aria-label="Возможности Signal">
          <article className="entry-role-card entry-candidate-card" data-accent="profile">
            <div className="entry-card-top"><span className="themed-icon"><Code2 size={18} strokeWidth={1.75} aria-hidden="true" /></span><span className="entry-role-caption">КАНДИДАТАМ</span></div>
            <h2><span>Навыки</span> открывают любые двери</h2>
            <ul className="entry-benefits"><li><BadgeCheck />Подтвердите свой уровень</li><li><Mail />Получайте приглашения с зарплатой</li><li><ShieldCheck />Решайте, кому открыть контакты</li></ul>
          </article>
          <article className="entry-role-card entry-employer-card" data-accent="employer">
            <div className="entry-card-top"><span className="themed-icon"><BriefcaseBusiness size={18} strokeWidth={1.75} aria-hidden="true" /></span><span className="entry-role-caption">РАБОТОДАТЕЛЯМ</span></div>
            <h2>Найдите своих специалистов</h2>
            <ul className="entry-benefits"><li><BadgeCheck />Выбирайте по проверенным навыкам</li><li><Target />Сравнивайте кандидатов по задаче</li><li><Handshake />Приглашайте напрямую</li></ul>
          </article>
        </section>
      </main>
      <footer className="entry-footer"><Link href="/about">О сервисе<ArrowRight size={13} /></Link></footer>
    </div>
    {modal === 'auth' && <Dialog title={mode === 'verify' ? 'Подтверждение электронной почты' : mode === 'register' ? 'Регистрация в Signal' : 'Вход в Signal'} onClose={close}>
      <div className={`public-auth public-auth-${mode}`}>
        <span className="entry-modal-icon">{mode === 'verify' ? <Mail size={23} /> : role === 'candidate' ? <UserRound size={23} /> : <BriefcaseBusiness size={23} />}</span>
        <div className="entry-auth-title"><h2>{mode === 'verify' ? 'Проверьте почту' : mode === 'register' ? 'Ваш аккаунт в Signal' : 'Рады видеть вас'}</h2>{mode === 'login' && <button className={`entry-demo-toggle${demoMode ? ' is-active' : ''}`} type="button" aria-pressed={demoMode} onClick={toggleDemo} disabled={pending} data-testid="button-demo-toggle">{demoMode ? <Check size={12} /> : <Play size={11} />}Demo</button>}</div>
        <>{mode === 'verify' && <p className="entry-modal-intro">Введите код из письма на <strong>{email}</strong>.</p>}</>
        {mode !== 'verify' && <div className="entry-auth-roles" role="group" aria-label="Роль аккаунта">{(['candidate', 'employer'] as const).map(target => <button type="button" key={target} disabled={pending} className={role === target ? 'selected' : ''} aria-pressed={role === target} onClick={() => { setRole(target); registrationInput.current = null; registrationId.current = null; setError(''); }} data-testid={`button-role-${target}`}>{target === 'candidate' ? <UserRound size={15} /> : <BriefcaseBusiness size={15} />}{target === 'candidate' ? 'Я кандидат' : 'Я работодатель'}</button>)}</div>}
        <form className="entry-auth-form" onSubmit={submit} key={mode}>
          {mode === 'register' && <FormField className="entry-field" label={role === 'employer' ? 'Название компании' : 'Имя и фамилия'}><input name="name" required minLength={2} maxLength={120} autoComplete={role === 'employer' ? 'organization' : 'name'} placeholder={role === 'employer' ? 'Название вашей компании' : 'Как к вам обращаться'} disabled={pending} data-testid="input-display-name" /></FormField>}
          {mode !== 'verify' && <><FormField className="entry-field" label={demoMode ? 'Логин Demo' : 'Электронная почта'}><input name="email" type="email" autoComplete={demoMode ? 'off' : 'email'} required maxLength={254} placeholder="name@example.ru" value={demoMode ? demoLogin : email} onChange={event => { setEmail(event.target.value); registrationInput.current = null; registrationId.current = null; }} readOnly={demoMode} disabled={pending} data-testid="input-email" /></FormField><FormField className="entry-field" label="Пароль" ><input name="password" type="password" autoComplete={demoMode ? 'off' : mode === 'register' ? 'new-password' : 'current-password'} required minLength={mode === 'register' ? 10 : undefined} maxLength={200} placeholder={mode === 'register' ? 'Не менее 10 символов' : 'Ваш пароль'} value={demoMode ? 'signal-demo' : password} onChange={event => setPassword(event.target.value)} readOnly={demoMode} disabled={pending} data-testid="input-password" /></FormField></>}
          {mode === 'verify' && <FormField className="entry-field" label="Код подтверждения"><input className="entry-code-input" name="code" inputMode="numeric" autoComplete="one-time-code" required pattern="[0-9]{6}" minLength={6} maxLength={6} value={code} onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" disabled={pending} data-testid="input-verification-code" /></FormField>}
          {mode === 'register' && <div className="entry-consents"><label><input type="checkbox" name="terms" required disabled={pending} data-testid="checkbox-terms" /><span>Принимаю условия использования сервиса.</span></label><label><input type="checkbox" name="privacy" required disabled={pending} data-testid="checkbox-privacy" /><span>Согласен(на) на обработку персональных данных для работы сервиса.</span></label></div>}
          {notice && <p className="entry-auth-notice" role="status" data-testid="status-auth-notice">{notice}</p>}
          {error && <p className="entry-auth-error" role="alert" data-testid="status-auth-error">{error}</p>}
          <button type="submit" className="button primary full" disabled={pending} data-testid="button-auth-submit">{pending ? 'Подождите…' : mode === 'verify' ? 'Подтвердить почту' : mode === 'register' ? 'Создать аккаунт' : 'Войти'}<ArrowRight size={16} /></button>
        </form>
        {mode !== 'verify' ? <button type="button" className="entry-switch-auth" disabled={pending} onClick={() => switchMode(mode === 'login' ? 'register' : 'login')} data-testid="button-switch-auth">{mode === 'login' ? <>Ещё нет аккаунта? <b>Зарегистрироваться</b></> : <>Уже есть аккаунт? <b>Войти</b></>}</button> : <div className="entry-verification-actions">{registrationInput.current && <button type="button" className="entry-switch-auth" disabled={pending || resendSeconds > 0} onClick={resend} data-testid="button-resend-code">{resendSeconds > 0 ? `Отправить снова через ${resendSeconds} с` : 'Отправить код ещё раз'}</button>}<button type="button" className="entry-switch-auth" disabled={pending} onClick={() => switchMode('register')} data-testid="button-back-register">Изменить адрес или вернуться</button></div>}
        {mode === 'verify' && <p className="entry-auth-privacy"><ShieldCheck size={13} />Код действует 30 минут.</p>}
      </div>
    </Dialog>}
  </>;
}

const autumnLeafPositions = [
  [-3, 7, 155, -28], [89, 1, 108, 72], [11, 82, 86, 24], [83, 73, 131, 152],
  [24, 0, 65, 124], [2, 46, 74, 86], [94, 44, 64, -43], [68, 89, 78, 62],
  [8, 29, 51, 34], [79, 17, 60, -22], [30, 83, 52, -52], [83, 0, 73, 36],
  [0, 87, 57, -7], [94, 88, 50, 18], [17, 7, 43, -78], [67, 4, 44, 24],
  [44, 2, 37, 12], [54, 89, 44, -16], [20, 68, 47, 128], [77, 54, 42, -98],
  [4, 64, 51, 167], [88, 27, 49, 113], [36, 94, 38, 43], [58, 6, 36, -31],
  [38, 20, 31, 71], [57, 71, 35, -108], [91, 64, 43, 16], [13, 54, 34, -19],
] as const;

function AutumnLeaf({ variant }: { variant: number }) {
  if (variant === 0) return <><path d="M49 82C41 79 32 81 25 76L30 67C25 65 18 59 15 53L29 52C24 44 25 34 25 29L38 39C39 29 45 18 50 10C54 19 59 29 60 40L74 29C74 37 72 45 69 52L85 51C82 58 74 64 69 68L75 77C67 80 59 79 51 82"/><path d="M49 94Q52 62 50 23M51 64Q39 54 30 43M51 57Q62 46 69 39M50 75L33 69M51 72L68 65"/></>;
  if (variant === 1) return <><path d="M48 85C39 84 29 82 31 75C20 75 22 64 30 61C18 58 21 48 30 46C21 40 27 30 36 31C31 21 40 18 45 21C43 11 50 8 54 16C62 11 68 19 62 26C75 22 79 33 68 38C82 39 83 51 71 54C81 59 77 70 65 70C69 80 58 85 48 85Z"/><path d="M47 95Q56 56 51 21M53 40L38 32M53 54L32 48M52 67L34 63M53 44L67 35M53 59L69 51M51 73L62 68"/></>;
  return <><path d="M22 80C15 61 24 36 42 25C53 17 68 14 83 14C82 30 79 43 70 57C58 75 40 84 22 80Z"/><path d="M16 91Q43 53 75 23M36 66Q31 56 32 46M49 52Q47 39 51 32M46 56Q59 59 66 55M60 40L76 39"/></>;
}

function SeasonalBackdrop() {
  const month = new Date().getMonth();
  const season = month === 11 || month < 2 ? 'winter' : month < 5 ? 'spring' : month < 8 ? 'summer' : 'autumn';
  return <div className={`entry-season entry-season--${season}`} aria-hidden="true">{Array.from({ length: season === 'autumn' ? autumnLeafPositions.length : 5 }, (_, index) => <svg key={index} focusable="false" className={`entry-season-mark ${season === 'autumn' ? 'entry-autumn-leaf' : `entry-season-mark--${index}`}`} style={season === 'autumn' ? { '--leaf-hue': [42, 32, 19, 7][index % 4], left: `${autumnLeafPositions[index][0]}%`, top: `${autumnLeafPositions[index][1]}%`, width: `${autumnLeafPositions[index][2]}px`, transform: `rotate(${autumnLeafPositions[index][3]}deg)` } as CSSProperties : undefined} viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round">
    {season === 'autumn' ? <AutumnLeaf variant={index % 3}/> : season === 'winter' ? <><path d="M50 9V91M14 29L86 71M14 71L86 29M38 20L50 32L62 20M38 80L50 68L62 80M18 44L35 42L31 24M69 76L65 58L82 56M18 56L35 58L31 76M69 24L65 42L82 44" /></> : season === 'spring' ? <><path d="M50 34C27 1 9 37 33 49C0 64 34 91 49 66C65 96 95 69 68 50C98 33 68 5 50 34Z" /><circle cx="50" cy="50" r="10" /></> : <><circle cx="50" cy="50" r="24" /><path d="M50 7V18M50 82V93M7 50H18M82 50H93M20 20L28 28M72 72L80 80M20 80L28 72M72 28L80 20" /></>}
  </svg>)}</div>;
}
