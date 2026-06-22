import type {
  AdminImportItemRecord,
  ChestRecord,
  ImportItemStatus,
  ImportSubmissionResult,
  LinkType,
  SolveMove,
} from '../../src/shared/lockTypes.js'
import {
  countSetLinks,
  isSameCanonicalData,
  type NormalizedChest,
} from '../../src/shared/lockValidation.js'
import { parseXetoxycLocalStorageImport } from '../../src/shared/xetoxycImport.js'
import { ApiError, query } from './db.js'
import { createOrReportLock, normalizeIncomingLock } from './lockService.js'

const IMPORT_SOURCE_XETOXYC = 'xetoxyc-local-storage'
const MAX_IMPORT_PAYLOAD_BYTES = 256 * 1024
const MAX_IMPORT_ITEMS = 100

type ImportItemRow = {
  id: string
  batch_id: string
  status: ImportItemStatus
  source: string
  storage_key: string | null
  name: string | null
  fingerprint: string | null
  gate_count: number | null
  initial_pins: unknown
  solution_pins: unknown
  links: unknown
  solution_moves: unknown
  normalized_chest: unknown
  error: string | null
  duplicate_lock_id: string | null
  is_conflict: boolean
  approved_lock_id: string | null
  visitor_hash: string | null
  ip_hash: string | null
  batch_created_at: string
  created_at: string
  updated_at: string
}

type LockDuplicateRow = {
  id: string
  gate_count: number
  initial_pins: unknown
  solution_pins: unknown
  links: unknown
  solution_moves: unknown
  fingerprint: string
}

function jsonValue<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback
  if (typeof value === 'string') return JSON.parse(value) as T
  return value as T
}

function nullableJson<T>(value: unknown): T | null {
  if (value === null || value === undefined) return null
  return jsonValue<T>(value, null as T)
}

function rowToNormalizedChest(row: LockDuplicateRow): NormalizedChest {
  return {
    name: 'Existing lock',
    gateCount: row.gate_count,
    initialPins: jsonValue<number[]>(row.initial_pins, []),
    solutionPins: jsonValue<number[]>(row.solution_pins, []),
    links: jsonValue<LinkType[][]>(row.links, []),
    solutionMoves: jsonValue<SolveMove[]>(row.solution_moves, []),
    fingerprint: row.fingerprint,
  }
}

