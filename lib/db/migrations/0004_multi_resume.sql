-- Additive, retry-safe migration. Run against an isolated snapshot before deployment.
ALTER TABLE signal_candidate_profiles ADD COLUMN IF NOT EXISTS avatar_data_url text;
ALTER TABLE signal_candidate_profiles ADD COLUMN IF NOT EXISTS avatar_updated_at timestamptz;
ALTER TABLE signal_candidate_profiles ADD COLUMN IF NOT EXISTS legacy_qualification jsonb;
ALTER TABLE signal_candidate_resumes ADD COLUMN IF NOT EXISTS id serial;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage ku USING (constraint_name,table_schema,table_name) WHERE tc.table_name='signal_candidate_resumes' AND tc.constraint_type='PRIMARY KEY' AND ku.column_name='user_id') THEN
    ALTER TABLE signal_candidate_resumes DROP CONSTRAINT signal_candidate_resumes_pkey;
    ALTER TABLE signal_candidate_resumes ADD PRIMARY KEY (id);
  END IF;
END $$;
ALTER TABLE signal_candidate_resumes ADD COLUMN IF NOT EXISTS title text NOT NULL DEFAULT 'Моё резюме';
ALTER TABLE signal_candidate_resumes ADD COLUMN IF NOT EXISTS is_primary boolean NOT NULL DEFAULT false;
ALTER TABLE signal_candidate_resumes ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1;
ALTER TABLE signal_candidate_resumes ADD COLUMN IF NOT EXISTS specialization text NOT NULL DEFAULT 'Backend / Python';
ALTER TABLE signal_candidate_resumes ADD COLUMN IF NOT EXISTS assumed_grade text NOT NULL DEFAULT 'Junior';
ALTER TABLE signal_candidate_resumes ADD COLUMN IF NOT EXISTS verified_grade text;
ALTER TABLE signal_candidate_resumes ADD COLUMN IF NOT EXISTS verified_grade_changed_at timestamptz;
ALTER TABLE signal_candidate_resumes ADD COLUMN IF NOT EXISTS verified_score integer;
ALTER TABLE signal_candidate_resumes ADD COLUMN IF NOT EXISTS verified_skills text[] NOT NULL DEFAULT '{}';
ALTER TABLE signal_candidate_resumes ADD COLUMN IF NOT EXISTS stack text[] NOT NULL DEFAULT '{}';
ALTER TABLE signal_candidate_resumes ADD COLUMN IF NOT EXISTS skills text[] NOT NULL DEFAULT '{}';
ALTER TABLE signal_candidate_resumes ADD COLUMN IF NOT EXISTS years_experience integer NOT NULL DEFAULT 0;
ALTER TABLE signal_candidate_resumes ADD COLUMN IF NOT EXISTS work_format text NOT NULL DEFAULT 'Удалённо';
ALTER TABLE signal_candidate_resumes ADD COLUMN IF NOT EXISTS salary_min integer;
ALTER TABLE signal_candidate_resumes ADD COLUMN IF NOT EXISTS salary_max integer;
ALTER TABLE signal_candidate_resumes ADD COLUMN IF NOT EXISTS salary_period text NOT NULL DEFAULT 'month';
ALTER TABLE signal_candidate_resumes ADD COLUMN IF NOT EXISTS salary_type text NOT NULL DEFAULT 'gross';
ALTER TABLE signal_candidate_resumes ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'private';
ALTER TABLE signal_candidate_resumes ADD COLUMN IF NOT EXISTS consent_matching boolean NOT NULL DEFAULT false;
ALTER TABLE signal_candidate_resumes ADD COLUMN IF NOT EXISTS consent_catalog boolean NOT NULL DEFAULT false;
ALTER TABLE signal_candidate_resumes ADD COLUMN IF NOT EXISTS ready_for_offers boolean NOT NULL DEFAULT false;
ALTER TABLE signal_candidate_resumes ADD COLUMN IF NOT EXISTS latest_assessment_at timestamptz;
ALTER TABLE signal_candidate_resumes ADD COLUMN IF NOT EXISTS qualification_attempt_id integer;
ALTER TABLE signal_candidate_resumes ADD COLUMN IF NOT EXISTS legacy_qualification jsonb;
ALTER TABLE signal_candidate_resumes ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE signal_candidate_resumes ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE signal_assessment_attempts ADD COLUMN IF NOT EXISTS resume_id integer;
ALTER TABLE signal_assessment_attempts ADD COLUMN IF NOT EXISTS resume_revision integer;
ALTER TABLE signal_assessment_attempts ADD COLUMN IF NOT EXISTS resume_specialization text;
ALTER TABLE signal_assessment_attempts ADD COLUMN IF NOT EXISTS program_version text;
ALTER TABLE signal_invitations ADD COLUMN IF NOT EXISTS resume_id integer;
ALTER TABLE signal_invitations ADD COLUMN IF NOT EXISTS resume_snapshot jsonb;
ALTER TABLE signal_applications ADD COLUMN IF NOT EXISTS resume_id integer;
ALTER TABLE signal_applications ADD COLUMN IF NOT EXISTS resume_snapshot jsonb;

-- A durable per-user marker makes a second run safe even after a migrated resume is deleted.
CREATE TABLE IF NOT EXISTS signal_resume_migration_state (
  user_id integer PRIMARY KEY REFERENCES signal_users(id) ON DELETE CASCADE,
  resume_id integer NOT NULL,
  applied_at timestamptz
);
INSERT INTO signal_candidate_resumes (user_id)
SELECT p.user_id FROM signal_candidate_profiles p JOIN signal_users u ON u.id=p.user_id AND u.role='candidate'
WHERE NOT EXISTS (SELECT 1 FROM signal_candidate_resumes r WHERE r.user_id=p.user_id)
  AND NOT EXISTS (SELECT 1 FROM signal_resume_migration_state m WHERE m.user_id=p.user_id);
