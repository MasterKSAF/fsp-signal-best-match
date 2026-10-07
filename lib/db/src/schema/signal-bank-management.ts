import { check, integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { signalAssessmentAttemptsTable } from "./fsp-signal";

/** Availability changes affect NEW attempts only. Saved cases and oracles never change. */
export const signalBankTemplateOverridesTable = pgTable("signal_bank_template_overrides", {
  templateId: text("template_id").primaryKey(),
  status: text("status", { enum: ["active", "disabled"] }).notNull(),
  reason: text("reason").notNull(),
  operator: text("operator").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [check("signal_bank_template_status_check", sql`${table.status} in ('active','disabled')`)]);

/** Append-only operator history. No answers or private oracle data in audit payloads. */
export const signalBankAuditTable = pgTable("signal_bank_audit", {
  id: serial("id").primaryKey(),
  action: text("action", { enum: ["enable", "disable", "annul_attempt"] }).notNull(),
  templateId: text("template_id"),
  attemptId: integer("attempt_id").references(() => signalAssessmentAttemptsTable.id, { onDelete: "cascade" }),
  operator: text("operator").notNull(),
  reason: text("reason").notNull(),
  details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** An explicit result correction invalidates evidence without editing the historical snapshot. */
export const signalAssessmentCorrectionsTable = pgTable("signal_assessment_corrections", {
  id: serial("id").primaryKey(),
  attemptId: integer("attempt_id").notNull().unique().references(() => signalAssessmentAttemptsTable.id, { onDelete: "cascade" }),
  reason: text("reason").notNull(),
  operator: text("operator").notNull(),
  originalDecision: jsonb("original_decision").$type<{ score: number | null; verified: boolean | null; status: string }>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
