import { pgTable, uuid, integer, text, jsonb, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { signalCompaniesTable, signalUsersTable } from './fsp-signal';
import type { ComputationVersions } from './signal-computation';

export const signalRequirementPreviewsTable = pgTable('signal_requirement_previews', {
  id: uuid('id').primaryKey(), companyId: integer('company_id').notNull().references(() => signalCompaniesTable.id),
  actorId: integer('actor_id').notNull().references(() => signalUsersTable.id),
  contextType: text('context_type', { enum: ['job','need'] }).notNull(), contextId: integer('context_id').notNull(),
  baseRevision: integer('base_revision').notNull(), patchHash: text('patch_hash').notNull(),
  patch: jsonb('patch').$type<Record<string, unknown>>().notNull(), versions: jsonb('versions').$type<ComputationVersions>().notNull(),
  result: jsonb('result').$type<Record<string, unknown>>().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  appliedRevision: integer('applied_revision'), applyCommand: text('apply_command'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [index('signal_preview_rate_idx').on(t.companyId,t.contextType,t.contextId,t.createdAt)]);

/** Private employer history. No candidate/export DTO imports this relation. */
export const signalContextRevisionsTable = pgTable('signal_context_revisions', {
  id: uuid('id').primaryKey(), companyId: integer('company_id').notNull().references(() => signalCompaniesTable.id),
  actorId: integer('actor_id').notNull().references(() => signalUsersTable.id),
  contextType: text('context_type', { enum: ['job','need'] }).notNull(), contextId: integer('context_id').notNull(),
  revision: integer('revision').notNull(), parentRevision: integer('parent_revision').notNull(),
  previewId: uuid('preview_id').notNull().references(() => signalRequirementPreviewsTable.id),
  before: jsonb('before').$type<Record<string, unknown>>().notNull(), after: jsonb('after').$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex('signal_context_revision_unique').on(t.companyId,t.contextType,t.contextId,t.revision)]);
