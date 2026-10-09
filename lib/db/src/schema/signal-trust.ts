import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { signalCompaniesTable, signalUsersTable } from "./fsp-signal";

/** Privilege is issued by an operator CLI, never by public profile/registration APIs. */
export const signalModeratorPermissionsTable = pgTable("signal_moderator_permissions", {
  userId: integer("user_id").primaryKey().references(() => signalUsersTable.id, { onDelete: "cascade" }),
  grantedBy: text("granted_by").notNull(), active: boolean("active").notNull().default(true),
  grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
});
export const signalCompanyBlocksTable = pgTable("signal_company_blocks", {
  id: serial("id").primaryKey(), candidateUserId: integer("candidate_user_id").notNull().references(() => signalUsersTable.id, { onDelete: "cascade" }),
  companyId: integer("company_id").notNull().references(() => signalCompaniesTable.id, { onDelete: "cascade" }),
  active: boolean("active").notNull().default(true),
  blockedAt: timestamp("blocked_at", { withTimezone: true }).notNull().defaultNow(),
  unblockedAt: timestamp("unblocked_at", { withTimezone: true }),
}, t => [uniqueIndex("signal_company_block_unique").on(t.candidateUserId, t.companyId)]);
export const signalComplaintsTable = pgTable("signal_complaints", {
  id: serial("id").primaryKey(), reporterUserId: integer("reporter_user_id").notNull().references(() => signalUsersTable.id, { onDelete: "cascade" }),
  companyId: integer("company_id").references(() => signalCompaniesTable.id, { onDelete: "cascade" }),
  objectType: text("object_type", { enum: ["company", "job", "invitation", "service"] }).notNull(), objectId: integer("object_id").notNull(),
  category: text("category", { enum: ["spam", "misleading", "discrimination", "inappropriate", "privacy", "other", "question", "technical"] }).notNull(),
  explanation: text("explanation").notNull().default(""),
  status: text("status", { enum: ["submitted", "in_review", "dismissed", "upheld", "resolved"] }).notNull().default("submitted"),
  decisionReason: text("decision_reason"), moderatorUserId: integer("moderator_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex("signal_complaint_case_unique").on(t.reporterUserId, t.objectType, t.objectId, t.category).where(sql`${t.objectType} <> 'service'`), index("signal_complaint_queue_idx").on(t.status, t.createdAt)]);
export const signalComplaintRequestsTable = pgTable("signal_complaint_requests", {
  id: serial("id").primaryKey(), reporterUserId: integer("reporter_user_id").notNull().references(() => signalUsersTable.id, { onDelete: "cascade" }),
  requestKey: text("request_key").notNull(), bodyHash: text("body_hash").notNull(),
  complaintId: integer("complaint_id").notNull().references(() => signalComplaintsTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex("signal_complaint_request_unique").on(t.reporterUserId, t.requestKey)]);
export const signalEmployerRestrictionsTable = pgTable("signal_employer_restrictions", {
  id: serial("id").primaryKey(), companyId: integer("company_id").notNull().references(() => signalCompaniesTable.id, { onDelete: "cascade" }),
  complaintId: integer("complaint_id").notNull().references(() => signalComplaintsTable.id, { onDelete: "cascade" }),
  scope: text("scope", { enum: ["invitations", "contacts", "publishing", "all"] }).notNull(),
  publicReason: text("public_reason").notNull(), moderatorUserId: integer("moderator_user_id").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  liftedAt: timestamp("lifted_at", { withTimezone: true }),
  liftReason: text("lift_reason"), liftedByUserId: integer("lifted_by_user_id"),
}, t => [uniqueIndex("signal_restriction_case_scope_unique").on(t.complaintId, t.scope), index("signal_restriction_company_idx").on(t.companyId, t.expiresAt)]);
export const signalRestrictionAppealsTable = pgTable("signal_restriction_appeals", {
  id: serial("id").primaryKey(), restrictionId: integer("restriction_id").notNull().references(() => signalEmployerRestrictionsTable.id, { onDelete: "cascade" }),
  companyId: integer("company_id").notNull().references(() => signalCompaniesTable.id, { onDelete: "cascade" }),
  authorUserId: integer("author_user_id").notNull(), explanation: text("explanation").notNull(),
  status: text("status", { enum: ["submitted", "accepted", "rejected"] }).notNull().default("submitted"),
  decisionReason: text("decision_reason"), moderatorUserId: integer("moderator_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
}, t => [uniqueIndex("signal_restriction_appeal_once").on(t.restrictionId)]);
/** Append-only, minimal audit. No reporter explanation or contact data is copied here. */
export const signalTrustAuditTable = pgTable("signal_trust_audit", {
  id: serial("id").primaryKey(), actorUserId: integer("actor_user_id"), actorOperator: text("actor_operator"),
  action: text("action").notNull(), objectType: text("object_type").notNull(), objectId: integer("object_id").notNull(),
  companyId: integer("company_id"), reason: text("reason").notNull(),
  details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
