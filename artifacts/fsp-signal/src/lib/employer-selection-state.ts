export type SelectionContext = { type: 'job' | 'need'; id: number } | null;
export type SelectionFilters = {
  q: string; specialization: string; grade: string; verifiedSkills: string; verifiedSkillsMode: string;
  verifiedSkillLevel: string; declaredSkills: string; declaredSkillsMode: string; experienceMin: string;
  workFormat: string; location: string; salaryMin: string; salaryMax: string; salaryPeriod: string;
  salaryType: string; fsp: string; experienceMax: string; hasPhoto: string; readyForOffers: string; checkedWithinDays: string;
};
export const emptySelectionFilters: SelectionFilters = {
  q: '', specialization: '', grade: '', verifiedSkills: '', verifiedSkillsMode: 'all', verifiedSkillLevel: '',
  declaredSkills: '', declaredSkillsMode: 'all', experienceMin: '', workFormat: '', location: '',
  salaryMin: '', salaryMax: '', salaryPeriod: 'month', salaryType: 'gross', fsp: '', experienceMax: '', hasPhoto: '', readyForOffers: '', checkedWithinDays: '',
};
export type SelectionState = {
  context: SelectionContext; mode?: 'catalog'; filters: SelectionFilters; applied: boolean;
  page: number; pageSize: number; view: 'all' | 'shortlisted'; sort: string; direction: 'asc' | 'desc';
  resumeId: number | null; candidateId: number | null; invite: boolean;
  invalidContext: boolean;
};
const positiveId = (value: string | null) => value && /^\d+$/.test(value) && Number(value) > 0 && Number(value) <= 2147483647 ? Number(value) : null;
export const selectionContextKey = (context: SelectionContext) => context ? `${context.type}:${context.id}` : 'catalog';
export const splitSelectionSkills = (value: string) => [...new Set(value.split(',').map(part => part.trim()).filter(Boolean))];
export function readSelectionState(search: string, pathname = '/employer/selection'): SelectionState {
  const params = new URLSearchParams(search);
  const typedId = positiveId(params.get('contextId'));
  const legacyNeed = positiveId(params.get('need') ?? params.get('needId'));
  const legacyJob = positiveId(params.get('job') ?? params.get('jobId'));
  const kind = params.get('contextType');
  const invalidContext = (params.has('contextType') || params.has('contextId')) && (!typedId || (kind !== 'need' && kind !== 'job')) ||
    (params.has('need') || params.has('needId')) && !legacyNeed || (params.has('job') || params.has('jobId')) && !legacyJob;
  const context: SelectionContext = typedId && (kind === 'need' || kind === 'job') ? { type: kind, id: typedId }
    : legacyJob ? { type: 'job', id: legacyJob } : legacyNeed ? { type: 'need', id: legacyNeed } : null;
  const filters = { ...emptySelectionFilters };
  for (const key of Object.keys(filters) as (keyof SelectionFilters)[]) {
    if (params.has(key)) filters[key] = params.get(key) ?? '';
  }
  filters.q = params.get('q') ?? params.get('search') ?? filters.q;
  filters.verifiedSkills = params.get('verifiedSkills') ?? params.get('skills') ?? '';
  const legacyCatalog = pathname === '/employer/candidates' && !!legacyNeed;
  const sort = params.get('sort') ?? (context ? 'recommended' : 'grade');
  return {
    context, ...(params.get('mode') === 'catalog' || legacyCatalog ? { mode: 'catalog' as const } : {}), filters,
    applied: params.get('applied') === '1' || (pathname === '/employer/matches' && !!context) ||
      (pathname === '/employer/candidates' && [...params.keys()].some(key => !['resume', 'resumeId'].includes(key))),
    page: positiveId(params.get('page')) ?? 1, pageSize: Math.min(50, positiveId(params.get('pageSize')) ?? 20),
    view: context && params.get('view') === 'shortlisted' ? 'shortlisted' : 'all',
    sort: ['recommended', 'grade', 'experience', 'salary', 'updated', 'name'].includes(sort) ? sort : context ? 'recommended' : 'grade',
    direction: params.get('direction') === 'asc' ? 'asc' : 'desc',
    resumeId: positiveId(params.get('resume') ?? params.get('resumeId')), candidateId: positiveId(params.get('candidate')),
    invite: params.get('invite') === '1',
    invalidContext,
  };
}
export function selectionParams(state: SelectionState, forApi = false): URLSearchParams {
  const params = new URLSearchParams();
  if (state.context) { params.set('contextType', state.context.type); params.set('contextId', String(state.context.id)); }
  if (state.mode) params.set('mode', state.mode);
  if (!forApi && state.applied) params.set('applied', '1');
  for (const key of Object.keys(state.filters) as (keyof SelectionFilters)[]) {
    const value = state.filters[key];
    const subordinate = (key === 'verifiedSkillsMode' || key === 'verifiedSkillLevel') && !state.filters.verifiedSkills ||
      key === 'declaredSkillsMode' && !state.filters.declaredSkills ||
      (key === 'salaryPeriod' || key === 'salaryType') && !state.filters.salaryMin && !state.filters.salaryMax;
    if (value && !subordinate) params.set(key, value);
  }
  params.set('page', String(state.page)); params.set('pageSize', String(state.pageSize));
  if (state.view === 'shortlisted') params.set('view', state.view);
  params.set('sort', state.sort); params.set('direction', state.direction);
  if (!forApi && state.resumeId) params.set('resume', String(state.resumeId));
  if (!forApi && state.candidateId) params.set('candidate', String(state.candidateId));
  if (!forApi && state.invite) params.set('invite', '1');
  return params;
}
export function selectionHref(state: SelectionState) { return `/employer/selection?${selectionParams(state)}`; }
export function selectionDraftKey(state: Pick<SelectionState, 'context' | 'mode' | 'filters'>) {
  return JSON.stringify([selectionContextKey(state.context), state.mode ?? '', state.filters]);
}
export function activeSelectionFilters(filters: SelectionFilters): (keyof SelectionFilters)[] {
  return (['q', 'specialization', 'grade', 'verifiedSkills', 'declaredSkills', 'experienceMin', 'workFormat', 'location', 'salaryMin', 'salaryMax', 'fsp', 'experienceMax', 'hasPhoto', 'readyForOffers', 'checkedWithinDays'] as const).filter(key => !!filters[key]);
}
