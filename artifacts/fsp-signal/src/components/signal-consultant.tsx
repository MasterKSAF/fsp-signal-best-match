import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, MessageCircle, Send, Sparkles, X } from 'lucide-react';
import { Link, useSearch } from 'wouter';
import { getWorkspaceGuideContent } from './workspace-guide';
import './signal-consultant.css';

type Role = 'candidate' | 'employer';
type Topic = 'purpose' | 'how' | 'entry' | 'section';
type Reply = { text: string; action?: { label: string; href?: string; auth?: true } };
type Message = Reply & { id: number; from: 'user' | 'assistant' };

const publicTopics: { id: Topic; label: string }[] = [
  { id: 'purpose', label: 'Для чего Signal?' },
  { id: 'how', label: 'Как это работает?' },
  { id: 'entry', label: 'Как начать?' },
];

function topicReply(topic: Topic, role?: Role, location = '/'): Reply {
  if (topic === 'purpose') return {
    text: 'Signal помогает специалистам и командам находить лучшее совпадение. Кандидат показывает, что умеет на практике, а работодатель видит, какие навыки подходят для его задач. Опыт, подтверждённые навыки и условия работы рассматриваются вместе.',
  };
  if (topic === 'how') return {
    text: 'Кандидат заполняет профиль, указывает ожидания и подтверждает навыки квалификационным экзаменом Signal. Работодатель описывает задачи и требования. Signal сопоставляет их и объясняет совпадения и пробелы. Дальше — приглашение и знакомство по взаимному согласию.',
  };
  if (topic === 'section' && role) {
    const guide = getWorkspaceGuideContent(role, location);
    return { text: `${guide.intro}\n\n${guide.tips.join('\n\n')}`, action: { label: guide.action, href: guide.href } };
  }
  if (role === 'candidate') return {
    text: 'Начните с паспорта: добавьте опыт и пожелания к работе, заполните профессиональный опрос. Затем выберите программу проверки навыков. Подтверждённый уровень появится в профиле и поможет компаниям оценить соответствие задачам.',
    action: { label: 'Открыть паспорт', href: '/candidate/passport' },
  };
  if (role === 'employer') return {
    text: 'Опишите компанию и создайте вакансию: задачи, нужные навыки, уровень и условия работы. После этого можно открыть подбор, сравнить подтверждения и отправить приглашения.',
    action: { label: 'К моим вакансиям', href: '/employer' },
  };
  return {
    text: 'Нажмите «Вход» вверху страницы и выберите роль: кандидат или работодатель. Если аккаунта ещё нет, перейдите к регистрации. Хотите сначала осмотреться? Включите Demo, выберите роль и нажмите «Войти». Данные готового профиля подставятся автоматически.',
    action: { label: 'Открыть вход', auth: true },
  };
}

