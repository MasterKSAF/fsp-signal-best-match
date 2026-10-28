CREATE TABLE signal_requirement_previews (
 id uuid PRIMARY KEY, company_id integer NOT NULL REFERENCES signal_companies(id), actor_id integer NOT NULL REFERENCES signal_users(id),
 context_type text NOT NULL CHECK(context_type IN ('job','need')), context_id integer NOT NULL,
 base_revision integer NOT NULL, patch_hash text NOT NULL, patch jsonb NOT NULL, versions jsonb NOT NULL, result jsonb NOT NULL,
 expires_at timestamptz NOT NULL, applied_revision integer, apply_command text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX signal_preview_rate_idx ON signal_requirement_previews(company_id,context_type,context_id,created_at);
CREATE TABLE signal_context_revisions (
 id uuid PRIMARY KEY, company_id integer NOT NULL REFERENCES signal_companies(id), actor_id integer NOT NULL REFERENCES signal_users(id),
 context_type text NOT NULL CHECK(context_type IN ('job','need')), context_id integer NOT NULL,
 revision integer NOT NULL, parent_revision integer NOT NULL, preview_id uuid NOT NULL REFERENCES signal_requirement_previews(id),
 before jsonb NOT NULL, after jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,context_type,context_id,revision), CHECK(revision=parent_revision+1)
);
CREATE FUNCTION signal_context_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Context revision history is immutable'; END $$;
CREATE TRIGGER signal_context_history_immutable BEFORE UPDATE OR DELETE ON signal_context_revisions FOR EACH ROW EXECUTE FUNCTION signal_context_history_immutable();
