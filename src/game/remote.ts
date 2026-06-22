import type {
  ChestRecord,
  ImportSubmissionResult,
  LockMatchRecord,
  RemoteLockRecord,
} from '../shared/lockTypes'
import { parsePins } from '../shared/lockValidation'

export type SubmitLockResult = {
  lock?: RemoteLockRecord
  duplicate: boolean
  hidden?: boolean
  skipped?: boolean
}

export type VoteRemoteNameResult = {
  lock?: RemoteLockRecord
  hidden?: boolean
}

async function readJson<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as { error?: string }
  if (!response.ok) throw new Error(body.error ?? `Request failed with ${response.status}`)
  return body as T
}

export async function submitLock(
  chest: ChestRecord,
  options: { submissionKind?: 'manual' | 'auto-solve' } = {},
): Promise<SubmitLockResult> {
  const response = await fetch('/api/locks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...chest, submissionKind: options.submissionKind ?? 'manual' }),
  })
  return readJson<SubmitLockResult>(response)
}

export async function submitXetoxycImport(payload: string): Promise<ImportSubmissionResult> {
  const response = await fetch('/api/imports/xetoxyc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ payload }),
  })
  return readJson<ImportSubmissionResult>(response)
}

export async function trackPageView(): Promise<void> {
  const params = new URLSearchParams({
    event: 'page-view',
    t: String(Date.now()),
  })
  await fetch(`/api/locks/match?${params.toString()}`, {
    credentials: 'same-origin',
  }).catch(() => undefined)
}

export async function matchLocks(gateCount: number, pins: readonly (number | null)[]): Promise<LockMatchRecord[]> {
  const enteredPins: number[] = []
  for (const pin of pins) {
    if (pin === null) break
    enteredPins.push(pin)
  }
  if (enteredPins.length === 0) return []

  const params = new URLSearchParams({
    gateCount: String(gateCount),
    pins: enteredPins.join(','),
  })
  const response = await fetch(`/api/locks/match?${params.toString()}`)
  const body = await readJson<{ matches: LockMatchRecord[] }>(response)
  return body.matches
}

export async function getRemoteLock(id: string): Promise<RemoteLockRecord> {
  const response = await fetch(`/api/locks/${encodeURIComponent(id)}`)
  const body = await readJson<{ lock: RemoteLockRecord }>(response)
  return body.lock
}

export async function suggestRemoteName(lockId: string, name: string): Promise<RemoteLockRecord> {
  const response = await fetch(`/api/locks/${encodeURIComponent(lockId)}/names`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  const body = await readJson<{ lock: RemoteLockRecord }>(response)
  return body.lock
}

export async function voteRemoteName(nameId: string, value: 1 | -1): Promise<VoteRemoteNameResult> {
  const response = await fetch(`/api/names/${encodeURIComponent(nameId)}/vote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value }),
  })
  return readJson<VoteRemoteNameResult>(response)
}

export function pinsFromChest(chest: ChestRecord): number[] {
  return parsePins(chest.initialPins.filter((pin): pin is number => pin !== null).join(','))
}
