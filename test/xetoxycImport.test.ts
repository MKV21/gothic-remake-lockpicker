import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { parseXetoxycLocalStorageImport } from '../src/shared/xetoxycImport'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const sampleChest = {
  name: 'Old Camp chest',
  gateCount: 4,
  initialPins: [1, 2, 3, 4],
  solutionPins: [4, 4, 4, 4],
  links: [
    ['none', 'same', 'none', 'none'],
    ['none', 'none', 'opposite', 'none'],
    ['none', 'none', 'none', 'none'],
    ['none', 'none', 'none', 'none'],
  ],
}

test('parses pasted Xetoxyc gothic.chests localStorage exports', () => {
  const payload = JSON.stringify({
    'gothic.chests': JSON.stringify({
      old_camp_chest: sampleChest,
    }),
  })

  const items = parseXetoxycLocalStorageImport(payload)
  assert.equal(items.length, 1)
  assert.equal(items[0]?.storageKey, 'old_camp_chest')
  assert.equal(items[0]?.chest?.name, 'Old Camp chest')
  assert.deepEqual(items[0]?.chest?.initialPins, [1, 2, 3, 4])
})

test('parses direct chest arrays and falls back to item names', () => {
  const items = parseXetoxycLocalStorageImport(JSON.stringify([
    {
      initialPins: [1, 2, 3, 4],
      targetPins: [4, 4, 4, 4],
    },
  ]))

  assert.equal(items.length, 1)
  assert.equal(items[0]?.chest?.name, 'item-1')
  assert.deepEqual(items[0]?.chest?.solutionPins, [4, 4, 4, 4])
})

test('returns item-level errors for malformed import entries', () => {
  const items = parseXetoxycLocalStorageImport(JSON.stringify({
    invalid_entry: { name: 'Missing pins' },
  }))

  assert.equal(items.length, 1)
  assert.equal(items[0]?.storageKey, 'invalid_entry')
  assert.equal(items[0]?.error, 'Import item has no start pins')
})

test('database schema stages local-storage imports before approval', async () => {
  const migration = await readFile(path.join(rootDir, 'db/migrations/002_import_batches.sql'), 'utf8')
  assert.match(migration, /CREATE TABLE IF NOT EXISTS import_batches/)
  assert.match(migration, /CREATE TABLE IF NOT EXISTS import_items/)
  assert.match(migration, /status IN \('pending', 'approved', 'rejected', 'invalid'\)/)
  assert.match(migration, /approved_lock_id uuid REFERENCES locks\(id\)/)
})
