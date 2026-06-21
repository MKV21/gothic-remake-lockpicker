import { test } from 'node:test'
import assert from 'node:assert/strict'
import { movesToInputChain } from '../src/game/inputChain'
import { OUTPUT_PROFILES, outputProfileLabel } from '../src/game/outputProfiles'

test('keyboard chain keeps upstream reset/navigation semantics', () => {
  const chain = movesToInputChain([{ card: 3, direction: 'left' }], 6)
  assert.deepEqual(chain, ['R', 'W', 'W', 'W', 'A'])
})

test('controller profiles map the same chain to platform labels', () => {
  assert.equal(OUTPUT_PROFILES.keyboard.R.label, 'R')
  assert.equal(OUTPUT_PROFILES.xbox.R.label, 'Y')
  assert.equal(OUTPUT_PROFILES.ps5.R.label, 'Triangle')
  assert.equal(OUTPUT_PROFILES.switch.R.label, 'X')
  assert.equal(OUTPUT_PROFILES.xbox.A.label, 'D-pad Left')
  assert.equal(OUTPUT_PROFILES.ps5.D.label, 'D-pad Right')
})

test('output profile labels are stable for UI radios', () => {
  assert.equal(outputProfileLabel('moves'), 'Moves')
  assert.equal(outputProfileLabel('keyboard'), 'Keyboard')
  assert.equal(outputProfileLabel('xbox'), 'Xbox')
  assert.equal(outputProfileLabel('ps5'), 'PS5')
  assert.equal(outputProfileLabel('switch'), 'Switch')
})
