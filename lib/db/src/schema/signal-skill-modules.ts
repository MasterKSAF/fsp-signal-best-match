import { boolean, index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { signalUsersTable } from './fsp-signal';
import { signalCandidateResumesTable } from './signal-resume';

export type SkillLevel = 'Junior' | 'Middle' | 'Senior';
export type SkillModuleCase = { id: string; competencyId: string; title: string; prompt: string; responseType: 'integer' | 'text' | 'choice'; options?: { id: string; text: string }[]; critical: boolean; templateId: string; templateVersion: number; contentFamilyId?: string; middleOutcome?: string; seniorOutcome?: string; levelRequirementId?: string };
export type SkillModuleOracle = Record<string, { expected: string; explanation: string; rubricVersion: string; points: number; parts?: { expected: string; responseType: 'integer' | 'text' }[] }>;
export type SkillModuleDecision = { score: number; passed: boolean; criticalComplete: boolean; competencies: { id: string; passed: boolean; critical: boolean }[]; rubricVersion: string; levelCoverage?: { requirementId: string; passed: boolean }[] };
export const signalSkillAttemptsTable = pgTable('signal_skill_attempts', {
  id: serial('id').primaryKey(), userId: integer('user_id').notNull().references(() => signalUsersTable.id, { onDelete: 'cascade' }),
  resumeId: integer('resume_id').references(() => signalCandidateResumesTable.id, { onDelete: 'set null' }),
  skillId: text('skill_id').notNull(), level: text('level', { enum: ['Junior', 'Middle', 'Senior'] }).notNull(),
  programVersion: text('program_version').notNull(), status: text('status', { enum: ['active', 'submitted', 'expired'] }).notNull(),
  cases: jsonb('cases').$type<SkillModuleCase[]>().notNull(), oracles: jsonb('oracles').$type<SkillModuleOracle>().notNull(),
  answers: jsonb('answers').$type<Record<string, string>>().notNull().default({}), revision: integer('revision').notNull().default(1),
  policy: jsonb('policy').$type<{ durationMinutes: number; retryHours: number; maxDailyIssues: number; maxModuleDailyIssues: number; threshold: number; rubricVersion: string }>().notNull(),
  decision: jsonb('decision').$type<SkillModuleDecision>(), startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(), submittedAt: timestamp('submitted_at', { withTimezone: true }),
}, t => [index('signal_skill_attempt_owner_idx').on(t.userId, t.startedAt), index('signal_skill_attempt_module_idx').on(t.userId, t.skillId, t.level)]);

export const signalSkillExposuresTable = pgTable('signal_skill_exposures', {
  id: serial('id').primaryKey(), userId: integer('user_id').notNull().references(() => signalUsersTable.id, { onDelete: 'cascade' }),
  attemptId: integer('attempt_id').notNull().references(() => signalSkillAttemptsTable.id, { onDelete: 'cascade' }),
  templateId: text('template_id').notNull(), issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex('signal_skill_exposure_unique').on(t.attemptId, t.templateId), index('signal_skill_exposure_frequency_idx').on(t.templateId, t.issuedAt), index('signal_skill_exposure_owner_idx').on(t.userId, t.templateId)]);

export const signalSkillEvidenceTable = pgTable('signal_skill_evidence', {
  id: serial('id').primaryKey(), userId: integer('user_id').notNull().references(() => signalUsersTable.id, { onDelete: 'cascade' }),
  attemptId: integer('attempt_id').notNull().unique().references(() => signalSkillAttemptsTable.id, { onDelete: 'cascade' }),
  skillId: text('skill_id').notNull(), level: text('level', { enum: ['Junior', 'Middle', 'Senior'] }).notNull(),
  programVersion: text('program_version').notNull(), competencyIds: text('competency_ids').array().notNull(),
  verifiedAt: timestamp('verified_at', { withTimezone: true }).notNull(), decision: jsonb('decision').$type<SkillModuleDecision>().notNull(),
}, t => [index('signal_skill_evidence_owner_idx').on(t.userId, t.skillId)]);

export const signalSkillCorrectionsTable = pgTable('signal_skill_corrections', {
  id: serial('id').primaryKey(), evidenceId: integer('evidence_id').notNull().unique().references(() => signalSkillEvidenceTable.id, { onDelete: 'cascade' }),
  reason: text('reason').notNull(), operator: text('operator').notNull(), originalDecision: jsonb('original_decision').$type<SkillModuleDecision>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type SkillCategorySnapshot = { matrixVersion: string; specialization: string; grade: SkillLevel; targetGrade: SkillLevel; requirements: { id: string; skillId: string; level: SkillLevel; evidenceId: number; attemptId: number; programVersion: string; verifiedAt: string }[] };
export const signalSkillCategoriesTable = pgTable('signal_skill_categories', {
  id: serial('id').primaryKey(), userId: integer('user_id').notNull().references(() => signalUsersTable.id, { onDelete: 'cascade' }),
  resumeId: integer('resume_id').notNull().references(() => signalCandidateResumesTable.id, { onDelete: 'cascade' }),
  snapshotHash: text('snapshot_hash').notNull(), snapshot: jsonb('snapshot').$type<SkillCategorySnapshot>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex('signal_skill_category_snapshot_unique').on(t.resumeId, t.snapshotHash)]);
