import { index, integer, pgTable, serial, text, timestamp, uniqueIndex, boolean } from 'drizzle-orm/pg-core';
import { signalCandidateResumesTable } from './signal-resume';
import { signalUsersTable } from './fsp-signal';

/** Events are current observations, never inferred historical traffic. One employer/account per UTC day. */
export const signalResumeEventsTable = pgTable('signal_resume_events', {
  id: serial('id').primaryKey(),
  resumeId: integer('resume_id').notNull().references(() => signalCandidateResumesTable.id, { onDelete: 'cascade' }),
  actorUserId: integer('actor_user_id').notNull().references(() => signalUsersTable.id, { onDelete: 'cascade' }),
  kind: text('kind', { enum: ['view', 'download'] }).notNull(),
  windowKey: text('window_key').notNull(),
  format: text('format', { enum: ['pdf', 'docx'] }),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex('signal_resume_event_dedup').on(t.resumeId, t.actorUserId, t.kind, t.windowKey), index('signal_resume_events_period').on(t.resumeId, t.occurredAt)]);

export const signalResumeWorkPreferencesTable = pgTable('signal_resume_work_preferences', {
  resumeId: integer('resume_id').primaryKey().references(() => signalCandidateResumesTable.id, { onDelete: 'cascade' }),
  location: text('location').notNull().default(''),
  schedule: text('schedule').notNull().default(''),
  employment: text('employment').notNull().default(''),
  relocation: boolean('relocation').notNull().default(false),
  startAvailability: text('start_availability').notNull().default(''),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
