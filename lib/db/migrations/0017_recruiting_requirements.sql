-- Omitted legacy modes remain verified. Historical invitation/application
-- snapshots and old skill levels are intentionally not rewritten.
CREATE FUNCTION signal_valid_skill_requirements(value jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE item jsonb;
BEGIN
  IF jsonb_typeof(value) <> 'array' OR jsonb_array_length(value) > 40 THEN RETURN false; END IF;
  FOR item IN SELECT * FROM jsonb_array_elements(value) LOOP
    IF jsonb_typeof(item) <> 'object' OR jsonb_typeof(item->'skill') IS DISTINCT FROM 'string'
      OR length(btrim(item->>'skill')) = 0 OR length(item->>'skill') > 100
      OR (item ? 'mode' AND (jsonb_typeof(item->'mode') IS DISTINCT FROM 'string' OR item->>'mode' NOT IN ('verified','declared_or_verified')))
      OR (item ? 'level' AND (jsonb_typeof(item->'level') IS DISTINCT FROM 'string' OR item->>'level' NOT IN ('Junior','Middle','Senior') OR item->>'mode' = 'declared_or_verified'))
      OR item - ARRAY['skill','mode','level'] <> '{}'::jsonb THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END $$;
--> statement-breakpoint
ALTER TABLE signal_needs ADD COLUMN grade_mode text NOT NULL DEFAULT 'verified';
--> statement-breakpoint
ALTER TABLE signal_needs ADD COLUMN skill_requirements jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint
ALTER TABLE signal_jobs ADD COLUMN grade_mode text NOT NULL DEFAULT 'verified';
--> statement-breakpoint
ALTER TABLE signal_needs ADD CONSTRAINT signal_needs_grade_mode_check CHECK (grade_mode IN ('verified','declared_or_verified'));
--> statement-breakpoint
ALTER TABLE signal_jobs ADD CONSTRAINT signal_jobs_grade_mode_check CHECK (grade_mode IN ('verified','declared_or_verified'));
--> statement-breakpoint
ALTER TABLE signal_needs ADD CONSTRAINT signal_needs_skill_requirements_check CHECK (signal_valid_skill_requirements(skill_requirements));
--> statement-breakpoint
ALTER TABLE signal_job_requirements ADD CONSTRAINT signal_job_requirements_modes_check CHECK (signal_valid_skill_requirements(skill_requirements));
