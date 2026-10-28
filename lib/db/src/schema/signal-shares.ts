import { pgTable, uuid, integer, text, boolean, jsonb, timestamp, primaryKey } from 'drizzle-orm/pg-core';
import { signalCompaniesTable as companies, signalUsersTable as users } from './fsp-signal';
import { signalCandidateResumesTable as resumes } from './signal-resume';
export const signalCompanyMembersTable = pgTable('signal_company_members', {
  companyId:integer('company_id').notNull().references(()=>companies.id), userId:integer('user_id').notNull().references(()=>users.id),
  appointedBy:integer('appointed_by').notNull().references(()=>users.id), active:boolean('active').notNull().default(true),
  revision:integer('revision').notNull().default(1), createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
}, t=>[primaryKey({columns:[t.companyId,t.userId]})]);
export const signalGuestPermissionsTable = pgTable('signal_guest_permissions', {
  resumeId:integer('resume_id').primaryKey().references(()=>resumes.id), userId:integer('user_id').notNull().references(()=>users.id),
  allowed:boolean('allowed').notNull().default(false), updatedAt:timestamp('updated_at',{withTimezone:true}).notNull().defaultNow(),
});
export type SharedSelectionItem = {candidateUserId:number;resumeId:number;resumeRevision:number};
export const signalSharedSelectionsTable = pgTable('signal_shared_selections', {
  id:uuid('id').primaryKey(), companyId:integer('company_id').notNull().references(()=>companies.id),
  createdBy:integer('created_by').notNull().references(()=>users.id), contextType:text('context_type',{enum:['job','need']}).notNull(), contextId:integer('context_id').notNull(),
  contextRevision:integer('context_revision').notNull(), publicPurpose:text('public_purpose').notNull(),
  items:jsonb('items').$type<SharedSelectionItem[]>().notNull(), memberIds:jsonb('member_ids').$type<number[]>().notNull(),
  tokenHash:text('token_hash'), expiresAt:timestamp('expires_at',{withTimezone:true}).notNull(), revokedAt:timestamp('revoked_at',{withTimezone:true}),
  revision:integer('revision').notNull().default(1), createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
});
export const signalShareCommentsTable = pgTable('signal_share_comments', {
  id:uuid('id').primaryKey(), shareId:uuid('share_id').notNull().references(()=>signalSharedSelectionsTable.id),
  candidateId:integer('candidate_id').notNull().references(()=>users.id), resumeId:integer('resume_id').notNull().references(()=>resumes.id),
  resumeRevision:integer('resume_revision').notNull(), author:text('author').notNull(),
  reaction:text('reaction',{enum:['consider','discuss','pass']}).notNull(), note:text('note').notNull(),
  revision:integer('revision').notNull().default(1), createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
});
