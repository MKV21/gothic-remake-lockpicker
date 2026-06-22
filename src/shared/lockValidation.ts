import type { ChestRecord, LinkType, RemoteLockRecord, SolveMove } from './lockTypes.js'

export const CARD_COUNT = 7
export const MIN_GATE_COUNT = 4
export const MAX_GATE_COUNT = CARD_COUNT
export const DEFAULT_GATE_COUNT = 6
export const HOLE_COUNT = 7
export const DEFAULT_SOLUTION_PIN = 4
export const MIN_MATCH_PIN_COUNT = 3

const LINK_TYPES = new Set<LinkType>(['none', 'same', 'opposite'])

export type NormalizedChest = {
  name: string
  gateCount: number
  initialPins: number[]
  solutionPins: number[]
  links: LinkType[][]
  solutionMoves: SolveMove[]
  fingerprint: string
}

export type ValidationResult =
  | { ok: true; chest: NormalizedChest }
  | { ok: false; error: string }

export function clampGateCount(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_GATE_COUNT
  return Math.min(MAX_GATE_COUNT, Math.max(MIN_GATE_COUNT, Math.round(value)))
}

export function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, ' ')
}

export function slugifyName(name: string): string {
  return (
    normalizeName(name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'chest'
  )
}

export function normalizeNameKey(name: string): string {
  return normalizeName(name).toLocaleLowerCase('en-US')
}

export function isPin(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= HOLE_COUNT
}

export function createFingerprint(gateCount: number, initialPins: readonly number[]): string {
  return `${gateCount}:${initialPins.join(',')}`
}

export function parsePins(value: string): number[] {
  if (!value.trim()) return []

  return value
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((pin) => Number.isInteger(pin) && pin >= 1 && pin <= HOLE_COUNT)
}

function normalizePins(
  pins: (number | null)[] | undefined,
  gateCount: number,
  field: string,
  fallback?: number,
): { ok: true; pins: number[] } | { ok: false; error: string } {
  if (!Array.isArray(pins)) {
    if (fallback === undefined) return { ok: false, error: `${field} is required` }
    return { ok: true, pins: Array.from({ length: gateCount }, () => fallback) }
  }

  const next: number[] = []
  for (let i = 0; i < gateCount; i++) {
    const pin = pins[i]
    if (pin === null || pin === undefined) {
      if (fallback === undefined) {
        return { ok: false, error: `${field} must include pin ${i + 1}` }
      }
      next.push(fallback)
      continue
    }
    if (!isPin(pin)) return { ok: false, error: `${field} contains an invalid pin` }
    next.push(pin)
  }

  return { ok: true, pins: next }
}

export function normalizeLinks(links: LinkType[][] | undefined, gateCount: number): LinkType[][] {
  return Array.from({ length: gateCount }, (_, rowIndex) =>
    Array.from({ length: gateCount }, (_, columnIndex) => {
      const value = links?.[rowIndex]?.[columnIndex]
      return LINK_TYPES.has(value as LinkType) ? (value as LinkType) : 'none'
    }),
  )
}

function normalizeMoves(moves: SolveMove[] | undefined, gateCount: number): SolveMove[] {
  if (!Array.isArray(moves)) return []

  return moves.filter(
    (move) =>
      Number.isInteger(move.card) &&
      move.card >= 1 &&
      move.card <= gateCount &&
      (move.direction === 'left' || move.direction === 'right'),
  )
}

export function normalizeChestRecord(chest: ChestRecord): ValidationResult {
  const gateCount = clampGateCount(chest.gateCount ?? chest.initialPins?.length ?? DEFAULT_GATE_COUNT)
  const name = normalizeName(chest.name)
  if (!name) return { ok: false, error: 'Name is required' }

  const initial = normalizePins(chest.initialPins, gateCount, 'initialPins')
  if (!initial.ok) return initial

  const solution = normalizePins(
    chest.solutionPins,
    gateCount,
    'solutionPins',
    DEFAULT_SOLUTION_PIN,
  )
  if (!solution.ok) return solution

  const initialPins = initial.pins
  const solutionPins = solution.pins

  return {
    ok: true,
    chest: {
      name,
      gateCount,
      initialPins,
      solutionPins,
      links: normalizeLinks(chest.links, gateCount),
      solutionMoves: normalizeMoves(chest.solutionMoves, gateCount),
      fingerprint: createFingerprint(gateCount, initialPins),
    },
  }
}

export function chestFromRemoteLock(lock: RemoteLockRecord): ChestRecord {
  return {
    name: lock.displayName,
    gateCount: lock.gateCount,
    initialPins: lock.initialPins,
    solutionPins: lock.solutionPins,
    links: lock.links,
    solutionMoves: lock.solutionMoves,
  }
}

export function isSameCanonicalData(a: NormalizedChest, b: NormalizedChest): boolean {
  return (
    JSON.stringify(a.solutionPins) === JSON.stringify(b.solutionPins) &&
    JSON.stringify(a.links) === JSON.stringify(b.links)
  )
}

export function matchPins(initialPins: readonly number[], queryPins: readonly number[]): boolean {
  return queryPins.every((pin, index) => initialPins[index] === pin)
}
