import { useEffect, useState } from 'react';
import { ArrowRight, BookOpen, Check, Compass, ListChecks, Sparkles, UserRound } from 'lucide-react';
import { Link } from 'wouter';
import { useGetCurrentUser } from '@workspace/api-client-react';
import { useSelectedCandidateProfile } from './multi-resume';
import { Dialog } from './product-enhancements';
import './workspace-guide.css';

type Role = 'candidate' | 'employer';
type GuideContent = { title: string; intro: string; tips: string[]; href: string; action: string };

const backendPreparation = [
  { id: 'api', title: 'API и обработка ошибок', detail: 'Повторите HTTP, проверку входных данных и понятные ответы об ошибках.' },
  { id: 'sql', title: 'SQL и работа с данными', detail: 'Потренируйтесь читать запросы, выбирать индексы и объяснять транзакции.' },
  { id: 'reliability', title: 'Надёжность операций', detail: 'Разберите повторные запросы, конкурентные изменения и идемпотентность.' },
  { id: 'diagnostics', title: 'Диагностика проблем', detail: 'Попробуйте найти причину сбоя по логам, метрикам и небольшому примеру.' },
  { id: 'architecture', title: 'Архитектура и компромиссы', detail: 'Объясните выбор решения, его ограничения и возможные альтернативы.' },
] as const;
const frontendPreparation = [
  { id: 'typescript', title: 'TypeScript и входные данные', detail: 'Повторите сужение типов, discriminated union и проверку unknown на границе API.' },
  { id: 'state', title: 'Состояние интерфейса', detail: 'Проследите reducer и производные значения, проверьте единый источник состояния.' },
  { id: 'accessibility', title: 'Доступность', detail: 'Проверьте движение фокуса, клавиатуру и сообщения об ошибках формы.' },
  { id: 'async', title: 'Асинхронные обновления', detail: 'Разберите поздние ответы, смену запроса и откат оптимистичного обновления.' },
  { id: 'performance', title: 'Производительность и архитектура', detail: 'Найдите длинную задачу, сетевую зависимость и границу кеша приложения.' },
] as const;
const generalPreparation = [
  { id: 'profile', title: 'Опыт и задачи', detail: 'Выберите рабочие примеры, в которых вы самостоятельно принимали решения.' },
  { id: 'fundamentals', title: 'Основы специализации', detail: 'Повторите основные понятия выбранного направления и объясните их на примерах.' },
  { id: 'errors', title: 'Разбор ошибок', detail: 'Вспомните найденные вами ошибки, причины и способы проверки исправления.' },
  { id: 'tradeoffs', title: 'Выбор решения', detail: 'Сравните доступные подходы и укажите ограничения каждого.' },
  { id: 'program', title: 'Программа проверки', detail: 'Изучите доступные программы Signal и выберите соответствующую специализации.' },
] as const;

function usePreparationPlan(specialization?: string) {
  const user = useGetCurrentUser().data?.user;
  const preparation = specialization === 'Frontend / TypeScript' ? frontendPreparation : specialization === 'Backend / Python' ? backendPreparation : generalPreparation;
  const programKey = specialization === 'Frontend / TypeScript' ? ':frontend-typescript' : specialization === 'Backend / Python' ? '' : ':general';
  const storageKey = user?.id ? `signal-preparation-v1:${user.id}${programKey}` : null;
  const [state, setState] = useState<{ key: string | null; checked: string[]; saved: boolean }>({ key: null, checked: [], saved: true });
  useEffect(() => {
    const read = () => {
      try {
        const stored: unknown = storageKey ? JSON.parse(localStorage.getItem(storageKey) || '[]') : [];
        const checked = Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string' && preparation.some(item => item.id === id)) : [];
        setState({ key: storageKey, checked: [...new Set(checked)], saved: true });
      } catch { setState({ key: storageKey, checked: [], saved: false }); }
    };
    read();
    const onStorage = (event: StorageEvent) => { if (event.key === storageKey || event.key === null) read(); };
    const onChange = (event: Event) => { if ((event as CustomEvent).detail === storageKey) read(); };
    window.addEventListener('storage', onStorage);
    window.addEventListener('signal-preparation-change', onChange);
    return () => { window.removeEventListener('storage', onStorage); window.removeEventListener('signal-preparation-change', onChange); };
  }, [storageKey, preparation]);
  const checked = state.key === storageKey ? state.checked : [];
  const toggle = (id: string) => {
    if (!storageKey) return;
    const next = checked.includes(id) ? checked.filter(item => item !== id) : [...checked, id];
    let saved = true;
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { saved = false; }
    setState({ key: storageKey, checked: next, saved });
    if (saved) window.dispatchEvent(new CustomEvent('signal-preparation-change', { detail: storageKey }));
  };
  return { checked, toggle, saved: state.saved, enabled: !!storageKey, topics: preparation };
}