function rowToImportItem(row: ImportItemRow): AdminImportItemRecord {
  return {
    id: row.id,
    batchId: row.batch_id,
    status: row.status,
    source: row.source,
    storageKey: row.storage_key,
    name: row.name,
    fingerprint: row.fingerprint,
    gateCount: row.gate_count,
    initialPins: nullableJson<number[]>(row.initial_pins),
    solutionPins: nullableJson<number[]>(row.solution_pins),
    links: nullableJson<LinkType[][]>(row.links),
    solutionMoves: nullableJson<SolveMove[]>(row.solution_moves),
    error: row.error,
    duplicateLockId: row.duplicate_lock_id,
    isConflict: row.is_conflict,
    approvedLockId: row.approved_lock_id,
    visitorHash: row.visitor_hash,
    ipHash: row.ip_hash,
    batchCreatedAt: row.batch_created_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

async function duplicateInfo(chest: NormalizedChest): Promise<{
  duplicateLockId: string | null
  isConflict: boolean
}> {
  const result = await query<LockDuplicateRow>(
    `
      SELECT id, gate_count, initial_pins, solution_pins, links, solution_moves, fingerprint
      FROM locks
      WHERE fingerprint = $1
      LIMIT 1
    `,
    [chest.fingerprint],
  )
  const duplicate = result.rows[0]
  if (!duplicate) return { duplicateLockId: null, isConflict: false }

  return {
    duplicateLockId: duplicate.id,
    isConflict: !isSameCanonicalData(chest, rowToNormalizedChest(duplicate)),
  }
}

async function refreshBatchCounts(batchId: string): Promise<void> {
  await query(
    `
      UPDATE import_batches
      SET
        approved_count = (
          SELECT COUNT(*)::integer FROM import_items WHERE batch_id = $1 AND status = 'approved'
        ),
        rejected_count = (
          SELECT COUNT(*)::integer FROM import_items WHERE batch_id = $1 AND status = 'rejected'
        ),
        updated_at = now()
      WHERE id = $1
    `,
    [batchId],
  )
}

export function importPayloadMaxBytes(): number {
  return MAX_IMPORT_PAYLOAD_BYTES
}

export async function createXetoxycImportBatch(
  payload: string,
  identity: { visitorHash: string; ipHash: string },
): Promise<ImportSubmissionResult> {
  if (!payload.trim()) throw new ApiError(400, 'Import JSON is required')
  if (Buffer.byteLength(payload, 'utf8') > MAX_IMPORT_PAYLOAD_BYTES) {
    throw new ApiError(413, 'Import JSON is too large')
  }

  const candidates = parseXetoxycLocalStorageImport(payload)
  if (candidates.length === 0) throw new ApiError(400, 'No import items found')
  if (candidates.length > MAX_IMPORT_ITEMS) {
    throw new ApiError(400, `Import is limited to ${MAX_IMPORT_ITEMS} chests`)
  }

  let validCount = 0
  let invalidCount = 0
  const batchResult = await query<{ id: string }>(
    `
      INSERT INTO import_batches (source, visitor_hash, ip_hash, item_count)
      VALUES ($1, $2, $3, $4)
      RETURNING id
    `,
    [IMPORT_SOURCE_XETOXYC, identity.visitorHash, identity.ipHash, candidates.length],
  )
  const batchId = batchResult.rows[0]!.id

  for (const candidate of candidates) {
    let chest: NormalizedChest | undefined
    let error = candidate.error
    let duplicateLockId: string | null = null
    let isConflict = false

    if (!error && candidate.chest) {
      try {
        chest = normalizeIncomingLock(candidate.chest)
        const duplicate = await duplicateInfo(chest)
        duplicateLockId = duplicate.duplicateLockId
        isConflict = duplicate.isConflict
      } catch (caught) {
        error = caught instanceof Error ? caught.message : 'Invalid lock data'
      }
    }

    const status: ImportItemStatus = chest ? 'pending' : 'invalid'
    if (status === 'pending') validCount++
    else invalidCount++

    await query(
      `
        INSERT INTO import_items (
          batch_id,
          status,
          storage_key,
          name,
          fingerprint,
          gate_count,
          initial_pins,
          solution_pins,
          links,
          solution_moves,
          normalized_chest,
          error,
          duplicate_lock_id,
          is_conflict
        )
        VALUES (
          $1, $2, $3, $4, $5, $6,
          $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb,
          $12, $13, $14
        )
      `,
      [
        batchId,
        status,
        candidate.storageKey ?? null,
        chest?.name ?? candidate.chest?.name ?? null,
        chest?.fingerprint ?? null,
        chest?.gateCount ?? null,
        chest ? JSON.stringify(chest.initialPins) : null,
        chest ? JSON.stringify(chest.solutionPins) : null,
        chest ? JSON.stringify(chest.links) : null,
        chest ? JSON.stringify(chest.solutionMoves) : null,
        chest ? JSON.stringify(chest) : null,
        error ?? null,
        duplicateLockId,
        isConflict,
      ],
    )
  }

  await query(
    `
      UPDATE import_batches
      SET valid_count = $2, invalid_count = $3, updated_at = now()
      WHERE id = $1
    `,
    [batchId, validCount, invalidCount],
  )

  return {
    batchId,
    itemCount: candidates.length,
    validCount,
    invalidCount,
  }
}

export async function listAdminImportItems(): Promise<AdminImportItemRecord[]> {
  const result = await query<ImportItemRow>(
    `
      SELECT
        i.*,
        b.source,
        b.visitor_hash,
        b.ip_hash,
        b.created_at AS batch_created_at
      FROM import_items i
      JOIN import_batches b ON b.id = i.batch_id
      ORDER BY
        CASE i.status WHEN 'pending' THEN 0 WHEN 'invalid' THEN 1 WHEN 'rejected' THEN 2 ELSE 3 END,
        i.created_at DESC
      LIMIT 250
    `,
  )

  return result.rows.map(rowToImportItem)
}

async function getImportItemForAdmin(id: string): Promise<ImportItemRow> {
  const result = await query<ImportItemRow>(
    `
      SELECT
        i.*,
        b.source,
        b.visitor_hash,
        b.ip_hash,
        b.created_at AS batch_created_at
      FROM import_items i
      JOIN import_batches b ON b.id = i.batch_id
      WHERE i.id = $1
    `,
    [id],
  )

  const row = result.rows[0]
  if (!row) throw new ApiError(404, 'Import item not found')
  return row
}

export async function approveAdminImportItem(id: string): Promise<AdminImportItemRecord> {
  const item = await getImportItemForAdmin(id)
  if (item.status !== 'pending') throw new ApiError(409, 'Only pending import items can be approved')
  if (item.is_conflict) {
    throw new ApiError(409, 'Import conflicts with an existing lock and needs manual review')
  }

  const chest = jsonValue<NormalizedChest | null>(item.normalized_chest, null)
  if (!chest) throw new ApiError(400, 'Import item has no valid lock data')

  const result = await createOrReportLock(chest as ChestRecord, {
    visitorHash: item.visitor_hash ?? undefined,
    ipHash: item.ip_hash ?? undefined,
    source: IMPORT_SOURCE_XETOXYC,
    reviewStatus: 'approved',
    nameStatus: 'approved',
  })

  const approvedLockId = result.lock?.id ?? item.duplicate_lock_id
  await query(
    `
      UPDATE import_items
      SET status = 'approved', approved_lock_id = $2, updated_at = now()
      WHERE id = $1
    `,
    [id, approvedLockId],
  )
  await refreshBatchCounts(item.batch_id)
  return rowToImportItem(await getImportItemForAdmin(id))
}

export async function rejectAdminImportItem(id: string): Promise<AdminImportItemRecord> {
  const item = await getImportItemForAdmin(id)
  if (item.status !== 'pending') throw new ApiError(409, 'Only pending import items can be rejected')

  await query(
    `
      UPDATE import_items
      SET status = 'rejected', updated_at = now()
      WHERE id = $1
    `,
    [id],
  )
  await refreshBatchCounts(item.batch_id)
  return rowToImportItem(await getImportItemForAdmin(id))
}

export function importedChestLinkCount(item: AdminImportItemRecord): number {
  return countSetLinks(item.links ?? undefined, item.gateCount ?? undefined)
}
