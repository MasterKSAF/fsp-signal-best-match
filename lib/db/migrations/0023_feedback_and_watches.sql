CREATE TABLE signal_selection_feedback (
 id uuid PRIMARY KEY,company_id integer NOT NULL REFERENCES signal_companies(id),actor_id integer NOT NULL REFERENCES signal_users(id),context_type text NOT NULL CHECK(context_type IN ('job','need')),context_id integer NOT NULL,context_revision integer NOT NULL,
 candidate_id integer NOT NULL REFERENCES signal_users(id),resume_id integer NOT NULL,resume_revision integer NOT NULL,reason text NOT NULL CHECK(reason IN ('proof_required','level_required','conditions','reviewed','other')),skill text,target_level text,note text NOT NULL DEFAULT '',command_key text NOT NULL,payload_hash text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(company_id,actor_id,command_key)
);
CREATE TABLE signal_refinement_proposals (
 id uuid PRIMARY KEY,company_id integer NOT NULL REFERENCES signal_companies(id),actor_id integer NOT NULL REFERENCES signal_users(id),feedback_id uuid NOT NULL UNIQUE REFERENCES signal_selection_feedback(id),preview_id uuid NOT NULL REFERENCES signal_requirement_previews(id),proposed_exclusions jsonb NOT NULL,applied_revision integer,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE signal_context_exclusions (
 id uuid PRIMARY KEY,company_id integer NOT NULL REFERENCES signal_companies(id),actor_id integer NOT NULL REFERENCES signal_users(id),context_type text NOT NULL CHECK(context_type IN ('job','need')),context_id integer NOT NULL,context_revision integer NOT NULL,candidate_id integer NOT NULL REFERENCES signal_users(id),resume_id integer NOT NULL,feedback_id uuid NOT NULL REFERENCES signal_selection_feedback(id),active boolean NOT NULL DEFAULT true,revision integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(company_id,context_type,context_id,context_revision,candidate_id)
);
CREATE TRIGGER signal_exclusions_epoch AFTER INSERT OR UPDATE OR DELETE ON signal_context_exclusions FOR EACH STATEMENT EXECUTE FUNCTION signal_bump_professional_epoch();
CREATE TABLE signal_selection_watches (
 id uuid PRIMARY KEY,company_id integer NOT NULL REFERENCES signal_companies(id),actor_id integer NOT NULL REFERENCES signal_users(id),context_type text NOT NULL CHECK(context_type IN ('job','need')),context_id integer NOT NULL,context_revision integer NOT NULL,conditions_hash text NOT NULL,mode text NOT NULL DEFAULT 'in_app' CHECK(mode='in_app'),frequency_minutes integer NOT NULL DEFAULT 15 CHECK(frequency_minutes BETWEEN 1 AND 1440),state text NOT NULL DEFAULT 'active' CHECK(state IN ('active','paused','closed')),revision integer NOT NULL DEFAULT 1,baseline jsonb NOT NULL,seen_events jsonb NOT NULL DEFAULT '[]',watermark text NOT NULL,next_check_at timestamptz NOT NULL,updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(company_id,actor_id,context_type,context_id)
);
CREATE INDEX signal_watch_due_idx ON signal_selection_watches(state,next_check_at);
CREATE TABLE signal_selection_watch_events (
 id uuid PRIMARY KEY,watch_id uuid NOT NULL REFERENCES signal_selection_watches(id),candidate_id integer NOT NULL,resume_id integer NOT NULL,event_key text NOT NULL,reason text NOT NULL CHECK(reason IN ('new_candidate','new_proof','entered_top')),state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','delivered','suppressed')),created_at timestamptz NOT NULL DEFAULT now(),delivered_at timestamptz,UNIQUE(watch_id,event_key)
);
