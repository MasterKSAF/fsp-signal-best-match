export type PassportLevel = 'Junior' | 'Middle' | 'Senior';
export type PassportSkillContext = { resumeId: number; state: 'declared' | 'recommended'; targetLevel: PassportLevel | null; reason: string | null };
export type PassportAccountSkill = { skillId: string | null; label: string; state: 'declared' | 'recommended'; resumeIds: number[]; contexts: PassportSkillContext[]; targetLevel: PassportLevel | null; verifiedLevel: PassportLevel | null };
export type BoundPassportSkill = PassportAccountSkill & { resumeId: number; reason: string | null };
const rank = { Junior: 1, Middle: 2, Senior: 3 };
export type PassportMode = 'all' | 'none' | `${number}`;
/** URL state belongs to this owner view, never to the global exact-CV selection. */
export function passportMode(raw: string | null, resumeIds: readonly number[]): PassportMode {
  if (raw === 'none') return 'none';
  if (raw && /^[1-9]\d*$/.test(raw) && resumeIds.includes(Number(raw))) return raw as `${number}`;
  return 'all';
}
export function passportProofs<T extends {skillId:string}>(proofs: readonly T[], mode: PassportMode, contexts: readonly {id:number;relatedSkillIds:string[]}[]): T[] {
  if (mode === 'all' || mode === 'none') return [...proofs];
  const related = new Set(contexts.find(context => String(context.id) === mode)?.relatedSkillIds ?? []);
  return proofs.filter(proof => related.has(proof.skillId));
}

/** Resolve displayed target and launch CV together. An active CV cannot override an explicit filter. */
export function bindPassportSkill(skill: PassportAccountSkill, filter: string, activeResumeId: number | null): BoundPassportSkill | null {
  if (filter === 'none') return null;
  const contexts = skill.contexts ?? [];
  if (filter !== 'all') {
    const selected = contexts.find(c => String(c.resumeId) === filter);
    return selected ? { ...skill, state: selected.state, targetLevel: selected.targetLevel, resumeId: selected.resumeId, resumeIds: [selected.resumeId], reason: selected.reason } : null;
  }
  const recommendations = contexts.filter(c => c.state === 'recommended' && c.targetLevel !== null);
  const pool = recommendations.length ? recommendations : contexts;
  const maxRank = Math.max(0, ...pool.map(c => c.targetLevel ? rank[c.targetLevel] : 0));
  const compatible = pool.filter(c => (c.targetLevel ? rank[c.targetLevel] : 0) === maxRank).sort((a,b) => a.resumeId - b.resumeId);
  const selected = compatible.find(c => c.resumeId === activeResumeId) ?? compatible[0];
  return selected ? { ...skill, state: selected.state, targetLevel: selected.targetLevel, resumeId: selected.resumeId, reason: selected.reason } : null;
}

/** Account proofs remain shared; only the context for a new next-level attempt is selected here. */
export function passportNextResume(filter: string, validResumeIds: number[], activeResumeId: number | null, recommendation: BoundPassportSkill | null): number | null {
  if (filter !== 'all') return validResumeIds.includes(Number(filter)) ? Number(filter) : null;
  return recommendation?.resumeId ?? (activeResumeId !== null && validResumeIds.includes(activeResumeId) ? activeResumeId : validResumeIds[0] ?? null);
}
