import type {
  AdminDataQualityRecord,
  AdminQualityLockSummary,
  AdminQualityMultiNameLock,
  AdminQualityNameConflict,
  AdminQualityNameItem,
  AdminQualityStartPinGroup,
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

type DataQualitySummaryRow = {
  low_signal_auto_solve: number
  low_signal_auto_solve_with_siblings: number
  start_pin_groups: number
  locks_in_start_pin_groups: number
  same_name_same_start_pin_groups: number
  multi_name_locks: number
  orphan_reports: number
}

type DataQualityLockSummaryRow = {
  id: string
  display_name: string
  review_status: ReviewStatus
  gate_count: number
  initial_pins: unknown
  link_count: number
  load_count: number
  report_count: number
  report_sources: string | null
  max_name_score: number | null
  created_at?: string | Date
  updated_at?: string | Date
}

type DataQualityStartPinGroupRow = {
  gate_count: number
  initial_pins: unknown
  lock_count: number
  total_load_count: number
  locks: unknown
}

type DataQualityNameConflictRow = {
  normalized_name: string
  example_name: string
  gate_count: number
  initial_pins: unknown
  lock_count: number
  names: unknown
}

type DataQualityMultiNameLockRow = DataQualityLockSummaryRow & {
  active_name_count: number
  names: unknown
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

function numberValue(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string') return Number(value)
  return 0
}

function timestampValue(value: string | Date | undefined): string | undefined {
  if (!value) return undefined
  return value instanceof Date ? value.toISOString() : value
}

function qualityLockSummaryFromRow(row: DataQualityLockSummaryRow): AdminQualityLockSummary {
  return {
    id: row.id,
    displayName: row.display_name,
    reviewStatus: row.review_status,
    gateCount: row.gate_count,
    initialPins: jsonValue<number[]>(row.initial_pins, []),
    linkCount: numberValue(row.link_count),
    loadCount: numberValue(row.load_count),
    reportCount: numberValue(row.report_count),
    reportSources: row.report_sources,
    maxNameScore: row.max_name_score === null ? null : numberValue(row.max_name_score),
    createdAt: timestampValue(row.created_at),
    updatedAt: timestampValue(row.updated_at),
  }
}

function qualityLockSummaryFromJson(value: unknown): AdminQualityLockSummary {
  const row = value as Record<string, unknown>
  return {
    id: String(row.id ?? ''),
    displayName: String(row.displayName ?? 'Unnamed lock'),
    reviewStatus: isReviewStatus(row.reviewStatus) ? row.reviewStatus : 'pending',
    gateCount: numberValue(row.gateCount),
    initialPins: jsonValue<number[]>(row.initialPins, []),
    linkCount: numberValue(row.linkCount),
    loadCount: numberValue(row.loadCount),
    reportCount: numberValue(row.reportCount),
    reportSources: typeof row.reportSources === 'string' ? row.reportSources : null,
    maxNameScore: row.maxNameScore === null || row.maxNameScore === undefined ? null : numberValue(row.maxNameScore),
    createdAt: typeof row.createdAt === 'string' ? row.createdAt : undefined,
    updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : undefined,
  }
}

function qualityNameItemFromJson(value: unknown): AdminQualityNameItem {
  const row = value as Record<string, unknown>
  return {
    ...qualityLockSummaryFromJson(value),
    nameId: String(row.nameId ?? ''),
    name: String(row.name ?? ''),
    nameStatus: isReviewStatus(row.nameStatus) ? row.nameStatus : 'pending',
    nameSource: String(row.nameSource ?? 'anonymous'),
    nameScore: numberValue(row.nameScore),
  }
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
  const solutionPins = jsonValue<number[]>(row.solution_pins, [])
  const links = jsonValue<LinkType[][]>(row.links, [])
  return {
    name: displayNameFor({ fingerprint: row.fingerprint, names: jsonValue<LockNameRecord[]>(row.names, []) }),
    gateCount: row.gate_count,
    initialPins,
    solutionPins,
    links,
    solutionMoves: jsonValue<SolveMove[]>(row.solution_moves, []),
    fingerprint: createFingerprint(row.gate_count, initialPins, solutionPins, links),
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

async function getEditableAutoSolveLockRow(
  chest: NormalizedChest,
  visitorHash: string | undefined,
  ipHash: string | undefined,
): Promise<LockRow | undefined> {
  if (!visitorHash && !ipHash) return undefined

  const result = await query<LockRow>(
    `
      WITH candidate_locks AS (
        SELECT
          l.id,
          MAX(r.created_at) AS last_auto_solve_at
        FROM locks l
        JOIN lock_reports r ON r.lock_id = l.id
        WHERE l.review_status = 'pending'
          AND l.gate_count = $1
          AND l.initial_pins = $2::jsonb
          AND r.source = 'auto-solve'
          AND NOT EXISTS (
            SELECT 1
            FROM lock_reports other_reports
            WHERE other_reports.lock_id = l.id
              AND other_reports.source <> 'auto-solve'
          )
          AND NOT EXISTS (
            SELECT 1
            FROM lock_names other_names
            WHERE other_names.lock_id = l.id
              AND other_names.source <> 'auto-solve'
          )
          AND (
            ($3::text IS NOT NULL AND r.visitor_hash = $3)
            OR ($3::text IS NULL AND $4::text IS NOT NULL AND r.ip_hash = $4)
          )
        GROUP BY l.id
        ORDER BY last_auto_solve_at DESC
        LIMIT 1
      )
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
      FROM candidate_locks c
      JOIN locks l ON l.id = c.id
      LEFT JOIN lock_names n ON n.lock_id = l.id
      GROUP BY l.id, c.last_auto_solve_at
      ORDER BY c.last_auto_solve_at DESC
    `,
    [
      chest.gateCount,
      JSON.stringify(chest.initialPins),
      visitorHash ?? null,
      ipHash ?? null,
    ],
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
      DO UPDATE SET
        name = CASE
          WHEN EXCLUDED.status = 'approved'
            OR ${nameSourcePrioritySql('EXCLUDED')} < ${nameSourcePrioritySql('lock_names')}
            THEN EXCLUDED.name
          ELSE lock_names.name
        END,
        status = CASE
          WHEN EXCLUDED.status = 'approved' THEN 'approved'
          ELSE lock_names.status
        END,
        source = CASE
          WHEN EXCLUDED.status = 'approved'
            OR ${nameSourcePrioritySql('EXCLUDED')} < ${nameSourcePrioritySql('lock_names')}
            THEN EXCLUDED.source
          ELSE lock_names.source
        END,
        visitor_hash = COALESCE(lock_names.visitor_hash, EXCLUDED.visitor_hash),
        updated_at = now()
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
        solution_moves = $7::jsonb,
        fingerprint = $8
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
      chest.fingerprint,
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
        fingerprint = $5,
        updated_at = now()
      WHERE id = $1
    `,
    [
      lockId,
      JSON.stringify(chest.solutionPins),
      JSON.stringify(chest.links),
      JSON.stringify(chest.solutionMoves),
      chest.fingerprint,
    ],
  )
}

async function rejectSupersededAutoSolveDraft(lockId: string): Promise<void> {
  await query(
    `
      UPDATE locks
      SET review_status = 'rejected', updated_at = now()
      WHERE id = $1
        AND review_status = 'pending'
    `,
    [lockId],
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
  const editableAutoSolve =
    source === 'auto-solve'
      ? await getEditableAutoSolveLockRow(chest, identity.visitorHash, identity.ipHash)
      : undefined
  const exactExisting = await getLockRowByFingerprint(chest.fingerprint)
  if (exactExisting && editableAutoSolve && editableAutoSolve.id !== exactExisting.id) {
    await rejectSupersededAutoSolveDraft(editableAutoSolve.id)
  }
  const existing = exactExisting ?? editableAutoSolve

  const reportExisting = async (existing: LockRow): Promise<LockMutationResult> => {
    const existingLock = rowToLock(existing)
    const isEditingAutoSolveDraft = editableAutoSolve?.id === existing.id
    const hasPriorAutoSolve =
      existing.review_status === 'pending' &&
      (await hasPriorAutoSolveReport(existing.id, identity.visitorHash))
    const canAttachName =
      hasSubmittableName &&
      (includeHidden || isManualSubmission || isLockPubliclyVisible(existingLock))
    const shouldUpdateAutoSolve =
      existing.review_status === 'pending' &&
      (hasPriorAutoSolve || isEditingAutoSolveDraft) &&
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
      isConflict: shouldUpdateAutoSolve ? false : !isSameCanonicalData(chest, normalizedFromRow(existing)),
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

  if (existing) {
    return reportExisting(existing)
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
      ON CONFLICT (fingerprint) DO NOTHING
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

  const insertedLockId = result.rows[0]?.id
  if (!insertedLockId) {
    const racedExisting = await getLockRowByFingerprint(chest.fingerprint)
    if (racedExisting) return reportExisting(racedExisting)
    throw new ApiError(409, 'Lock already exists')
  }

  const lockId = insertedLockId
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
        AND NOT EXISTS (
          SELECT 1
          FROM unnest($2::int[]) WITH ORDINALITY AS entered(pin, ordinal)
          WHERE (l.initial_pins ->> (entered.ordinal - 1)::integer)::integer IS DISTINCT FROM entered.pin
        )
      GROUP BY l.id
    `,
    [gateCount, pins],
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

export async function listAdminDataQuality(): Promise<AdminDataQualityRecord> {
  const [
    summaryResult,
    lowSignalResult,
    startPinGroupsResult,
    sameNameSameStartPinsResult,
    multiNameLocksResult,
  ] = await Promise.all([
    query<DataQualitySummaryRow>(
      `
        WITH active_locks AS (
          SELECT
            l.id,
            l.gate_count,
            l.initial_pins,
            l.review_status,
            l.created_at,
            EXISTS (
              SELECT 1
              FROM lock_names n
              WHERE n.lock_id = l.id
                AND n.status <> 'rejected'
            ) AS has_name,
            (
              SELECT string_agg(DISTINCT r.source, ', ' ORDER BY r.source)
              FROM lock_reports r
              WHERE r.lock_id = l.id
            ) AS sources,
            (
              SELECT COUNT(*)::integer
              FROM usage_events e
              WHERE e.lock_id = l.id
                AND e.event_type = 'lock_load'
            ) AS load_count
          FROM locks l
          WHERE l.review_status <> 'rejected'
        ),
        start_pin_groups AS (
          SELECT gate_count, initial_pins, COUNT(*)::integer AS lock_count
          FROM active_locks
          GROUP BY gate_count, initial_pins
          HAVING COUNT(*) > 1
        ),
        same_name_same_start_pin_groups AS (
          SELECT n.normalized_name, l.gate_count, l.initial_pins
          FROM lock_names n
          JOIN locks l ON l.id = n.lock_id
          WHERE n.status <> 'rejected'
            AND l.review_status <> 'rejected'
          GROUP BY n.normalized_name, l.gate_count, l.initial_pins
          HAVING COUNT(DISTINCT l.id) > 1
        ),
        multi_name_locks AS (
          SELECT l.id
          FROM locks l
          JOIN lock_names n ON n.lock_id = l.id AND n.status <> 'rejected'
          WHERE l.review_status <> 'rejected'
          GROUP BY l.id
          HAVING COUNT(n.id) > 1
        ),
        candidate_base AS (
          SELECT
            a.*,
            EXISTS (
              SELECT 1
              FROM active_locks other
              WHERE other.id <> a.id
                AND other.gate_count = a.gate_count
                AND other.initial_pins = a.initial_pins
            ) AS has_start_pin_sibling
          FROM active_locks a
        )
        SELECT
          COUNT(*) FILTER (
            WHERE review_status = 'pending'
              AND NOT has_name
              AND sources = 'auto-solve'
              AND load_count = 0
              AND created_at < now() - interval '48 hours'
          )::integer AS low_signal_auto_solve,
          COUNT(*) FILTER (
            WHERE review_status = 'pending'
              AND NOT has_name
              AND sources = 'auto-solve'
              AND load_count = 0
              AND created_at < now() - interval '48 hours'
              AND has_start_pin_sibling
          )::integer AS low_signal_auto_solve_with_siblings,
          (SELECT COUNT(*)::integer FROM start_pin_groups) AS start_pin_groups,
          COALESCE((SELECT SUM(lock_count)::integer FROM start_pin_groups), 0) AS locks_in_start_pin_groups,
          (SELECT COUNT(*)::integer FROM same_name_same_start_pin_groups) AS same_name_same_start_pin_groups,
          (SELECT COUNT(*)::integer FROM multi_name_locks) AS multi_name_locks,
          (SELECT COUNT(*)::integer FROM lock_reports WHERE lock_id IS NULL) AS orphan_reports
        FROM candidate_base
      `,
    ),
    query<DataQualityLockSummaryRow>(
      `
        WITH lock_base AS (
          SELECT
            l.id,
            l.gate_count,
            l.initial_pins,
            l.review_status,
            l.created_at,
            l.updated_at,
            COALESCE((
              SELECT n.name
              FROM lock_names n
              WHERE n.lock_id = l.id
                AND n.status <> 'rejected'
              ORDER BY
                CASE n.status WHEN 'approved' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
                ${nameSourcePrioritySql('n')},
                n.score DESC,
                n.created_at ASC
              LIMIT 1
            ), 'Unnamed lock') AS display_name,
            (
              SELECT MAX(n.score)
              FROM lock_names n
              WHERE n.lock_id = l.id
                AND n.status <> 'rejected'
            ) AS max_name_score,
            (
              SELECT COUNT(*)::integer
              FROM jsonb_array_elements(l.links) row_item,
                jsonb_array_elements_text(row_item.value) link_value
              WHERE link_value.value <> 'none'
            ) AS link_count,
            (
              SELECT COUNT(*)::integer
              FROM usage_events e
              WHERE e.lock_id = l.id
                AND e.event_type = 'lock_load'
            ) AS load_count,
            (
              SELECT COUNT(*)::integer
              FROM lock_reports r
              WHERE r.lock_id = l.id
            ) AS report_count,
            (
              SELECT string_agg(DISTINCT r.source, ', ' ORDER BY r.source)
              FROM lock_reports r
              WHERE r.lock_id = l.id
            ) AS report_sources
          FROM locks l
        )
        SELECT *
        FROM lock_base l
        WHERE l.review_status = 'pending'
          AND l.display_name = 'Unnamed lock'
          AND l.report_sources = 'auto-solve'
          AND l.load_count = 0
          AND l.created_at < now() - interval '48 hours'
        ORDER BY l.created_at ASC
        LIMIT 40
      `,
    ),
    query<DataQualityStartPinGroupRow>(
      `
        WITH lock_base AS (
          SELECT
            l.id,
            l.gate_count,
            l.initial_pins,
            l.review_status,
            l.created_at,
            l.updated_at,
            COALESCE((
              SELECT n.name
              FROM lock_names n
              WHERE n.lock_id = l.id
                AND n.status <> 'rejected'
              ORDER BY
                CASE n.status WHEN 'approved' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
                ${nameSourcePrioritySql('n')},
                n.score DESC,
                n.created_at ASC
              LIMIT 1
            ), 'Unnamed lock') AS display_name,
            (
              SELECT MAX(n.score)
              FROM lock_names n
              WHERE n.lock_id = l.id
                AND n.status <> 'rejected'
            ) AS max_name_score,
            (
              SELECT COUNT(*)::integer
              FROM jsonb_array_elements(l.links) row_item,
                jsonb_array_elements_text(row_item.value) link_value
              WHERE link_value.value <> 'none'
            ) AS link_count,
            (
              SELECT COUNT(*)::integer
              FROM usage_events e
              WHERE e.lock_id = l.id
                AND e.event_type = 'lock_load'
            ) AS load_count,
            (
              SELECT COUNT(*)::integer
              FROM lock_reports r
              WHERE r.lock_id = l.id
            ) AS report_count,
            (
              SELECT string_agg(DISTINCT r.source, ', ' ORDER BY r.source)
              FROM lock_reports r
              WHERE r.lock_id = l.id
            ) AS report_sources
          FROM locks l
          WHERE l.review_status <> 'rejected'
        ),
        grouped AS (
          SELECT
            gate_count,
            initial_pins,
            COUNT(*)::integer AS lock_count,
            SUM(load_count)::integer AS total_load_count
          FROM lock_base
          GROUP BY gate_count, initial_pins
          HAVING COUNT(*) > 1
        )
        SELECT
          g.gate_count,
          g.initial_pins,
          g.lock_count,
          g.total_load_count,
          jsonb_agg(
            jsonb_build_object(
              'id', b.id,
              'displayName', b.display_name,
              'reviewStatus', b.review_status,
              'gateCount', b.gate_count,
              'initialPins', b.initial_pins,
              'linkCount', b.link_count,
              'loadCount', b.load_count,
              'reportCount', b.report_count,
              'reportSources', b.report_sources,
              'maxNameScore', b.max_name_score,
              'createdAt', b.created_at,
              'updatedAt', b.updated_at
            )
            ORDER BY b.load_count DESC, b.report_count DESC, b.display_name ASC
          ) AS locks
        FROM grouped g
        JOIN lock_base b ON b.gate_count = g.gate_count AND b.initial_pins = g.initial_pins
        GROUP BY g.gate_count, g.initial_pins, g.lock_count, g.total_load_count
        ORDER BY g.lock_count DESC, g.total_load_count DESC, g.gate_count, g.initial_pins::text
        LIMIT 20
      `,
    ),
    query<DataQualityNameConflictRow>(
      `
        WITH active_names AS (
          SELECT
            n.id AS name_id,
            n.normalized_name,
            n.name,
            n.status AS name_status,
            n.score AS name_score,
            n.source AS name_source,
            l.id AS lock_id,
            l.gate_count,
            l.initial_pins,
            l.review_status,
            l.created_at,
            l.updated_at,
            (
              SELECT COUNT(*)::integer
              FROM jsonb_array_elements(l.links) row_item,
                jsonb_array_elements_text(row_item.value) link_value
              WHERE link_value.value <> 'none'
            ) AS link_count,
            (
              SELECT COUNT(*)::integer
              FROM usage_events e
              WHERE e.lock_id = l.id
                AND e.event_type = 'lock_load'
            ) AS load_count,
            (
              SELECT COUNT(*)::integer
              FROM lock_reports r
              WHERE r.lock_id = l.id
            ) AS report_count,
            (
              SELECT string_agg(DISTINCT r.source, ', ' ORDER BY r.source)
              FROM lock_reports r
              WHERE r.lock_id = l.id
            ) AS report_sources
          FROM lock_names n
          JOIN locks l ON l.id = n.lock_id
          WHERE n.status <> 'rejected'
            AND l.review_status <> 'rejected'
        ),
        grouped AS (
          SELECT normalized_name, gate_count, initial_pins, COUNT(DISTINCT lock_id)::integer AS lock_count
          FROM active_names
          GROUP BY normalized_name, gate_count, initial_pins
          HAVING COUNT(DISTINCT lock_id) > 1
        )
        SELECT
          g.normalized_name,
          MIN(a.name) AS example_name,
          g.gate_count,
          g.initial_pins,
          g.lock_count,
          jsonb_agg(
            jsonb_build_object(
              'id', a.lock_id,
              'displayName', a.name,
              'reviewStatus', a.review_status,
              'gateCount', a.gate_count,
              'initialPins', a.initial_pins,
              'linkCount', a.link_count,
              'loadCount', a.load_count,
              'reportCount', a.report_count,
              'reportSources', a.report_sources,
              'maxNameScore', a.name_score,
              'createdAt', a.created_at,
              'updatedAt', a.updated_at,
              'nameId', a.name_id,
              'name', a.name,
              'nameStatus', a.name_status,
              'nameSource', a.name_source,
              'nameScore', a.name_score
            )
            ORDER BY a.load_count DESC, a.report_count DESC, a.name ASC
          ) AS names
        FROM grouped g
        JOIN active_names a ON a.normalized_name = g.normalized_name
          AND a.gate_count = g.gate_count
          AND a.initial_pins = g.initial_pins
        GROUP BY g.normalized_name, g.gate_count, g.initial_pins, g.lock_count
        ORDER BY g.lock_count DESC, g.normalized_name
        LIMIT 20
      `,
    ),
    query<DataQualityMultiNameLockRow>(
      `
        SELECT
          l.id,
          COALESCE((
            SELECT n.name
            FROM lock_names n
            WHERE n.lock_id = l.id
              AND n.status <> 'rejected'
            ORDER BY
              CASE n.status WHEN 'approved' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
              ${nameSourcePrioritySql('n')},
              n.score DESC,
              n.created_at ASC
            LIMIT 1
          ), 'Unnamed lock') AS display_name,
          l.review_status,
          l.gate_count,
          l.initial_pins,
          (
            SELECT COUNT(*)::integer
            FROM jsonb_array_elements(l.links) row_item,
              jsonb_array_elements_text(row_item.value) link_value
            WHERE link_value.value <> 'none'
          ) AS link_count,
          (
            SELECT COUNT(*)::integer
            FROM usage_events e
            WHERE e.lock_id = l.id
              AND e.event_type = 'lock_load'
          ) AS load_count,
          (
            SELECT COUNT(*)::integer
            FROM lock_reports r
            WHERE r.lock_id = l.id
          ) AS report_count,
          (
            SELECT string_agg(DISTINCT r.source, ', ' ORDER BY r.source)
            FROM lock_reports r
            WHERE r.lock_id = l.id
          ) AS report_sources,
          (
            SELECT MAX(n.score)
            FROM lock_names n
            WHERE n.lock_id = l.id
              AND n.status <> 'rejected'
          ) AS max_name_score,
          l.created_at,
          l.updated_at,
          COUNT(n.id)::integer AS active_name_count,
          jsonb_agg(
            jsonb_build_object(
              'id', n.id,
              'name', n.name,
              'score', n.score,
              'status', n.status,
              'source', n.source
            )
            ORDER BY n.score DESC, n.name ASC
          ) AS names
        FROM locks l
        JOIN lock_names n ON n.lock_id = l.id AND n.status <> 'rejected'
        WHERE l.review_status <> 'rejected'
        GROUP BY l.id
        HAVING COUNT(n.id) > 1
        ORDER BY active_name_count DESC, load_count DESC, l.updated_at DESC
        LIMIT 30
      `,
    ),
  ])

  const summary = summaryResult.rows[0] ?? {
    low_signal_auto_solve: 0,
    low_signal_auto_solve_with_siblings: 0,
    start_pin_groups: 0,
    locks_in_start_pin_groups: 0,
    same_name_same_start_pin_groups: 0,
    multi_name_locks: 0,
    orphan_reports: 0,
  }

  return {
    summary: {
      lowSignalAutoSolve: numberValue(summary.low_signal_auto_solve),
      lowSignalAutoSolveWithSiblings: numberValue(summary.low_signal_auto_solve_with_siblings),
      startPinGroups: numberValue(summary.start_pin_groups),
      locksInStartPinGroups: numberValue(summary.locks_in_start_pin_groups),
      sameNameSameStartPinGroups: numberValue(summary.same_name_same_start_pin_groups),
      multiNameLocks: numberValue(summary.multi_name_locks),
      orphanReports: numberValue(summary.orphan_reports),
    },
    lowSignalAutoSolve: lowSignalResult.rows.map(qualityLockSummaryFromRow),
    startPinGroups: startPinGroupsResult.rows.map((row): AdminQualityStartPinGroup => ({
      gateCount: row.gate_count,
      initialPins: jsonValue<number[]>(row.initial_pins, []),
      lockCount: numberValue(row.lock_count),
      totalLoadCount: numberValue(row.total_load_count),
      locks: jsonValue<unknown[]>(row.locks, []).map(qualityLockSummaryFromJson),
    })),
    sameNameSameStartPins: sameNameSameStartPinsResult.rows.map((row): AdminQualityNameConflict => ({
      normalizedName: row.normalized_name,
      exampleName: row.example_name,
      gateCount: row.gate_count,
      initialPins: jsonValue<number[]>(row.initial_pins, []),
      lockCount: numberValue(row.lock_count),
      names: jsonValue<unknown[]>(row.names, []).map(qualityNameItemFromJson),
    })),
    multiNameLocks: multiNameLocksResult.rows.map((row): AdminQualityMultiNameLock => ({
      ...qualityLockSummaryFromRow(row),
      activeNameCount: numberValue(row.active_name_count),
      names: jsonValue<LockNameRecord[]>(row.names, []),
    })),
  }
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

  if (reviewStatus === 'approved') {
    await query(
      `
        UPDATE lock_names
        SET status = 'approved', updated_at = now()
        WHERE lock_id = $1
          AND status = 'pending'
          AND (
            SELECT COUNT(*)::integer
            FROM lock_names
            WHERE lock_id = $1
              AND status <> 'rejected'
          ) = 1
      `,
      [id],
    )
  }

  return getLock(id, { includeHidden: true })
}

export async function deleteAdminLock(id: string): Promise<void> {
  const result = await query<{ id: string }>(
    'DELETE FROM locks WHERE id = $1 RETURNING id',
    [id],
  )

  if (result.rows.length === 0) throw new ApiError(404, 'Lock not found')
}
