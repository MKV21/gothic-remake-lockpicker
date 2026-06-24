import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { solveLock } from '../src/game/solver'
import type { GameState } from '../src/game/types'
import type { NormalizedChest } from '../src/shared/lockValidation'
import {
  CARD_COUNT,
  countSetLinks,
  createFingerprint,
  isSameCanonicalData,
  matchPins,
  normalizeChestRecord,
} from '../src/shared/lockValidation'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function stateFromChest(chest: NormalizedChest): GameState {
  return {
    gateCount: chest.gateCount,
    cards: Array.from({ length: CARD_COUNT }, (_, index) => {
      const startPin = index < chest.gateCount ? chest.initialPins[index] - 1 : null
      const correctPin = index < chest.gateCount ? chest.solutionPins[index] - 1 : 3
      return {
        startPin,
        correctPin,
        currentPin: startPin,
      }
    }),
    links: Array.from({ length: CARD_COUNT }, (_, rowIndex) =>
      Array.from({ length: CARD_COUNT }, (_, columnIndex) =>
        rowIndex < chest.gateCount && columnIndex < chest.gateCount
          ? chest.links[rowIndex]?.[columnIndex] ?? 'none'
          : 'none',
      ),
    ),
  }
}

test('normalizes chests and creates stable fingerprints', () => {
  const result = normalizeChestRecord({
    name: '  Scatty chest  ',
    gateCount: 5,
    initialPins: [7, 1, 2, 3, 6],
    solutionPins: [4, 4, 4, 4, 4],
  })

  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.chest.name, 'Scatty chest')
  assert.equal(
    result.chest.fingerprint,
    createFingerprint(
      result.chest.gateCount,
      result.chest.initialPins,
      result.chest.solutionPins,
      result.chest.links,
    ),
  )
  assert.match(result.chest.fingerprint, /^5:\[7,1,2,3,6\]\|solution:/)
})

test('keeps names required unless explicitly disabled', () => {
  const unnamed = {
    name: '',
    gateCount: 4,
    initialPins: [1, 2, 3, 4],
    solutionPins: [4, 4, 4, 4],
  }

  const required = normalizeChestRecord(unnamed)
  const optional = normalizeChestRecord(unnamed, { requireName: false })

  assert.deepEqual(required, { ok: false, error: 'Name is required' })
  assert.equal(optional.ok, true)
  if (!optional.ok) return
  assert.equal(optional.chest.name, '')
})

test('matches only the entered start-pin prefix', () => {
  assert.equal(matchPins([7, 1, 2, 3, 6], [7]), true)
  assert.equal(matchPins([7, 1, 2, 3, 6], [7, 1, 2]), true)
  assert.equal(matchPins([7, 1, 2, 3, 6], [1]), false)
})

test('canonical duplicate comparison ignores name and solution moves', () => {
  const first = normalizeChestRecord({
    name: 'One',
    gateCount: 4,
    initialPins: [1, 2, 3, 4],
    solutionPins: [4, 4, 4, 4],
    solutionMoves: [{ card: 1, direction: 'left' }],
  })
  const second = normalizeChestRecord({
    name: 'Two',
    gateCount: 4,
    initialPins: [1, 2, 3, 4],
    solutionPins: [4, 4, 4, 4],
    solutionMoves: [],
  })

  assert.equal(first.ok, true)
  assert.equal(second.ok, true)
  if (!first.ok || !second.ok) return
  assert.equal(isSameCanonicalData(first.chest, second.chest), true)
})

test('fingerprints separate locks with the same start pins but different links', () => {
  const first = normalizeChestRecord({
    name: 'One',
    gateCount: 4,
    initialPins: [1, 2, 3, 4],
    solutionPins: [4, 4, 4, 4],
    links: [
      ['none', 'none', 'none', 'none'],
      ['none', 'none', 'none', 'none'],
      ['none', 'none', 'none', 'none'],
      ['none', 'none', 'none', 'none'],
    ],
  })
  const second = normalizeChestRecord({
    name: 'Two',
    gateCount: 4,
    initialPins: [1, 2, 3, 4],
    solutionPins: [4, 4, 4, 4],
    links: [
      ['none', 'same', 'none', 'none'],
      ['none', 'none', 'none', 'none'],
      ['none', 'none', 'none', 'none'],
      ['none', 'none', 'none', 'none'],
    ],
  })

  assert.equal(first.ok, true)
  assert.equal(second.ok, true)
  if (!first.ok || !second.ok) return
  assert.notEqual(first.chest.fingerprint, second.chest.fingerprint)
  assert.equal(matchPins(first.chest.initialPins, second.chest.initialPins), true)
})

test('counts only active same and opposite links', () => {
  assert.equal(countSetLinks([
    ['none', 'same', 'opposite'],
    ['none', 'none', 'same'],
    ['opposite', 'none', 'none'],
  ], 2), 1)
  assert.equal(countSetLinks([
    ['none', 'same'],
    ['opposite', 'none'],
  ]), 2)
})

test('solver still reproduces copied seed solution lengths', async () => {
  const raw = JSON.parse(
    await readFile(path.join(rootDir, 'data/chests/scatty.json'), 'utf8'),
  )
  const normalized = normalizeChestRecord(raw)

  assert.equal(normalized.ok, true)
  if (!normalized.ok) return

  const solved = solveLock(stateFromChest(normalized.chest))
  assert.equal(solved.ok, true)
  if (!solved.ok) return
  assert.equal(solved.moves.length, normalized.chest.solutionMoves.length)
})
