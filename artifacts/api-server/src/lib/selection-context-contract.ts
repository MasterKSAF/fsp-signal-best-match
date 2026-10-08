import { z } from 'zod';
import { postgresIntIdSchema } from './postgres-id';
import type { MatchNeed, SignalGrade } from './signal-matching';
import { retainedSkillLevelRequirements } from './skill-level-requirements';

export const SelectionContextRefSchema = z.object({ type: z.enum(['need', 'job']), id: postgresIntIdSchema }).strict();
export type SelectionContextRef = z.infer<typeof SelectionContextRefSchema>;
export type SelectionContextDto = SelectionContextRef & {
  version: number; title: string; specialization: string; grade: SignalGrade;
  requiredSkills: string[]; requiredSkillLevels: Record<string, SignalGrade>;
  desirableSkills: string[]; description: string; workFormat: string;
  salaryMin: number; salaryMax: number; salaryPeriod: 'month' | 'year'; salaryType: 'gross' | 'net';
  status: string; updatedAt: string; shortlistCount?: number; applicationCount?: number;
};
export function selectionMatchNeed(context: SelectionContextDto): MatchNeed {
  return { specialization: context.specialization, grade: context.grade,
    requiredSkills: context.requiredSkills, requiredSkillLevels: retainedSkillLevelRequirements(context.requiredSkillLevels,context.requiredSkills),
    desirableSkills: context.desirableSkills, workFormat: context.workFormat,
    salaryMin: context.salaryMin, salaryMax: context.salaryMax,
    salaryPeriod: context.salaryPeriod, salaryType: context.salaryType };
}
export function selectionContextActive(context: Pick<SelectionContextDto, 'type' | 'status'>) {
  return context.type === 'need' ? context.status === 'active' : ['draft', 'published'].includes(context.status);
}
export function selectionContextKey(context: SelectionContextRef) { return `${context.type}:${context.id}`; }
export function requirementLevels(requirements: readonly {skill: string; level?: SignalGrade}[]) {
  return retainedSkillLevelRequirements(Object.fromEntries(requirements.filter(item => item.level).map(item => [item.skill, item.level!])), requirements.map(item => item.skill));
}

/** Merge only explicitly sent properties. Missing partial fields never reset data. */
export function mergePresentFields<T extends Record<string, unknown>>(current: T, patch: Partial<T>): T {
  return { ...current, ...Object.fromEntries(Object.entries(patch).filter(([,value]) => value !== undefined)) } as T;
}
