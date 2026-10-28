ALTER TABLE signal_invitations ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK(revision>0);
ALTER TABLE signal_invitations ADD COLUMN decline_reason text CHECK(decline_reason IN ('conditions','format','direction','timing','other'));
ALTER TABLE signal_invitations ADD COLUMN decline_note text CHECK(length(decline_note)<=1000);
-- Existing invitations had no agreed expiry. Preserve that unknown state.
ALTER TABLE signal_invitations ADD COLUMN expires_at timestamptz;
ALTER TABLE signal_invitations ALTER COLUMN expires_at SET DEFAULT (now()+interval '14 days');
CREATE TABLE signal_invitation_budget_consumption (
 invitation_id integer PRIMARY KEY, company_id integer NOT NULL, spent_at timestamptz NOT NULL,
 source text NOT NULL CHECK(source IN ('committed_send','legacy_created_at'))
);
CREATE INDEX signal_invitation_budget_window_idx ON signal_invitation_budget_consumption(company_id,spent_at);
INSERT INTO signal_invitation_budget_consumption(invitation_id,company_id,spent_at,source)
 SELECT id,company_id,created_at,'legacy_created_at' FROM signal_invitations;
CREATE TABLE signal_invitation_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), invitation_id integer NOT NULL, company_id integer NOT NULL,
 kind text NOT NULL CHECK(kind IN ('sent','viewed','accepted','declined','withdrawn','expired')),
 occurred_at timestamptz NOT NULL, source text NOT NULL,
 UNIQUE(invitation_id,kind)
);
CREATE INDEX signal_invitation_events_company_idx ON signal_invitation_events(company_id,occurred_at);
-- Creation is the only first event known reliably for historical records.
INSERT INTO signal_invitation_events(invitation_id,company_id,kind,occurred_at,source)
 SELECT id,company_id,'sent',created_at,'legacy_created_at' FROM signal_invitations;
CREATE FUNCTION signal_invitation_committed_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  INSERT INTO signal_invitation_budget_consumption(invitation_id,company_id,spent_at,source)
   VALUES(NEW.id,NEW.company_id,NEW.created_at,'committed_send');
  INSERT INTO signal_invitation_events(invitation_id,company_id,kind,occurred_at,source)
   VALUES(NEW.id,NEW.company_id,'sent',NEW.created_at,'committed_transition');
 ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
  NEW.revision:=OLD.revision+1;
  INSERT INTO signal_invitation_events(invitation_id,company_id,kind,occurred_at,source)
   VALUES(NEW.id,NEW.company_id,NEW.status,NEW.updated_at,'committed_transition') ON CONFLICT(invitation_id,kind) DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER signal_invitation_event_insert AFTER INSERT ON signal_invitations FOR EACH ROW EXECUTE FUNCTION signal_invitation_committed_event();
CREATE TRIGGER signal_invitation_event_update BEFORE UPDATE ON signal_invitations FOR EACH ROW EXECUTE FUNCTION signal_invitation_committed_event();
CREATE FUNCTION signal_invitation_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'invitation history is append-only'; END $$;
CREATE TRIGGER signal_invitation_events_immutable BEFORE UPDATE OR DELETE ON signal_invitation_events FOR EACH ROW EXECUTE FUNCTION signal_invitation_history_immutable();
CREATE TRIGGER signal_invitation_budget_immutable BEFORE UPDATE OR DELETE ON signal_invitation_budget_consumption FOR EACH ROW EXECUTE FUNCTION signal_invitation_history_immutable();
