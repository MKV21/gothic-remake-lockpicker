import type { ChestRecord, LinkType, LockMatchRecord, LockNameRecord, RemoteLockRecord, SolveMove } from '../../src/shared/lockTypes.js'
import {
  CARD_COUNT,
  createFingerprint,
  isSameCanonicalData,
  matchPins,
  normalizeChestRecord,
  normalizeName,
  normalizeNameKey,
  parsePins,
  type NormalizedChest,
} from '../../src/shared/lockValidation.js'
import { solveLock } from '../../src/game/solver.js'
import type { GameState } from '../../src/game/types.js'
import { ApiError, query } from './db.js'

type LockRow = {
  id: string
  gate_count: number
  initial_pins: unknown
  solution_pins: unknown
  links: unknown
  solution_moves: unknown
  fingerprint: string
  review_status: 'approved' | 'pending' | 'rejected'
  names: unknown
}

type ReportRow = {
  id: string
  lock_id: string | null
  fingerprint: string
  submitted_name: string | null
  source: string
  is_conflict: boolean
  created_at: string
}

function jsonValue<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback
  if (typeof value === 'string') return JSON.parse(value) as T
  return value as T
}

function displayNameFor(lock: { fingerprint: string; names: LockNameRecord[] }): string {
  return (
    lock.names.find((name) => name.status === 'approved')?.name ??
    lock.names.find((name) => name.status === 'pending')?.name ??
    `Lock ${lock.fingerprint}`
  )
}

function rowToLock(row: LockRow): RemoteLockRecord {
  const names = jsonValue<LockNameRecord[]>(row.names, [])
  const lock = {
    id: row.id,
    gateCount: row.gate_count,
    initialPins: jsonValue<number[]>(row.initial_pins, []),
    solutionPins: jsonValue<number[]>(row.solution_pins, []),
    links: jsonValue<LinkType[][]>(row.links, []),
    solutionMoves: jsonValue<SolveMove[]>(row.solution_moves, []),
    fingerprint: row.fingerprint,
    reviewStatus: row.review_status,
    names,
    displayName: '',
  }
  return { ...lock, displayName: displayNameFor(lock) }
}

function normalizedFromRow(row: LockRow): NormalizedChest {
  const initialPins = jsonValue<number[]>(row.initial_pins, [])
  return {
    name: displayNameFor({ fingerprint: row.fingerprint, names: jsonValue<LockNameRecord[]>(row.names, []) }),
    gateCount: row.gate_count,
    initialPins,
    solutionPins: jsonValue<number[]>(row.solution_pins, []),
    links: jsonValue<LinkType[][]>(row.links, []),
    solutionMoves: jsonValue<SolveMove[]>(row.solution_moves, []),
    fingerprint: createFingerprint(row.gate_count, initialPins),
  }
}

function chestToGameState(chest: NormalizedChest): GameState {
  const cards = Array.from({ length: CARD_COUNT }, (_, index) => {
    const startPin = index < chest.gateCount ? chest.initialPins[index] - 1 : null
    const correctPin = index < chest.gateCount ? chest.solutionPins[index] - 1 : 3
    return {
      startPin,
      correctPin,
      currentPin: startPin,
    }
  })

  const links = Array.from({ length: CARD_COUNT }, (_, rowIndex) =>
    Array.from({ length: CARD_COUNT }, (_, columnIndex) =>
      rowIndex < chest.gateCount && columnIndex < chest.gateCount
        ? chest.links[rowIndex]?.[columnIndex] ?? 'none'
        : 'none',
    ),
  )

  return {
    gateCount: chest.gateCount,
    cards,
    links,
  }
}

function normalizeIncomingLock(chest: ChestRecord): NormalizedChest {
  const result = normalizeChestRecord(chest)
  if (!result.ok) throw new ApiError(400, result.error)

  if (result.chest.solutionMoves.length > 0) return result.chest

  const solved = solveLock(chestToGameState(result.chest))
  if (!solved.ok) throw new ApiError(400, solved.error)

  return {
    ...result.chest,
    solutionMoves: solved.moves,
  }
}

async function getLockRow(id: string): Promise<LockRow | undefined> {
  const result = await query<LockRow>(
    `
      SELECT
        l.*,
        COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'id', n.id,
              'name', n.name,
              'score', n.score,
              'status', n.status,
              'source', n.source
            )
            ORDER BY
              CASE n.status WHEN 'approved' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
              n.score DESC,
              n.created_at ASC
          ) FILTER (WHERE n.id IS NOT NULL),
          '[]'::jsonb
        ) AS names
      FROM locks l
      LEFT JOIN lock_names n ON n.lock_id = l.id
      WHERE l.id = $1
      GROUP BY l.id
    `,
    [id],
  )

  return result.rows[0]
}

