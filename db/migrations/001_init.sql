CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS seed_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_project text NOT NULL,
  source_url text NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (source_project, source_url)
);

CREATE TABLE IF NOT EXISTS locks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gate_count integer NOT NULL CHECK (gate_count BETWEEN 4 AND 7),
  initial_pins jsonb NOT NULL,
  solution_pins jsonb NOT NULL,
  links jsonb NOT NULL,
  solution_moves jsonb NOT NULL DEFAULT '[]'::jsonb,
  fingerprint text NOT NULL UNIQUE,
  review_status text NOT NULL DEFAULT 'pending' CHECK (review_status IN ('approved', 'pending', 'rejected')),
  seed_source_id uuid REFERENCES seed_sources(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS locks_gate_count_idx ON locks (gate_count);
CREATE INDEX IF NOT EXISTS locks_review_status_idx ON locks (review_status);

CREATE TABLE IF NOT EXISTS lock_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lock_id uuid REFERENCES locks(id) ON DELETE SET NULL,
  fingerprint text NOT NULL,
  gate_count integer NOT NULL CHECK (gate_count BETWEEN 4 AND 7),
  initial_pins jsonb NOT NULL,
  solution_pins jsonb NOT NULL,
  links jsonb NOT NULL,
  solution_moves jsonb NOT NULL DEFAULT '[]'::jsonb,
  submitted_name text,
  visitor_hash text,
  ip_hash text,
  source text NOT NULL DEFAULT 'anonymous',
  is_conflict boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lock_reports_fingerprint_idx ON lock_reports (fingerprint);
CREATE INDEX IF NOT EXISTS lock_reports_lock_id_idx ON lock_reports (lock_id);

CREATE TABLE IF NOT EXISTS lock_names (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lock_id uuid NOT NULL REFERENCES locks(id) ON DELETE CASCADE,
  name text NOT NULL,
  normalized_name text NOT NULL,
  score integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('approved', 'pending', 'rejected')),
  source text NOT NULL DEFAULT 'anonymous',
  visitor_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lock_id, normalized_name)
);

CREATE INDEX IF NOT EXISTS lock_names_lock_status_score_idx ON lock_names (lock_id, status, score DESC);

CREATE TABLE IF NOT EXISTS name_votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name_id uuid NOT NULL REFERENCES lock_names(id) ON DELETE CASCADE,
  visitor_hash text NOT NULL,
  vote integer NOT NULL CHECK (vote IN (-1, 1)),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (name_id, visitor_hash)
);

CREATE TABLE IF NOT EXISTS rate_limits (
  scope_key text NOT NULL,
  action text NOT NULL,
  visitor_hash text,
  ip_hash text,
  window_start timestamptz NOT NULL DEFAULT now(),
  count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope_key, action)
);
