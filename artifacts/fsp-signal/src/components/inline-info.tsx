import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { createInlineInfoEscapeLayers } from '../lib/inline-info-escape';
import { infoBounds, infoPosition } from '../lib/inline-info-position';
import './inline-info.css';

let escapeLayers: ReturnType<typeof createInlineInfoEscapeLayers> | undefined;

export function InlineInfo({ children, label = 'Подробнее', id }: { children: ReactNode; label?: string; id?: string }) {
  const generated = useId(); const tipId = id ?? `info-${generated}`;
  const button = useRef<HTMLButtonElement>(null); const tip = useRef<HTMLSpanElement>(null); const pinned = useRef(false); const suppressFocus = useRef(false); const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false); const [position, setPosition] = useState({ left: 0, top: 0, maxWidth:280, maxHeight:600 });
  const close = () => { pinned.current=false; setOpen(false); };
  const show = () => { if(closeTimer.current)clearTimeout(closeTimer.current); setOpen(true); };
  useLayoutEffect(()=>{
    if(!open||!button.current||!tip.current)return;
    const reposition=()=>{
      if(!button.current||!tip.current)return;
      const viewport=window.visualViewport;
      const bounds=infoBounds({left:viewport?.offsetLeft??0,top:viewport?.offsetTop??0,width:viewport?.width??window.innerWidth,height:viewport?.height??window.innerHeight},button.current.closest('[role="dialog"]')?.getBoundingClientRect());
      const limits=infoPosition(button.current.getBoundingClientRect(),{width:280,height:0},bounds);
      tip.current.style.maxWidth=`${limits.maxWidth}px`;tip.current.style.maxHeight=`${limits.maxHeight}px`;
      const next=infoPosition(button.current.getBoundingClientRect(),tip.current.getBoundingClientRect(),bounds);
      setPosition(previous=>Object.keys(next).every(key=>next[key as keyof typeof next]===previous[key as keyof typeof previous])?previous:next);
    };
    reposition();
    const observer=new ResizeObserver(reposition);observer.observe(tip.current);
    window.addEventListener('resize',reposition);window.visualViewport?.addEventListener('resize',reposition);window.visualViewport?.addEventListener('scroll',reposition);
    return()=>{observer.disconnect();window.removeEventListener('resize',reposition);window.visualViewport?.removeEventListener('resize',reposition);window.visualViewport?.removeEventListener('scroll',reposition);};
  },[open,children]);
  const leave = () => { if(!pinned.current && document.activeElement!==button.current)closeTimer.current=setTimeout(close,180); };
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !button.current?.contains(event.target) && !tip.current?.contains(event.target)) close(); };
    const unregister = (escapeLayers ??= createInlineInfoEscapeLayers(window)).register(() => {
      close(); suppressFocus.current=true;
      try { button.current?.focus({ preventScroll: true }); } finally { suppressFocus.current=false; }
    });
    const scroll=(event:Event)=>{if(event.target instanceof Node&&tip.current?.contains(event.target))return;close();};
    document.addEventListener('pointerdown', outside); window.addEventListener('scroll', scroll, true);
    return () => { unregister(); document.removeEventListener('pointerdown', outside); window.removeEventListener('scroll', scroll, true); if(closeTimer.current)clearTimeout(closeTimer.current); };
  }, [open]);
  return <span className="inline-info" onPointerEnter={event=>{if(event.pointerType!=='touch')show();}} onPointerLeave={event=>{if(event.pointerType!=='touch')leave();}}>
    <button ref={button} type="button" className="inline-info__button" aria-label={label} aria-expanded={open} aria-controls={open ? tipId : undefined} aria-describedby={open ? tipId : undefined} onKeyDown={event=>{if(open&&['ArrowDown','ArrowUp','PageDown','PageUp'].includes(event.key)){event.preventDefault();tip.current?.scrollBy({top:(event.key.endsWith('Down')?1:-1)*(event.key.startsWith('Page')?180:40)});}}} onFocus={() => { if(!suppressFocus.current)show(); }} onBlur={event => { if (!(event.relatedTarget instanceof Node) || !tip.current?.contains(event.relatedTarget)) close(); }} onClick={() => { if(pinned.current)close();else{pinned.current=true;show();} }}>i</button>
    {open && createPortal(<span ref={tip} id={tipId} role="tooltip" className="inline-info__tip" style={position} onPointerEnter={show} onPointerLeave={leave}>{children}</span>, document.body)}
  </span>;
}
