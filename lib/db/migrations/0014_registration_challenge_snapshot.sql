ALTER TABLE signal_verification_tokens ADD COLUMN registration_id uuid;
--> statement-breakpoint
ALTER TABLE signal_verification_tokens ADD COLUMN pending_password_hash text;
--> statement-breakpoint
ALTER TABLE signal_verification_tokens ADD COLUMN pending_role text;
--> statement-breakpoint
ALTER TABLE signal_verification_tokens ADD COLUMN pending_display_name text;
--> statement-breakpoint
ALTER TABLE signal_verification_tokens ADD COLUMN pending_consent_version text;
--> statement-breakpoint
ALTER TABLE signal_verification_tokens ADD CONSTRAINT signal_verification_registration_snapshot CHECK (
  (registration_id IS NULL AND pending_password_hash IS NULL AND pending_role IS NULL AND pending_display_name IS NULL AND pending_consent_version IS NULL)
  OR (registration_id IS NOT NULL AND pending_password_hash IS NOT NULL AND pending_role IN ('candidate','employer') AND pending_role IS NOT NULL AND pending_display_name IS NOT NULL AND length(trim(pending_display_name))>=2 AND pending_consent_version IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX signal_verification_registration_id_unique ON signal_verification_tokens(registration_id) WHERE registration_id IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX signal_verification_pending_user_unique ON signal_verification_tokens(user_id) WHERE registration_id IS NOT NULL AND consumed_at IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX signal_verification_registration_code_unique ON signal_verification_tokens(user_id,token_hash) WHERE registration_id IS NOT NULL;
--> statement-breakpoint
-- Unbound old challenges cannot safely activate preliminary credentials. This
-- changes no verified account, password, role, session or evidence.
UPDATE signal_verification_tokens t SET consumed_at=now() FROM signal_users u WHERE t.user_id=u.id AND NOT u.email_verified AND NOT u.demo_mode AND t.consumed_at IS NULL;
--> statement-breakpoint
CREATE FUNCTION signal_registration_proof_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.user_id,NEW.token_hash,NEW.registration_id,NEW.pending_password_hash,NEW.pending_role,NEW.pending_display_name,NEW.pending_consent_version,NEW.created_at,NEW.expires_at)
     IS DISTINCT FROM (OLD.user_id,OLD.token_hash,OLD.registration_id,OLD.pending_password_hash,OLD.pending_role,OLD.pending_display_name,OLD.pending_consent_version,OLD.created_at,OLD.expires_at)
     OR (OLD.consumed_at IS NOT NULL AND NEW.consumed_at IS DISTINCT FROM OLD.consumed_at) THEN
    RAISE EXCEPTION 'Registration challenge identity and credential snapshot are immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER signal_registration_proof_immutable BEFORE UPDATE ON signal_verification_tokens FOR EACH ROW EXECUTE FUNCTION signal_registration_proof_immutable();