function replyTo(question: string, role?: Role, location = '/'): Reply {
  const text = question.toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').trim();
  if (/парол|войти|вход|регист|аккаунт|демо|demo|начать/.test(text)) return topicReply('entry', role, location);
  if (/как.*работ|механик|процесс|устроен|этап/.test(text)) return topicReply('how', role, location);
  if (/контакт|телефон|приват|конфиден|видимост|персональн|соглас/.test(text)) return {
    text: 'Кандидат управляет видимостью профиля и согласием на подбор. В подборе работодатель видит профессиональный профиль без контактов. Контакты открываются после принятия приглашения или явного согласия при отклике на вакансию. Доступ компании можно отозвать.',
    ...(role === 'candidate' ? { action: { label: 'Настройки профиля', href: '/candidate/passport' } } : {}),
  };
  if (/балл|процент|совпад|рейтинг|подбор|матч|алгоритм/.test(text)) return {
    text: 'Подбор сопоставляет требования вакансии с подтверждёнными навыками, результатами проверки и условиями кандидата. В карточке можно посмотреть объяснение: что подтверждено, что указано самим кандидатом и чего пока не хватает. Балл соответствия помогает сравнивать профили, но не гарантирует успешный найм.',
    ...(role === 'employer' ? { action: { label: 'Открыть подбор', href: '/employer/matches' } } : {}),
  };
  if (/навык|провер|тест|уровен|уровн|опрос|оценк|python|backend/.test(text)) return {
    text: 'Доступны программы квалификационного экзамена Signal Backend / Python и Frontend / TypeScript. Профессиональный опрос помогает выбрать стартовый уровень, а экзамен проверяет применение навыков. Практика компании оценивается отдельно и не присваивает грейд Signal. В паспорте отдельно видны ваш опыт и навыки с подтверждением. История проверок сохраняется.',
    ...(role === 'candidate' ? { action: { label: 'К проверке навыков', href: '/candidate/kalibr' } } : {}),
  };
  if (/резюме|паспорт|pdf|опыт|портфолио/.test(text)) return {
    text: 'В паспорте можно собрать резюме: опыт, проекты, образование и ссылки на работы. Там же находятся профессиональный опрос, подтверждённые навыки и история результатов. Резюме можно скачать в PDF.',
    ...(role === 'candidate' ? { action: { label: 'Открыть паспорт', href: '/candidate/passport' } } : {}),
  };
  if (/работодат|команд|компан|ваканси|специалист/.test(text)) return {
    text: 'Для работодателя Signal — способ увидеть навыки за резюме. Опишите задачи команды, откройте подбор и сравните подтверждения по единым требованиям. Можно также изучить банк кандидатов и отправить приглашение с понятными условиями.',
    ...(role === 'employer' ? { action: { label: 'Банк кандидатов', href: '/employer/candidates' } } : {}),
  };
  if (/кандидат|работ[ауые]|карьер|предложени/.test(text)) return {
    text: 'Для кандидата Signal — возможность показать сильные стороны делом. Соберите профиль, подтвердите навыки и укажите ожидания от работы. Компании смогут оценить ваши подтверждения, а вы — выбрать подходящее приглашение.',
    ...(role === 'candidate' ? { action: { label: 'Мои приглашения', href: '/candidate/invitations' } } : {}),
  };
  if (/зачем|для чего|что.*signal|что.*сигнал|что.*сайт|о сервис|возможност|умеешь|помощ/.test(text)) return topicReply('purpose', role, location);
  if (/здесь|страниц|раздел|дальше|следующ/.test(text) && role) return topicReply('section', role, location);
  if (/^(привет|здравствуй|добрый|хай|hello)/.test(text)) return { text: 'Здравствуйте! Помогу познакомиться с Signal и найти следующий шаг. Что интересно: возможности сервиса, подбор по навыкам или вход в кабинет?' };
  return { text: 'По этому вопросу у меня пока нет точного ответа. Могу рассказать, для чего нужен Signal, как устроен подбор и как начать работу. Выберите тему ниже или задайте вопрос об этих возможностях.' };
}

