-- Additive migration. Old assessments, answer/rubric snapshots and dates are untouched.
CREATE TABLE IF NOT EXISTS signal_skill_attempts (
 id serial PRIMARY KEY, user_id integer NOT NULL REFERENCES signal_users(id) ON DELETE CASCADE,
 resume_id integer REFERENCES signal_candidate_resumes(id) ON DELETE SET NULL, skill_id text NOT NULL,
 level text NOT NULL CHECK(level IN ('Junior','Middle','Senior')), program_version text NOT NULL,
 status text NOT NULL CHECK(status IN ('active','submitted','expired')), cases jsonb NOT NULL, oracles jsonb NOT NULL,
 answers jsonb NOT NULL DEFAULT '{}', revision integer NOT NULL DEFAULT 1, policy jsonb NOT NULL, decision jsonb,
 started_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL, submitted_at timestamptz
);
CREATE INDEX IF NOT EXISTS signal_skill_attempt_owner_idx ON signal_skill_attempts(user_id,started_at);
CREATE INDEX IF NOT EXISTS signal_skill_attempt_module_idx ON signal_skill_attempts(user_id,skill_id,level);
CREATE TABLE IF NOT EXISTS signal_skill_exposures (
 id serial PRIMARY KEY, user_id integer NOT NULL REFERENCES signal_users(id) ON DELETE CASCADE,
 attempt_id integer NOT NULL REFERENCES signal_skill_attempts(id) ON DELETE CASCADE,
 template_id text NOT NULL, issued_at timestamptz NOT NULL DEFAULT now(), UNIQUE(attempt_id,template_id)
);
CREATE INDEX IF NOT EXISTS signal_skill_exposure_frequency_idx ON signal_skill_exposures(template_id,issued_at);
CREATE INDEX IF NOT EXISTS signal_skill_exposure_owner_idx ON signal_skill_exposures(user_id,template_id);
CREATE TABLE IF NOT EXISTS signal_skill_evidence (
 id serial PRIMARY KEY, user_id integer NOT NULL REFERENCES signal_users(id) ON DELETE CASCADE,
 attempt_id integer NOT NULL UNIQUE REFERENCES signal_skill_attempts(id) ON DELETE CASCADE,
 skill_id text NOT NULL, level text NOT NULL CHECK(level IN ('Junior','Middle','Senior')), program_version text NOT NULL,
 competency_ids text[] NOT NULL, verified_at timestamptz NOT NULL, decision jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS signal_skill_evidence_owner_idx ON signal_skill_evidence(user_id,skill_id);
CREATE TABLE IF NOT EXISTS signal_skill_corrections (
 id serial PRIMARY KEY, evidence_id integer NOT NULL UNIQUE REFERENCES signal_skill_evidence(id) ON DELETE CASCADE,
 reason text NOT NULL, operator text NOT NULL, original_decision jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS signal_skill_categories (
 id serial PRIMARY KEY, user_id integer NOT NULL REFERENCES signal_users(id) ON DELETE CASCADE,
 resume_id integer NOT NULL REFERENCES signal_candidate_resumes(id) ON DELETE CASCADE,
 snapshot_hash text NOT NULL, snapshot jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(resume_id,snapshot_hash)
);
