import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setQueryExecutorForTests } from '../api/_lib/db'
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
import { createFingerprint } from '../src/shared/lockValidation'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function queryResult<T>(rows: T[]): any {
  return {
    rows,
    rowCount: rows.length,
    command: 'SELECT',
    oid: 0,
    fields: [],
  }
}

function links(gateCount: number): string[][] {
  return Array.from({ length: gateCount }, () =>
    Array.from({ length: gateCount }, () => 'none'),
  )
}

function lockRow(options: {
  id: string
  name: string
  gateCount?: number
  initialPins?: number[]
  solutionPins?: number[]
  links?: string[][]
  reviewStatus?: RemoteLockRecord['reviewStatus']
  source?: string
}): any {
  const gateCount = options.gateCount ?? 4
  const initialPins = options.initialPins ?? [1, 2, 3, 4].slice(0, gateCount)
  const solutionPins = options.solutionPins ?? [4, 4, 4, 4].slice(0, gateCount)
  const linkMatrix = options.links ?? links(gateCount)

  return {
    id: options.id,
    gate_count: gateCount,
    initial_pins: initialPins,
    solution_pins: solutionPins,
    links: linkMatrix,
    solution_moves: [{ card: 1, direction: 'left' }],
    fingerprint: createFingerprint(gateCount, initialPins, solutionPins, linkMatrix as any),
    review_status: options.reviewStatus ?? 'approved',
    created_at: '2026-06-22T10:00:00.000Z',
    updated_at: '2026-06-22T10:00:00.000Z',
    names: [
      {
        id: `${options.id}-name`,
        name: options.name,
        score: 0,
        status: options.reviewStatus === 'rejected' ? 'rejected' : 'approved',
        source: options.source ?? 'manual',
      },
    ],
  }
}

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

