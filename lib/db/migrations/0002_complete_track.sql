CREATE TABLE "signal_applications" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" integer NOT NULL,
	"company_id" integer NOT NULL,
	"candidate_user_id" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"message" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'sent' NOT NULL,
	"disclosure_version" text DEFAULT 'application-contact-v1' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signal_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"specialization" text NOT NULL,
	"grade" text NOT NULL,
	"skills" text[] DEFAULT '{}' NOT NULL,
	"work_format" text NOT NULL,
	"salary_min" integer NOT NULL,
	"salary_max" integer NOT NULL,
	"salary_period" text NOT NULL,
	"salary_type" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "signal_jobs_salary_check" CHECK ("signal_jobs"."salary_min" > 0 AND "signal_jobs"."salary_max" >= "signal_jobs"."salary_min")
);
--> statement-breakpoint
CREATE TABLE "signal_micro_offers" (
	"id" serial PRIMARY KEY NOT NULL,
	"subscription_id" integer NOT NULL,
	"company_id" integer NOT NULL,
	"candidate_user_id" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"status" text DEFAULT 'offered' NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"answer" text,
	"result" jsonb,
	"share_result" boolean DEFAULT false NOT NULL,
	"consent_revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "signal_micro_preferences" (
	"candidate_user_id" integer PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signal_micro_subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"template_id" integer NOT NULL,
	"candidate_user_id" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"next_due_at" timestamp with time zone NOT NULL,
	"last_offered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signal_micro_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"title" text NOT NULL,
	"competency" text NOT NULL,
	"scenario" text NOT NULL,
	"expected_minutes" integer NOT NULL,
	"rubric" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"interval_days" integer DEFAULT 7 NOT NULL,
	"deadline_days" integer DEFAULT 3 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"educational_only" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signal_micro_frequency_check" CHECK ("signal_micro_templates"."interval_days" >= 7 AND "signal_micro_templates"."deadline_days" BETWEEN 1 AND 7 AND "signal_micro_templates"."expected_minutes" BETWEEN 5 AND 45)
);
--> statement-breakpoint
CREATE TABLE "signal_assessment_corrections" (
	"id" serial PRIMARY KEY NOT NULL,
	"attempt_id" integer NOT NULL,
	"reason" text NOT NULL,
	"operator" text NOT NULL,
	"original_decision" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signal_assessment_corrections_attempt_id_unique" UNIQUE("attempt_id")
);
--> statement-breakpoint
CREATE TABLE "signal_bank_audit" (
	"id" serial PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"template_id" text,
	"attempt_id" integer,
	"operator" text NOT NULL,
	"reason" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signal_bank_template_overrides" (
	"template_id" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"reason" text NOT NULL,
	"operator" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signal_bank_template_status_check" CHECK ("signal_bank_template_overrides"."status" in ('active','disabled'))
);
--> statement-breakpoint
CREATE TABLE "signal_research_attempts" (
	"id" serial PRIMARY KEY NOT NULL,
	"enrollment_id" integer NOT NULL,
	"form" text NOT NULL,
	"program_version" text NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"cases" jsonb NOT NULL,
	"oracles" jsonb NOT NULL,
	"responses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"result" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"submitted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "signal_research_enrollments" (
	"id" serial PRIMARY KEY NOT NULL,
	"study_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"pseudonym" text NOT NULL,
	"form_order" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"independent_grade" text,
	"independent_basis" text,
	"group_assigned_at" timestamp with time zone,
	"consent_version" text NOT NULL,
	"consented_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "signal_research_ratings" (
	"id" serial PRIMARY KEY NOT NULL,
	"study_id" integer NOT NULL,
	"reviewer_id" text NOT NULL,
	"source_sha256" text NOT NULL,
	"ratings" jsonb NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signal_research_studies" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_user_id" integer NOT NULL,
	"title" text NOT NULL,
	"program_id" text NOT NULL,
	"grade" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"retention_days" integer DEFAULT 30 NOT NULL,
	"measurement_origin" text DEFAULT 'synthetic' NOT NULL,
	"protocol_version" text DEFAULT 'signal-research-v1' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signal_research_retention_check" CHECK ("signal_research_studies"."retention_days" between 1 and 90)
);
--> statement-breakpoint
-- Preserve the existing grants while changing their primary key.
DO $$ DECLARE old_key text;
BEGIN
 SELECT conname INTO old_key FROM pg_constraint WHERE conrelid = 'public.signal_contact_grants'::regclass AND contype = 'p';
 IF old_key IS NOT NULL THEN EXECUTE format('ALTER TABLE public.signal_contact_grants DROP CONSTRAINT %I', old_key); END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "signal_contact_grants" ALTER COLUMN "invitation_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "signal_contact_grants" ADD COLUMN "id" serial PRIMARY KEY NOT NULL;--> statement-breakpoint
ALTER TABLE "signal_contact_grants" ADD COLUMN "application_id" integer;--> statement-breakpoint
ALTER TABLE "signal_applications" ADD CONSTRAINT "signal_applications_job_id_signal_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."signal_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_applications" ADD CONSTRAINT "signal_applications_company_id_signal_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."signal_companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_applications" ADD CONSTRAINT "signal_applications_candidate_user_id_signal_users_id_fk" FOREIGN KEY ("candidate_user_id") REFERENCES "public"."signal_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_jobs" ADD CONSTRAINT "signal_jobs_company_id_signal_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."signal_companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_micro_offers" ADD CONSTRAINT "signal_micro_offers_subscription_id_signal_micro_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."signal_micro_subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_micro_offers" ADD CONSTRAINT "signal_micro_offers_company_id_signal_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."signal_companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_micro_offers" ADD CONSTRAINT "signal_micro_offers_candidate_user_id_signal_users_id_fk" FOREIGN KEY ("candidate_user_id") REFERENCES "public"."signal_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_micro_preferences" ADD CONSTRAINT "signal_micro_preferences_candidate_user_id_signal_users_id_fk" FOREIGN KEY ("candidate_user_id") REFERENCES "public"."signal_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_micro_subscriptions" ADD CONSTRAINT "signal_micro_subscriptions_template_id_signal_micro_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."signal_micro_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_micro_subscriptions" ADD CONSTRAINT "signal_micro_subscriptions_candidate_user_id_signal_users_id_fk" FOREIGN KEY ("candidate_user_id") REFERENCES "public"."signal_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_micro_templates" ADD CONSTRAINT "signal_micro_templates_company_id_signal_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."signal_companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_assessment_corrections" ADD CONSTRAINT "signal_assessment_corrections_attempt_id_signal_assessment_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."signal_assessment_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_bank_audit" ADD CONSTRAINT "signal_bank_audit_attempt_id_signal_assessment_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."signal_assessment_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_research_attempts" ADD CONSTRAINT "signal_research_attempts_enrollment_id_signal_research_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."signal_research_enrollments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_research_enrollments" ADD CONSTRAINT "signal_research_enrollments_study_id_signal_research_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."signal_research_studies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_research_enrollments" ADD CONSTRAINT "signal_research_enrollments_user_id_signal_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."signal_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_research_ratings" ADD CONSTRAINT "signal_research_ratings_study_id_signal_research_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."signal_research_studies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_research_studies" ADD CONSTRAINT "signal_research_studies_owner_user_id_signal_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."signal_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "signal_application_once" ON "signal_applications" USING btree ("job_id","candidate_user_id");--> statement-breakpoint
CREATE INDEX "signal_jobs_status_idx" ON "signal_jobs" USING btree ("status","company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "signal_micro_offer_once" ON "signal_micro_offers" USING btree ("subscription_id","scheduled_for");--> statement-breakpoint
CREATE UNIQUE INDEX "signal_micro_subscription_once" ON "signal_micro_subscriptions" USING btree ("template_id","candidate_user_id");--> statement-breakpoint
CREATE INDEX "signal_micro_subscription_due" ON "signal_micro_subscriptions" USING btree ("active","next_due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "signal_research_form_unique" ON "signal_research_attempts" USING btree ("enrollment_id","form");--> statement-breakpoint
CREATE UNIQUE INDEX "signal_research_enrollment_unique" ON "signal_research_enrollments" USING btree ("study_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "signal_research_pseudonym_unique" ON "signal_research_enrollments" USING btree ("pseudonym");--> statement-breakpoint
CREATE UNIQUE INDEX "signal_research_reviewer_unique" ON "signal_research_ratings" USING btree ("study_id","reviewer_id");--> statement-breakpoint
ALTER TABLE "signal_contact_grants" ADD CONSTRAINT "signal_contact_grants_application_id_signal_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."signal_applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "signal_contact_invitation_unique" ON "signal_contact_grants" USING btree ("invitation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "signal_contact_application_unique" ON "signal_contact_grants" USING btree ("application_id");--> statement-breakpoint
ALTER TABLE "signal_contact_grants" ADD CONSTRAINT "signal_contact_basis_check" CHECK (("signal_contact_grants"."invitation_id" IS NOT NULL) <> ("signal_contact_grants"."application_id" IS NOT NULL));