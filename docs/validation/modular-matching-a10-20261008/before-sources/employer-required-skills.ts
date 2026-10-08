import { z } from 'zod';
import { canonicalSkillLabels, normalizeSkillSearchToken } from './skill-catalog';

/** Validate every original item before deduplication; blanks never disappear. */
export const EmployerRequiredSkills = z.array(
  z.string().max(100)
    .transform(value => value.normalize('NFKC').trim())
    .pipe(z.string().min(1).max(100)),
).min(1).max(40).transform(canonicalSkillLabels);

/** Historical invalid needs remain stored, but cannot admit anyone. */
export function hasMeaningfulRequiredSkills(skills: readonly string[]): boolean {
  return skills.length >= 1 && skills.length <= 40 && skills.every(
    value => value.length <= 100 && value.normalize('NFKC').trim().length <= 100 && normalizeSkillSearchToken(value).length > 0,
  );
}
