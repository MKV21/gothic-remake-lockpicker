import type {
  AdminLockRecord,
  ChestRecord,
  LinkType,
  LockMatchRecord,
  LockNameRecord,
  RemoteLockRecord,
  ReviewStatus,
  SolveMove,
} from '../../src/shared/lockTypes.js'
import {
  CARD_COUNT,
  countSetLinks,
  createFingerprint,
  isSameCanonicalData,
  matchPins,
  MIN_MATCH_PIN_COUNT,
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
  review_status: ReviewStatus
  created_at: string
  updated_at: string
  names: unknown
}

type AdminLockRow = LockRow & {
  first_report_visitor_hash: string | null
  first_report_ip_hash: string | null
  first_report_source: string | null
  first_report_created_at: string | null
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

export const HIDDEN_LOCK_SCORE_THRESHOLD = -5

export type LockMutationResult = {
  lock?: RemoteLockRecord
  duplicate: boolean
  hidden?: boolean
  skipped?: boolean
  promotedFromAutoSolve?: boolean
}

export type NameVoteResult = {
  lock?: RemoteLockRecord
  hidden?: boolean
}

export function isReviewStatus(value: unknown): value is ReviewStatus {
  return value === 'approved' || value === 'pending' || value === 'rejected'
}

export function isStatusOnlyAdminLockPatch(
  payload: unknown,
): payload is { reviewStatus: ReviewStatus } {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false

  const keys = Object.keys(payload)
  return keys.length === 1 && keys[0] === 'reviewStatus' && isReviewStatus(
    (payload as { reviewStatus?: unknown }).reviewStatus,
  )
}

function nameSourcePrioritySql(alias: string): string {
  return `
              CASE ${alias}.source
                WHEN 'manual' THEN 0
                WHEN 'anonymous' THEN 0
                WHEN 'admin' THEN 0
                WHEN 'xetoxyc-local-storage' THEN 1
                WHEN 'seed' THEN 1
                WHEN 'auto-solve' THEN 2
                ELSE 1
              END`
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
    'Unnamed lock'
  )
}

export function isSubmittableLockName(name: string): boolean {
  const normalizedName = normalizeName(name)
  return normalizedName !== '' && normalizeNameKey(normalizedName) !== 'unnamed lock'
}

export function isLockPubliclyVisible(lock: RemoteLockRecord): boolean {
  if (lock.reviewStatus === 'rejected') return false
  if (lock.names.length === 0) return true

  const activeNameScores = lock.names
    .filter((name) => name.status !== 'rejected')
    .map((name) => name.score)

  if (activeNameScores.length === 0) return false

  return Math.max(...activeNameScores) > HIDDEN_LOCK_SCORE_THRESHOLD
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    names,
    displayName: '',
  }
  return { ...lock, displayName: displayNameFor(lock) }
}

function rowToAdminLock(row: AdminLockRow): AdminLockRecord {
  return {
    ...rowToLock(row),
    admin: {
      firstReportVisitorHash: row.first_report_visitor_hash,
      firstReportIpHash: row.first_report_ip_hash,
      firstReportSource: row.first_report_source,
      firstReportCreatedAt: row.first_report_created_at,
    },
  }
}

