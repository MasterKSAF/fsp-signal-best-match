import { integer, jsonb, pgTable, text, timestamp, uuid, uniqueIndex } from 'drizzle-orm/pg-core';
import type { SkillModuleDecision } from './signal-skill-modules';
export const signalExpertGrantsTable = pgTable('signal_expert_grants', {
 id: uuid('id').primaryKey(), userId: integer('user_id').notNull(), grantedBy: text('granted_by').notNull(),
 authority: text('authority').notNull(), expiresAt: timestamp('expires_at',{withTimezone:true}).notNull(), revokedAt: timestamp('revoked_at',{withTimezone:true}),
});
export const signalAssessmentAppealsTable = pgTable('signal_assessment_appeals', {
 id: uuid('id').primaryKey(), userId: integer('user_id').notNull(), kind: text('kind',{enum:['skill','legacy']}).notNull(), attemptId: integer('attempt_id').notNull(),
 reason: text('reason').notNull(), status: text('status',{enum:['open','in_review','resolved']}).notNull().default('open'), revision: integer('revision').notNull().default(1),
 cycle: integer('cycle').notNull().default(1), groundsHashes: text('grounds_hashes').array().notNull(),
 createdAt: timestamp('created_at',{withTimezone:true}).notNull().defaultNow(), updatedAt: timestamp('updated_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[uniqueIndex('signal_appeal_attempt_unique').on(t.kind,t.attemptId)]);
export const signalAppealMessagesTable = pgTable('signal_appeal_messages', {
 id: uuid('id').primaryKey(), appealId: uuid('appeal_id').notNull(), authorId: integer('author_id').notNull(), authorityId: uuid('authority_id'),
 visibility: text('visibility',{enum:['candidate','internal']}).notNull(), body: text('body').notNull(), createdAt: timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
});
export const signalAssessmentHeadsTable = pgTable('signal_assessment_heads', {
 id: text('id').primaryKey(), userId: integer('user_id').notNull(), kind: text('kind',{enum:['skill','legacy']}).notNull(), attemptId: integer('attempt_id').notNull(),
 revision: integer('revision').notNull().default(1), decisionId: uuid('decision_id'), validity: text('validity',{enum:['original','valid','invalid']}).notNull().default('original'),
 decision: jsonb('decision').$type<SkillModuleDecision>(), updatedAt: timestamp('updated_at',{withTimezone:true}).notNull().defaultNow(),
});
export const signalAssessmentReviewDecisionsTable = pgTable('signal_assessment_review_decisions', {
 id: uuid('id').primaryKey(), appealId: uuid('appeal_id').notNull(), actorId: integer('actor_id').notNull(), authorityId: uuid('authority_id').notNull(), authority: text('authority').notNull(),
 commandKey: uuid('command_key').notNull().unique(), payloadHash: text('payload_hash').notNull(), supersedes: uuid('supersedes'), previousRevision: integer('previous_revision').notNull(), revision: integer('revision').notNull(),
 action: text('action',{enum:['confirm','correct','invalidate','new_check']}).notNull(), explanation: text('explanation').notNull(), internalNote: text('internal_note').notNull(),
 source: jsonb('source').$type<Record<string,unknown>>().notNull(), affectedSkills: text('affected_skills').array().notNull(),
 caseReviews: jsonb('case_reviews').$type<{caseId:string;passed:boolean;basis:string}[]>().notNull(), projection: jsonb('projection').notNull(),
 createdAt: timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
});
export const signalQualificationProjectionEventsTable = pgTable('signal_qualification_projection_events', {
 id: uuid('id').primaryKey(), userId: integer('user_id').notNull(), decisionId: uuid('decision_id').notNull().unique(),
 createdAt: timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
});
