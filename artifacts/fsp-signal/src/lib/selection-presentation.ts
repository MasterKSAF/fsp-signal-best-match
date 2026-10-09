import { contextRequirements, type RequirementContext } from './context-requirements';
import { normalizeDictionaryText } from './professional-dictionaries';

export type SelectionMatchView = {
  score: number | null; eligible?: boolean; summary?: string; salaryNote?: string | null;
  ineligibilityReasons?: string[]; gaps?: string[];
  evidence?: { requirement: string; satisfied?: boolean; reason?: string | null }[];
};
export type CandidateGrades = { verifiedGrade: string | null; declaredGrade?: string | null };

export function candidateGradeSummary(candidate: CandidateGrades): string {
  return `${candidate.verifiedGrade ? `Подтверждён: ${candidate.verifiedGrade}` : 'Грейд не подтверждён'}${candidate.declaredGrade ? ` · Заявлен: ${candidate.declaredGrade}` : ''}`;
}

const reasonLabels: Record<string, string> = {
  pool: 'Резюме относится к другому режиму аккаунта.',
  consent: 'Нет действующего согласия кандидата на подбор.',
  visibility: 'Кандидат ограничил доступ к резюме.',
  specialization: 'Специализация резюме не совпадает с требованиями.',
};

/** Admission reasons only: a missing desirable skill is not a failed requirement. */
export function selectionMismatchReasons(match: SelectionMatchView | null | undefined, context?: (RequirementContext & { grade?: string }) | null): string[] {
  if (match?.eligible !== false) return [];
  const codes = match.ineligibilityReasons ?? [];
  const reasons = codes.flatMap(code => reasonLabels[code] ? [reasonLabels[code]] : []);
  if (codes.includes('grade')) reasons.push(context?.grade
    ? `Нужен ${context.gradeMode === 'declared_or_verified' ? 'заявленный или подтверждённый' : 'подтверждённый'} общий грейд ${context.grade} или выше.`
    : 'Общий грейд не соответствует условиям выбранной вакансии или запроса.');
  if (codes.includes('required_skills')) {
    const required = new Set(context ? contextRequirements(context).map(item => normalizeDictionaryText(item.skill)) : []);
    const details = match.evidence?.filter(item => item.satisfied === false && required.has(normalizeDictionaryText(item.requirement)) && item.reason)
      .map(item => `${item.requirement}: ${item.reason}`) ?? [];
    reasons.push(...(details.length ? details : ['Не выполнены условия по обязательным навыкам.']));
  }
  return [...new Set(reasons.length ? reasons : ['Резюме не соответствует текущим требованиям.'])];
}
