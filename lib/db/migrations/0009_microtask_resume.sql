ALTER TABLE signal_micro_templates ADD COLUMN specialization text;
ALTER TABLE signal_micro_templates ADD CONSTRAINT signal_micro_specialization_check CHECK (specialization IS NULL OR specialization IN ('Backend / Python','Frontend / TypeScript'));
--> statement-breakpoint
ALTER TABLE signal_micro_subscriptions ADD COLUMN resume_id integer REFERENCES signal_candidate_resumes(id) ON DELETE SET NULL;
ALTER TABLE signal_micro_subscriptions ADD COLUMN resume_revision integer;
ALTER TABLE signal_micro_subscriptions ADD COLUMN resume_context jsonb;
ALTER TABLE signal_micro_subscriptions ADD COLUMN resume_provenance text NOT NULL DEFAULT 'legacy_unbound';
--> statement-breakpoint
ALTER TABLE signal_micro_offers ADD COLUMN resume_id integer;
ALTER TABLE signal_micro_offers ADD COLUMN resume_revision integer;
ALTER TABLE signal_micro_offers ADD COLUMN resume_context jsonb;
ALTER TABLE signal_micro_offers ADD COLUMN resume_provenance text NOT NULL DEFAULT 'legacy_unbound';
--> statement-breakpoint
-- Old rows have no recorded source resume. Do not infer it from today's primary.
ALTER TABLE signal_micro_subscriptions ADD CONSTRAINT signal_micro_subscription_resume_check CHECK (COALESCE((
  (resume_provenance = 'legacy_unbound' AND resume_id IS NULL AND resume_revision IS NULL AND resume_context IS NULL)
  OR (resume_provenance = 'captured' AND resume_revision IS NOT NULL AND resume_revision > 0 AND resume_context IS NOT NULL AND jsonb_typeof(resume_context) = 'object'
      AND resume_context ?& ARRAY['resumeId','revision','title','specialization','verifiedGrade','verifiedSkills','professionalAlias']
      AND resume_context->>'specialization' IN ('Backend / Python','Frontend / TypeScript')
      AND resume_context->>'verifiedGrade' IN ('Junior','Middle','Senior')
      AND jsonb_typeof(resume_context->'verifiedSkills') = 'array'
      AND jsonb_typeof(resume_context->'title') = 'string' AND jsonb_typeof(resume_context->'professionalAlias') = 'string'
      AND resume_context->>'revision' = resume_revision::text
      AND (resume_id IS NULL OR resume_context->>'resumeId' = resume_id::text))
), false));
ALTER TABLE signal_micro_offers ADD CONSTRAINT signal_micro_offer_resume_check CHECK (COALESCE((
  (resume_provenance = 'legacy_unbound' AND resume_id IS NULL AND resume_revision IS NULL AND resume_context IS NULL)
  OR (resume_provenance = 'captured' AND resume_id IS NOT NULL AND resume_id > 0 AND resume_revision IS NOT NULL AND resume_revision > 0 AND resume_context IS NOT NULL AND jsonb_typeof(resume_context) = 'object'
      AND resume_context ?& ARRAY['resumeId','revision','title','specialization','verifiedGrade','verifiedSkills','professionalAlias']
      AND resume_context->>'specialization' IN ('Backend / Python','Frontend / TypeScript')
      AND resume_context->>'verifiedGrade' IN ('Junior','Middle','Senior')
      AND jsonb_typeof(resume_context->'verifiedSkills') = 'array'
      AND jsonb_typeof(resume_context->'title') = 'string' AND jsonb_typeof(resume_context->'professionalAlias') = 'string'
      AND resume_context->>'resumeId' = resume_id::text AND resume_context->>'revision' = resume_revision::text)
), false));
--> statement-breakpoint
CREATE INDEX signal_micro_subscription_resume ON signal_micro_subscriptions(candidate_user_id, resume_id);
CREATE INDEX signal_micro_offer_resume ON signal_micro_offers(candidate_user_id, resume_id);
--> statement-breakpoint
CREATE FUNCTION signal_micro_offer_resume_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.resume_id, NEW.resume_revision, NEW.resume_context, NEW.resume_provenance, NEW.snapshot,
         NEW.candidate_user_id, NEW.company_id, NEW.subscription_id, NEW.scheduled_for)
     IS DISTINCT FROM
     ROW(OLD.resume_id, OLD.resume_revision, OLD.resume_context, OLD.resume_provenance, OLD.snapshot,
         OLD.candidate_user_id, OLD.company_id, OLD.subscription_id, OLD.scheduled_for) THEN
    RAISE EXCEPTION 'Company practice origin is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER signal_micro_offer_resume_immutable BEFORE UPDATE ON signal_micro_offers FOR EACH ROW EXECUTE FUNCTION signal_micro_offer_resume_immutable();
