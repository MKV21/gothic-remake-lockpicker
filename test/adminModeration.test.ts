import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  HIDDEN_LOCK_SCORE_THRESHOLD,
  createOrReportLock,
  findMatches,
  isReviewStatus,
  isLockPubliclyVisible,
  isStatusOnlyAdminLockPatch,
} from '../api/_lib/lockService'
import type { RemoteLockRecord } from '../src/shared/lockTypes'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function lockWithScore(score: number): RemoteLockRecord {
  return {
    id: 'lock-1',
    gateCount: 5,
    initialPins: [1, 2, 3, 4, 5],
    solutionPins: [4, 4, 4, 4, 4],
    links: [],
    solutionMoves: [],
    fingerprint: '5:1,2,3,4,5',
    displayName: 'Test',
    reviewStatus: 'approved',
    createdAt: '2026-06-22T10:00:00.000Z',
    updatedAt: '2026-06-22T10:00:00.000Z',
    names: [
      {
        id: 'name-1',
        name: 'Test',
        score,
        status: 'approved',
        source: 'test',
      },
    ],
  }
}

test('public lock visibility hides chests at -5 votes', () => {
  assert.equal(HIDDEN_LOCK_SCORE_THRESHOLD, -5)
  assert.equal(isLockPubliclyVisible(lockWithScore(-4)), true)
  assert.equal(isLockPubliclyVisible(lockWithScore(-5)), false)
})

test('public lock visibility hides rejected locks', () => {
  const lock = lockWithScore(10)
  lock.reviewStatus = 'rejected'
  assert.equal(isLockPubliclyVisible(lock), false)
})

test('schema enforces one vote per visitor and name', async () => {
  const migration = await readFile(path.join(rootDir, 'db/migrations/001_init.sql'), 'utf8')
  assert.match(migration, /UNIQUE\s*\(\s*name_id\s*,\s*visitor_hash\s*\)/)
})

test('admin approve patch is status-only', () => {
  assert.equal(isReviewStatus('approved'), true)
  assert.equal(isReviewStatus('archived'), false)

  assert.equal(isStatusOnlyAdminLockPatch({ reviewStatus: 'approved' }), true)
  assert.equal(isStatusOnlyAdminLockPatch({ reviewStatus: 'pending' }), true)
  assert.equal(isStatusOnlyAdminLockPatch({ reviewStatus: 'rejected' }), true)
  assert.equal(isStatusOnlyAdminLockPatch({ reviewStatus: 'approved', name: 'Chest' }), false)
  assert.equal(isStatusOnlyAdminLockPatch({ reviewStatus: 'archived' }), false)
  assert.equal(isStatusOnlyAdminLockPatch(null), false)
})

test('admin lock list includes first report identity metadata', async () => {
  const service = await readFile(path.join(rootDir, 'api/_lib/lockService.ts'), 'utf8')
  assert.match(service, /first_report\.ip_hash AS first_report_ip_hash/)
  assert.match(service, /first_report\.visitor_hash AS first_report_visitor_hash/)
  assert.match(service, /LEFT JOIN LATERAL\s*\(\s*SELECT visitor_hash, ip_hash, source, created_at/s)
})

test('database matching waits for at least three pins', async () => {
  assert.deepEqual(await findMatches('6', '1,2'), [])
})

test('auto-solve submissions without links are skipped before database writes', async () => {
  const result = await createOrReportLock(
    {
      name: 'Auto solve without links',
      gateCount: 4,
      initialPins: [1, 2, 3, 4],
      solutionPins: [4, 4, 4, 4],
      links: [
        ['none', 'none', 'none', 'none'],
        ['none', 'none', 'none', 'none'],
        ['none', 'none', 'none', 'none'],
        ['none', 'none', 'none', 'none'],
      ],
    },
    { source: 'auto-solve', visitorHash: 'visitor-1' },
  )

  assert.deepEqual(result, { duplicate: false, skipped: true })
})

test('admin import approval clears the staged import item', async () => {
  const service = await readFile(path.join(rootDir, 'api/_lib/importService.ts'), 'utf8')
  assert.match(service, /export async function approveAdminImportItem[\s\S]*createOrReportLock/)
  assert.match(service, /export async function approveAdminImportItem[\s\S]*DELETE FROM import_items/)
})
