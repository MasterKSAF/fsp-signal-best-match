import { pgTable, uuid, integer, text, jsonb, timestamp, boolean, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { signalCompaniesTable, signalUsersTable } from './fsp-signal';
import { signalRequirementPreviewsTable } from './signal-refinement';

export const signalSelectionFeedbackTable = pgTable('signal_selection_feedback', {
  id:uuid('id').primaryKey(),companyId:integer('company_id').notNull().references(()=>signalCompaniesTable.id),actorId:integer('actor_id').notNull().references(()=>signalUsersTable.id),
  contextType:text('context_type',{enum:['job','need']}).notNull(),contextId:integer('context_id').notNull(),contextRevision:integer('context_revision').notNull(),
  candidateId:integer('candidate_id').notNull().references(()=>signalUsersTable.id),resumeId:integer('resume_id').notNull(),resumeRevision:integer('resume_revision').notNull(),
  reason:text('reason').notNull(),skill:text('skill'),targetLevel:text('target_level'),note:text('note').notNull().default(''),
  commandKey:text('command_key').notNull(),payloadHash:text('payload_hash').notNull(),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[uniqueIndex('signal_feedback_command_unique').on(t.companyId,t.actorId,t.commandKey)]);
export const signalRefinementProposalsTable=pgTable('signal_refinement_proposals',{
  id:uuid('id').primaryKey(),companyId:integer('company_id').notNull().references(()=>signalCompaniesTable.id),actorId:integer('actor_id').notNull().references(()=>signalUsersTable.id),
  feedbackId:uuid('feedback_id').notNull().references(()=>signalSelectionFeedbackTable.id),previewId:uuid('preview_id').notNull().references(()=>signalRequirementPreviewsTable.id),
  proposedExclusions:jsonb('proposed_exclusions').$type<{candidateId:number;resumeId:number}[]>().notNull(),appliedRevision:integer('applied_revision'),
  createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[uniqueIndex('signal_proposal_feedback_unique').on(t.feedbackId)]);
export const signalContextExclusionsTable=pgTable('signal_context_exclusions',{
  id:uuid('id').primaryKey(),companyId:integer('company_id').notNull().references(()=>signalCompaniesTable.id),actorId:integer('actor_id').notNull().references(()=>signalUsersTable.id),
  contextType:text('context_type',{enum:['job','need']}).notNull(),contextId:integer('context_id').notNull(),contextRevision:integer('context_revision').notNull(),
  candidateId:integer('candidate_id').notNull().references(()=>signalUsersTable.id),resumeId:integer('resume_id').notNull(),feedbackId:uuid('feedback_id').notNull().references(()=>signalSelectionFeedbackTable.id),
  active:boolean('active').notNull().default(true),revision:integer('revision').notNull().default(1),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[uniqueIndex('signal_context_exclusion_unique').on(t.companyId,t.contextType,t.contextId,t.contextRevision,t.candidateId)]);

export type WatchEntry={candidateId:number;resumeId:number;resumeRevision:number;proofHash:string;proofKeys?:string[];position:number};
export const signalSelectionWatchesTable=pgTable('signal_selection_watches',{
  id:uuid('id').primaryKey(),companyId:integer('company_id').notNull().references(()=>signalCompaniesTable.id),actorId:integer('actor_id').notNull().references(()=>signalUsersTable.id),
  contextType:text('context_type',{enum:['job','need']}).notNull(),contextId:integer('context_id').notNull(),contextRevision:integer('context_revision').notNull(),conditionsHash:text('conditions_hash').notNull(),
  mode:text('mode',{enum:['in_app']}).notNull().default('in_app'),frequencyMinutes:integer('frequency_minutes').notNull().default(15),
  state:text('state',{enum:['active','paused','closed']}).notNull().default('active'),revision:integer('revision').notNull().default(1),
  baseline:jsonb('baseline').$type<WatchEntry[]>().notNull(),seenEvents:jsonb('seen_events').$type<string[]>().notNull().default([]),
  watermark:text('watermark').notNull(),nextCheckAt:timestamp('next_check_at',{withTimezone:true}).notNull(),updatedAt:timestamp('updated_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[uniqueIndex('signal_watch_owner_context_unique').on(t.companyId,t.actorId,t.contextType,t.contextId),index('signal_watch_due_idx').on(t.state,t.nextCheckAt)]);
export const signalSelectionWatchEventsTable=pgTable('signal_selection_watch_events',{
  id:uuid('id').primaryKey(),watchId:uuid('watch_id').notNull().references(()=>signalSelectionWatchesTable.id),candidateId:integer('candidate_id').notNull(),resumeId:integer('resume_id').notNull(),
  eventKey:text('event_key').notNull(),reason:text('reason',{enum:['new_candidate','new_proof','entered_top']}).notNull(),
  contextRevision:integer('context_revision').notNull(),proofHash:text('proof_hash').notNull(),
  state:text('state',{enum:['pending','delivered','suppressed']}).notNull().default('pending'),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
  deliveredAt:timestamp('delivered_at',{withTimezone:true}),
},t=>[uniqueIndex('signal_watch_event_unique').on(t.watchId,t.eventKey)]);