async function getLockRowByFingerprint(fingerprint: string): Promise<LockRow | undefined> {
  const result = await query<LockRow>(
    `
      SELECT
        l.*,
        COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'id', n.id,
              'name', n.name,
              'score', n.score,
              'status', n.status,
              'source', n.source
            )
            ORDER BY
              CASE n.status WHEN 'approved' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
              n.score DESC,
              n.created_at ASC
          ) FILTER (WHERE n.id IS NOT NULL),
          '[]'::jsonb
        ) AS names
      FROM locks l
      LEFT JOIN lock_names n ON n.lock_id = l.id
      WHERE l.fingerprint = $1
      GROUP BY l.id
    `,
    [fingerprint],
  )

  return result.rows[0]
}

async function upsertName(options: {
  lockId: string
  name: string
  status: 'approved' | 'pending'
  source: string
  visitorHash?: string
}): Promise<void> {
  const name = normalizeName(options.name)
  if (!name) throw new ApiError(400, 'Name is required')

  await query(
    `
      INSERT INTO lock_names (lock_id, name, normalized_name, status, source, visitor_hash)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (lock_id, normalized_name)
      DO UPDATE SET updated_at = now()
    `,
    [
      options.lockId,
      name,
      normalizeNameKey(name),
      options.status,
      options.source,
      options.visitorHash ?? null,
    ],
  )
}

async function insertReport(options: {
  lockId?: string
  chest: NormalizedChest
  visitorHash?: string
  ipHash?: string
  source: string
  isConflict: boolean
}): Promise<void> {
  await query(
    `
      INSERT INTO lock_reports (
        lock_id,
        fingerprint,
        gate_count,
        initial_pins,
        solution_pins,
        links,
        solution_moves,
        submitted_name,
        visitor_hash,
        ip_hash,
        source,
        is_conflict
      )
      VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, $8, $9, $10, $11, $12)
    `,
    [
      options.lockId ?? null,
      options.chest.fingerprint,
      options.chest.gateCount,
      JSON.stringify(options.chest.initialPins),
      JSON.stringify(options.chest.solutionPins),
      JSON.stringify(options.chest.links),
      JSON.stringify(options.chest.solutionMoves),
      options.chest.name,
      options.visitorHash ?? null,
      options.ipHash ?? null,
      options.source,
      options.isConflict,
    ],
  )
}

export async function getLock(id: string): Promise<RemoteLockRecord> {
  const row = await getLockRow(id)
  if (!row) throw new ApiError(404, 'Lock not found')
  return rowToLock(row)
}

export async function createOrReportLock(
  payload: ChestRecord,
  identity: { visitorHash?: string; ipHash?: string; source?: string; seedSourceId?: string } = {},
): Promise<{ lock: RemoteLockRecord; duplicate: boolean }> {
  const chest = normalizeIncomingLock(payload)
  const source = identity.source ?? 'anonymous'
  const existing = await getLockRowByFingerprint(chest.fingerprint)

  if (existing) {
    if (identity.seedSourceId) {
      await query(
        `
          UPDATE locks
          SET
            seed_source_id = COALESCE(seed_source_id, $2),
            review_status = CASE WHEN review_status = 'pending' THEN 'approved' ELSE review_status END,
            updated_at = now()
          WHERE id = $1
        `,
        [existing.id, identity.seedSourceId],
      )
    }

    await insertReport({
      lockId: existing.id,
      chest,
      visitorHash: identity.visitorHash,
      ipHash: identity.ipHash,
      source,
      isConflict: !isSameCanonicalData(chest, normalizedFromRow(existing)),
    })
    await upsertName({
      lockId: existing.id,
      name: chest.name,
      status: source === 'seed' ? 'approved' : 'pending',
      source,
      visitorHash: identity.visitorHash,
    })
    return { lock: await getLock(existing.id), duplicate: true }
  }

  const result = await query<{ id: string }>(
    `
      INSERT INTO locks (
        gate_count,
        initial_pins,
        solution_pins,
        links,
      solution_moves,
      fingerprint,
      review_status,
      seed_source_id
    )
      VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb, $6, $7, $8)
      RETURNING id
    `,
    [
      chest.gateCount,
      JSON.stringify(chest.initialPins),
      JSON.stringify(chest.solutionPins),
      JSON.stringify(chest.links),
      JSON.stringify(chest.solutionMoves),
      chest.fingerprint,
      source === 'seed' ? 'approved' : 'pending',
      identity.seedSourceId ?? null,
    ],
  )

  const lockId = result.rows[0]!.id
  await insertReport({
    lockId,
    chest,
    visitorHash: identity.visitorHash,
    ipHash: identity.ipHash,
    source,
    isConflict: false,
  })
  await upsertName({
    lockId,
    name: chest.name,
    status: source === 'seed' ? 'approved' : 'pending',
    source,
    visitorHash: identity.visitorHash,
  })

  return { lock: await getLock(lockId), duplicate: false }
}

