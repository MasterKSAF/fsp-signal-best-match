-- Employer workspace: preserve every existing context, receipt and invitation.
ALTER TABLE signal_needs ADD COLUMN revision integer NOT NULL DEFAULT 1;
ALTER TABLE signal_needs ADD COLUMN status text NOT NULL DEFAULT 'active';
ALTER TABLE signal_needs ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE signal_needs ADD COLUMN deleted_at timestamptz;
ALTER TABLE signal_needs ADD CONSTRAINT signal_needs_revision_check CHECK (revision > 0);
ALTER TABLE signal_needs ADD CONSTRAINT signal_needs_status_check CHECK (status IN ('active', 'archived'));
UPDATE signal_needs SET updated_at = created_at;
ALTER TABLE signal_jobs ADD COLUMN deleted_at timestamptz;
--> statement-breakpoint
ALTER TABLE signal_invitations ALTER COLUMN need_id DROP NOT NULL;
ALTER TABLE signal_invitations DROP CONSTRAINT signal_invitations_need_id_signal_needs_id_fk;
ALTER TABLE signal_invitations ADD CONSTRAINT signal_invitations_need_id_signal_needs_id_fk FOREIGN KEY (need_id) REFERENCES signal_needs(id) ON DELETE RESTRICT;
ALTER TABLE signal_invitations ADD COLUMN job_id integer REFERENCES signal_jobs(id) ON DELETE RESTRICT;
ALTER TABLE signal_invitations ADD COLUMN context_version integer NOT NULL DEFAULT 1;
ALTER TABLE signal_invitations ADD COLUMN context_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;
-- Existing sent conditions are the trustworthy historical values; current need
-- requirements may have changed. Do not invent a historical requirements copy.
UPDATE signal_invitations SET context_snapshot = jsonb_build_object(
  'type', 'need', 'id', need_id, 'version', 1, 'title', title,
  'salaryMin', salary_min, 'salaryMax', salary_max, 'salaryPeriod', salary_period,
  'salaryType', salary_type, 'workFormat', work_format, 'legacyConditionsOnly', true);
ALTER TABLE signal_invitations ADD CONSTRAINT signal_invitations_context_check CHECK ((need_id IS NOT NULL) <> (job_id IS NOT NULL));
ALTER TABLE signal_invitations ADD CONSTRAINT signal_invitations_context_version_check CHECK (context_version > 0);
CREATE INDEX signal_invitations_job_context_idx ON signal_invitations(company_id, job_id, candidate_user_id);
--> statement-breakpoint
CREATE TABLE signal_shortlist (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES signal_companies(id) ON DELETE CASCADE,
  context_type text NOT NULL,
  context_id integer NOT NULL,
  need_id integer REFERENCES signal_needs(id) ON DELETE RESTRICT,
  job_id integer REFERENCES signal_jobs(id) ON DELETE RESTRICT,
  candidate_user_id integer NOT NULL REFERENCES signal_users(id) ON DELETE CASCADE,
  resume_id integer NOT NULL REFERENCES signal_candidate_resumes(id) ON DELETE CASCADE,
  context_version integer NOT NULL CHECK (context_version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT signal_shortlist_context_check CHECK (
    (context_type = 'need' AND need_id IS NOT NULL AND need_id = context_id AND job_id IS NULL) OR
    (context_type = 'job' AND job_id IS NOT NULL AND job_id = context_id AND need_id IS NULL))
);
CREATE UNIQUE INDEX signal_shortlist_person_unique ON signal_shortlist(company_id, context_type, context_id, candidate_user_id);
CREATE INDEX signal_shortlist_context_idx ON signal_shortlist(company_id, context_type, context_id);
