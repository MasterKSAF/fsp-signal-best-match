import { integer, jsonb, pgTable, text } from 'drizzle-orm/pg-core';
import { signalJobsTable } from './signal-opportunities';

/** Optional publication requirements. Legacy jobs retain unlevelled skills. */
export type JobSkillRequirement = { skill: string; level?: 'Junior' | 'Middle' | 'Senior' };
export const signalJobRequirementsTable = pgTable('signal_job_requirements', {
  jobId: integer('job_id').primaryKey().references(() => signalJobsTable.id, { onDelete: 'cascade' }),
  location: text('location').notNull().default(''),
  skillRequirements: jsonb('skill_requirements').$type<JobSkillRequirement[]>().notNull().default([]),
});
