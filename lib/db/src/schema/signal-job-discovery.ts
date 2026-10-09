import { check, integer, jsonb, pgTable, text } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { signalJobsTable } from './signal-opportunities';

/** Optional publication requirements. Legacy jobs retain unlevelled skills. */
export type JobSkillRequirement = { skill: string; mode?: 'verified' | 'declared_or_verified'; level?: 'Junior' | 'Middle' | 'Senior' };
export const signalJobRequirementsTable = pgTable('signal_job_requirements', {
  jobId: integer('job_id').primaryKey().references(() => signalJobsTable.id, { onDelete: 'cascade' }),
  location: text('location').notNull().default(''),
  skillRequirements: jsonb('skill_requirements').$type<JobSkillRequirement[]>().notNull().default([]),
},t=>[check('signal_job_requirements_modes_check',sql`signal_valid_skill_requirements(${t.skillRequirements})`)]);
