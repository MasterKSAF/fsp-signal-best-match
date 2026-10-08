import { z } from 'zod';
import { canonicalSkillKey } from './skill-catalog';
import type { SignalGrade } from './signal-matching';

// A valid 100-character raw label can produce a longer stored key (raw: plus
// NFKC expansion). Allow that canonical representation through a reload too.
const RequirementKey = z.string().trim().min(1).max(2048)
  .refine(key=>key.length<=100 || key.startsWith('raw:') || key.startsWith('skill:'));
export const SkillLevelRequirementsSchema = z.record(RequirementKey, z.enum(['Junior', 'Middle', 'Senior']))
  .refine(value => Object.keys(value).length <= 40, 'Не более 40 требований по уровням.');

/** Labels and aliases enter through canonicalSkillKey; stored keys already in
 * the selected vocabulary are reused verbatim. Never canonicalize one twice. */
function requirementKey(value: string, selected: ReadonlySet<string>) {
  const trimmed = value.trim();
  return selected.has(trimmed) ? trimmed : canonicalSkillKey(value);
}
export function validateSkillLevelRequirements(value: unknown, skills: readonly string[]) {
  const parsed = SkillLevelRequirementsSchema.safeParse(value ?? {});
  if (!parsed.success) return parsed;
  const selected = new Set(skills.map(canonicalSkillKey));
  const data: Record<string, SignalGrade> = {};
  for (const [skill, grade] of Object.entries(parsed.data)) {
    const key = requirementKey(skill, selected);
    if (!selected.has(key) || (data[key] !== undefined && data[key] !== grade)) return { success: false as const };
    data[key] = grade;
  }
  return { success: true as const, data };
}

/** Missing level patches preserve the levels of retained skills; removing a
 * requirement removes only its level. Explicit {} is validated separately. */
export function retainedSkillLevelRequirements(levels: Readonly<Record<string, SignalGrade>>, skills: readonly string[]) {
  const selected = new Set(skills.map(canonicalSkillKey));
  const entries = Object.entries(levels).map(([skill, grade]) => [requirementKey(skill, selected), grade] as const)
    .filter(([key]) => selected.has(key));
  return Object.fromEntries(entries) as Record<string, SignalGrade>;
}
