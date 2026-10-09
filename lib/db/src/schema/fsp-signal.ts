import {
  boolean,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uuid,
  uniqueIndex,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from 'drizzle-orm';
import { signalApplicationsTable, signalJobsTable } from './signal-opportunities';
import type { SignalLegacyQualification, SignalResumeSnapshot } from './signal-resume';

export type SignalCase = {
  id: string;
  family: string;
  title: string;
  prompt: string;
  responseType: "text" | "choice";
  options: string[];
  savedAnswer?: string | null;
};

export type SignalAnswer = { caseId: string; answer: string };

export const signalUsersTable = pgTable(
  "signal_users",
  {
    id: serial("id").primaryKey(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: text("role", { enum: ["candidate", "employer"] }).notNull(),
    displayName: text("display_name").notNull(),
    emailVerified: boolean("email_verified").notNull().default(false),
    demoMode: boolean("demo_mode").notNull().default(false),
    reviewScopeId: text("review_scope_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("signal_users_email_unique").on(table.email),
    index("signal_users_review_pool_idx").on(table.demoMode, table.reviewScopeId, table.role, table.id),
    check("signal_users_review_scope_check", sql`${table.reviewScopeId} IS NULL OR (${table.demoMode} AND ${table.reviewScopeId} ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')`)],
);

export const signalSessionsTable = pgTable("signal_sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: integer("user_id").notNull().references(() => signalUsersTable.id, { onDelete: "cascade" }),
  demoMode: boolean("demo_mode").notNull().default(false),
  reviewScopeId: text("review_scope_id"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const signalVerificationTokensTable = pgTable("signal_verification_tokens", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => signalUsersTable.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  registrationId: uuid("registration_id"),
  pendingPasswordHash: text("pending_password_hash"),
  pendingRole: text("pending_role", { enum: ["candidate", "employer"] }),
  pendingDisplayName: text("pending_display_name"),
  pendingConsentVersion: text("pending_consent_version"),
});

export const signalConsentsTable = pgTable("signal_consents", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => signalUsersTable.id, { onDelete: "cascade" }),
  consentType: text("consent_type", { enum: ["terms", "privacy"] }).notNull(),
  version: text("version").notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull().defaultNow(),
});

export const signalCandidateProfilesTable = pgTable("signal_candidate_profiles", {
  userId: integer("user_id").primaryKey().references(() => signalUsersTable.id, { onDelete: "cascade" }),
  professionalAlias: text("professional_alias").notNull(),
  avatarDataUrl: text("avatar_data_url"),
  avatarUpdatedAt: timestamp("avatar_updated_at", { withTimezone: true }),
  legacyQualification: jsonb("legacy_qualification").$type<SignalLegacyQualification>(),
  specialization: text("specialization").notNull().default("Backend / Python"),
  assumedGrade: text("assumed_grade", { enum: ["Junior", "Middle", "Senior"] }).notNull().default("Junior"),
  verifiedGrade: text("verified_grade", { enum: ["Junior", "Middle", "Senior"] }),
  verifiedGradeChangedAt: timestamp("verified_grade_changed_at", { withTimezone: true }),
  verifiedScore: integer("verified_score"),
  verifiedSkills: text("verified_skills").array().notNull().default([]),
  stack: text("stack").array().notNull().default([]),
  skills: text("skills").array().notNull().default([]),
  yearsExperience: integer("years_experience").notNull().default(0),
  workFormat: text("work_format").notNull().default("Удалённо"),
  salaryMin: integer("salary_min"),
  salaryMax: integer("salary_max"),
  salaryPeriod: text("salary_period", { enum: ["month", "year"] }).notNull().default("month"),
  salaryType: text("salary_type", { enum: ["gross", "net"] }).notNull().default("gross"),
  visibility: text("visibility", { enum: ["private", "pseudonymous", "public"] }).notNull().default("pseudonymous"),
  consentMatching: boolean("consent_matching").notNull().default(false),
  phone: text("phone"),
  contactEmail: text("contact_email"),
  hasFspHistory: boolean("has_fsp_history").notNull().default(false),
  latestAssessmentAt: timestamp("latest_assessment_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const signalCompaniesTable = pgTable(
  "signal_companies",
  {
    id: serial("id").primaryKey(),
    ownerUserId: integer("owner_user_id").notNull().references(() => signalUsersTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    industry: text("industry").notNull().default("Информационные технологии"),
    inn: text("inn"),
    contactEmail: text("contact_email").notNull(),
    contactPhone: text("contact_phone"),
    contactMethod: text("contact_method").notNull().default("Электронная почта"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("signal_companies_owner_unique").on(table.ownerUserId),
    check("signal_companies_inn_format_check", sql`${table.inn} IS NULL OR ${table.inn} ~ '^(?:[0-9]{10}|[0-9]{12})$'`)],
);

export const signalNeedsTable = pgTable("signal_needs", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => signalCompaniesTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  specialization: text("specialization").notNull(),
  grade: text("grade", { enum: ["Junior", "Middle", "Senior"] }).notNull(),
  requiredSkills: text("required_skills").array().notNull(),
  gradeMode: text('grade_mode', { enum: ['verified','declared_or_verified'] }).notNull().default('verified'),
  skillRequirements: jsonb('skill_requirements').$type<{skill:string;mode?:'verified'|'declared_or_verified';level?:'Junior'|'Middle'|'Senior'}[]>().notNull().default([]),
  desirableSkills: text("desirable_skills").array().notNull().default([]),
  description: text("description").notNull(),
  workFormat: text("work_format").notNull(),
  salaryMin: integer("salary_min").notNull(),
  salaryMax: integer("salary_max").notNull(),
  salaryPeriod: text("salary_period", { enum: ["month", "year"] }).notNull().default("month"),
  salaryType: text("salary_type", { enum: ["gross", "net"] }).notNull().default("gross"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  revision: integer("revision").notNull().default(1),
  status: text("status", { enum: ["active", "archived"] }).notNull().default("active"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
},t=>[check('signal_needs_grade_mode_check',sql`${t.gradeMode} IN ('verified','declared_or_verified')`),check('signal_needs_skill_requirements_check',sql`signal_valid_skill_requirements(${t.skillRequirements})`)]);

export const signalAssessmentAttemptsTable = pgTable("signal_assessment_attempts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => signalUsersTable.id, { onDelete: "cascade" }),
  purpose: text("purpose", { enum: ["signal_qualification", "company_task", "legacy_unknown"] }).notNull().default("signal_qualification"),
  purposeOrigin: text("purpose_origin", { enum: ["candidate_confirmed", "legacy_signal_bank"] }).notNull().default("legacy_signal_bank"),
  gradeConfirmedAt: timestamp("grade_confirmed_at", { withTimezone: true }),
  resumeId: integer("resume_id"),
  resumeRevision: integer("resume_revision"),
  resumeSpecialization: text("resume_specialization"),
  programVersion: text("program_version"),
  programId: text("program_id").notNull(),
  grade: text("grade", { enum: ["Junior", "Middle", "Senior"] }).notNull(),
  status: text("status", { enum: ["in_progress", "submitted"] }).notNull().default("in_progress"),
  cases: jsonb("cases").$type<SignalCase[]>().notNull(),
  oracles: jsonb("oracles").$type<Record<string, { answer: string; rubric?: string[] }>>().notNull().default({}),
  answers: jsonb("answers").$type<SignalAnswer[]>().notNull().default([]),
  score: integer("score"),
  verified: boolean("verified"),
  gradeChanged: boolean("grade_changed").notNull().default(false),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
});

export const signalInvitationsTable = pgTable("signal_invitations", {
  id: serial("id").primaryKey(),
  needId: integer("need_id").references(() => signalNeedsTable.id, { onDelete: "restrict" }),
  jobId: integer("job_id").references(() => signalJobsTable.id, { onDelete: "restrict" }),
  contextVersion: integer("context_version").notNull().default(1),
  contextSnapshot: jsonb("context_snapshot").$type<Record<string, unknown>>().notNull().default({}),
  companyId: integer("company_id").notNull().references(() => signalCompaniesTable.id, { onDelete: "cascade" }),
  candidateUserId: integer("candidate_user_id").notNull().references(() => signalUsersTable.id, { onDelete: "cascade" }),
  resumeId: integer("resume_id"),
  resumeSnapshot: jsonb("resume_snapshot").$type<SignalResumeSnapshot>(),
  title: text("title").notNull(),
  message: text("message").notNull(),
  reason: text("reason").notNull(),
  salaryMin: integer("salary_min").notNull(),
  salaryMax: integer("salary_max").notNull(),
  salaryPeriod: text("salary_period", { enum: ["month", "year"] }).notNull(),
  salaryType: text("salary_type", { enum: ["gross", "net"] }).notNull(),
  workFormat: text("work_format").notNull(),
  status: text("status", { enum: ["sent", "viewed", "accepted", "declined", "withdrawn", "expired"] }).notNull().default("sent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [check('signal_invitations_context_check', sql`(${t.needId} IS NOT NULL) <> (${t.jobId} IS NOT NULL)`)]);

export const signalContactGrantsTable = pgTable("signal_contact_grants", {
  id: serial('id').primaryKey(),
  invitationId: integer("invitation_id").references(() => signalInvitationsTable.id, { onDelete: "cascade" }),
  applicationId: integer('application_id').references(() => signalApplicationsTable.id, { onDelete: 'cascade' }),
  candidateUserId: integer("candidate_user_id").notNull().references(() => signalUsersTable.id, { onDelete: "cascade" }),
  companyId: integer("company_id").notNull().references(() => signalCompaniesTable.id, { onDelete: "cascade" }),
  consentedAt: timestamp("consented_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, t => [uniqueIndex('signal_contact_invitation_unique').on(t.invitationId), uniqueIndex('signal_contact_application_unique').on(t.applicationId), check('signal_contact_basis_check', sql`(${t.invitationId} IS NOT NULL) <> (${t.applicationId} IS NOT NULL)`)]);

export const signalDemoSeedTable = pgTable("signal_demo_seed", {
  key: text("key").primaryKey(),
  version: text("version").notNull(),
  appliedAt: timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
});
