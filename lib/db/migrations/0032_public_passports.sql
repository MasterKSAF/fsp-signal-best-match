CREATE TABLE signal_passport_keys(kid text PRIMARY KEY,issuer text NOT NULL,public_key_pem text NOT NULL,state text NOT NULL CHECK(state IN ('active','retired','compromised')),created_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX signal_passport_active_key ON signal_passport_keys(issuer) WHERE state='active';
CREATE TABLE signal_passport_previews(id uuid PRIMARY KEY,user_id integer NOT NULL REFERENCES signal_users(id),claims jsonb NOT NULL,expires_at timestamptz NOT NULL,issued_id uuid);
CREATE TABLE signal_public_passports(id uuid PRIMARY KEY,user_id integer NOT NULL REFERENCES signal_users(id),document jsonb NOT NULL,state text NOT NULL DEFAULT 'active' CHECK(state IN ('active','revoked','replaced')),replacement_id uuid REFERENCES signal_public_passports(id),created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX signal_public_passport_owner ON signal_public_passports(user_id,created_at);
CREATE TABLE signal_passport_events(id uuid PRIMARY KEY,passport_id uuid NOT NULL REFERENCES signal_public_passports(id),actor_id integer NOT NULL REFERENCES signal_users(id),kind text NOT NULL,replacement_id uuid REFERENCES signal_public_passports(id),created_at timestamptz NOT NULL DEFAULT now());
CREATE FUNCTION signal_passport_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'passport audit is append only'; END IF;
 IF TG_TABLE_NAME='signal_passport_events' THEN RAISE EXCEPTION 'passport audit is append only'; END IF;
 IF NEW.document IS DISTINCT FROM OLD.document OR NEW.user_id<>OLD.user_id OR NEW.created_at<>OLD.created_at OR OLD.state<>'active' AND NEW.state<>OLD.state THEN RAISE EXCEPTION 'passport source/state cannot be rewritten'; END IF;RETURN NEW;END $$;
CREATE TRIGGER signal_passport_source_immutable BEFORE UPDATE OR DELETE ON signal_public_passports FOR EACH ROW EXECUTE FUNCTION signal_passport_immutable();
CREATE TRIGGER signal_passport_events_immutable BEFORE UPDATE OR DELETE ON signal_passport_events FOR EACH ROW EXECUTE FUNCTION signal_passport_immutable();
CREATE FUNCTION signal_passport_key_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.issuer<>OLD.issuer OR NEW.public_key_pem<>OLD.public_key_pem OR OLD.state='compromised' AND NEW.state<>'compromised' THEN RAISE EXCEPTION 'key identity/compromise cannot be rewritten';END IF;RETURN NEW;END $$;
CREATE TRIGGER signal_passport_key_source BEFORE UPDATE ON signal_passport_keys FOR EACH ROW EXECUTE FUNCTION signal_passport_key_immutable();
