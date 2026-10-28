CREATE TABLE signal_company_commands (
 id uuid PRIMARY KEY,company_id integer NOT NULL REFERENCES signal_companies(id),actor_id integer NOT NULL REFERENCES signal_users(id),command_key text NOT NULL,payload_hash text NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(company_id,actor_id,command_key)
);
ALTER TABLE signal_selection_watch_events ADD COLUMN context_revision integer NOT NULL DEFAULT 0;
ALTER TABLE signal_selection_watch_events ADD COLUMN proof_hash text NOT NULL DEFAULT '';
CREATE TRIGGER signal_bank_policy_epoch AFTER INSERT OR UPDATE OR DELETE ON signal_bank_template_overrides FOR EACH STATEMENT EXECUTE FUNCTION signal_bump_professional_epoch();
