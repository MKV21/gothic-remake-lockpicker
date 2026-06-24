CREATE OR REPLACE FUNCTION canonical_lock_fingerprint(
  lock_gate_count integer,
  lock_initial_pins jsonb,
  lock_solution_pins jsonb,
  lock_links jsonb
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lock_gate_count::text
    || ':' || replace(lock_initial_pins::text, ' ', '')
    || '|solution:' || replace(lock_solution_pins::text, ' ', '')
    || '|links:' || replace(lock_links::text, ' ', '')
$$;

UPDATE locks
SET fingerprint = canonical_lock_fingerprint(gate_count, initial_pins, solution_pins, links),
    updated_at = now()
WHERE fingerprint IS DISTINCT FROM canonical_lock_fingerprint(gate_count, initial_pins, solution_pins, links);

WITH conflict_reports AS (
  SELECT
    r.*,
    canonical_lock_fingerprint(r.gate_count, r.initial_pins, r.solution_pins, r.links) AS new_fingerprint,
    regexp_replace(trim(COALESCE(r.submitted_name, '')), '[[:space:]]+', ' ', 'g') AS clean_name,
    lower(regexp_replace(trim(COALESCE(r.submitted_name, '')), '[[:space:]]+', ' ', 'g')) AS normalized_name
  FROM lock_reports r
  WHERE r.is_conflict = true
),
existing_targets AS (
  SELECT
    cr.id AS report_id,
    cr.lock_id AS old_lock_id,
    l.id AS target_lock_id,
    cr.new_fingerprint,
    cr.clean_name,
    cr.normalized_name,
    cr.source,
    cr.visitor_hash
  FROM conflict_reports cr
  JOIN locks l ON l.fingerprint = cr.new_fingerprint
),
inserted_targets AS (
  INSERT INTO locks (
    gate_count,
    initial_pins,
    solution_pins,
    links,
    solution_moves,
    fingerprint,
    review_status,
    seed_source_id,
    created_at,
    updated_at
  )
  SELECT DISTINCT ON (cr.new_fingerprint)
    cr.gate_count,
    cr.initial_pins,
    cr.solution_pins,
    cr.links,
    cr.solution_moves,
    cr.new_fingerprint,
    'pending',
    NULL,
    cr.created_at,
    now()
  FROM conflict_reports cr
  WHERE NOT EXISTS (
    SELECT 1
    FROM locks l
    WHERE l.fingerprint = cr.new_fingerprint
  )
  ORDER BY cr.new_fingerprint, cr.created_at
  RETURNING id AS target_lock_id, fingerprint AS new_fingerprint
),
targets AS (
  SELECT * FROM existing_targets
  UNION ALL
  SELECT
    cr.id AS report_id,
    cr.lock_id AS old_lock_id,
    it.target_lock_id,
    cr.new_fingerprint,
    cr.clean_name,
    cr.normalized_name,
    cr.source,
    cr.visitor_hash
  FROM conflict_reports cr
  JOIN inserted_targets it ON it.new_fingerprint = cr.new_fingerprint
  WHERE NOT EXISTS (
    SELECT 1
    FROM existing_targets et
    WHERE et.report_id = cr.id
  )
),
moved_reports AS (
  UPDATE lock_reports r
  SET
    lock_id = t.target_lock_id,
    fingerprint = t.new_fingerprint,
    is_conflict = false
  FROM targets t
  WHERE r.id = t.report_id
  RETURNING
    t.old_lock_id,
    t.target_lock_id,
    t.clean_name,
    t.normalized_name,
    t.source,
    t.visitor_hash,
    r.created_at
),
inserted_names AS (
  INSERT INTO lock_names (
    lock_id,
    name,
    normalized_name,
    status,
    source,
    visitor_hash,
    created_at,
    updated_at
  )
  SELECT DISTINCT ON (mr.target_lock_id, mr.normalized_name)
    mr.target_lock_id,
    mr.clean_name,
    mr.normalized_name,
    CASE WHEN mr.source IN ('seed', 'admin') THEN 'approved' ELSE 'pending' END,
    mr.source,
    mr.visitor_hash,
    mr.created_at,
    mr.created_at
  FROM moved_reports mr
  WHERE mr.clean_name <> ''
    AND mr.normalized_name <> 'unnamed lock'
  ORDER BY mr.target_lock_id, mr.normalized_name, mr.created_at
  ON CONFLICT (lock_id, normalized_name) DO NOTHING
  RETURNING lock_id
)
DELETE FROM lock_names n
USING moved_reports mr
WHERE n.lock_id = mr.old_lock_id
  AND mr.old_lock_id IS DISTINCT FROM mr.target_lock_id
  AND n.normalized_name = mr.normalized_name
  AND mr.clean_name <> ''
  AND mr.normalized_name <> 'unnamed lock';

UPDATE lock_reports
SET fingerprint = canonical_lock_fingerprint(gate_count, initial_pins, solution_pins, links)
WHERE fingerprint IS DISTINCT FROM canonical_lock_fingerprint(gate_count, initial_pins, solution_pins, links);

WITH computed_imports AS (
  SELECT
    i.id,
    canonical_lock_fingerprint(i.gate_count, i.initial_pins, i.solution_pins, i.links) AS new_fingerprint
  FROM import_items i
  WHERE i.gate_count IS NOT NULL
    AND i.initial_pins IS NOT NULL
    AND i.solution_pins IS NOT NULL
    AND i.links IS NOT NULL
),
import_duplicates AS (
  SELECT
    ci.id,
    ci.new_fingerprint,
    l.id AS duplicate_lock_id
  FROM computed_imports ci
  LEFT JOIN locks l ON l.fingerprint = ci.new_fingerprint
)
UPDATE import_items i
SET
  fingerprint = d.new_fingerprint,
  duplicate_lock_id = d.duplicate_lock_id,
  is_conflict = false,
  updated_at = now()
FROM import_duplicates d
WHERE i.id = d.id;