function PreparationPlan({ onClose }: { onClose: () => void }) {
  const profile = useSelectedCandidateProfile().data;
  const plan = usePreparationPlan(profile?.specialization);
  const preparation = plan.topics;
  return <Dialog title="План подготовки" onClose={onClose}>
    <div className="guide-dialog-heading"><span className="guide-symbol"><BookOpen size={22} /></span><div><span className="guide-kicker">{profile?.specialization || 'ВАША ПОДГОТОВКА'}</span><h2>План подготовки</h2></div></div>
    <p className="guide-intro">Пять тем, к которым полезно вернуться перед проверкой навыков. Отмечайте то, что уже повторили.</p>
    <div className="preparation-progress"><span>{plan.checked.length} из {preparation.length} тем повторено</span><progress max={preparation.length} value={plan.checked.length} aria-label="Прогресс подготовки" /></div>
    <div className="preparation-checklist">{preparation.map(item => <label className={plan.checked.includes(item.id) ? 'is-complete' : ''} key={item.id}><input type="checkbox" checked={plan.checked.includes(item.id)} disabled={!plan.enabled} onChange={() => plan.toggle(item.id)} /><span><strong>{item.title}</strong><small>{item.detail}</small></span>{plan.checked.includes(item.id) && <Check size={16} aria-hidden="true" />}</label>)}</div>
    <p className="guide-footnote">{plan.saved ? 'Отметки сохраняются на этом устройстве.' : 'Не удалось сохранить отметки на устройстве. Они доступны до закрытия окна.'} Это ваш личный план: отметки не подтверждают навыки и не меняют уровень в профиле.</p>
    <div className="guide-dialog-actions"><Link className="button primary" href="/candidate/kalibr" onClick={onClose}>К проверке навыков <ArrowRight size={16} /></Link><button className="button secondary" onClick={onClose}>Продолжить позже</button></div>
  </Dialog>;
}

export function getWorkspaceGuideContent(role: Role, location: string): GuideContent {
  if (role === 'candidate') {
    if (location.startsWith('/candidate/kalibr')) return {
      title: 'Выберите следующую проверку', intro: 'Программа помогает подтвердить навыки для конкретных рабочих задач.',
      tips: ['Заполните профессиональный опрос в паспорте, чтобы выбрать подходящий стартовый уровень.', 'Выберите контекст задач и уровень проверки. Условия будут показаны перед началом.', 'Во время попытки сохраните ответы и завершите проверку до истечения времени. Результат появится в паспорте.'],
      href: '/candidate/passport', action: 'К профессиональному опросу',
    };
    if (location.startsWith('/candidate/passport')) return {
      title: 'Профиль, который помогает знакомиться', intro: 'Покажите свой опыт и настройте, кому доступен профиль.',
      tips: ['Укажите технологии, с которыми действительно работали, и желаемый формат работы.', 'Проверьте ожидания по оплате: период и сумма до или после вычета налогов важны для подбора.', 'Выберите видимость профиля. Контакты откроются компании после вашего согласия на приглашение.'],
      href: '/candidate/kalibr', action: 'Подтвердить навыки',
    };
    if (location.startsWith('/candidate/invitations')) return {
      title: 'Выберите подходящее предложение', intro: 'Решение о знакомстве с компанией остаётся за вами.',
      tips: ['Сравните задачи, формат работы и оплату с вашими ожиданиями.', 'Принимайте приглашение, когда готовы к общению: это откроет компании ваши контактные данные.', 'Если ваши планы изменились, обновите предпочтения в профиле.'],
      href: '/candidate/passport', action: 'Обновить предпочтения',
    };
    return {
      title: 'Ваш следующий шаг', intro: 'Соберите профиль, подтвердите навыки и выбирайте предложения компаний.',
      tips: ['Добавьте опыт, технологии и предпочтения в профиль.', 'Квалификационный экзамен Signal поможет подтвердить уровень в вашей специализации.', 'Просматривайте приглашения и делитесь контактами, когда готовы к знакомству.'],
      href: '/candidate/passport', action: 'Перейти к профилю',
    };
  }
  if (location.startsWith('/employer/candidates')) return {
    title: 'Найдите нужные навыки', intro: 'В банке собраны открытые для подбора профили с подтверждённым уровнем.',
    tips: ['Отфильтруйте профили по специализации, уровню и навыкам.', 'Технологии, указанные кандидатом, и подтверждённые навыки отображаются отдельно.', 'Для сопоставления с конкретной вакансией откройте подбор: он покажет совпадения и пробелы по её требованиям.'],
    href: '/employer/matches', action: 'К подбору по вакансии',
  };
  if (location.startsWith('/employer/matches')) return {
    title: 'На что смотреть при подборе', intro: 'Сопоставляйте требования с опытом и подтверждёнными навыками.',
    tips: ['Откройте кандидата, чтобы увидеть, какие требования подтверждены, а что ещё стоит обсудить.', 'Выберите два профиля для сравнения по одинаковым требованиям.', 'Учитывайте пробелы и условия кандидата. Балл соответствия помогает сориентироваться, но не предсказывает результат найма.'],
    href: '/employer', action: 'К моим вакансиям',
  };
  if (location.startsWith('/employer/invitations') || location.startsWith('/employer/contacts')) return {
    title: 'От приглашения к знакомству', intro: 'Понятное предложение помогает кандидату принять решение.',
    tips: ['Укажите задачи, оплату и формат работы до отправки приглашения.', 'Следите за статусом: после согласия кандидата появятся контакты.', 'Представьте компанию в её профиле, чтобы кандидат понимал, с кем будет общаться.'],
    href: '/employer/company', action: 'Открыть профиль компании',
  };
  if (location.startsWith('/employer/company')) return {
    title: 'Расскажите о вашей компании', intro: 'Эти сведения помогают кандидату оценить приглашение.',
    tips: ['Кратко опишите продукт и задачи команды.', 'Проверьте название, отрасль и контакт для связи.', 'Выберите удобный способ общения с кандидатами.'],
    href: '/employer', action: 'Перейти к вакансиям',
  };
  return {
    title: 'Начните с задач команды', intro: 'Точные требования делают подбор полезнее.',
    tips: ['Опишите роль и укажите навыки, необходимые для рабочих задач.', 'Добавьте уровень, формат работы и диапазон оплаты.', 'Откройте подбор, изучите подтверждения и пригласите подходящих кандидатов.'],
    href: '/employer/matches', action: 'Открыть подбор',
  };
}

