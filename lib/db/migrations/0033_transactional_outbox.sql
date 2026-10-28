CREATE TABLE signal_ats_endpoints(id uuid PRIMARY KEY,company_id integer NOT NULL UNIQUE REFERENCES signal_companies(id),actor_id integer NOT NULL REFERENCES signal_users(id),url text NOT NULL,secret_cipher text NOT NULL,active integer NOT NULL DEFAULT 1 CHECK(active IN(0,1)),revision integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE signal_outbox(id uuid PRIMARY KEY,sequence bigserial NOT NULL UNIQUE,company_id integer NOT NULL REFERENCES signal_companies(id),entity_type text NOT NULL,entity_id integer NOT NULL,event_type text NOT NULL,payload jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE signal_outbox_deliveries(id uuid PRIMARY KEY,event_id uuid NOT NULL REFERENCES signal_outbox(id),endpoint_id uuid NOT NULL REFERENCES signal_ats_endpoints(id),endpoint_revision integer NOT NULL,state text NOT NULL DEFAULT 'queued' CHECK(state IN('queued','running','delivered','suppressed','dead')),fence integer NOT NULL DEFAULT 0,attempts integer NOT NULL DEFAULT 0,lease_until timestamptz,next_at timestamptz NOT NULL DEFAULT now(),last_code text,updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(endpoint_id,event_id));
CREATE INDEX signal_outbox_claim_idx ON signal_outbox_deliveries(state,next_at,lease_until);
CREATE TABLE signal_webhook_inbox(event_id uuid PRIMARY KEY,body_hash text NOT NULL,received_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE signal_webhook_projection(key text PRIMARY KEY,version numeric(30,0) NOT NULL,body jsonb NOT NULL,effects integer NOT NULL DEFAULT 1);
CREATE FUNCTION signal_enqueue_ats_event(tenant integer,kind text,entity integer,event_name text,body jsonb) RETURNS void LANGUAGE plpgsql AS $$ DECLARE event_id uuid:=gen_random_uuid();BEGIN
 INSERT INTO signal_outbox(id,company_id,entity_type,entity_id,event_type,payload) VALUES(event_id,tenant,kind,entity,event_name,body);
 INSERT INTO signal_outbox_deliveries(id,event_id,endpoint_id,endpoint_revision) SELECT gen_random_uuid(),event_id,id,revision FROM signal_ats_endpoints WHERE company_id=tenant AND active=1;
END $$;
CREATE FUNCTION signal_business_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE kind text;context_type text;context_id integer;BEGIN
 IF TG_OP='UPDATE' AND NEW.status=OLD.status THEN RETURN NEW;END IF;
 kind:=CASE WHEN TG_TABLE_NAME='signal_applications' THEN 'application' ELSE 'invitation' END;
 context_type:=CASE WHEN TG_TABLE_NAME='signal_applications' OR NEW.job_id IS NOT NULL THEN 'job' ELSE 'need' END;
 context_id:=CASE WHEN context_type='job' THEN NEW.job_id ELSE (to_jsonb(NEW)->>'need_id')::integer END;
 PERFORM signal_enqueue_ats_event(NEW.company_id,kind,NEW.id,kind||'.status_changed',jsonb_build_object('status',NEW.status,'contextType',context_type,'contextId',context_id,'resumeId',NEW.resume_id,'candidateId',NEW.candidate_user_id));RETURN NEW;
END $$;
CREATE TRIGGER signal_invitation_outbox AFTER INSERT OR UPDATE ON signal_invitations FOR EACH ROW EXECUTE FUNCTION signal_business_outbox();
CREATE TRIGGER signal_application_outbox AFTER INSERT OR UPDATE ON signal_applications FOR EACH ROW EXECUTE FUNCTION signal_business_outbox();
CREATE FUNCTION signal_resume_revocation_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE tenant integer;BEGIN
 IF (OLD.consent_matching AND NOT NEW.consent_matching) OR (OLD.visibility<>'private' AND NEW.visibility='private') OR (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL) THEN
  FOR tenant IN SELECT company_id FROM signal_invitations WHERE resume_id=NEW.id UNION SELECT company_id FROM signal_applications WHERE resume_id=NEW.id LOOP
   PERFORM signal_enqueue_ats_event(tenant,'cv',NEW.id,'cv.access_revoked',jsonb_build_object('resumeId',NEW.id));
  END LOOP;
 END IF;RETURN NEW;END $$;
CREATE TRIGGER signal_resume_revoke_outbox AFTER UPDATE ON signal_candidate_resumes FOR EACH ROW EXECUTE FUNCTION signal_resume_revocation_outbox();
CREATE FUNCTION signal_outbox_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'outbox business event is immutable';END $$;
CREATE TRIGGER signal_outbox_source_immutable BEFORE UPDATE OR DELETE ON signal_outbox FOR EACH ROW EXECUTE FUNCTION signal_outbox_immutable();
