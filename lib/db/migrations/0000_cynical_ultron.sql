CREATE TABLE "signal_assessment_attempts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"program_id" text NOT NULL,
	"grade" text NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"cases" jsonb NOT NULL,
	"oracles" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"answers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"score" integer,
	"verified" boolean,
	"grade_changed" boolean DEFAULT false NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"submitted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "signal_candidate_profiles" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"professional_alias" text NOT NULL,
	"specialization" text DEFAULT 'Backend / Python' NOT NULL,
	"assumed_grade" text DEFAULT 'Junior' NOT NULL,
	"verified_grade" text,
	"verified_grade_changed_at" timestamp with time zone,
	"verified_score" integer,
	"verified_skills" text[] DEFAULT '{}' NOT NULL,
	"stack" text[] DEFAULT '{}' NOT NULL,
	"skills" text[] DEFAULT '{}' NOT NULL,
	"years_experience" integer DEFAULT 0 NOT NULL,
	"work_format" text DEFAULT 'Удалённо' NOT NULL,
	"salary_min" integer,
	"salary_max" integer,
	"salary_period" text DEFAULT 'month' NOT NULL,
	"salary_type" text DEFAULT 'gross' NOT NULL,
	"visibility" text DEFAULT 'pseudonymous' NOT NULL,
	"consent_matching" boolean DEFAULT false NOT NULL,
	"phone" text,
	"contact_email" text,
	"has_fsp_history" boolean DEFAULT false NOT NULL,
	"latest_assessment_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signal_companies" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_user_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"industry" text DEFAULT 'Информационные технологии' NOT NULL,
	"contact_email" text NOT NULL,
	"contact_phone" text,
	"contact_method" text DEFAULT 'Электронная почта' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signal_consents" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"consent_type" text NOT NULL,
	"version" text NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signal_contact_grants" (
	"invitation_id" integer PRIMARY KEY NOT NULL,
	"candidate_user_id" integer NOT NULL,
	"company_id" integer NOT NULL,
	"consented_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "signal_demo_seed" (
	"key" text PRIMARY KEY NOT NULL,
	"version" text NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signal_invitations" (
	"id" serial PRIMARY KEY NOT NULL,
	"need_id" integer NOT NULL,
	"company_id" integer NOT NULL,
	"candidate_user_id" integer NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"reason" text NOT NULL,
	"salary_min" integer NOT NULL,
	"salary_max" integer NOT NULL,
	"salary_period" text NOT NULL,
	"salary_type" text NOT NULL,
	"work_format" text NOT NULL,
	"status" text DEFAULT 'sent' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signal_needs" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"title" text NOT NULL,
	"specialization" text NOT NULL,
	"grade" text NOT NULL,
	"required_skills" text[] NOT NULL,
	"desirable_skills" text[] DEFAULT '{}' NOT NULL,
	"description" text NOT NULL,
	"work_format" text NOT NULL,
	"salary_min" integer NOT NULL,
	"salary_max" integer NOT NULL,
	"salary_period" text DEFAULT 'month' NOT NULL,
	"salary_type" text DEFAULT 'gross' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signal_sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"demo_mode" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signal_users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text NOT NULL,
	"display_name" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"demo_mode" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signal_verification_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "signal_assessment_attempts" ADD CONSTRAINT "signal_assessment_attempts_user_id_signal_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."signal_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_candidate_profiles" ADD CONSTRAINT "signal_candidate_profiles_user_id_signal_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."signal_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_companies" ADD CONSTRAINT "signal_companies_owner_user_id_signal_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."signal_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_consents" ADD CONSTRAINT "signal_consents_user_id_signal_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."signal_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_contact_grants" ADD CONSTRAINT "signal_contact_grants_invitation_id_signal_invitations_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."signal_invitations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_contact_grants" ADD CONSTRAINT "signal_contact_grants_candidate_user_id_signal_users_id_fk" FOREIGN KEY ("candidate_user_id") REFERENCES "public"."signal_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_contact_grants" ADD CONSTRAINT "signal_contact_grants_company_id_signal_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."signal_companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_invitations" ADD CONSTRAINT "signal_invitations_need_id_signal_needs_id_fk" FOREIGN KEY ("need_id") REFERENCES "public"."signal_needs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_invitations" ADD CONSTRAINT "signal_invitations_company_id_signal_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."signal_companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_invitations" ADD CONSTRAINT "signal_invitations_candidate_user_id_signal_users_id_fk" FOREIGN KEY ("candidate_user_id") REFERENCES "public"."signal_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_needs" ADD CONSTRAINT "signal_needs_company_id_signal_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."signal_companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_sessions" ADD CONSTRAINT "signal_sessions_user_id_signal_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."signal_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_verification_tokens" ADD CONSTRAINT "signal_verification_tokens_user_id_signal_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."signal_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "signal_companies_owner_unique" ON "signal_companies" USING btree ("owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "signal_users_email_unique" ON "signal_users" USING btree ("email");