function toPublicLock(lock: RemoteLockRecord): RemoteLockRecord {
  const names = lock.names.filter(
    (name) => name.status !== 'rejected' && name.score > HIDDEN_LOCK_SCORE_THRESHOLD,
  )
  return {
    ...lock,
    names,
    displayName: displayNameFor({ fingerprint: lock.fingerprint, names }),
  }
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

export function normalizeIncomingLock(
  chest: ChestRecord,
  options: { requireName?: boolean } = {},
): NormalizedChest {
  const result = normalizeChestRecord(chest, options)
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
              ${nameSourcePrioritySql('n')},
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
              ${nameSourcePrioritySql('n')},
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

async function hasPriorAutoSolveReport(
  lockId: string,
  visitorHash: string | undefined,
): Promise<boolean> {
  if (!visitorHash) return false

  const result = await query<{ exists: boolean }>(
    `
      SELECT EXISTS (
        SELECT 1
        FROM lock_reports
        WHERE lock_id = $1
          AND visitor_hash = $2
          AND source = 'auto-solve'
      ) AS exists
    `,
    [lockId, visitorHash],
  )

  return result.rows[0]?.exists === true
}

async function promotePriorAutoSolveReports(
  lockId: string,
  visitorHash: string | undefined,
  chest: NormalizedChest,
  source: string,
): Promise<boolean> {
  if (!visitorHash) return false

  const result = await query<{ id: string }>(
    `
      UPDATE lock_reports
      SET
        source = $3,
        submitted_name = $4,
        solution_pins = $5::jsonb,
        links = $6::jsonb,
        solution_moves = $7::jsonb
      WHERE lock_id = $1
        AND visitor_hash = $2
        AND source = 'auto-solve'
      RETURNING id
    `,
    [
      lockId,
      visitorHash,
      source,
      chest.name,
      JSON.stringify(chest.solutionPins),
      JSON.stringify(chest.links),
      JSON.stringify(chest.solutionMoves),
    ],
  )

  return result.rows.length > 0
}

async function updateLockCanonicalData(lockId: string, chest: NormalizedChest): Promise<void> {
  await query(
    `
      UPDATE locks
      SET
        solution_pins = $2::jsonb,
        links = $3::jsonb,
        solution_moves = $4::jsonb,
        updated_at = now()
      WHERE id = $1
    `,
    [
      lockId,
      JSON.stringify(chest.solutionPins),
      JSON.stringify(chest.links),
      JSON.stringify(chest.solutionMoves),
    ],
  )
}

export async function getLock(
  id: string,
  options: { includeHidden?: boolean } = {},
): Promise<RemoteLockRecord> {
  const row = await getLockRow(id)
  if (!row) throw new ApiError(404, 'Lock not found')
  const lock = rowToLock(row)
  if (options.includeHidden) return lock

  if (!isLockPubliclyVisible(lock)) {
    throw new ApiError(404, 'Lock not found')
  }
  return toPublicLock(lock)
}

async function publicMutationResult(
  lockId: string,
  duplicate: boolean,
  includeHidden: boolean,
): Promise<LockMutationResult> {
  if (includeHidden) {
    return { lock: await getLock(lockId, { includeHidden: true }), duplicate }
  }

  try {
    return { lock: await getLock(lockId), duplicate }
  } catch (error) {
    if (error instanceof ApiError && error.statusCode === 404) {
      return { duplicate, hidden: true }
    }
    throw error
  }
}

export async function createOrReportLock(
  payload: ChestRecord,
  identity: {
    visitorHash?: string
    ipHash?: string
    source?: string
    seedSourceId?: string
    reviewStatus?: ReviewStatus
    nameStatus?: 'approved' | 'pending'
  } = {},
): Promise<LockMutationResult> {
  const source = identity.source ?? 'anonymous'
  const chest = normalizeIncomingLock(payload, { requireName: source !== 'auto-solve' })
  const isManualSubmission = source === 'manual' || source === 'anonymous'
  const reviewStatus = identity.reviewStatus ?? (source === 'seed' ? 'approved' : 'pending')
  const nameStatus = identity.nameStatus ?? (source === 'seed' ? 'approved' : 'pending')
  const hasSubmittableName = isSubmittableLockName(chest.name)
  if (source === 'auto-solve' && countSetLinks(chest.links, chest.gateCount) === 0) {
    return { duplicate: false, skipped: true }
  }
  const includeHidden = source === 'seed' || source === 'admin' || reviewStatus === 'approved'
  const existing = await getLockRowByFingerprint(chest.fingerprint)

  if (existing) {
    const existingLock = rowToLock(existing)
    const hasPriorAutoSolve =
      existing.review_status === 'pending' &&
      (await hasPriorAutoSolveReport(existing.id, identity.visitorHash))
    const canAttachName =
      hasSubmittableName &&
      (includeHidden || isManualSubmission || isLockPubliclyVisible(existingLock))
    const shouldUpdateAutoSolve =
      existing.review_status === 'pending' &&
      hasPriorAutoSolve &&
      (source === 'auto-solve' || isManualSubmission)
    const promotedFromAutoSolve =
      isManualSubmission &&
      hasPriorAutoSolve &&
      (await promotePriorAutoSolveReports(existing.id, identity.visitorHash, chest, source))

    if (shouldUpdateAutoSolve) {
      await updateLockCanonicalData(existing.id, chest)
    }

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

    if (identity.reviewStatus) {
      await query(
        `
          UPDATE locks
          SET review_status = $2, updated_at = now()
          WHERE id = $1
        `,
        [existing.id, identity.reviewStatus],
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
    if (canAttachName || (hasSubmittableName && promotedFromAutoSolve)) {
      await upsertName({
        lockId: existing.id,
        name: chest.name,
        status: nameStatus,
        source,
        visitorHash: identity.visitorHash,
      })
    }
    const result = await publicMutationResult(existing.id, true, includeHidden)
    return promotedFromAutoSolve ? { ...result, promotedFromAutoSolve } : result
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
      reviewStatus,
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
  if (hasSubmittableName) {
    await upsertName({
      lockId,
      name: chest.name,
      status: nameStatus,
      source,
      visitorHash: identity.visitorHash,
    })
  }

  return publicMutationResult(lockId, false, includeHidden)
}

export async function findMatches(gateCountValue: string | undefined, pinsValue: string | undefined): Promise<LockMatchRecord[]> {
  const gateCount = Number(gateCountValue)
  const pins = parsePins(pinsValue ?? '')
  if (!Number.isInteger(gateCount) || gateCount < 4 || gateCount > 7) {
    throw new ApiError(400, 'gateCount must be between 4 and 7')
  }
  if (pins.length < MIN_MATCH_PIN_COUNT) return []

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
              ${nameSourcePrioritySql('n')},
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
    .filter(isLockPubliclyVisible)
    .map(toPublicLock)
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
  const includeHidden = identity.source === 'admin'
  await getLock(lockId, { includeHidden })
  await upsertName({
    lockId,
    name,
    status: identity.source === 'admin' ? 'approved' : 'pending',
    source: identity.source ?? 'anonymous',
    visitorHash: identity.visitorHash,
  })
  return getLock(lockId, { includeHidden })
}

export async function voteName(
  nameId: string,
  value: number,
  visitorHash: string,
): Promise<NameVoteResult> {
  if (value !== 1 && value !== -1) throw new ApiError(400, 'Vote must be 1 or -1')

  const nameResult = await query<{ lock_id: string }>(
    'SELECT lock_id FROM lock_names WHERE id = $1',
    [nameId],
  )
  const lockId = nameResult.rows[0]?.lock_id
  if (!lockId) throw new ApiError(404, 'Name not found')
  await getLock(lockId)

  const voteResult = await query<{ id: string }>(
    `
      INSERT INTO name_votes (name_id, visitor_hash, vote)
      VALUES ($1, $2, $3)
      ON CONFLICT (name_id, visitor_hash)
      DO NOTHING
      RETURNING id
    `,
    [nameId, visitorHash, value],
  )

  if (voteResult.rows.length === 0) {
    throw new ApiError(409, 'You have already voted on this name')
  }

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

  try {
    return { lock: await getLock(lockId) }
  } catch (error) {
    if (error instanceof ApiError && error.statusCode === 404) {
      return { hidden: true }
    }
    throw error
  }
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
  status: ReviewStatus,
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
  return getLock(lockId, { includeHidden: true })
}

export async function listAdminLocks(): Promise<AdminLockRecord[]> {
  const result = await query<AdminLockRow>(
    `
      SELECT
        l.*,
        first_report.visitor_hash AS first_report_visitor_hash,
        first_report.ip_hash AS first_report_ip_hash,
        first_report.source AS first_report_source,
        first_report.created_at AS first_report_created_at,
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
              ${nameSourcePrioritySql('n')},
              n.score DESC,
              n.created_at ASC
          ) FILTER (WHERE n.id IS NOT NULL),
          '[]'::jsonb
        ) AS names
      FROM locks l
      LEFT JOIN lock_names n ON n.lock_id = l.id
      LEFT JOIN LATERAL (
        SELECT visitor_hash, ip_hash, source, created_at
        FROM lock_reports r
        WHERE r.lock_id = l.id
        ORDER BY r.created_at ASC
        LIMIT 1
      ) first_report ON true
      GROUP BY l.id,
        first_report.visitor_hash,
        first_report.ip_hash,
        first_report.source,
        first_report.created_at
      ORDER BY l.updated_at DESC, l.created_at DESC
    `,
  )

  return result.rows.map(rowToAdminLock)
}

export async function updateAdminLock(
  id: string,
  payload: Partial<ChestRecord> & { reviewStatus?: ReviewStatus },
): Promise<RemoteLockRecord> {
  const existing = await getLock(id, { includeHidden: true })
  const normalized = normalizeIncomingLock({
    name: payload.name ?? existing.displayName,
    gateCount: payload.gateCount ?? existing.gateCount,
    initialPins: payload.initialPins ?? existing.initialPins,
    solutionPins: payload.solutionPins ?? existing.solutionPins,
    links: payload.links ?? existing.links,
    solutionMoves: payload.solutionMoves ?? existing.solutionMoves,
  })

  if (
    payload.reviewStatus !== undefined &&
    !isReviewStatus(payload.reviewStatus)
  ) {
    throw new ApiError(400, 'reviewStatus must be approved, pending, or rejected')
  }

  const duplicate = await getLockRowByFingerprint(normalized.fingerprint)
  if (duplicate && duplicate.id !== id) {
    throw new ApiError(409, 'Another lock already has this gate count and initial pins')
  }

  await query(
    `
      UPDATE locks
      SET
        gate_count = $2,
        initial_pins = $3::jsonb,
        solution_pins = $4::jsonb,
        links = $5::jsonb,
        solution_moves = $6::jsonb,
        fingerprint = $7,
        review_status = COALESCE($8, review_status),
        updated_at = now()
      WHERE id = $1
    `,
    [
      id,
      normalized.gateCount,
      JSON.stringify(normalized.initialPins),
      JSON.stringify(normalized.solutionPins),
      JSON.stringify(normalized.links),
      JSON.stringify(normalized.solutionMoves),
      normalized.fingerprint,
      payload.reviewStatus ?? null,
    ],
  )

  await upsertName({
    lockId: id,
    name: normalized.name,
    status: 'approved',
    source: 'admin',
  })

  return getLock(id, { includeHidden: true })
}

export async function setAdminLockReviewStatus(
  id: string,
  reviewStatus: ReviewStatus,
): Promise<RemoteLockRecord> {
  const result = await query<{ id: string }>(
    `
      UPDATE locks
      SET review_status = $2, updated_at = now()
      WHERE id = $1
      RETURNING id
    `,
    [id, reviewStatus],
  )

  if (result.rows.length === 0) throw new ApiError(404, 'Lock not found')
  return getLock(id, { includeHidden: true })
}

export async function deleteAdminLock(id: string): Promise<void> {
  const result = await query<{ id: string }>(
    'DELETE FROM locks WHERE id = $1 RETURNING id',
    [id],
  )

  if (result.rows.length === 0) throw new ApiError(404, 'Lock not found')
}
