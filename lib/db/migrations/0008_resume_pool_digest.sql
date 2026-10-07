-- Complete server-owned row commitment; never a revision/TTL substitute.
ALTER TABLE signal_candidate_resumes ADD COLUMN IF NOT EXISTS pool_content_digest bytea;

CREATE OR REPLACE FUNCTION signal_resume_pool_content_digest(value signal_candidate_resumes)
RETURNS bytea LANGUAGE sql STABLE AS $$
  SELECT sha256(convert_to((
    (to_jsonb(value) - 'pool_content_digest') || jsonb_build_object(
      'created_at', extract(epoch FROM value.created_at),
      'updated_at', extract(epoch FROM value.updated_at),
      'verified_grade_changed_at', extract(epoch FROM value.verified_grade_changed_at),
      'latest_assessment_at', extract(epoch FROM value.latest_assessment_at),
      'deleted_at', extract(epoch FROM value.deleted_at)
    )
  )::text, 'UTF8'));
$$;

CREATE OR REPLACE FUNCTION signal_refresh_resume_pool_content_digest()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Unconditional: direct SQL updates, unchanged revision and attempted digest
  -- overrides are treated exactly like ordinary writes. Commit is atomic.
  NEW.pool_content_digest := signal_resume_pool_content_digest(NEW);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS signal_resume_pool_content_digest_guard ON signal_candidate_resumes;
CREATE TRIGGER signal_resume_pool_content_digest_guard
  BEFORE INSERT OR UPDATE ON signal_candidate_resumes
  FOR EACH ROW EXECUTE FUNCTION signal_refresh_resume_pool_content_digest();

-- Backfill existing live/soft-deleted rows without creating any résumé.
UPDATE signal_candidate_resumes SET pool_content_digest = pool_content_digest;
ALTER TABLE signal_candidate_resumes ALTER COLUMN pool_content_digest SET NOT NULL;
ALTER TABLE signal_candidate_resumes ALTER COLUMN pool_content_digest SET DEFAULT decode('', 'hex');
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='signal_resume_pool_digest_size_check' AND conrelid='signal_candidate_resumes'::regclass) THEN
    ALTER TABLE signal_candidate_resumes ADD CONSTRAINT signal_resume_pool_digest_size_check CHECK (octet_length(pool_content_digest)=32);
  END IF;
END $$;

-- Keep fingerprint scans narrow; every live permission/scope predicate is
-- nevertheless evaluated in the current SQL statement, never cached here.
CREATE INDEX IF NOT EXISTS signal_resume_matching_digest_idx
  ON signal_candidate_resumes(specialization, user_id, id)
  INCLUDE (pool_content_digest, visibility)
  WHERE deleted_at IS NULL AND consent_matching AND visibility <> 'private';
CREATE INDEX IF NOT EXISTS signal_resume_catalog_digest_idx
  ON signal_candidate_resumes(user_id, id)
  INCLUDE (pool_content_digest, visibility)
  WHERE deleted_at IS NULL AND consent_catalog AND visibility <> 'private';
