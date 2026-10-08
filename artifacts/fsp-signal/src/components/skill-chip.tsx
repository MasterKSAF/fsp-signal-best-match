import { useState, type ReactNode } from 'react';
import { Check, Circle, Plus, Sparkles } from 'lucide-react';
import { InlineInfo } from './inline-info';
import './skill-chip.css';

export type SkillChipItem = { label: string; skillId?: string; status: 'verified' | 'declared' | 'recommended'; level?: string | null; source?: string };
/** Only a module proof with an explicit level can mark an individual technology as verified. */
export function employerSkillChips(stack: readonly string[], proofs: readonly {skill:string;sourceType?:string;level?:string;programVersion?:string|null}[] = []): SkillChipItem[] {
  return deduplicateSkillChips([...proofs.filter(p=>p.sourceType==='signal_skill_module' && ['Junior','Middle','Senior'].includes(p.level??'')).map(p=>({label:p.skill,status:'verified' as const,level:p.level,source:p.programVersion??undefined})),...stack.map(label=>({label,status:'declared' as const}))]);
}
export function canonicalSkillKey(label: string) {
  const key = label.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
  const aliases: Record<string, string> = { py: 'python', python3: 'python', 'python 3': 'python', ts: 'typescript', 'type script': 'typescript', 'react.js': 'react', reactjs: 'react', 'react js': 'react', 'backend engineering': 'backend-engineering', 'backend-инженерия': 'backend-engineering', 'frontend engineering': 'frontend-engineering', 'frontend-инженерия': 'frontend-engineering' };
  return aliases[key] ?? key;
}
export function deduplicateSkillChips(items: SkillChipItem[]) {
  const byKey = new Map<string, SkillChipItem>(); const priority = { verified: 3, declared: 2, recommended: 1 }; const levels: Record<string, number> = { Junior: 1, Middle: 2, Senior: 3 };
  for (const item of items) { const key = canonicalSkillKey(item.skillId ?? item.label); const previous = byKey.get(key); if (!previous || priority[item.status] > priority[previous.status] || (item.status === previous.status && (levels[item.level ?? ''] ?? 0) > (levels[previous.level ?? ''] ?? 0))) byKey.set(key, item); }
  return [...byKey.values()];
}
const statusLabels = { verified: 'Подтверждённый навык', declared: 'Заявленный навык', recommended: 'Рекомендованный навык' };
export function SkillChip({ label, status, level, source, children }: SkillChipItem & { children?: ReactNode }) {
  const Marker = status === 'verified' ? Check : status === 'recommended' ? Sparkles : Circle;
  return <span className={`signal-skill-chip signal-skill-chip--${status}`} title={source} data-skill-status={status} aria-label={`${statusLabels[status]}: ${label}${level ? `, ${level}` : ''}`}><Marker size={12} aria-hidden="true"/><span>{label}</span>{level && <span className="signal-skill-chip__level">· {level}</span>}{children}</span>;
}
/** Render once for a skills section, never once per candidate row or chip. */
export function SkillLegend({ info = true }: { info?: boolean }) {
  return <div className="signal-skill-legend" aria-label="Статусы навыков"><span className="signal-skill-legend__sample signal-skill-chip--verified"><Check size={12} aria-hidden="true"/>Подтверждён</span><span className="signal-skill-legend__sample signal-skill-chip--declared"><Circle size={11} aria-hidden="true"/>Заявлен</span><span className="signal-skill-legend__sample signal-skill-chip--recommended"><Sparkles size={12} aria-hidden="true"/>Рекомендован</span>{info && <InlineInfo label="Статусы навыков">Подтверждение относится к конкретному навыку и уровню. Заявленные навыки указал кандидат; рекомендация не подтверждает владение.</InlineInfo>}</div>;
}
export function SkillChips({ items, limit }: { items: SkillChipItem[]; limit?: number }) {
  const [expanded, setExpanded] = useState(false); const unique = deduplicateSkillChips(items); const shown = !limit || expanded ? unique : unique.slice(0, limit);
  return <div className="signal-skill-chips">{shown.map(item => <SkillChip key={canonicalSkillKey(item.skillId ?? item.label)} {...item}/>)}{!!limit && unique.length > limit && <button type="button" className="signal-skill-chips__more" aria-label={expanded ? 'Свернуть список навыков' : `Показать ещё ${unique.length - limit} навыка`} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? 'Свернуть' : <><Plus size={12} aria-hidden="true"/>{unique.length - limit}</>}</button>}</div>;
}
