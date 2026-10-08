import { integer, jsonb, pgTable } from 'drizzle-orm/pg-core';
import { signalNeedsTable } from './fsp-signal';
export const signalNeedSkillLevelsTable = pgTable('signal_need_skill_levels', {
  needId: integer('need_id').primaryKey().references(() => signalNeedsTable.id, { onDelete: 'cascade' }),
  levels: jsonb('levels').$type<Record<string, 'Junior' | 'Middle' | 'Senior'>>().notNull().default({}),
});
