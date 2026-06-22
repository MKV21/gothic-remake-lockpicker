import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

async function listApiRouteFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === '_lib') return []
        return listApiRouteFiles(fullPath)
      }
      return entry.name.endsWith('.ts') ? [fullPath] : []
    }),
  )
  return files.flat()
}

test('analytics migration creates usage event tracking tables and indexes', async () => {
  const migration = await readFile(path.join(rootDir, 'db/migrations/003_usage_events.sql'), 'utf8')
  assert.match(migration, /CREATE TABLE IF NOT EXISTS usage_events/)
  assert.match(migration, /event_type text NOT NULL/)
  assert.match(migration, /lock_id uuid REFERENCES locks\(id\) ON DELETE SET NULL/)
  assert.match(migration, /usage_events_type_created_idx/)
  assert.match(migration, /usage_events_lock_type_idx/)
})

test('analytics reuses existing Vercel API route budget', async () => {
  const routeFiles = await listApiRouteFiles(path.join(rootDir, 'api'))
  assert.equal(routeFiles.length, 12)

  const matchRoute = await readFile(path.join(rootDir, 'api/locks/match.ts'), 'utf8')
  const lockRoute = await readFile(path.join(rootDir, 'api/locks/[id].ts'), 'utf8')
  const reportsRoute = await readFile(path.join(rootDir, 'api/admin/reports.ts'), 'utf8')
  assert.match(matchRoute, /event'\) === 'page-view'/)
  assert.match(matchRoute, /safeTrackRequestUsageEvent\('match_search'/)
  assert.match(lockRoute, /safeTrackRequestUsageEvent\('lock_load'/)
  assert.match(reportsRoute, /listAdminUsageStats/)
})
