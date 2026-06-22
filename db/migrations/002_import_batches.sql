CREATE TABLE IF NOT EXISTS import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  visitor_hash text,
  ip_hash text,
  item_count integer NOT NULL DEFAULT 0,
  valid_count integer NOT NULL DEFAULT 0,
  invalid_count integer NOT NULL DEFAULT 0,
  approved_count integer NOT NULL DEFAULT 0,
  rejected_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS import_batches_created_idx ON import_batches (created_at DESC);

CREATE TABLE IF NOT EXISTS import_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'invalid')),
  storage_key text,
  name text,
  fingerprint text,
  gate_count integer CHECK (gate_count IS NULL OR gate_count BETWEEN 4 AND 7),
  initial_pins jsonb,
  solution_pins jsonb,
  links jsonb,
  solution_moves jsonb,
  normalized_chest jsonb,
  error text,
  duplicate_lock_id uuid REFERENCES locks(id) ON DELETE SET NULL,
  is_conflict boolean NOT NULL DEFAULT false,
  approved_lock_id uuid REFERENCES locks(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS import_items_status_created_idx ON import_items (status, created_at DESC);
CREATE INDEX IF NOT EXISTS import_items_batch_idx ON import_items (batch_id);
CREATE INDEX IF NOT EXISTS import_items_fingerprint_idx ON import_items (fingerprint);
