CREATE FUNCTION signal_preserve_final_skill_answers() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.status IN ('submitted','expired') AND (NEW.answers IS DISTINCT FROM OLD.answers OR NEW.decision IS DISTINCT FROM OLD.decision OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at) THEN RAISE EXCEPTION 'final skill answers and original decision are immutable; append a review'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER signal_skill_final_answers_immutable BEFORE UPDATE ON signal_skill_attempts FOR EACH ROW EXECUTE FUNCTION signal_preserve_final_skill_answers();
CREATE FUNCTION signal_preserve_final_legacy_answers() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.status='submitted' AND (NEW.answers IS DISTINCT FROM OLD.answers OR NEW.score IS DISTINCT FROM OLD.score OR NEW.verified IS DISTINCT FROM OLD.verified OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at) THEN RAISE EXCEPTION 'final historical answers and decision are immutable; append a review'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER signal_legacy_final_answers_immutable BEFORE UPDATE ON signal_assessment_attempts FOR EACH ROW EXECUTE FUNCTION signal_preserve_final_legacy_answers();
