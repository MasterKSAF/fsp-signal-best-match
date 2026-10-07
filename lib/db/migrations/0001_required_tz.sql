CREATE TABLE "signal_candidate_resumes" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"soft_skills" text[] DEFAULT '{}' NOT NULL,
	"experience" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"projects" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"education" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"portfolio" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"questionnaire" jsonb DEFAULT '{"version":"backend-python-v1","industry":"Информационные технологии","specialization":"Backend / Python","answers":{"python":null,"databases":null,"api":null,"testing":null,"reliability":null,"ownership":null}}'::jsonb NOT NULL,
	"questionnaire_history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signal_fsp_connections" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"fsp_id" text,
	"status" text DEFAULT 'unlinked' NOT NULL,
	"consent_version" text,
	"consented_at" timestamp with time zone,
	"requested_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"imported_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"provenance" text,
	"provider_version" text,
	"achievements" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_error_code" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signal_fsp_connection_status_check" CHECK ("signal_fsp_connections"."status" IN ('unlinked', 'pending', 'connected_demo', 'unavailable')),
	CONSTRAINT "signal_fsp_connection_provenance_check" CHECK ("signal_fsp_connections"."provenance" IS NULL OR "signal_fsp_connections"."provenance" IN ('user_supplied', 'synthetic_fixture'))
);
--> statement-breakpoint
CREATE TABLE "signal_assessment_contexts" (
	"attempt_id" integer PRIMARY KEY NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "signal_candidate_resumes" ADD CONSTRAINT "signal_candidate_resumes_user_id_signal_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."signal_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_fsp_connections" ADD CONSTRAINT "signal_fsp_connections_user_id_signal_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."signal_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_assessment_contexts" ADD CONSTRAINT "signal_assessment_contexts_attempt_id_signal_assessment_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."signal_assessment_attempts"("id") ON DELETE cascade ON UPDATE no action;