CREATE TABLE IF NOT EXISTS signal_invitation_requests (
  id serial PRIMARY KEY, company_id integer NOT NULL REFERENCES signal_companies(id) ON DELETE CASCADE,
  request_key text NOT NULL, body_hash text NOT NULL,
  invitation_id integer NOT NULL REFERENCES signal_invitations(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS signal_invitation_request_unique ON signal_invitation_requests(company_id,request_key);
CREATE TABLE IF NOT EXISTS signal_moderator_permissions (
  user_id integer PRIMARY KEY REFERENCES signal_users(id) ON DELETE CASCADE,
  granted_by text NOT NULL, active boolean NOT NULL DEFAULT true,granted_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS signal_company_blocks (
  id serial PRIMARY KEY,candidate_user_id integer NOT NULL REFERENCES signal_users(id) ON DELETE CASCADE,
  company_id integer NOT NULL REFERENCES signal_companies(id) ON DELETE CASCADE,
  active boolean NOT NULL DEFAULT true,blocked_at timestamptz NOT NULL DEFAULT now(),unblocked_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS signal_company_block_unique ON signal_company_blocks(candidate_user_id,company_id);
CREATE TABLE IF NOT EXISTS signal_complaints (
  id serial PRIMARY KEY,reporter_user_id integer NOT NULL REFERENCES signal_users(id) ON DELETE CASCADE,
  company_id integer NOT NULL REFERENCES signal_companies(id) ON DELETE CASCADE,
  object_type text NOT NULL CHECK(object_type IN('company','job','invitation')),object_id integer NOT NULL,
  category text NOT NULL CHECK(category IN('spam','misleading','discrimination','inappropriate','privacy','other')),
  explanation text NOT NULL DEFAULT '',status text NOT NULL DEFAULT 'submitted' CHECK(status IN('submitted','in_review','dismissed','upheld')),
  decision_reason text,moderator_user_id integer,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS signal_complaint_case_unique ON signal_complaints(reporter_user_id,object_type,object_id,category);
CREATE INDEX IF NOT EXISTS signal_complaint_queue_idx ON signal_complaints(status,created_at);
CREATE TABLE IF NOT EXISTS signal_complaint_requests (
  id serial PRIMARY KEY,reporter_user_id integer NOT NULL REFERENCES signal_users(id) ON DELETE CASCADE,
  request_key text NOT NULL,body_hash text NOT NULL,complaint_id integer NOT NULL REFERENCES signal_complaints(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS signal_complaint_request_unique ON signal_complaint_requests(reporter_user_id,request_key);
CREATE TABLE IF NOT EXISTS signal_employer_restrictions (
  id serial PRIMARY KEY,company_id integer NOT NULL REFERENCES signal_companies(id) ON DELETE CASCADE,
  complaint_id integer NOT NULL REFERENCES signal_complaints(id) ON DELETE CASCADE,
  scope text NOT NULL CHECK(scope IN('invitations','contacts','publishing','all')),public_reason text NOT NULL,
  moderator_user_id integer NOT NULL,starts_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL,
  lifted_at timestamptz,lift_reason text,lifted_by_user_id integer,
  CHECK(expires_at>starts_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS signal_restriction_case_scope_unique ON signal_employer_restrictions(complaint_id,scope);
CREATE INDEX IF NOT EXISTS signal_restriction_company_idx ON signal_employer_restrictions(company_id,expires_at);
CREATE TABLE IF NOT EXISTS signal_restriction_appeals (
  id serial PRIMARY KEY,restriction_id integer NOT NULL REFERENCES signal_employer_restrictions(id) ON DELETE CASCADE,
  company_id integer NOT NULL REFERENCES signal_companies(id) ON DELETE CASCADE,author_user_id integer NOT NULL,
  explanation text NOT NULL,status text NOT NULL DEFAULT 'submitted' CHECK(status IN('submitted','accepted','rejected')),
  decision_reason text,moderator_user_id integer,created_at timestamptz NOT NULL DEFAULT now(),decided_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS signal_restriction_appeal_once ON signal_restriction_appeals(restriction_id);
CREATE TABLE IF NOT EXISTS signal_trust_audit (
  id serial PRIMARY KEY,actor_user_id integer,actor_operator text,action text NOT NULL,
  object_type text NOT NULL,object_id integer NOT NULL,company_id integer,reason text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION signal_trust_audit_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Trust audit is append-only' USING ERRCODE='23514'; END $$;
DROP TRIGGER IF EXISTS signal_trust_audit_immutable ON signal_trust_audit;
CREATE TRIGGER signal_trust_audit_immutable BEFORE UPDATE OR DELETE ON signal_trust_audit FOR EACH ROW EXECUTE FUNCTION signal_trust_audit_immutable();