test('database matching filters the start-pin prefix before result limiting', async () => {
  const calls: { sql: string; params: unknown[] }[] = []
  setQueryExecutorForTests(async (sql, params = []) => {
    calls.push({ sql, params })
    return queryResult(
      Array.from({ length: 25 }, (_, index) =>
        lockRow({
          id: `match-${String(index).padStart(2, '0')}`,
          name: `Match ${String(index).padStart(2, '0')}`,
        }),
      ),
    )
  })

  try {
    const matches = await findMatches('4', '1,2,3')

    assert.equal(matches.length, 20)
    assert.deepEqual(calls[0]?.params, [4, [1, 2, 3]])
    assert.match(calls[0]!.sql, /unnest\(\$2::int\[\]\) WITH ORDINALITY/)
    assert.match(calls[0]!.sql, /IS DISTINCT FROM entered\.pin/)
    assert.doesNotMatch(calls[0]!.sql, /LIMIT 100/)
  } finally {
    setQueryExecutorForTests(undefined)
  }
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

test('manual saves do not reuse auto-solve drafts by start pins', async () => {
  const calls: string[] = []
  const chest = {
    name: 'Manual Race Chest',
    gateCount: 4,
    initialPins: [1, 2, 3, 4],
    solutionPins: [4, 4, 4, 4],
    links: links(4) as any,
    solutionMoves: [{ card: 1, direction: 'left' as const }],
  }
  const inserted = lockRow({ id: 'manual-lock', name: chest.name })

  setQueryExecutorForTests(async (sql) => {
    calls.push(sql)
    if (/WHERE l\.fingerprint = \$1/.test(sql)) return queryResult([])
    if (/INSERT INTO locks/.test(sql)) return queryResult([{ id: inserted.id }])
    if (/INSERT INTO lock_reports/.test(sql)) return queryResult([])
    if (/INSERT INTO lock_names/.test(sql)) return queryResult([])
    if (/WHERE l\.id = \$1/.test(sql)) return queryResult([inserted])
    throw new Error(`Unexpected query: ${sql}`)
  })

  try {
    const result = await createOrReportLock(chest, {
      source: 'manual',
      visitorHash: 'manual-visitor',
    })

    assert.equal(result.duplicate, false)
    assert.equal(result.lock?.id, 'manual-lock')
    assert.equal(calls.some((sql) => /last_auto_solve_at/.test(sql)), false)
  } finally {
    setQueryExecutorForTests(undefined)
  }
})

test('concurrent duplicate lock inserts are reported as duplicates', async () => {
  const calls: string[] = []
  const chest = {
    name: 'Concurrent Chest',
    gateCount: 4,
    initialPins: [1, 2, 3, 4],
    solutionPins: [4, 4, 4, 4],
    links: links(4) as any,
    solutionMoves: [{ card: 1, direction: 'left' as const }],
  }
  const existing = lockRow({ id: 'existing-lock', name: chest.name })
  let fingerprintLookups = 0

  setQueryExecutorForTests(async (sql) => {
    calls.push(sql)
    if (/WHERE l\.fingerprint = \$1/.test(sql)) {
      fingerprintLookups++
      return queryResult(fingerprintLookups === 1 ? [] : [existing])
    }
    if (/INSERT INTO locks/.test(sql)) return queryResult([])
    if (/SELECT EXISTS/.test(sql)) return queryResult([{ exists: false }])
    if (/INSERT INTO lock_reports/.test(sql)) return queryResult([])
    if (/INSERT INTO lock_names/.test(sql)) return queryResult([])
    if (/WHERE l\.id = \$1/.test(sql)) return queryResult([existing])
    throw new Error(`Unexpected query: ${sql}`)
  })

  try {
    const result = await createOrReportLock(chest, {
      source: 'manual',
      visitorHash: 'race-visitor',
    })

    assert.equal(result.duplicate, true)
    assert.equal(result.lock?.id, 'existing-lock')
    assert.equal(calls.some((sql) => /ON CONFLICT \(fingerprint\) DO NOTHING/.test(sql)), true)
    assert.equal(calls.some((sql) => /INSERT INTO lock_reports/.test(sql)), true)
  } finally {
    setQueryExecutorForTests(undefined)
  }
})

test('auto-solve edits reuse the same visitor draft by start pins', async () => {
  const service = await readFile(path.join(rootDir, 'api/_lib/lockService.ts'), 'utf8')

  assert.match(service, /getEditableAutoSolveLockRow/)
  assert.match(service, /source === 'auto-solve'\s*\?\s*await getEditableAutoSolveLockRow/)
  assert.doesNotMatch(service, /const editableAutoSolve =[\s\S]{0,120}source === 'auto-solve' \|\| isManualSubmission/)
  assert.match(service, /l\.initial_pins = \$2::jsonb/)
  assert.match(service, /other_reports\.source <> 'auto-solve'/)
  assert.match(service, /other_names\.source <> 'auto-solve'/)
  assert.match(service, /r\.source = 'auto-solve'/)
  assert.match(service, /r\.visitor_hash = \$3/)
  assert.match(service, /const existing = exactExisting \?\? editableAutoSolve/)
  assert.match(service, /rejectSupersededAutoSolveDraft\(editableAutoSolve\.id\)/)
  assert.match(service, /fingerprint = \$5/)
  assert.match(service, /fingerprint = \$8/)
  assert.match(service, /isConflict: shouldUpdateAutoSolve \? false/)
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

test('public UI explains and highlights database matches', async () => {
  const main = await readFile(path.join(rootDir, 'src/main.ts'), 'utf8')
  const panel = await readFile(path.join(rootDir, 'src/game/chestPanel.ts'), 'utf8')
  const styles = await readFile(path.join(rootDir, 'src/style.css'), 'utf8')
  const i18n = await readFile(path.join(rootDir, 'src/i18n.ts'), 'utf8')

  assert.match(main, /t\('helpDatabaseTitle'\)/)
  assert.match(main, /t\('helpDatabaseText1'\)/)
  assert.match(main, /t\('helpDatabaseText2'\)/)
  assert.match(panel, /id="remote-match-count"/)
  assert.match(panel, /remote-panel--has-matches/)
  assert.match(panel, /t\('databaseMatchesFound'\)/)
  assert.match(panel, /t\('loadDatabaseMatch'\)/)
  assert.match(styles, /\.remote-panel--has-matches/)
  assert.match(i18n, /helpDatabaseTitle: 'Gemeinsame Datenbank'/)
  assert.match(i18n, /loadDatabaseMatch: 'Treffer laden'/)
})

test('admin entry count is rendered as first statistics card', async () => {
  const panel = await readFile(path.join(rootDir, 'src/game/adminPanel.ts'), 'utf8')

  assert.match(panel, /renderMetric\(t\('entryCount'\), entryCountValue/)
  assert.match(panel, /renderStats\(container, usageStats, \{\s*visible: visibleLocks\.length,\s*total: locks\.length/s)
  assert.doesNotMatch(panel, /setStatus\(container, entryCount/)
})

test('admin moderation actions refresh statistics', async () => {
  const panel = await readFile(path.join(rootDir, 'src/game/adminPanel.ts'), 'utf8')

  assert.match(panel, /await Promise\.all\(\[loadLocks\(lock\.id\), loadStats\(\)\]\)/)
  assert.match(panel, /await Promise\.all\(\[loadLocks\(\), loadStats\(\)\]\)/)
  assert.match(panel, /await Promise\.all\(\[loadLocks\(\), loadImports\(\), loadStats\(\)\]\)/)
  assert.match(panel, /await Promise\.all\(\[loadImports\(\), loadStats\(\)\]\)/)
  assert.match(panel, /await Promise\.all\(\[loadLocks\(body\.lock\.id\), loadStats\(\)\]\)/)
})

test('canonical fingerprint migration splits conflict reports into separate locks', async () => {
  const migration = await readFile(
    path.join(rootDir, 'db/migrations/005_canonical_lock_fingerprints.sql'),
    'utf8',
  )

  assert.match(migration, /CREATE OR REPLACE FUNCTION canonical_lock_fingerprint/)
  assert.match(migration, /WHERE r\.is_conflict = true/)
  assert.match(migration, /INSERT INTO locks/)
  assert.match(migration, /UPDATE lock_reports r[\s\S]*is_conflict = false/)
  assert.match(migration, /INSERT INTO lock_names/)
  assert.match(migration, /DELETE FROM lock_names/)
  assert.match(migration, /UPDATE import_items i[\s\S]*is_conflict = false/)
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

test('name upserts promote higher-trust sources and approved status', async () => {
  const service = await readFile(path.join(rootDir, 'api/_lib/lockService.ts'), 'utf8')

  assert.match(service, /ON CONFLICT \(lock_id, normalized_name\)/)
  assert.match(service, /WHEN EXCLUDED\.status = 'approved' THEN 'approved'/)
  assert.match(service, /nameSourcePrioritySql\('EXCLUDED'\)/)
  assert.match(service, /nameSourcePrioritySql\('lock_names'\)/)
  assert.match(service, /visitor_hash = COALESCE\(lock_names\.visitor_hash, EXCLUDED\.visitor_hash\)/)
})