export async function findMatches(gateCountValue: string | undefined, pinsValue: string | undefined): Promise<LockMatchRecord[]> {
  const gateCount = Number(gateCountValue)
  const pins = parsePins(pinsValue ?? '')
  if (!Number.isInteger(gateCount) || gateCount < 4 || gateCount > 7) {
    throw new ApiError(400, 'gateCount must be between 4 and 7')
  }
  if (pins.length === 0) return []

  const result = await query<LockRow>(
    `
      SELECT
        l.*,
        COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'id', n.id,
              'name', n.name,
              'score', n.score,
              'status', n.status,
              'source', n.source
            )
            ORDER BY
              CASE n.status WHEN 'approved' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
              n.score DESC,
              n.created_at ASC
          ) FILTER (WHERE n.id IS NOT NULL),
          '[]'::jsonb
        ) AS names
      FROM locks l
      LEFT JOIN lock_names n ON n.lock_id = l.id
      WHERE l.gate_count = $1
        AND l.review_status <> 'rejected'
      GROUP BY l.id
      LIMIT 100
    `,
    [gateCount],
  )

  return result.rows
    .map(rowToLock)
    .filter((lock) => matchPins(lock.initialPins, pins))
    .map((lock) => ({
      id: lock.id,
      gateCount: lock.gateCount,
      initialPins: lock.initialPins,
      displayName: lock.displayName,
      score: pins.length,
      reviewStatus: lock.reviewStatus,
      names: lock.names,
    }))
    .sort((a, b) => b.score - a.score || a.displayName.localeCompare(b.displayName))
    .slice(0, 20)
}

export async function suggestName(
  lockId: string,
  name: string,
  identity: { visitorHash?: string; source?: string } = {},
): Promise<RemoteLockRecord> {
  await getLock(lockId)
  await upsertName({
    lockId,
    name,
    status: identity.source === 'admin' ? 'approved' : 'pending',
    source: identity.source ?? 'anonymous',
    visitorHash: identity.visitorHash,
  })
  return getLock(lockId)
}

export async function voteName(
  nameId: string,
  value: number,
  visitorHash: string,
): Promise<RemoteLockRecord> {
  if (value !== 1 && value !== -1) throw new ApiError(400, 'Vote must be 1 or -1')

  const nameResult = await query<{ lock_id: string }>(
    'SELECT lock_id FROM lock_names WHERE id = $1',
    [nameId],
  )
  const lockId = nameResult.rows[0]?.lock_id
  if (!lockId) throw new ApiError(404, 'Name not found')

  await query(
    `
      INSERT INTO name_votes (name_id, visitor_hash, vote)
      VALUES ($1, $2, $3)
      ON CONFLICT (name_id, visitor_hash)
      DO UPDATE SET vote = EXCLUDED.vote, updated_at = now()
    `,
    [nameId, visitorHash, value],
  )

  await query(
    `
      UPDATE lock_names
      SET
        score = COALESCE((SELECT SUM(vote)::integer FROM name_votes WHERE name_id = $1), 0),
        updated_at = now()
      WHERE id = $1
    `,
    [nameId],
  )

  return getLock(lockId)
}

export async function listReports(): Promise<ReportRow[]> {
  const result = await query<ReportRow>(
    `
      SELECT id, lock_id, fingerprint, submitted_name, source, is_conflict, created_at
      FROM lock_reports
      ORDER BY created_at DESC
      LIMIT 200
    `,
  )
  return result.rows
}

export async function setNameStatus(
  nameId: string,
  status: 'approved' | 'pending' | 'rejected',
): Promise<RemoteLockRecord> {
  const result = await query<{ lock_id: string }>(
    `
      UPDATE lock_names
      SET status = $2, updated_at = now()
      WHERE id = $1
      RETURNING lock_id
    `,
    [nameId, status],
  )
  const lockId = result.rows[0]?.lock_id
  if (!lockId) throw new ApiError(404, 'Name not found')
  return getLock(lockId)
}