/** Local product guidance; messages never leave this page or persist across sessions. */
export function SignalConsultant({ role, location, hidden = false, onOpenAuth }: { role?: Role; location: string; hidden?: boolean; onOpenAuth?: () => void }) {
  const search = useSearch();
  const [open, setOpen] = useState(false);
  const [modalPresent, setModalPresent] = useState(false);
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const sequence = useRef(0);
  const launcher = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const titleId = useId();
  const assessmentAttempt = location.startsWith('/candidate/kalibr') && Number(new URLSearchParams(search).get('attempt')) > 0;
  const unavailable = hidden || modalPresent || assessmentAttempt;
  const topics = role ? [{ id: 'section' as const, label: 'Что сделать в этом разделе?' }, publicTopics[1], { id: 'entry' as const, label: 'С чего начать?' }] : publicTopics;

  useEffect(() => {
    const check = () => setModalPresent(Array.from(document.querySelectorAll<HTMLElement>('[aria-modal="true"]')).some(element => element.getClientRects().length > 0));
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-modal', 'hidden'] });
    return () => observer.disconnect();
  }, []);
  useEffect(() => { setOpen(false); setDraft(''); }, [location, search]);
  useEffect(() => { setMessages([]); }, [role]);
  useEffect(() => { if (unavailable) setOpen(false); }, [unavailable]);
  useEffect(() => {
    if (!open || unavailable) return;
    input.current?.focus({ preventScroll: true });
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
      launcher.current?.focus({ preventScroll: true });
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [open, unavailable]);
  useEffect(() => { if (open && log.current) log.current.scrollTop = log.current.scrollHeight; }, [messages, open]);

  const close = () => { setOpen(false); launcher.current?.focus({ preventScroll: true }); };
  const answer = (question: string, reply: Reply) => {
    setMessages(previous => [...previous.slice(-18), { id: ++sequence.current, from: 'user', text: question } as Message, { id: ++sequence.current, from: 'assistant', ...reply } as Message]);
    setDraft('');
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const question = draft.trim();
    if (question) answer(question, replyTo(question, role, location));
  };
  const openAuth = () => {
    setOpen(false);
    if (onOpenAuth) onOpenAuth();
    else window.dispatchEvent(new CustomEvent('signal-open-auth'));
  };

  if (unavailable) return null;
  return <aside className={`signal-consultant ${open ? 'is-open' : ''}`} aria-label="Помощник Signal">
    {open && <section className="signal-consultant__panel" id={panelId} role="dialog" aria-modal="false" aria-labelledby={titleId}>
      <header className="signal-consultant__header"><span className="signal-consultant__avatar" aria-hidden="true"><Sparkles size={20} /></span><div><h2 id={titleId}>Помощник Signal</h2><p>Помогу разобраться</p></div><button className="signal-consultant__close" onClick={close} aria-label="Закрыть помощника"><X size={18} /></button></header>
      <div className="signal-consultant__log" ref={log} role="log" aria-live="polite" aria-relevant="additions" aria-label="Диалог с помощником">
        <div className="signal-consultant__message is-assistant"><p>{role ? 'Подскажу, как использовать этот раздел и найти следующий шаг. Что хотите узнать?' : 'За сильным совпадением — понятные навыки и подходящие задачи. Расскажу, как Signal помогает специалистам и командам найти друг друга.'}</p></div>
        {messages.map(message => <div key={message.id} className={`signal-consultant__message is-${message.from}`}><span className="signal-consultant__speaker">{message.from === 'user' ? 'Вы' : 'Помощник Signal'}</span><p>{message.text}</p>{message.action && (message.action.auth ? <button className="signal-consultant__action" onClick={openAuth}>{message.action.label}<ArrowRight size={14} /></button> : <Link className="signal-consultant__action" href={message.action.href!} onClick={() => setOpen(false)}>{message.action.label}<ArrowRight size={14} /></Link>)}</div>)}
      </div>
      <div className="signal-consultant__topics" aria-label="Темы для разговора">{topics.map(topic => <button key={topic.id} data-testid={`consultant-topic-${topic.id}`} onClick={() => answer(topic.label, topicReply(topic.id, role, location))}>{topic.label}<ArrowRight size={13} aria-hidden="true" /></button>)}</div>
      <form className="signal-consultant__form" onSubmit={submit}><label htmlFor={`${panelId}-input`} className="sr-only">Ваш вопрос о Signal</label><input id={`${panelId}-input`} ref={input} value={draft} onChange={event => setDraft(event.target.value)} placeholder="Спросите о Signal…" maxLength={500} autoComplete="off" enterKeyHint="send" data-testid="input-consultant-question" /><button type="submit" disabled={!draft.trim()} aria-label="Отправить вопрос" data-testid="button-consultant-send"><Send size={17} /></button></form>
    </section>}
    <button className="signal-consultant__launcher" ref={launcher} onClick={() => setOpen(value => !value)} aria-label={open ? 'Свернуть помощника Signal' : 'Спросите о Signal — открыть помощника'} aria-expanded={open} aria-controls={open ? panelId : undefined} data-testid="button-signal-consultant"><span aria-hidden="true">{open ? <X size={21} /> : <MessageCircle size={22} />}</span><strong>Спросите о Signal</strong></button>
  </aside>;
}
