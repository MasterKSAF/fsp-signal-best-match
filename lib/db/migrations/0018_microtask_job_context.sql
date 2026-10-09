-- Legacy templates and immutable offer snapshots intentionally remain unbound.
ALTER TABLE signal_micro_templates ADD COLUMN job_id integer;
ALTER TABLE signal_micro_templates ADD CONSTRAINT signal_micro_templates_job_fk
  FOREIGN KEY (job_id) REFERENCES signal_jobs(id) ON DELETE RESTRICT;
CREATE INDEX signal_micro_templates_job_idx ON signal_micro_templates(job_id, active);
