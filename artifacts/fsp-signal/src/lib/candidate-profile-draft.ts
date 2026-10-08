import type { CandidateProfile, CandidateProfileInput } from '@workspace/api-client-react';

export type CandidateProfileDraft = Omit<CandidateProfileInput, 'resumeId' | 'revision' | 'identityRevision'> & {
  title: string;
  consentCatalog: boolean;
  readyForOffers: boolean;
};

export function editableCandidateProfile(p: CandidateProfile & { title: string; consentCatalog: boolean; readyForOffers: boolean }): CandidateProfileDraft {
  return {
    title: p.title, consentCatalog: p.consentCatalog, readyForOffers: p.readyForOffers,
    displayName: p.displayName, professionalAlias: p.professionalAlias,
    specialization: p.specialization, assumedGrade: p.assumedGrade,
    stack: p.stack, skills: p.skills, yearsExperience: p.yearsExperience,
    workFormat: p.workFormat, salaryMin: p.salaryMin, salaryMax: p.salaryMax,
    salaryPeriod: p.salaryPeriod, salaryType: p.salaryType, visibility: p.visibility,
    consentMatching: p.consentMatching, phone: p.phone, contactEmail: p.contactEmail,
  };
}

/** Refresh untouched fields; preserve local edits for an explicit later save. */
export function reconcileProfileDraft<T extends object>(baseline: T, local: T, current: T) {
  const draft = { ...current };
  const overlappingFields: (keyof T)[] = [];
  const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  for (const key of Object.keys(local) as (keyof T)[]) {
    if (equal(local[key], baseline[key])) continue;
    draft[key] = local[key];
    if (!equal(current[key], baseline[key]) && !equal(local[key], current[key])) overlappingFields.push(key);
  }
  return { draft, overlappingFields };
}

export const profileFieldLabels: Partial<Record<keyof CandidateProfileDraft, string>> = {
  title: 'Название резюме', displayName: 'Имя для профиля', professionalAlias: 'Имя для подбора',
  phone: 'Телефон', contactEmail: 'Контактная почта', specialization: 'Специализация',
  assumedGrade: 'Заявленный уровень', stack: 'Технологический стек', skills: 'Заявленные навыки',
  yearsExperience: 'Опыт', workFormat: 'Формат работы', salaryMin: 'Зарплата от', salaryMax: 'Зарплата до',
  salaryPeriod: 'Период зарплаты', salaryType: 'Сумма зарплаты', visibility: 'Видимость',
  consentMatching: 'Доступ для подбора', consentCatalog: 'Доступ для каталога', readyForOffers: 'Готовность к предложениям',
};

export function profileDraftValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'Не указано';
  if (Array.isArray(value)) return value.join(', ') || 'Не указано';
  if (typeof value === 'boolean') return value ? 'Да' : 'Нет';
  const labels: Record<string, string> = { month: 'В месяц', year: 'В год', gross: 'До вычета налогов', net: 'На руки', private: 'Скрыт', pseudonymous: 'Псевдоним для работодателей', public: 'Открытое имя' };
  return labels[String(value)] ?? String(value);
}
