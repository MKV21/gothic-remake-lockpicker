import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { query, getPool } from '../api/_lib/db'
import { createOrReportLock } from '../api/_lib/lockService'
import type { ChestRecord, LinkType, SolveMove } from '../src/shared/lockTypes'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const xetoxycChestDir = path.join(rootDir, 'data/chests')

type SeedItem = {
  chest: ChestRecord
  sourceProject: string
  sourceUrl: string
  metadata?: Record<string, unknown>
}

async function upsertSeedSource(item: SeedItem): Promise<string> {
  const result = await query<{ id: string }>(
    `
      INSERT INTO seed_sources (source_project, source_url, metadata)
      VALUES ($1, $2, $3::jsonb)
      ON CONFLICT (source_project, source_url)
      DO UPDATE SET imported_at = now(), metadata = EXCLUDED.metadata
      RETURNING id
    `,
    [item.sourceProject, item.sourceUrl, JSON.stringify(item.metadata ?? {})],
  )
  return result.rows[0]!.id
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

function normalizeExternalChest(raw: Record<string, unknown>, fallbackName: string): ChestRecord | undefined {
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

async function readXetoxycSeeds(): Promise<SeedItem[]> {
  const files = (await readdir(xetoxycChestDir))
    .filter((file) => file.endsWith('.json'))
    .sort((a, b) => a.localeCompare(b))

  const items: SeedItem[] = []
  for (const file of files) {
    const raw = JSON.parse(await readFile(path.join(xetoxycChestDir, file), 'utf8')) as Record<string, unknown>
    const chest = normalizeExternalChest(raw, file.replace(/\.json$/, ''))
    if (!chest) continue
    items.push({
      chest,
      sourceProject: 'Xetoxyc/gothic-remake-lockpicker',
      sourceUrl: `https://github.com/Xetoxyc/gothic-remake-lockpicker/blob/main/data/chests/${file}`,
      metadata: { file, reviewStatus: 'approved-seed' },
    })
  }

  return items
}

async function readReligiosaSeeds(): Promise<SeedItem[]> {
  const apiUrl = 'https://api.github.com/repos/religiosa1/gothic-lockpick-emulator/contents/locks'
  const response = await fetch(apiUrl)
  if (!response.ok) throw new Error(`Failed to fetch religiosa1 locks: ${response.status}`)
  const entries = (await response.json()) as { name: string; download_url?: string; type: string }[]
  const items: SeedItem[] = []

  for (const entry of entries.filter((item) => item.type === 'file' && item.name.endsWith('.json'))) {
    if (!entry.download_url) continue
    const rawResponse = await fetch(entry.download_url)
    if (!rawResponse.ok) continue
    const raw = (await rawResponse.json()) as Record<string, unknown>
    const chest = normalizeExternalChest(raw, entry.name.replace(/\.json$/, ''))
    if (!chest) continue
    items.push({
      chest,
      sourceProject: 'religiosa1/gothic-lockpick-emulator',
      sourceUrl: entry.download_url,
      metadata: { file: entry.name, reviewStatus: 'pending-format-review' },
    })
  }

  return items
}

const includeReligiosa = process.argv.includes('--fetch-religiosa1')
const seeds = [...(await readXetoxycSeeds())]

if (includeReligiosa) {
  seeds.push(...(await readReligiosaSeeds()))
}

let created = 0
let duplicates = 0

for (const item of seeds) {
  const seedSourceId = await upsertSeedSource(item)
  const result = await createOrReportLock(item.chest, {
    source: 'seed',
    seedSourceId,
  })
  if (result.duplicate) duplicates++
  else created++
  console.log(`${result.duplicate ? 'updated' : 'created'} ${result.lock.displayName}`)
}

console.log(`seed import complete: ${created} created, ${duplicates} updated`)
await getPool().end()
