import type { LinkType } from '../shared/lockTypes.js'
import {
  CARD_COUNT,
  DEFAULT_GATE_COUNT,
  HOLE_COUNT,
  MAX_GATE_COUNT,
  MIN_GATE_COUNT,
  clampGateCount,
} from '../shared/lockValidation.js'

export { CARD_COUNT, DEFAULT_GATE_COUNT, HOLE_COUNT, MAX_GATE_COUNT, MIN_GATE_COUNT, clampGateCount }
export const DEFAULT_SOLUTION_PIN = 3 // hole 4

export type { LinkType }

export type CardState = {
  startPin: number | null
  correctPin: number | null
  currentPin: number | null
}

export type GameState = {
  // Number of active gates (4–7). We always keep CARD_COUNT cards/links
  // in memory so changing the gate count never loses data; only the first
  // gateCount entries are rendered and solved.
  gateCount: number
  cards: CardState[]
  links: LinkType[][]
}

export function createEmptyCard(): CardState {
  return {
    startPin: null,
    correctPin: DEFAULT_SOLUTION_PIN,
    currentPin: null,
  }
}

export function createEmptyCards(): CardState[] {
  return Array.from({ length: CARD_COUNT }, createEmptyCard)
}

export function createEmptyLinks(): LinkType[][] {
  return Array.from({ length: CARD_COUNT }, () =>
    Array.from({ length: CARD_COUNT }, () => 'none' as LinkType),
  )
}

export function createGameState(): GameState {
  return {
    gateCount: DEFAULT_GATE_COUNT,
    cards: createEmptyCards(),
    links: createEmptyLinks(),
  }
}

export function resetGameState(state: GameState): void {
  const gateCount = state.gateCount
  state.cards = createEmptyCards()
  state.links = createEmptyLinks()
  state.gateCount = gateCount
}

export const LINK_CYCLE: LinkType[] = ['none', 'same', 'opposite']

export function nextLinkType(current: LinkType): LinkType {
  const index = LINK_CYCLE.indexOf(current)
  return LINK_CYCLE[(index + 1) % LINK_CYCLE.length]
}

export function linkLabel(type: LinkType): string {
  switch (type) {
    case 'same':
      return 'S'
    case 'opposite':
      return 'O'
    default:
      return ''
  }
}
