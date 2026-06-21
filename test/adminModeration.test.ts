import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  HIDDEN_LOCK_SCORE_THRESHOLD,
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
