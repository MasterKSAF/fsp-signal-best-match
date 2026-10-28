import { index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { signalUsersTable } from './fsp-signal';
import { signalCandidateResumesTable } from './signal-resume';

export type PdfImportFragment = { id:number; page:number; text:string; bbox:number[] };
export type PdfImportFields = { summary:string; skills:string[] };
/** Bounded-work receipts contain no document text or file bytes. */
export const signalPdfImportReceiptsTable = pgTable('signal_pdf_import_receipts', {
 id:uuid('id').primaryKey(),userId:integer('user_id').notNull().references(()=>signalUsersTable.id),
 createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[index('signal_pdf_import_receipt_owner_idx').on(t.userId,t.createdAt)]);
export const signalPdfImportDraftsTable = pgTable('signal_pdf_import_drafts', {
 id:uuid('id').primaryKey(), userId:integer('user_id').notNull().references(()=>signalUsersTable.id),
 resumeId:integer('resume_id').notNull().references(()=>signalCandidateResumesTable.id),
 resumeRevision:integer('resume_revision').notNull(), revision:integer('revision').notNull().default(1),
 documentHash:text('document_hash').notNull(), engine:text('engine').notNull(),
 fields:jsonb('fields').$type<PdfImportFields>().notNull(),
 provenance:jsonb('provenance').$type<Record<keyof PdfImportFields,number[]>>().notNull(),
 fragments:jsonb('fragments').$type<PdfImportFragment[]>().notNull(),
 warnings:jsonb('warnings').$type<string[]>().notNull(),
 reviewTokenHash:text('review_token_hash'), reviewedAt:timestamp('reviewed_at',{withTimezone:true}),
 state:text('state',{enum:['draft','applied','cancelled']}).notNull().default('draft'),
 appliedRevision:integer('applied_revision'), applyHash:text('apply_hash'),
 expiresAt:timestamp('expires_at',{withTimezone:true}).notNull(),
 createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[index('signal_pdf_import_owner_idx').on(t.userId,t.createdAt)]);
