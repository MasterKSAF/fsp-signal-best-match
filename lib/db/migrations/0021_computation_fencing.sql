CREATE TABLE signal_dependency_epoch (key text PRIMARY KEY, revision bigint NOT NULL DEFAULT 1);
--> statement-breakpoint
INSERT INTO signal_dependency_epoch(key,revision) VALUES ('professional-pool',1);
--> statement-breakpoint
CREATE FUNCTION signal_bump_professional_epoch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE signal_dependency_epoch SET revision=revision+1 WHERE key='professional-pool';
  RETURN NULL;
END;
$$;
--> statement-breakpoint
DO $$
DECLARE target text;
BEGIN
  FOREACH target IN ARRAY ARRAY[
    'signal_users','signal_companies','signal_candidate_profiles','signal_candidate_resumes',
    'signal_needs','signal_need_skill_levels','signal_jobs','signal_job_requirements',
    'signal_skill_attempts','signal_skill_evidence','signal_skill_corrections',
    'signal_assessment_attempts','signal_assessment_corrections','signal_consents',
    'signal_company_blocks','signal_contact_grants','signal_fsp_connections'
  ] LOOP
    EXECUTE format('CREATE TRIGGER signal_professional_epoch AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH STATEMENT EXECUTE FUNCTION signal_bump_professional_epoch()',target);
  END LOOP;
END;
$$;
--> statement-breakpoint
CREATE TABLE signal_computation_tasks (
  id uuid PRIMARY KEY, actor_id integer NOT NULL REFERENCES signal_users(id) ON DELETE CASCADE,
  company_id integer NOT NULL REFERENCES signal_companies(id) ON DELETE CASCADE,
  context_type text NOT NULL CHECK (context_type IN ('job','need')), context_id integer NOT NULL,
  kind text NOT NULL, command_key text NOT NULL, versions jsonb NOT NULL,
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','running','ready','discarded_stale','failed')),
  input jsonb NOT NULL, result jsonb, lease_fence integer NOT NULL DEFAULT 0, lease_until timestamptz,
  error_code text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX signal_computation_command_unique ON signal_computation_tasks(company_id,actor_id,command_key);
--> statement-breakpoint
CREATE INDEX signal_computation_poll_idx ON signal_computation_tasks(state,lease_until);
