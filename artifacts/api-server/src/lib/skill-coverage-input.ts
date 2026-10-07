import {z} from 'zod';
// Forty 100-code-unit values plus comma/space separators occupy at most 4078.
export const SKILL_COVERAGE_TEXT_LIMIT=4100;
export const SkillCoverageQuerySchema=z.object({
  specialization:z.string().trim().min(1).max(120),
  skills:z.string().max(SKILL_COVERAGE_TEXT_LIMIT).default(''),
}).strict();
