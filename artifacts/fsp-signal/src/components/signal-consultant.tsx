import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, MessageCircle, Send, Sparkles, X } from 'lucide-react';
import { Link, useSearch } from 'wouter';
import {topicReply,replyTo,consultantAttemptActive,type Role,type Topic,type Reply} from '../lib/signal-consultant-content';
import './signal-consultant.css';

type Message = Reply & { id: number; from: 'user' | 'assistant' };

const publicTopics: { id: Topic; label: string }[] = [
  { id: 'purpose', label: 'Для чего Signal?' },
  { id: 'how', label: 'Как это работает?' },
  { id: 'entry', label: 'Как начать?' },
];


/** Local product guidance; messages never leave this page or persist across sessions. */
export function SignalConsultant({ role, location, hidden = false, onOpenAuth }: { role?: Role; location: string; hidden?: boolean; onOpenAuth?: () => void }) {
  const search = useSearch();
  const [open, setOpen] = useState(false);
  const [modalPresent, setModalPresent] = useState(false);
  const [controlFocused,setControlFocused]=useState(false);
  const [actionCollision,setActionCollision]=useState(false);
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const sequence = useRef(0);
  const launcher = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const titleId = useId();
  const assessmentAttempt = consultantAttemptActive(location,search);
  const unavailable = hidden || modalPresent || assessmentAttempt || controlFocused || actionCollision;
  const topics = role ? [{ id: 'section' as const, label: 'Что сделать в этом разделе?' }, publicTopics[1], { id: 'entry' as const, label: 'С чего начать?' }] : publicTopics;

  useEffect(() => {
    const check = () => setModalPresent(Array.from(document.querySelectorAll<HTMLElement>('[aria-modal="true"]')).some(element => element.getClientRects().length > 0));
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-modal', 'hidden'] });
    return () => observer.disconnect();
  }, []);
  useEffect(() => { setOpen(false); setDraft(''); }, [location, search]);
  useEffect(()=>{
    let frame=0;
    const measure=()=>{
      frame=0;
      const active=document.activeElement;
      setControlFocused(active instanceof HTMLElement&&active.matches('input,textarea,select,[contenteditable="true"]')&&!active.closest('.signal-consultant'));
      if(open){setActionCollision(false);return;}
      const mobile=window.innerWidth<=700;const right=mobile?14:22;const bottom=mobile?14:18;
      const rect={left:window.innerWidth-right-46,right:window.innerWidth-right,top:window.innerHeight-bottom-46,bottom:window.innerHeight-bottom};
      setActionCollision(Array.from(document.querySelectorAll<HTMLElement>('.main-area button,.main-area a')).some(element=>{
        if(!element.getClientRects().length)return false;const box=element.getBoundingClientRect();
        return box.left<rect.right+6&&box.right>rect.left-6&&box.top<rect.bottom+6&&box.bottom>rect.top-6;
      }));
    };
    const schedule=()=>{if(!frame)frame=requestAnimationFrame(measure);};
    schedule();window.addEventListener('scroll',schedule,true);window.addEventListener('resize',schedule);document.addEventListener('focusin',schedule);document.addEventListener('focusout',schedule);
    const observer=new MutationObserver(schedule);observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden','open']});
    return()=>{cancelAnimationFrame(frame);observer.disconnect();window.removeEventListener('scroll',schedule,true);window.removeEventListener('resize',schedule);document.removeEventListener('focusin',schedule);document.removeEventListener('focusout',schedule);};
  },[open,location,search]);
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
