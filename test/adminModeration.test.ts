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
  isSubmittableLockName,
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

function lockWithoutNames(reviewStatus: RemoteLockRecord['reviewStatus'] = 'pending'): RemoteLockRecord {
  return {
    ...lockWithScore(0),
    displayName: 'Unnamed lock',
    reviewStatus,
    names: [],
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

test('public lock visibility allows nameless pending auto-solve locks', async () => {
  const service = await readFile(path.join(rootDir, 'api/_lib/lockService.ts'), 'utf8')

  assert.equal(isLockPubliclyVisible(lockWithoutNames()), true)
  assert.equal(isLockPubliclyVisible(lockWithoutNames('rejected')), false)
  assert.match(service, /'Unnamed lock'/)
  assert.match(service, /\.map\(rowToLock\)\s*\.filter\(isLockPubliclyVisible\)\s*\.map\(toPublicLock\)/s)
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

test('admin lock approval auto-approves a single pending active name', async () => {
  const service = await readFile(path.join(rootDir, 'api/_lib/lockService.ts'), 'utf8')

  assert.match(service, /export async function setAdminLockReviewStatus/)
  assert.match(service, /if \(reviewStatus === 'approved'\)/)
  assert.match(service, /UPDATE lock_names\s+SET status = 'approved'/s)
  assert.match(service, /AND status = 'pending'/)
  assert.match(service, /COUNT\(\*\)::integer[\s\S]*status <> 'rejected'[\s\S]*\) = 1/)
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

test('manual saves promote prior auto-solve submissions from the same visitor', async () => {
  const endpoint = await readFile(path.join(rootDir, 'api/locks/index.ts'), 'utf8')
  const service = await readFile(path.join(rootDir, 'api/_lib/lockService.ts'), 'utf8')

  assert.match(endpoint, /payload\.submissionKind === 'auto-solve' \? 'auto-solve' : 'manual'/)
  assert.match(service, /promotePriorAutoSolveReports/)
  assert.match(service, /source = 'auto-solve'/)
  assert.match(service, /promotedFromAutoSolve/)
  assert.match(service, /source === 'manual' \|\| source === 'anonymous'/)
})

test('admin UI exposes lock name moderation controls', async () => {
  const panel = await readFile(path.join(rootDir, 'src/game/adminPanel.ts'), 'utf8')
  const i18n = await readFile(path.join(rootDir, 'src/i18n.ts'), 'utf8')

  assert.match(panel, /class="admin-name-section"/)
  assert.match(panel, /class="admin-table-action admin-name-action/)
  assert.match(panel, /\/api\/admin\/names/)
  assert.match(panel, /data-status="approved"/)
  assert.match(panel, /data-status="rejected"/)
  assert.match(panel, /nameCountLabel\(lock\)/)
  assert.match(panel, /t\('openModeration'\)/)
  assert.match(i18n, /openModeration: 'Offene Moderation'/)
})

test('UI distinguishes match score from name vote score', async () => {
  const adminPanel = await readFile(path.join(rootDir, 'src/game/adminPanel.ts'), 'utf8')
  const chestPanel = await readFile(path.join(rootDir, 'src/game/chestPanel.ts'), 'utf8')
  const i18n = await readFile(path.join(rootDir, 'src/i18n.ts'), 'utf8')

  assert.match(adminPanel, /t\('nameVotes'\)/)
  assert.match(chestPanel, /t\('matchedPins'\)/)
  assert.match(chestPanel, /t\('nameVotes'\)/)
  assert.match(chestPanel, /nameScoreLabel/)
  assert.doesNotMatch(chestPanel, /t\('score'\)\s*\}\s*\$\{match\.score/)
  assert.match(i18n, /matchedPins: 'Passende Pins'/)
  assert.match(i18n, /nameVotes: 'Namensvotes'/)
  assert.match(i18n, /sortScore: 'Niedrigste Namensvotes'/)
})

test('auto-solve placeholder names are not treated as name suggestions', async () => {
  const panel = await readFile(path.join(rootDir, 'src/game/chestPanel.ts'), 'utf8')
  const migration = await readFile(
    path.join(rootDir, 'db/migrations/004_drop_auto_solve_unnamed_lock_names.sql'),
    'utf8',
  )

  assert.equal(isSubmittableLockName(''), false)
  assert.equal(isSubmittableLockName('   '), false)
  assert.equal(isSubmittableLockName('Unnamed lock'), false)
  assert.equal(isSubmittableLockName('Old Camp chest'), true)
  assert.doesNotMatch(panel, /\|\| 'Unnamed lock'/)
  assert.match(migration, /DELETE FROM lock_names/)
  assert.match(migration, /source = 'auto-solve'/)
  assert.match(migration, /normalized_name = 'unnamed lock'/)
})
