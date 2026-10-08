import { inArray } from 'drizzle-orm';
import { db, signalNeedSkillLevelsTable } from '@workspace/db';
export { SkillLevelRequirementsSchema, validateSkillLevelRequirements, retainedSkillLevelRequirements } from './skill-level-requirements';
export async function loadNeedSkillLevels(ids: number[]) {
  if (process.env.SIGNAL_WORKSPACE_ENABLED !== 'true' || !ids.length) return new Map<number, Record<string, 'Junior' | 'Middle' | 'Senior'>>();
  const rows = await db.select().from(signalNeedSkillLevelsTable).where(inArray(signalNeedSkillLevelsTable.needId, ids));
  return new Map(rows.map(row => [row.needId, row.levels]));
}
