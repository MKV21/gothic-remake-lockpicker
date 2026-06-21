import type { ChestRecord } from '../shared/lockTypes'
import type { SolveMove } from './solver'
import {
  clampGateCount,
  CARD_COUNT,
  DEFAULT_GATE_COUNT,
  createEmptyCard,
  type GameState,
} from './types'

export type { ChestRecord }

export function gameStateToChest(
  name: string,
  state: GameState,
  solutionMoves?: SolveMove[],
): ChestRecord {
  const gateCount = clampGateCount(state.gateCount ?? DEFAULT_GATE_COUNT)

  const chest: ChestRecord = {
    name: name.trim(),
    gateCount,
    initialPins: state.cards
      .slice(0, gateCount)
      .map((card) => (card.startPin === null ? null : card.startPin + 1)),
    solutionPins: state.cards
      .slice(0, gateCount)
      .map((card) => (card.correctPin === null ? null : card.correctPin + 1)),
    links: state.links.slice(0, gateCount).map((row) => row.slice(0, gateCount)),
  }

  if (solutionMoves !== undefined) {
    chest.solutionMoves = solutionMoves.map((move) => ({ ...move }))
  }

  return chest
}

export function applyChestToGameState(state: GameState, chest: ChestRecord): void {
  const gateCount = clampGateCount(chest.gateCount ?? chest.initialPins.length)
  state.gateCount = gateCount

  for (let i = 0; i < CARD_COUNT; i++) {
    if (i < gateCount) {
      const initial = chest.initialPins[i] ?? null
      const solution = chest.solutionPins[i] ?? null

      const startIndex = initial === null ? null : initial - 1
      const correctIndex = solution === null ? null : solution - 1

      state.cards[i].startPin = startIndex
      state.cards[i].currentPin = startIndex
      state.cards[i].correctPin = correctIndex
    } else {
      // Reset inactive gates to defaults so stale data never leaks in.
      Object.assign(state.cards[i], createEmptyCard())
    }
  }

  for (let i = 0; i < CARD_COUNT; i++) {
    for (let j = 0; j < CARD_COUNT; j++) {
      state.links[i][j] =
        i < gateCount && j < gateCount ? chest.links?.[i]?.[j] ?? 'none' : 'none'
    }
  }
}
