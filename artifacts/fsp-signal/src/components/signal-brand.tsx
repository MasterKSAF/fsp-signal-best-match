import type { CSSProperties } from 'react';
import { Link } from 'wouter';
import { Sparkles } from 'lucide-react';
import './signal-brand.css';

/** The visible letters are decorative; the link has one complete accessible name. */
export function SignalBrand({ href = '/', dark = false }: { href?: string; dark?: boolean }) {
  return <Link href={href} className={`signal-brand${dark ? ' signal-brand--on-dark' : ''}`} aria-label="Signal — на главную" data-testid="link-signal-home">
    <span className="signal-brand__word signal-wordmark" aria-hidden="true">{[...'Signal'].map((letter, index) => <span
      key={`${letter}-${index}`}
      className={`signal-brand__letter signal-brand__letter--${letter.toLowerCase()}`}
      data-letter={letter}
      style={{ '--signal-letter-index': index } as CSSProperties}
    >{letter}</span>)}</span><Sparkles className="signal-brand__spark" size={20} strokeWidth={1.65} aria-hidden="true" />
  </Link>;
}
