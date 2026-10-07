-- Existing assessment-bank rows originated in Signal; company work already lives
-- in signal_micro_offers. No historical score/source/date or earned grade changes.
ALTER TABLE signal_assessment_attempts ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'signal_qualification';
ALTER TABLE signal_assessment_attempts ADD COLUMN IF NOT EXISTS purpose_origin text NOT NULL DEFAULT 'legacy_signal_bank';
ALTER TABLE signal_assessment_attempts ADD COLUMN IF NOT EXISTS grade_confirmed_at timestamptz;
ALTER TABLE signal_micro_offers ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'company_task';
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='signal_attempt_purpose_check') THEN
    ALTER TABLE signal_assessment_attempts ADD CONSTRAINT signal_attempt_purpose_check CHECK(purpose IN('signal_qualification','company_task','legacy_unknown'));
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='signal_attempt_purpose_origin_check') THEN
    ALTER TABLE signal_assessment_attempts ADD CONSTRAINT signal_attempt_purpose_origin_check CHECK(purpose_origin IN('candidate_confirmed','legacy_signal_bank') AND (purpose_origin<>'candidate_confirmed' OR grade_confirmed_at IS NOT NULL));
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='signal_micro_offer_purpose_check') THEN
    ALTER TABLE signal_micro_offers ADD CONSTRAINT signal_micro_offer_purpose_check CHECK(purpose='company_task');
  END IF;
END $$;
CREATE OR REPLACE FUNCTION signal_attempt_identity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(OLD.user_id,OLD.purpose,OLD.purpose_origin,OLD.grade_confirmed_at,OLD.program_id,OLD.program_version,OLD.resume_id,OLD.resume_revision,OLD.resume_specialization,OLD.grade,OLD.cases,OLD.oracles)
    IS DISTINCT FROM ROW(NEW.user_id,NEW.purpose,NEW.purpose_origin,NEW.grade_confirmed_at,NEW.program_id,NEW.program_version,NEW.resume_id,NEW.resume_revision,NEW.resume_specialization,NEW.grade,NEW.cases,NEW.oracles) THEN
    RAISE EXCEPTION 'Assessment purpose, target, declared grade and saved program are immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS signal_attempt_identity_guard ON signal_assessment_attempts;
CREATE TRIGGER signal_attempt_identity_guard BEFORE UPDATE ON signal_assessment_attempts FOR EACH ROW EXECUTE FUNCTION signal_attempt_identity_guard();
CREATE OR REPLACE FUNCTION signal_assessment_context_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.attempt_id IS DISTINCT FROM OLD.attempt_id OR NEW.snapshot IS DISTINCT FROM OLD.snapshot THEN
    RAISE EXCEPTION 'Assessment creation context is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS signal_assessment_context_guard ON signal_assessment_contexts;
CREATE TRIGGER signal_assessment_context_guard BEFORE UPDATE ON signal_assessment_contexts FOR EACH ROW EXECUTE FUNCTION signal_assessment_context_guard();
CREATE OR REPLACE FUNCTION signal_micro_purpose_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.purpose IS DISTINCT FROM OLD.purpose OR NEW.company_id IS DISTINCT FROM OLD.company_id OR NEW.candidate_user_id IS DISTINCT FROM OLD.candidate_user_id OR NEW.snapshot IS DISTINCT FROM OLD.snapshot THEN
    RAISE EXCEPTION 'Company task source and original context are immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS signal_micro_purpose_guard ON signal_micro_offers;
CREATE TRIGGER signal_micro_purpose_guard BEFORE UPDATE ON signal_micro_offers FOR EACH ROW EXECUTE FUNCTION signal_micro_purpose_guard();
