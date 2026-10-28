CREATE TABLE "signal_skill_bank_releases" (
  "content_hash" text PRIMARY KEY CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  "release_id" text NOT NULL UNIQUE,
  "program_version" text NOT NULL,
  "manifest" jsonb NOT NULL,
  "sources" jsonb NOT NULL,
  "attestation" jsonb NOT NULL,
  "attestation_hash" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE FUNCTION signal_reject_bank_release_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Skill bank releases are immutable; publish a new checked release';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER signal_bank_release_immutable BEFORE UPDATE OR DELETE ON signal_skill_bank_releases
FOR EACH ROW EXECUTE FUNCTION signal_reject_bank_release_mutation();
--> statement-breakpoint
ALTER TABLE signal_skill_attempts ADD COLUMN bank_release_hash text REFERENCES signal_skill_bank_releases(content_hash);
--> statement-breakpoint
ALTER TABLE signal_skill_attempts ADD COLUMN provenance jsonb;
--> statement-breakpoint
ALTER TABLE signal_skill_attempts ADD CONSTRAINT signal_attempt_release_provenance_check CHECK (
  (bank_release_hash IS NULL AND provenance IS NULL) OR
  (bank_release_hash IS NOT NULL AND provenance IS NOT NULL AND COALESCE(provenance->>'status' = 'complete'
   AND provenance->>'contentHash' = bank_release_hash
   AND length(provenance->>'seed') > 0 AND provenance->>'variantHash' ~ '^[a-f0-9]{64}$'
   AND provenance->>'attestationHash' ~ '^[a-f0-9]{64}$',false))
);
--> statement-breakpoint
CREATE FUNCTION signal_preserve_skill_attempt_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.cases IS DISTINCT FROM OLD.cases OR NEW.oracles IS DISTINCT FROM OLD.oracles
     OR NEW.policy IS DISTINCT FROM OLD.policy OR NEW.provenance IS DISTINCT FROM OLD.provenance
     OR NEW.bank_release_hash IS DISTINCT FROM OLD.bank_release_hash
     OR NEW.program_version IS DISTINCT FROM OLD.program_version OR NEW.skill_id IS DISTINCT FROM OLD.skill_id
     OR NEW.level IS DISTINCT FROM OLD.level OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'Assessment source is immutable; append a review or issue a new attempt';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER signal_skill_attempt_source_immutable BEFORE UPDATE ON signal_skill_attempts
FOR EACH ROW EXECUTE FUNCTION signal_preserve_skill_attempt_source();
