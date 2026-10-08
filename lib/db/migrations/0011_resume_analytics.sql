CREATE TABLE IF NOT EXISTS signal_resume_events (
 id serial PRIMARY KEY,
 resume_id integer NOT NULL REFERENCES signal_candidate_resumes(id) ON DELETE CASCADE,
 actor_user_id integer NOT NULL REFERENCES signal_users(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK (kind IN ('view','download')),
 window_key text NOT NULL,
 format text CHECK (format IS NULL OR format IN ('pdf','docx')),
 occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS signal_resume_event_dedup ON signal_resume_events(resume_id,actor_user_id,kind,window_key);
CREATE INDEX IF NOT EXISTS signal_resume_events_period ON signal_resume_events(resume_id,occurred_at);
CREATE TABLE IF NOT EXISTS signal_resume_work_preferences (
 resume_id integer PRIMARY KEY REFERENCES signal_candidate_resumes(id) ON DELETE CASCADE,
 location text NOT NULL DEFAULT '', schedule text NOT NULL DEFAULT '', employment text NOT NULL DEFAULT '',
 relocation boolean NOT NULL DEFAULT false, start_availability text NOT NULL DEFAULT '', updated_at timestamptz NOT NULL DEFAULT now()
);
-- Existing content, qualifications, identity and historic timestamps are untouched. No synthetic events are created.
