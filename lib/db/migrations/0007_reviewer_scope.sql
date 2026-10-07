-- Additive reviewer isolation. Existing ordinary and overview Demo users stay null.
ALTER TABLE signal_users ADD COLUMN IF NOT EXISTS review_scope_id text;
ALTER TABLE signal_sessions ADD COLUMN IF NOT EXISTS review_scope_id text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='signal_users_review_scope_check' AND conrelid='signal_users'::regclass) THEN
    ALTER TABLE signal_users ADD CONSTRAINT signal_users_review_scope_check CHECK (
      review_scope_id IS NULL OR (demo_mode AND review_scope_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
    );
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS signal_users_review_pool_idx ON signal_users(demo_mode, review_scope_id, role, id);
