-- Add optional public location / level requirements without assigning levels to old jobs.
CREATE TABLE IF NOT EXISTS signal_job_requirements (
  job_id integer PRIMARY KEY REFERENCES signal_jobs(id) ON DELETE CASCADE,
  location text NOT NULL DEFAULT '',
  skill_requirements jsonb NOT NULL DEFAULT '[]'::jsonb,
  CONSTRAINT signal_job_requirements_array CHECK (jsonb_typeof(skill_requirements) = 'array')
);
