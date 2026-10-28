import { bigint, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { signalCompaniesTable, signalUsersTable } from './fsp-signal';

export const signalDependencyEpochTable = pgTable('signal_dependency_epoch', {
  key: text('key').primaryKey(), revision: bigint('revision', { mode: 'bigint' }).notNull(),
});
export type ComputationVersions = { poolEpoch: string; algorithm: string; contextType: 'job' | 'need'; contextId: number; contextRevision: number; requirementsPolicy: string; actorId: number; companyId: number };
export const signalComputationTasksTable = pgTable('signal_computation_tasks', {
  id: uuid('id').primaryKey(), actorId: integer('actor_id').notNull().references(() => signalUsersTable.id, { onDelete: 'cascade' }),
  companyId: integer('company_id').notNull().references(() => signalCompaniesTable.id, { onDelete: 'cascade' }),
  contextType: text('context_type', { enum: ['job', 'need'] }).notNull(), contextId: integer('context_id').notNull(),
  kind: text('kind').notNull(), commandKey: text('command_key').notNull(), versions: jsonb('versions').$type<ComputationVersions>().notNull(),
  state: text('state', { enum: ['queued', 'running', 'ready', 'discarded_stale', 'failed'] }).notNull().default('queued'),
  input: jsonb('input').$type<Record<string, unknown>>().notNull(), result: jsonb('result').$type<Record<string, unknown>>(),
  leaseFence: integer('lease_fence').notNull().default(0), leaseUntil: timestamp('lease_until', { withTimezone: true }),
  errorCode: text('error_code'), createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex('signal_computation_command_unique').on(t.companyId, t.actorId, t.commandKey), index('signal_computation_poll_idx').on(t.state, t.leaseUntil)]);
