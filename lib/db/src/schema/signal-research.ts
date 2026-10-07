import { check, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { signalUsersTable, type SignalCase } from './fsp-signal';

export type ResearchProtocolSnapshot = {
  frozenAt: string; programVersion: string; scoreThreshold: number; criticalCriteriaRequired: true;
  forms: Record<'A' | 'B', { cases: SignalCase[]; oracles: Record<string, unknown>; templateIds: string[] }>;
};

export const signalResearchStudiesTable = pgTable('signal_research_studies', {
  id: serial('id').primaryKey(), ownerUserId: integer('owner_user_id').notNull().references(() => signalUsersTable.id, { onDelete: 'cascade' }),
  title: text('title').notNull(), programId: text('program_id').notNull(), grade: text('grade', { enum: ['Junior', 'Middle', 'Senior'] }).notNull(),
  status: text('status', { enum: ['open', 'closed'] }).notNull().default('open'), retentionDays: integer('retention_days').notNull().default(30),
  measurementOrigin: text('measurement_origin', { enum: ['synthetic', 'operator_declared_human'] }).notNull().default('synthetic'),
  // Immutable private bank/threshold snapshot. Null marks a legacy study, never an invented protocol.
  protocolSnapshot: jsonb('protocol_snapshot').$type<ResearchProtocolSnapshot>(),
  protocolVersion: text('protocol_version').notNull().default('signal-research-v1'), createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [check('signal_research_retention_check', sql`${table.retentionDays} between 1 and 90`)]);

export const signalResearchEnrollmentsTable = pgTable('signal_research_enrollments', {
  id: serial('id').primaryKey(), studyId: integer('study_id').notNull().references(() => signalResearchStudiesTable.id, { onDelete: 'cascade' }),
  userId: integer('user_id').notNull().references(() => signalUsersTable.id, { onDelete: 'cascade' }), pseudonym: text('pseudonym').notNull(),
  order: text('form_order', { enum: ['AB', 'BA'] }).notNull(), status: text('status', { enum: ['active', 'revoked', 'expired'] }).notNull().default('active'),
  independentGrade: text('independent_grade', { enum: ['Junior', 'Middle', 'Senior'] }), independentBasis: text('independent_basis'),
  groupAssignedAt: timestamp('group_assigned_at', { withTimezone: true }), consentVersion: text('consent_version').notNull(),
  consentedAt: timestamp('consented_at', { withTimezone: true }).notNull().defaultNow(), expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(), revokedAt: timestamp('revoked_at', { withTimezone: true }),
}, table => [uniqueIndex('signal_research_enrollment_unique').on(table.studyId, table.userId), uniqueIndex('signal_research_pseudonym_unique').on(table.pseudonym)]);

export type ResearchResponse = { caseId: string; answer: string; activeMs: number; skipped: boolean; ambiguous: boolean; firstSavedAt: string; lastSavedAt: string; savedAtSource?: 'answer_save' | 'missing_at_submit' };
export type ResearchResult = { score: number; verified: boolean; evidence: { skill: string; score: number; criterionId: string | null; programVersion: string; templateId: string | null; templateVersion: number | null }[] };
export const signalResearchAttemptsTable = pgTable('signal_research_attempts', {
  id: serial('id').primaryKey(), enrollmentId: integer('enrollment_id').notNull().references(() => signalResearchEnrollmentsTable.id, { onDelete: 'cascade' }),
  form: text('form', { enum: ['A', 'B'] }).notNull(), programVersion: text('program_version').notNull(),
  status: text('status', { enum: ['in_progress', 'submitted', 'expired'] }).notNull().default('in_progress'),
  cases: jsonb('cases').$type<SignalCase[]>().notNull(), oracles: jsonb('oracles').$type<Record<string, unknown>>().notNull(),
  responses: jsonb('responses').$type<ResearchResponse[]>().notNull().default([]), result: jsonb('result').$type<ResearchResult>(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(), dueAt: timestamp('due_at', { withTimezone: true }).notNull(), submittedAt: timestamp('submitted_at', { withTimezone: true }),
}, table => [uniqueIndex('signal_research_form_unique').on(table.enrollmentId, table.form)]);

export const signalResearchRatingsTable = pgTable('signal_research_ratings', {
  id: serial('id').primaryKey(), studyId: integer('study_id').notNull().references(() => signalResearchStudiesTable.id, { onDelete: 'cascade' }),
  reviewerId: text('reviewer_id').notNull(), sourceSha256: text('source_sha256').notNull(),
  // Independent assessments keyed only by pseudonym; original submissions are append-only.
  ratings: jsonb('ratings').$type<{ pseudonym: string; grade: 'Junior' | 'Middle' | 'Senior'; comment: string }[]>().notNull(),
  importedAt: timestamp('imported_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [uniqueIndex('signal_research_reviewer_unique').on(table.studyId, table.reviewerId)]);
