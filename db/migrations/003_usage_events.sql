CREATE TABLE IF NOT EXISTS usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  lock_id uuid REFERENCES locks(id) ON DELETE SET NULL,
  visitor_hash text,
  ip_hash text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS usage_events_type_created_idx ON usage_events (event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS usage_events_lock_type_idx ON usage_events (lock_id, event_type);
CREATE INDEX IF NOT EXISTS usage_events_visitor_created_idx ON usage_events (visitor_hash, created_at DESC);
