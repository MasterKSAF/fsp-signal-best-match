import {
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { signalCompaniesTable, signalInvitationsTable } from "./fsp-signal";

/** Sender-scoped immutable idempotency receipts. Failed requests do not create receipts. */
export const signalInvitationRequestsTable = pgTable(
  "signal_invitation_requests",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => signalCompaniesTable.id, { onDelete: "cascade" }),
    requestKey: text("request_key").notNull(),
    bodyHash: text("body_hash").notNull(),
    invitationId: integer("invitation_id")
      .notNull()
      .references(() => signalInvitationsTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("signal_invitation_request_unique").on(
      table.companyId,
      table.requestKey,
    ),
  ],
);
