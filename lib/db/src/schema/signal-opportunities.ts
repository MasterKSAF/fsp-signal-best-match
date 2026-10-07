import {
  boolean,
  check,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { signalUsersTable, signalCompaniesTable } from "./fsp-signal";
import { signalCandidateResumesTable, type SignalResumeSnapshot } from "./signal-resume";

export type JobSnapshot = {
  version: number;
  title: string;
  companyName: string;
  description: string;
  specialization: string;
  grade: string;
  skills: string[];
  workFormat: string;
  salaryMin: number;
  salaryMax: number;
  salaryPeriod: "month" | "year";
  salaryType: "gross" | "net";
};
export const signalJobsTable = pgTable(
  "signal_jobs",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => signalCompaniesTable.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description").notNull(),
    specialization: text("specialization").notNull(),
    grade: text("grade").notNull(),
    skills: text("skills").array().notNull().default([]),
    workFormat: text("work_format").notNull(),
    salaryMin: integer("salary_min").notNull(),
    salaryMax: integer("salary_max").notNull(),
    salaryPeriod: text("salary_period", { enum: ["month", "year"] }).notNull(),
    salaryType: text("salary_type", { enum: ["gross", "net"] }).notNull(),
    version: integer("version").notNull().default(1),
    status: text("status", {
      enum: ["draft", "published", "closed", "archived"],
    })
      .notNull()
      .default("draft"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (t) => [
    check(
      "signal_jobs_salary_check",
      sql`${t.salaryMin} > 0 AND ${t.salaryMax} >= ${t.salaryMin}`,
    ),
    index("signal_jobs_status_idx").on(t.status, t.companyId),
  ],
);

export const signalApplicationsTable = pgTable(
  "signal_applications",
  {
    id: serial("id").primaryKey(),
    jobId: integer("job_id")
      .notNull()
      .references(() => signalJobsTable.id, { onDelete: "cascade" }),
    companyId: integer("company_id")
      .notNull()
      .references(() => signalCompaniesTable.id, { onDelete: "cascade" }),
    candidateUserId: integer("candidate_user_id")
      .notNull()
      .references(() => signalUsersTable.id, { onDelete: "cascade" }),
    resumeId: integer("resume_id"),
    resumeSnapshot: jsonb("resume_snapshot").$type<SignalResumeSnapshot>(),
    snapshot: jsonb("snapshot").$type<JobSnapshot>().notNull(),
    message: text("message").notNull().default(""),
    status: text("status", {
      enum: ["sent", "viewed", "shortlisted", "declined", "withdrawn"],
    })
      .notNull()
      .default("sent"),
    disclosureVersion: text("disclosure_version")
      .notNull()
      .default("application-contact-v1"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("signal_application_once").on(t.jobId, t.candidateUserId),
  ],
);

export type MicroRubric = { id: string; label: string; maxPoints: number };
export type MicroResumeContext = {
  resumeId: number;
  revision: number;
  title: string;
  specialization: string;
  verifiedGrade: "Junior" | "Middle" | "Senior";
  verifiedSkills: string[];
  professionalAlias: string;
};
export type MicroSnapshot = {
  title: string;
  competency: string;
  scenario: string;
  expectedMinutes: number;
  rubric: MicroRubric[];
  version: number;
  companyName: string;
  limits: string;
};
export type MicroResult = {
  purpose?: "company_task";
  qualificationEffect?: "none";
  evaluatorUserId: number;
  evaluatedAt: string;
  scores: { criterionId: string; points: number; comment: string }[];
  total: number;
  max: number;
  feedback: string;
  source: "company_task";
  competency: string;
  templateVersion: number;
};
export const signalMicroTemplatesTable = pgTable(
  "signal_micro_templates",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => signalCompaniesTable.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    competency: text("competency").notNull(),
    specialization: text("specialization", { enum: ["Backend / Python", "Frontend / TypeScript"] }),
    scenario: text("scenario").notNull(),
    expectedMinutes: integer("expected_minutes").notNull(),
    rubric: jsonb("rubric").$type<MicroRubric[]>().notNull(),
    version: integer("version").notNull().default(1),
    intervalDays: integer("interval_days").notNull().default(7),
    deadlineDays: integer("deadline_days").notNull().default(3),
    active: boolean("active").notNull().default(true),
    educationalOnly: boolean("educational_only").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "signal_micro_frequency_check",
      sql`${t.intervalDays} >= 7 AND ${t.deadlineDays} BETWEEN 1 AND 7 AND ${t.expectedMinutes} BETWEEN 5 AND 45`,
    ),
  ],
);
export const signalMicroPreferencesTable = pgTable("signal_micro_preferences", {
  candidateUserId: integer("candidate_user_id")
    .primaryKey()
    .references(() => signalUsersTable.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const signalMicroSubscriptionsTable = pgTable(
  "signal_micro_subscriptions",
  {
    id: serial("id").primaryKey(),
    templateId: integer("template_id")
      .notNull()
      .references(() => signalMicroTemplatesTable.id, { onDelete: "cascade" }),
    candidateUserId: integer("candidate_user_id")
      .notNull()
      .references(() => signalUsersTable.id, { onDelete: "cascade" }),
    resumeId: integer("resume_id").references(() => signalCandidateResumesTable.id, { onDelete: "set null" }),
    resumeRevision: integer("resume_revision"),
    resumeContext: jsonb("resume_context").$type<MicroResumeContext>(),
    resumeProvenance: text("resume_provenance", { enum: ["captured", "legacy_unbound"] }).notNull().default("legacy_unbound"),
    active: boolean("active").notNull().default(true),
    nextDueAt: timestamp("next_due_at", { withTimezone: true }).notNull(),
    lastOfferedAt: timestamp("last_offered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("signal_micro_subscription_once").on(
      t.templateId,
      t.candidateUserId,
    ),
    index("signal_micro_subscription_due").on(t.active, t.nextDueAt),
  ],
);
export const signalMicroOffersTable = pgTable(
  "signal_micro_offers",
  {
    id: serial("id").primaryKey(),
    purpose: text("purpose", { enum: ["company_task"] }).notNull().default("company_task"),
    subscriptionId: integer("subscription_id")
      .notNull()
      .references(() => signalMicroSubscriptionsTable.id, {
        onDelete: "cascade",
      }),
    companyId: integer("company_id")
      .notNull()
      .references(() => signalCompaniesTable.id, { onDelete: "cascade" }),
    candidateUserId: integer("candidate_user_id")
      .notNull()
      .references(() => signalUsersTable.id, { onDelete: "cascade" }),
    // Historical identifier: physical deletion must not rewrite a captured offer.
    resumeId: integer("resume_id"),
    resumeRevision: integer("resume_revision"),
    resumeContext: jsonb("resume_context").$type<MicroResumeContext>(),
    resumeProvenance: text("resume_provenance", { enum: ["captured", "legacy_unbound"] }).notNull().default("legacy_unbound"),
    snapshot: jsonb("snapshot").$type<MicroSnapshot>().notNull(),
    status: text("status", {
      enum: [
        "offered",
        "accepted",
        "declined",
        "submitted",
        "evaluated",
        "expired",
        "withdrawn",
      ],
    })
      .notNull()
      .default("offered"),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    answer: text("answer"),
    result: jsonb("result").$type<MicroResult>(),
    shareResult: boolean("share_result").notNull().default(false),
    consentRevokedAt: timestamp("consent_revoked_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("signal_micro_offer_once").on(t.subscriptionId, t.scheduledFor),
  ],
);
