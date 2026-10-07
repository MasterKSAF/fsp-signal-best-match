import { integer, jsonb, pgTable, timestamp } from "drizzle-orm/pg-core";
import { signalAssessmentAttemptsTable } from "./fsp-signal";

/** Immutable public explanation; assessment answers remain in the existing private oracle. */
export const signalAssessmentContextsTable = pgTable("signal_assessment_contexts", {
  attemptId: integer("attempt_id").primaryKey().references(() => signalAssessmentAttemptsTable.id, { onDelete: "cascade" }),
  snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