export function WorkspaceGuide({ role, location, onOpen }: { role: Role; location: string; onOpen?: () => void }) {
  const [view, setView] = useState<'guide' | 'plan' | null>(null);
  useEffect(() => setView(null), [location, role]);
  const guide = getWorkspaceGuideContent(role, location);
  // Guidance is deliberately absent throughout assessment, including active attempts.
  if (location.startsWith('/candidate/kalibr')) return null;
  return <>
    <button className="workspace-guide" onClick={() => { onOpen?.(); setView('guide'); }} aria-label="Открыть помощник по разделу" data-testid="button-workspace-guide"><span className="guide-symbol"><Compass size={21} /></span><span><strong>Помощник</strong><small>{role === 'candidate' ? 'Подсказки и план подготовки' : 'Как найти нужного специалиста'}</small></span><ArrowRight className="guide-arrow" size={15} aria-hidden="true" /></button>
    {view === 'guide' && <Dialog title="Помощник по разделу" onClose={() => setView(null)}>
      <div className="guide-dialog-heading"><span className="guide-symbol"><Compass size={23} /></span><div><span className="guide-kicker">ПОДСКАЗКИ ПО РАЗДЕЛУ</span><h2>{guide.title}</h2></div></div>
      <p className="guide-intro">{guide.intro}</p>
      <ol className="guide-tips">{guide.tips.map(tip => <li key={tip}>{tip}</li>)}</ol>
      <div className="guide-dialog-actions"><Link className="button primary" href={guide.href} onClick={() => setView(null)}>{guide.action} <ArrowRight size={16} /></Link>{role === 'candidate' && <button className="button secondary" onClick={() => setView('plan')}><ListChecks size={17} />План подготовки</button>}</div>
    </Dialog>}
    {view === 'plan' && <PreparationPlan onClose={() => setView(null)} />}
  </>;
}

export function CandidateActions() {
  const [planOpen, setPlanOpen] = useState(false);
  const profile = useSelectedCandidateProfile().data;
  const plan = usePreparationPlan(profile?.specialization);
  const preparationIntro = profile?.specialization === 'Frontend / TypeScript' ? 'TypeScript, состояние, доступность и асинхронный интерфейс.' : profile?.specialization === 'Backend / Python' ? 'API, SQL, надёжность и ещё две темы.' : 'Рабочие задачи, основы специализации и разбор решений.';
  const hidden = profile && (profile.visibility === 'private' || !profile.consentMatching);
  return <section className="candidate-actions" aria-label="Полезные действия">
    <article className="candidate-action-card preparation-action"><span className="guide-symbol"><Sparkles size={22} /></span><div><span className="guide-kicker">ДЛЯ ВАШЕГО РОСТА</span><h2>Навыки в тонусе</h2><p>{preparationIntro} Подготовьтесь к следующей проверке в своём темпе.</p><button className="guide-text-action" onClick={() => setPlanOpen(true)} data-testid="button-preparation-plan">{plan.checked.length ? `Продолжить план · ${plan.checked.length}/${plan.topics.length}` : 'Открыть план подготовки'} <ArrowRight size={16} /></button></div></article>
    <article className="candidate-action-card"><span className="guide-symbol neutral"><UserRound size={22} /></span><div><span className="guide-kicker">ВАШИ ПРЕДПОЧТЕНИЯ</span><h2>{hidden ? 'Откройтесь возможностям' : 'Расскажите о себе точнее'}</h2><p>{hidden ? 'Профиль пока закрыт для подбора. Настройте видимость, если готовы рассматривать предложения.' : 'Укажите актуальные технологии, формат работы и ожидания по оплате, чтобы получать подходящие предложения.'}</p><Link className="guide-text-action" href="/candidate/passport">{hidden ? 'Настроить видимость' : 'Обновить профиль'} <ArrowRight size={16} /></Link></div></article>
    {planOpen && <PreparationPlan onClose={() => setPlanOpen(false)} />}
  </section>;
}
