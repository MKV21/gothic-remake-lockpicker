import type { ChestRecord, LinkType, SolveMove } from './lockTypes.js'

const STORAGE_KEY = 'gothic.chests'

export type XetoxycImportCandidate = {
  index: number
  storageKey?: string
  chest?: ChestRecord
  error?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function unescapeConsoleWhitespace(value: string): string {
  return value
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\'/g, "'")
}

function unescapeJsonLikeString(value: string): string {
  return unescapeConsoleWhitespace(value).replace(/\\"/g, '"').replace(/\\\\/g, '\\')
}

function parseJsonCandidate(value: string): unknown | undefined {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return undefined
  }
}

function parseJsonString(value: string): unknown {
  const trimmed = value.trim()
  const direct = parseJsonCandidate(trimmed)
  if (direct !== undefined) return direct

  const candidates: string[] = []
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    candidates.push(unescapeConsoleWhitespace(trimmed.slice(1, -1)))
  }
  if (trimmed.startsWith('\\{') || trimmed.startsWith('\\[') || trimmed.includes('\\"')) {
    candidates.push(unescapeJsonLikeString(trimmed))
  }

  for (const candidate of candidates) {
    const parsed = parseJsonCandidate(candidate)
    if (parsed !== undefined) return parsed
  }

  throw new Error('Invalid JSON')
}

function looksLikeJsonString(value: string): boolean {
  const trimmed = value.trim()
  return (
    trimmed.startsWith('{') ||
    trimmed.startsWith('[') ||
    trimmed.startsWith('"') ||
    trimmed.startsWith("'") ||
    trimmed.startsWith('\\{') ||
    trimmed.startsWith('\\[')
  )
}

function unwrapJson(value: unknown): unknown {
  let next = value
  for (let depth = 0; depth < 2; depth++) {
    if (typeof next !== 'string') return next
    const trimmed = next.trim()
    if (!trimmed) return next
    if (!looksLikeJsonString(trimmed)) return next
    next = parseJsonString(trimmed)
  }
  return next
}

function asPins(value: unknown): (number | null)[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.map((pin) => (Number.isInteger(pin) ? Number(pin) : null))
}

function asLinks(value: unknown): LinkType[][] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.map((row) =>
    Array.isArray(row)
      ? row.map((link) => (link === 'same' || link === 'opposite' ? link : 'none'))
      : [],
  )
}

function asMoves(value: unknown): SolveMove[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value
    .map((move) => ({
      card: Number((move as { card?: unknown }).card),
      direction: (move as { direction?: unknown }).direction,
    }))
    .filter(
      (move): move is SolveMove =>
        Number.isInteger(move.card) && (move.direction === 'left' || move.direction === 'right'),
    )
}

function hasChestShape(value: unknown): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    (
      Array.isArray(value.initialPins) ||
      Array.isArray(value.startPins) ||
      Array.isArray(value.pins) ||
      Array.isArray(value.initial_pins)
    )
  )
}

export function normalizeExternalChest(
  raw: Record<string, unknown>,
  fallbackName: string,
): ChestRecord | undefined {
  const initialPins =
    asPins(raw.initialPins) ??
    asPins(raw.startPins) ??
    asPins(raw.pins) ??
    asPins(raw.initial_pins)

  if (!initialPins) return undefined

  const solutionPins =
    asPins(raw.solutionPins) ??
    asPins(raw.targetPins) ??
    asPins(raw.correctPins) ??
    asPins(raw.solution_pins) ??
    initialPins.map(() => 4)

  return {
    name: String(raw.name ?? raw.title ?? fallbackName),
    gateCount: Number(raw.gateCount ?? raw.gates ?? initialPins.length),
    initialPins,
    solutionPins,
    links: asLinks(raw.links),
    solutionMoves: asMoves(raw.solutionMoves ?? raw.solution_moves ?? raw.moves),
  }
}

function storageValueFromExport(parsed: unknown): unknown {
  if (Array.isArray(parsed)) {
    const localStorageEntry = parsed.find(
      (entry) => isRecord(entry) && entry.key === STORAGE_KEY && 'value' in entry,
    )
    if (isRecord(localStorageEntry)) return unwrapJson(localStorageEntry.value)
    return parsed
  }

  if (!isRecord(parsed)) return parsed

  if (STORAGE_KEY in parsed) return unwrapJson(parsed[STORAGE_KEY])
  if ('key' in parsed && parsed.key === STORAGE_KEY && 'value' in parsed) {
    return unwrapJson(parsed.value)
  }
  if (Object.prototype.hasOwnProperty.call(parsed, 'chests') && !hasChestShape(parsed)) {
    return unwrapJson((parsed as { chests?: unknown }).chests)
  }

  return parsed
}

function candidateEntries(value: unknown): { storageKey?: string; raw: unknown }[] {
  const store = storageValueFromExport(value)

  if (Array.isArray(store)) {
    return store.map((raw, index) => ({ storageKey: `item-${index + 1}`, raw }))
  }

  if (hasChestShape(store)) return [{ raw: store }]

  if (isRecord(store)) {
    return Object.entries(store).map(([storageKey, raw]) => ({ storageKey, raw }))
  }

  return [{ raw: store }]
}

export function parseXetoxycLocalStorageImport(payload: string): XetoxycImportCandidate[] {
  let parsed: unknown
  try {
    parsed = unwrapJson(payload)
  } catch (error) {
    return [
      {
        index: 1,
        error: error instanceof Error ? error.message : 'Invalid JSON',
      },
    ]
  }

  return candidateEntries(parsed).map((entry, index) => {
    if (!isRecord(entry.raw)) {
      return {
        index: index + 1,
        storageKey: entry.storageKey,
        error: 'Import item is not an object',
      }
    }

    const chest = normalizeExternalChest(
      entry.raw,
      entry.storageKey ?? `Imported lock ${index + 1}`,
    )
    if (!chest) {
      return {
        index: index + 1,
        storageKey: entry.storageKey,
        error: 'Import item has no start pins',
      }
    }

    return {
      index: index + 1,
      storageKey: entry.storageKey,
      chest,
    }
  })
}
