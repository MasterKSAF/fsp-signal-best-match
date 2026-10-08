import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { createInlineInfoEscapeLayers } from '../lib/inline-info-escape';
import './inline-info.css';

let escapeLayers: ReturnType<typeof createInlineInfoEscapeLayers> | undefined;

export function InlineInfo({ children, label = 'Подробнее', id }: { children: ReactNode; label?: string; id?: string }) {
  const generated = useId(); const tipId = id ?? `info-${generated}`;
  const button = useRef<HTMLButtonElement>(null); const tip = useRef<HTMLSpanElement>(null); const pinned = useRef(false); const suppressFocus = useRef(false); const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false); const [position, setPosition] = useState({ left: 0, top: 0 });
  const close = () => { pinned.current=false; setOpen(false); };
  const show = () => { if(closeTimer.current)clearTimeout(closeTimer.current); setOpen(true); };
  useLayoutEffect(()=>{
    if(!open||!button.current||!tip.current)return;
    const anchor=button.current.getBoundingClientRect(),box=tip.current.getBoundingClientRect();
    const below=anchor.bottom+8;
    setPosition({left:Math.max(12,Math.min(anchor.left,window.innerWidth-box.width-12)),top:Math.max(12,Math.min(below+box.height<=window.innerHeight-12?below:anchor.top-box.height-8,window.innerHeight-box.height-12))});
  },[open,children]);
  const leave = () => { if(!pinned.current && document.activeElement!==button.current)closeTimer.current=setTimeout(close,180); };
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !button.current?.contains(event.target) && !tip.current?.contains(event.target)) close(); };
    const unregister = (escapeLayers ??= createInlineInfoEscapeLayers(window)).register(() => {
      close(); suppressFocus.current=true;
      try { button.current?.focus({ preventScroll: true }); } finally { suppressFocus.current=false; }
    });
    document.addEventListener('pointerdown', outside); window.addEventListener('resize', close); window.addEventListener('scroll', close, true);
    return () => { unregister(); document.removeEventListener('pointerdown', outside); window.removeEventListener('resize', close); window.removeEventListener('scroll', close, true); if(closeTimer.current)clearTimeout(closeTimer.current); };
  }, [open]);
  return <span className="inline-info" onPointerEnter={event=>{if(event.pointerType!=='touch')show();}} onPointerLeave={event=>{if(event.pointerType!=='touch')leave();}}>
    <button ref={button} type="button" className="inline-info__button" aria-label={label} aria-expanded={open} aria-controls={open ? tipId : undefined} aria-describedby={open ? tipId : undefined} onFocus={() => { if(!suppressFocus.current)show(); }} onBlur={event => { if (!(event.relatedTarget instanceof Node) || !tip.current?.contains(event.relatedTarget)) close(); }} onClick={() => { if(pinned.current)close();else{pinned.current=true;show();} }}>i</button>
    {open && createPortal(<span ref={tip} id={tipId} role="tooltip" className="inline-info__tip" style={position} onPointerEnter={show} onPointerLeave={leave}>{children}</span>, document.body)}
  </span>;
}
