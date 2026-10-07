import { boolean, customType, index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { signalUsersTable } from "./fsp-signal";

export type SignalResumeExperience = { company: string; role: string; start: string; end: string | null; description: string };
export type SignalResumeProject = { title: string; role: string; description: string; url: string | null };
export type SignalResumeEducation = { institution: string; qualification: string; start: string; end: string | null };
export type SignalResumeLink = { title: string; url: string };
export type SignalResumeQuestionnaire = {
  version: "backend-python-v1" | "frontend-typescript-v1";
  industry: string;
  specialization: string;
  answers: { python: number | null; databases: number | null; api: number | null; testing: number | null; reliability: number | null; ownership: number | null } | { typescript: number | null; state: number | null; accessibility: number | null; performance: number | null; architecture: number | null; ownership: number | null };
};
export type SignalResumeQuestionnaireHistory = { completedAt: string; recommendedGrade: "Junior" | "Middle" | "Senior"; questionnaire: SignalResumeQuestionnaire };
/** Historical summary is retained, never represented as newly measured criterion evidence. */
export type SignalLegacyQualification = {
  specialization: string; grade: "Junior" | "Middle" | "Senior" | null; score: number | null;
  skills: string[]; assessedAt: string | null; gradeChangedAt: string | null;
  attemptId: number | null; limitation: string;
};
/** Immutable professional context; intentionally excludes identity, photos and contact data. */
export type SignalResumeSnapshot = {
  resumeId: number; revision: number; title: string; specialization: string;
  verifiedGrade: string | null; verifiedScore: number | null; verifiedSkills: string[];
  stack: string[]; skills: string[]; yearsExperience: number; workFormat: string;
  salaryMin: number | null; salaryMax: number | null; salaryPeriod: "month" | "year";
  salaryType: "gross" | "net"; updatedAt: string; summary: string;
};

export const signalCandidateResumesTable = pgTable("signal_candidate_resumes", {
  id: serial("id").primaryKey(),
  // Server-only complete content signature, maintained unconditionally by0008.
  poolContentDigest: customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' })("pool_content_digest").notNull().default(sql`decode('', 'hex')`),
  userId: integer("user_id").notNull().references(() => signalUsersTable.id, { onDelete: "cascade" }),
  title: text("title").notNull().default("Моё резюме"),
  isPrimary: boolean("is_primary").notNull().default(false),
  revision: integer("revision").notNull().default(1),
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
  visibility: text("visibility", { enum: ["private", "pseudonymous", "public"] }).notNull().default("private"),
  consentMatching: boolean("consent_matching").notNull().default(false),
  consentCatalog: boolean("consent_catalog").notNull().default(false),
  readyForOffers: boolean("ready_for_offers").notNull().default(false),
  latestAssessmentAt: timestamp("latest_assessment_at", { withTimezone: true }),
  qualificationAttemptId: integer("qualification_attempt_id"),
  legacyQualification: jsonb("legacy_qualification").$type<SignalLegacyQualification>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  summary: text("summary").notNull().default(""),
  softSkills: text("soft_skills").array().notNull().default([]),
  experience: jsonb("experience").$type<SignalResumeExperience[]>().notNull().default([]),
  projects: jsonb("projects").$type<SignalResumeProject[]>().notNull().default([]),
  education: jsonb("education").$type<SignalResumeEducation[]>().notNull().default([]),
  portfolio: jsonb("portfolio").$type<SignalResumeLink[]>().notNull().default([]),
  questionnaire: jsonb("questionnaire").$type<SignalResumeQuestionnaire>().notNull().default({ version: "backend-python-v1", industry: "Информационные технологии", specialization: "Backend / Python", answers: { python: null, databases: null, api: null, testing: null, reliability: null, ownership: null } }),
  questionnaireHistory: jsonb("questionnaire_history").$type<SignalResumeQuestionnaireHistory[]>().notNull().default([]),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  index("signal_resumes_owner_idx").on(table.userId, table.deletedAt),
  uniqueIndex("signal_resumes_primary_unique").on(table.userId).where(sql`${table.isPrimary} AND ${table.deletedAt} IS NULL`),
  index("signal_resume_matching_digest_idx").on(table.specialization,table.userId,table.id).where(sql`${table.deletedAt} IS NULL AND ${table.consentMatching} AND ${table.visibility} <> 'private'`),
  index("signal_resume_catalog_digest_idx").on(table.userId,table.id).where(sql`${table.deletedAt} IS NULL AND ${table.consentCatalog} AND ${table.visibility} <> 'private'`),
]);
