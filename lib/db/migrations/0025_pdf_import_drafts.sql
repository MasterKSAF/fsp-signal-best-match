CREATE TABLE signal_pdf_import_drafts (
 id uuid PRIMARY KEY, user_id integer NOT NULL REFERENCES signal_users(id),
 resume_id integer NOT NULL REFERENCES signal_candidate_resumes(id), resume_revision integer NOT NULL CHECK(resume_revision>0),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0), document_hash text NOT NULL, engine text NOT NULL,
 fields jsonb NOT NULL, provenance jsonb NOT NULL, fragments jsonb NOT NULL, warnings jsonb NOT NULL,
 review_token_hash text, reviewed_at timestamptz, state text NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','applied','cancelled')),
 applied_revision integer, apply_hash text, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX signal_pdf_import_owner_idx ON signal_pdf_import_drafts(user_id,created_at);
