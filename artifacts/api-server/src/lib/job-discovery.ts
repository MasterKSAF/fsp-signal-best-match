import { z } from 'zod';
import type { JobSkillRequirement } from '../../../../lib/db/src/schema/signal-job-discovery';
import { RecruitingSkillRequirementSchema, interpretSkillRequirements } from './recruiting-requirements';

const optionalText = z.string().trim().max(160).optional().default('');
const queryBoolean = z.enum(['true', 'false']).optional().default('false').transform(value => value === 'true');
const grade = z.enum(['Junior', 'Middle', 'Senior']);
export const skillRequirementInput = RecruitingSkillRequirementSchema;
// A search describes records to find, including historical/custom levels. It
// does not create an employer requirement or promise a current examination.
const skillSearchInput = z.object({skill:z.string().trim().min(1).max(60),level:grade.optional()}).strict();
export const jobDetailsInput = z.object({
  location: z.string().trim().max(160).optional(),
  skillRequirements: z.array(skillRequirementInput).max(20).optional(),
}).strict();
const queryShape = {
  q: optionalText, specialization: optionalText, grade: z.union([grade, z.literal('')]).optional().default(''),
  workFormat: z.enum(['Удалённо', 'Офис', 'Гибрид', '']).optional().default(''), location: optionalText,
  salaryMin: z.coerce.number().int().min(0).max(100000000).optional(),
  salaryMax: z.coerce.number().int().min(0).max(100000000).optional(),
  salaryPeriod: z.enum(['month', 'year']).optional().default('month'),
  sort: z.enum(['newest', 'oldest', 'salary_desc', 'salary_asc']).optional().default('newest'),
  page: z.coerce.number().int().min(1).max(1000000).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
  skills: z.string().max(3000).optional().default('[]'),
  resumeId: z.coerce.number().int().positive().max(2147483647).optional(),
  hideApplied: queryBoolean,
  hideBlocked: queryBoolean,
};
export const jobSearchInput = z.object(queryShape).passthrough().superRefine((value, context) => {
  try {
    const result = z.array(skillSearchInput).max(20).safeParse(JSON.parse(value.skills));
    if (!result.success) throw new Error();
  } catch { context.addIssue({ code: 'custom', path: ['skills'], message: 'Проверьте фильтр навыков.' }); }
  if (value.salaryMin !== undefined && value.salaryMax !== undefined && value.salaryMin > value.salaryMax) {
    context.addIssue({ code: 'custom', path: ['salaryMax'], message: 'Минимум зарплаты не может быть больше максимума.' });
  }
});
export type JobSearchFilters = z.infer<typeof jobSearchInput>;
export const parseSkillFilters = (value: string): JobSkillRequirement[] => JSON.parse(value);
export const escapeLike = (value: string) => value.replace(/[\\%_]/g, character => `\\${character}`);
export const gradeWeight = (value: string | null | undefined) => (({ Junior: 1, Middle: 2, Senior: 3 } as Record<string,number>)[value ?? ''] ?? 0);

/** Exact skill identities only; a SQL test never confirms PostgreSQL by similarity. */
export function skillRequirementCovered(requirement: JobSkillRequirement, evidence: { skill: string; level?: string | null }[]) {
  return evidence.some(item => item.skill.trim().toLocaleLowerCase('en-US') === requirement.skill.trim().toLocaleLowerCase('en-US') &&
    (!requirement.level || gradeWeight(item.level) >= gradeWeight(requirement.level)));
}

export const JOB_EXPORT_LIMIT = 10000;
export const JOB_EXPORT_COLUMNS = ['Компания', 'Должность', 'Специализация', 'Общий грейд', 'Навыки и уровни', 'Зарплата от', 'Зарплата до', 'Валюта', 'Период', 'Налоги', 'Формат', 'Локация', 'Дата публикации', 'Ссылка'] as const;
export type ExportableJob = {
  id: number; companyName: string; title: string; specialization: string; grade: string; skills: string[];
  skillRequirements?: JobSkillRequirement[]; gradeMode?: 'verified'|'declared_or_verified'; salaryMin: number; salaryMax: number; salaryPeriod: string;
  salaryType: string; workFormat: string; location?: string; publishedAt: Date | string | null;
};
export function jobExportCells(job: ExportableJob, baseUrl: string) {
  const explicit = new Map((job.skillRequirements ?? []).map(item => [item.skill.toLowerCase(), item]));
  const skills = [...new Set([...job.skills, ...(job.skillRequirements ?? []).map(item => item.skill)])];
  return [job.companyName, job.title, job.specialization, `${job.grade} — ${job.gradeMode==='declared_or_verified'?'достаточно заявленного':'требуется подтверждение'}`,
    interpretSkillRequirements(skills,job.skillRequirements).map(item=>`${item.skill} — ${item.mode==='declared_or_verified'?'достаточно заявленного':`${item.level??'уровень не указан'} · требуется подтверждение`}`).join('; '),
    String(job.salaryMin), String(job.salaryMax), 'RUB', job.salaryPeriod === 'year' ? 'год' : 'месяц',
    job.salaryType === 'net' ? 'на руки' : 'до налогов', job.workFormat, job.location || 'Не указана',
    job.publishedAt ? new Date(job.publishedAt).toISOString() : '', `${baseUrl.replace(/\/$/, '')}/jobs?job=${job.id}`];
}
/** Prefix formula-like text after whitespace/control removal; quote every CSV cell. */
export function safeSpreadsheetText(value: unknown) {
  const text = String(value ?? '').replace(/\u0000/g, '');
  return /^[\s\u0000-\u001f]*[=+@\-]/u.test(text) ? `'${text}` : text;
}
export function jobsCsv(jobs: ExportableJob[], baseUrl: string) {
  const cells = (values: readonly string[]) => values.map(value => `"${safeSpreadsheetText(value).replace(/"/g, '""')}"`).join(',');
  return `\uFEFF${[cells(JOB_EXPORT_COLUMNS), ...jobs.map(job => cells(jobExportCells(job, baseUrl)))].join('\r\n')}\r\n`;
}
