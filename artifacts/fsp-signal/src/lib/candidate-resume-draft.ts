export type ResumeAnswerKey = 'python' | 'databases' | 'api' | 'testing' | 'reliability' | 'ownership' | 'typescript' | 'state' | 'accessibility' | 'performance' | 'architecture';
export type ResumeQuestionnaire = { version: 'backend-python-v1' | 'frontend-typescript-v1'; industry: string; specialization: 'Backend / Python' | 'Frontend / TypeScript'; answers: Partial<Record<ResumeAnswerKey, number | null>> };
export type ResumeInput = {
  summary: string; softSkills: string[];
  experience: { company: string; role: string; start: string; end: string | null; description: string }[];
  projects: { title: string; role: string; description: string; url: string | null }[];
  education: { institution: string; qualification: string; start: string; end: string | null }[];
  portfolio: { title: string; url: string }[];
  questionnaire: ResumeQuestionnaire;
};
export type ResumeContentField = keyof ResumeInput;
export const resumeContentFields: ResumeContentField[] = ['summary', 'softSkills', 'experience', 'projects', 'education', 'portfolio', 'questionnaire'];
export const resumeContentLabels: Record<ResumeContentField, string> = {
  summary: 'О себе', softSkills: 'Личные навыки', experience: 'Опыт работы', projects: 'Проекты',
  education: 'Образование и курсы', portfolio: 'Портфолио и ссылки', questionnaire: 'Профессиональный опрос',
};

/** JSONB can reorder object keys. Arrays retain their user-defined order. */
export function resumeContentEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => resumeContentEqual(value, b[index]));
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && resumeContentEqual(left[key], right[key]));
}

/** Read older tab-memory caches without rewriting any saved résumé. */
export function resumeDraftBaseline(value: ResumeInput | string | null | undefined): ResumeInput | null {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return parsed && typeof parsed.summary === 'string' && resumeContentFields.every(key => Object.hasOwn(parsed, key)) && parsed.questionnaire && typeof parsed.questionnaire.version === 'string' ? parsed as ResumeInput : null;
  } catch { return null; }
}

/** A proposal only: callers must obtain explicit choices and then use the current revision. */
export function prepareResumeDraftRecovery(baseline: ResumeInput | null, local: ResumeInput, current: ResumeInput) {
  const draft = { ...current };
  const overlappingFields: ResumeContentField[] = [];
  for (const key of resumeContentFields) {
    if (baseline && resumeContentEqual(local[key], baseline[key])) continue;
    Object.assign(draft, { [key]: local[key] });
    if ((!baseline || !resumeContentEqual(current[key], baseline[key])) && !resumeContentEqual(local[key], current[key])) overlappingFields.push(key);
  }
  const programChanged = local.questionnaire.version !== current.questionnaire.version || local.questionnaire.specialization !== current.questionnaire.specialization;
  if (programChanged) {
    // Answers belong to their program, including similarly named questions. Keep
    // them separately; never copy ownership or language answers into a new program.
    draft.questionnaire = { ...current.questionnaire, industry: local.questionnaire.industry };
    const index = overlappingFields.indexOf('questionnaire');
    if (index !== -1) overlappingFields.splice(index, 1);
  }
  return { draft, overlappingFields, programChanged, previousQuestionnaire: programChanged ? local.questionnaire : null };
}

export function resolveResumeDraftRecovery(recovery: ReturnType<typeof prepareResumeDraftRecovery>, current: ResumeInput, choices: Partial<Record<ResumeContentField, 'local' | 'current'>>, acceptedProgram: boolean): ResumeInput | null {
  if (recovery.overlappingFields.some(key => !choices[key]) || (recovery.programChanged && !acceptedProgram)) return null;
  const content = { ...recovery.draft };
  for (const key of recovery.overlappingFields) if (choices[key] === 'current') Object.assign(content, { [key]: current[key] });
  return content;
}

export function resumeContentValue(key: ResumeContentField, value: ResumeInput[ResumeContentField]): string {
  if (typeof value === 'string') return value || 'Не заполнено';
  if (key === 'softSkills') return (value as string[]).join(', ') || 'Не заполнено';
  if (key === 'questionnaire') {
    const q = value as ResumeQuestionnaire;
    const labels: Record<ResumeAnswerKey, string> = { python: 'Python', databases: 'Базы данных', api: 'API', testing: 'Тестирование', reliability: 'Надёжность', ownership: 'Ответственность', typescript: 'TypeScript', state: 'Состояние интерфейса', accessibility: 'Доступность', performance: 'Производительность', architecture: 'Архитектура' };
    return `${q.specialization}\n${q.industry}\n${Object.entries(q.answers).map(([answer, score]) => `${labels[answer as ResumeAnswerKey] ?? answer}: ${score == null ? 'нет ответа' : score}`).join(', ')}`;
  }
  if (Array.isArray(value)) return value.map((row, index) => `${index + 1}. ${Object.values(row).filter(item => item !== null && item !== '').join(' · ')}`).join('\n\n') || 'Не заполнено';
  return 'Не заполнено';
}
