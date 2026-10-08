CREATE TABLE IF NOT EXISTS signal_need_skill_levels (
  need_id integer PRIMARY KEY REFERENCES signal_needs(id) ON DELETE CASCADE,
  levels jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT signal_need_skill_levels_object CHECK (jsonb_typeof(levels) = 'object')
);
