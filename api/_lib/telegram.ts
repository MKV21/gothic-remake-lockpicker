import type { ImportSubmissionResult } from '../../src/shared/lockTypes.js'
import type { LockMutationResult } from './lockService.js'
import { countSetLinks } from '../../src/shared/lockValidation.js'
import type { ChestRecord } from '../../src/shared/lockTypes.js'

const TELEGRAM_SEND_TIMEOUT_MS = 5000
const DEFAULT_ADMIN_URL = 'https://gothic-lockpick-database.vercel.app/admin'

type TelegramNotificationResult = {
  sent: boolean
  reason?: 'not-configured' | 'failed'
}

type LockSubmissionNotification = {
  payload: ChestRecord & { submissionKind?: 'manual' | 'auto-solve' }
  result: LockMutationResult
}

function configuredAdminUrl(): string {
  const explicitUrl = process.env.ADMIN_URL?.trim()
  const vercelProductionUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim()
  const vercelUrl = process.env.VERCEL_URL?.trim()
  const baseUrl = explicitUrl || vercelProductionUrl || vercelUrl

  if (!baseUrl) return DEFAULT_ADMIN_URL

  const normalizedBaseUrl = /^https?:\/\//i.test(baseUrl) ? baseUrl : `https://${baseUrl}`
  const withoutTrailingSlash = normalizedBaseUrl.replace(/\/+$/, '')
  return withoutTrailingSlash.endsWith('/admin') ? withoutTrailingSlash : `${withoutTrailingSlash}/admin`
}

function formatPins(pins: ChestRecord['initialPins']): string {
  return pins.map((pin) => pin ?? '?').join(', ')
}

function lockDisplayName(payload: ChestRecord): string {
  const name = payload.name.trim()
  return name || '(no name)'
}

export async function sendTelegramAdminNotification(text: string): Promise<TelegramNotificationResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim()
  const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID?.trim()
  if (!token || !chatId) return { sent: false, reason: 'not-configured' }

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(TELEGRAM_SEND_TIMEOUT_MS),
    })

    if (!response.ok) {
      console.warn(`Telegram notification failed with status ${response.status}`)
      return { sent: false, reason: 'failed' }
    }

    return { sent: true }
  } catch (error) {
    console.warn(error instanceof Error ? `Telegram notification failed: ${error.message}` : 'Telegram notification failed')
    return { sent: false, reason: 'failed' }
  }
}

export async function notifyPendingLockSubmission({
  payload,
  result,
}: LockSubmissionNotification): Promise<void> {
  if (result.skipped || result.duplicate) return

  const gateCount = payload.gateCount ?? payload.initialPins.length
  const linkCount = countSetLinks(payload.links, gateCount)
  const source = payload.submissionKind === 'auto-solve' ? 'auto-solve' : 'manual'

  await sendTelegramAdminNotification([
    'New lock pending approval',
    `Name: ${lockDisplayName(payload)}`,
    `Source: ${source}`,
    `Gates: ${gateCount}`,
    `Pins: ${formatPins(payload.initialPins)}`,
    `Links: ${linkCount}`,
    `Admin: ${configuredAdminUrl()}`,
  ].join('\n'))
}

export async function notifyPendingImportBatch(result: ImportSubmissionResult): Promise<void> {
  if (result.validCount <= 0) return

  await sendTelegramAdminNotification([
    'New import pending approval',
    `Valid items: ${result.validCount}`,
    `Invalid items: ${result.invalidCount}`,
    `Total items: ${result.itemCount}`,
    `Batch: ${result.batchId}`,
    `Admin: ${configuredAdminUrl()}`,
  ].join('\n'))
}
