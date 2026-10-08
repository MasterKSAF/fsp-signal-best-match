import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, serial, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { signalCompaniesTable, signalNeedsTable, signalUsersTable } from './fsp-signal';
import { signalJobsTable } from './signal-opportunities';
import { signalCandidateResumesTable } from './signal-resume';

/** A saved person and one exact CV. It does not create sharing or an application. */
export const signalShortlistTable = pgTable('signal_shortlist', {
  id: serial('id').primaryKey(),
  companyId: integer('company_id').notNull().references(() => signalCompaniesTable.id, { onDelete: 'cascade' }),
  contextType: text('context_type', { enum: ['need', 'job'] }).notNull(),
  contextId: integer('context_id').notNull(),
  needId: integer('need_id').references(() => signalNeedsTable.id, { onDelete: 'restrict' }),
  jobId: integer('job_id').references(() => signalJobsTable.id, { onDelete: 'restrict' }),
  candidateUserId: integer('candidate_user_id').notNull().references(() => signalUsersTable.id, { onDelete: 'cascade' }),
  resumeId: integer('resume_id').notNull().references(() => signalCandidateResumesTable.id, { onDelete: 'cascade' }),
  contextVersion: integer('context_version').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [
  uniqueIndex('signal_shortlist_person_unique').on(t.companyId, t.contextType, t.contextId, t.candidateUserId),
  index('signal_shortlist_context_idx').on(t.companyId, t.contextType, t.contextId),
  check('signal_shortlist_context_check', sql`(${t.contextType} = 'need' AND ${t.needId} IS NOT NULL AND ${t.needId} = ${t.contextId} AND ${t.jobId} IS NULL) OR (${t.contextType} = 'job' AND ${t.jobId} IS NOT NULL AND ${t.jobId} = ${t.contextId} AND ${t.needId} IS NULL)`),
]);
