import { check, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { signalUsersTable } from "./fsp-signal";

export type FspAchievement = {
  id: string;
  title: string;
  event: string;
  occurredAt: string;
  kind: "participation" | "placement" | "rank";
  /** Explicit provider outcome. Legacy placement/rank alone is not a prize or victory. */
  result?: "participation" | "prize" | "win";
};

/** User-entered identifiers are not unique claims on an external identity. */
export const signalFspConnectionsTable = pgTable("signal_fsp_connections", {
  userId: integer("user_id").primaryKey().references(() => signalUsersTable.id, { onDelete: "cascade" }),
  fspId: text("fsp_id"),
  status: text("status", { enum: ["unlinked", "pending", "connected_demo", "unavailable"] }).notNull().default("unlinked"),
  consentVersion: text("consent_version"),
  consentedAt: timestamp("consented_at", { withTimezone: true }),
  requestedAt: timestamp("requested_at", { withTimezone: true }),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  importedAt: timestamp("imported_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  provenance: text("provenance", { enum: ["user_supplied", "synthetic_fixture"] }),
  providerVersion: text("provider_version"),
  achievements: jsonb("achievements").$type<FspAchievement[]>().notNull().default([]),
  lastErrorCode: text("last_error_code"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check('signal_fsp_connection_status_check', sql`${table.status} IN ('unlinked', 'pending', 'connected_demo', 'unavailable')`),
  check('signal_fsp_connection_provenance_check', sql`${table.provenance} IS NULL OR ${table.provenance} IN ('user_supplied', 'synthetic_fixture')`),
]);