INSERT INTO signal_resume_migration_state (user_id,resume_id)
SELECT p.user_id,min(r.id) FROM signal_candidate_profiles p JOIN signal_users u ON u.id=p.user_id AND u.role='candidate'
JOIN signal_candidate_resumes r ON r.user_id=p.user_id GROUP BY p.user_id
ON CONFLICT (user_id) DO NOTHING;
UPDATE signal_candidate_resumes r SET
  title=p.specialization, is_primary=true, specialization=p.specialization,
  assumed_grade=p.assumed_grade, verified_grade=p.verified_grade,
  verified_grade_changed_at=p.verified_grade_changed_at, verified_score=p.verified_score,
  verified_skills=p.verified_skills, stack=p.stack, skills=p.skills,
  years_experience=p.years_experience, work_format=p.work_format,
  salary_min=p.salary_min,salary_max=p.salary_max,salary_period=p.salary_period,salary_type=p.salary_type,
  visibility=p.visibility,consent_matching=p.consent_matching,
  latest_assessment_at=p.latest_assessment_at,
  legacy_qualification=CASE WHEN p.verified_grade IS NOT NULL OR cardinality(p.verified_skills)>0 THEN jsonb_build_object(
    'specialization',p.specialization,'grade',p.verified_grade,'score',p.verified_score,
    'skills',to_jsonb(p.verified_skills),'assessedAt',p.latest_assessment_at,'gradeChangedAt',p.verified_grade_changed_at,
    'attemptId',(SELECT a.id FROM signal_assessment_attempts a WHERE a.user_id=p.user_id AND a.verified=true AND a.status='submitted' AND a.grade=p.verified_grade AND a.submitted_at=p.latest_assessment_at AND ((p.specialization='Backend / Python' AND a.program_id='backend-python') OR (p.specialization='Frontend / TypeScript' AND a.program_id='frontend-typescript')) ORDER BY a.id LIMIT 1),
    'limitation','Исторический результат сохранён. При отсутствии полной программы и критериев происхождение ограничено; отдельные навыки не считаются новым измерением.') ELSE NULL END
FROM signal_candidate_profiles p,signal_resume_migration_state m
WHERE r.id=m.resume_id AND p.user_id=m.user_id AND m.applied_at IS NULL;
UPDATE signal_candidate_profiles p SET legacy_qualification=r.legacy_qualification
FROM signal_candidate_resumes r,signal_resume_migration_state m
WHERE p.user_id=m.user_id AND r.id=m.resume_id AND m.applied_at IS NULL;
UPDATE signal_resume_migration_state SET applied_at=now() WHERE applied_at IS NULL;

-- Context comes only from stored program/oracle metadata, never guessed from today's profile.
UPDATE signal_assessment_attempts a SET
  resume_specialization=CASE a.program_id WHEN 'backend-python' THEN 'Backend / Python' WHEN 'frontend-typescript' THEN 'Frontend / TypeScript' ELSE NULL END,
  program_version=(SELECT CASE WHEN count(DISTINCT value->'blueprint'->>'version')=1 THEN min(value->'blueprint'->>'version') END FROM jsonb_each(a.oracles))
WHERE a.resume_specialization IS NULL;
UPDATE signal_assessment_attempts a SET resume_id=m.resume_id,resume_revision=1
FROM signal_resume_migration_state m,signal_candidate_resumes r
WHERE a.user_id=m.user_id AND r.id=m.resume_id AND a.resume_id IS NULL AND a.resume_specialization=r.specialization;
UPDATE signal_invitations i SET resume_id=m.resume_id FROM signal_resume_migration_state m WHERE i.candidate_user_id=m.user_id AND i.resume_id IS NULL;
UPDATE signal_applications a SET resume_id=m.resume_id FROM signal_resume_migration_state m WHERE a.candidate_user_id=m.user_id AND a.resume_id IS NULL;
-- Old invitation/application snapshots remain NULL: their original professional revision is unknown.
CREATE INDEX IF NOT EXISTS signal_resumes_owner_idx ON signal_candidate_resumes(user_id,deleted_at);
CREATE UNIQUE INDEX IF NOT EXISTS signal_resumes_primary_unique ON signal_candidate_resumes(user_id) WHERE is_primary AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS signal_attempts_resume_idx ON signal_assessment_attempts(resume_id);
CREATE OR REPLACE FUNCTION signal_resume_limit_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(3306,NEW.user_id);
  IF NOT EXISTS(SELECT 1 FROM signal_users WHERE id=NEW.user_id AND role='candidate') THEN
    RAISE EXCEPTION 'Only candidates can own resumes' USING ERRCODE='23514';
  END IF;
  IF NEW.deleted_at IS NULL AND (SELECT count(*) FROM signal_candidate_resumes WHERE user_id=NEW.user_id AND deleted_at IS NULL AND id<>NEW.id)>=5 THEN
    RAISE EXCEPTION 'Candidate resume limit is five' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS signal_resume_limit_guard ON signal_candidate_resumes;
CREATE TRIGGER signal_resume_limit_guard BEFORE INSERT OR UPDATE ON signal_candidate_resumes FOR EACH ROW EXECUTE FUNCTION signal_resume_limit_guard();
