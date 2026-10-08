type ContextState = { type: 'job' | 'need'; status: string };
/** A closed vacancy exposes only previously pinned CVs, never a new pool. */
export function selectionReadPolicy(context: ContextState, view?: 'all' | 'shortlisted') {
  const active = context.type === 'need' ? context.status === 'active' : ['draft', 'published'].includes(context.status);
  const readOnly = context.type === 'job' && context.status === 'closed' && view === 'shortlisted';
  return { allowed: active || readOnly, readOnly };
}
export function withinSavedSelection(resumeIds: readonly number[], savedIds: ReadonlySet<number> | null) {
  return savedIds ? resumeIds.filter(id => savedIds.has(id)) : [...resumeIds];
}
