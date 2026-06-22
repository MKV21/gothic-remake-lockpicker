import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  notifyPendingImportBatch,
  notifyPendingLockSubmission,
  sendTelegramAdminNotification,
} from '../api/_lib/telegram'

const originalFetch = globalThis.fetch

function restoreTelegramEnv(previous: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

function captureTelegramEnv(): Record<string, string | undefined> {
  return {
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    TELEGRAM_ADMIN_CHAT_ID: process.env.TELEGRAM_ADMIN_CHAT_ID,
    ADMIN_URL: process.env.ADMIN_URL,
    VERCEL_PROJECT_PRODUCTION_URL: process.env.VERCEL_PROJECT_PRODUCTION_URL,
    VERCEL_URL: process.env.VERCEL_URL,
  }
}

test('telegram notifications are disabled when env vars are missing', async () => {
  const previousEnv = captureTelegramEnv()
  let fetchCalled = false
  delete process.env.TELEGRAM_BOT_TOKEN
  delete process.env.TELEGRAM_ADMIN_CHAT_ID
  globalThis.fetch = (async () => {
    fetchCalled = true
    return new Response('{}')
  }) as typeof fetch

  try {
    const result = await sendTelegramAdminNotification('test')
    assert.deepEqual(result, { sent: false, reason: 'not-configured' })
    assert.equal(fetchCalled, false)
  } finally {
    globalThis.fetch = originalFetch
    restoreTelegramEnv(previousEnv)
  }
})

test('telegram notifications send plain-text messages to the configured chat', async () => {
  const previousEnv = captureTelegramEnv()
  const calls: { input: RequestInfo | URL; init?: RequestInit }[] = []
  process.env.TELEGRAM_BOT_TOKEN = '123:test-token'
  process.env.TELEGRAM_ADMIN_CHAT_ID = '256626875'
  globalThis.fetch = (async (input, init) => {
    calls.push({ input, init })
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  }) as typeof fetch

  try {
    const result = await sendTelegramAdminNotification('New lock pending approval')
    assert.deepEqual(result, { sent: true })
    assert.equal(calls.length, 1)
    assert.equal(String(calls[0]!.input), 'https://api.telegram.org/bot123:test-token/sendMessage')

    const body = JSON.parse(String(calls[0]!.init?.body)) as {
      chat_id: string
      text: string
      disable_web_page_preview: boolean
    }
    assert.equal(body.chat_id, '256626875')
    assert.equal(body.text, 'New lock pending approval')
    assert.equal(body.disable_web_page_preview, true)
  } finally {
    globalThis.fetch = originalFetch
    restoreTelegramEnv(previousEnv)
  }
})

test('pending import notifications skip batches without valid review items', async () => {
  const previousEnv = captureTelegramEnv()
  let fetchCalled = false
  process.env.TELEGRAM_BOT_TOKEN = '123:test-token'
  process.env.TELEGRAM_ADMIN_CHAT_ID = '256626875'
  globalThis.fetch = (async () => {
    fetchCalled = true
    return new Response('{}')
  }) as typeof fetch

  try {
    await notifyPendingImportBatch({
      batchId: 'batch-1',
      itemCount: 2,
      validCount: 0,
      invalidCount: 2,
    })
    assert.equal(fetchCalled, false)
  } finally {
    globalThis.fetch = originalFetch
    restoreTelegramEnv(previousEnv)
  }
})

test('pending import notifications keep explicit admin URLs unchanged', async () => {
  const previousEnv = captureTelegramEnv()
  const calls: { input: RequestInfo | URL; init?: RequestInit }[] = []
  process.env.TELEGRAM_BOT_TOKEN = '123:test-token'
  process.env.TELEGRAM_ADMIN_CHAT_ID = '256626875'
  process.env.ADMIN_URL = 'https://gothic-lockpick-database.vercel.app/admin/'
  globalThis.fetch = (async (input, init) => {
    calls.push({ input, init })
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  }) as typeof fetch

  try {
    await notifyPendingImportBatch({
      batchId: 'batch-1',
      itemCount: 1,
      validCount: 1,
      invalidCount: 0,
    })

    const body = JSON.parse(String(calls[0]!.init?.body)) as { text: string }
    assert.match(body.text, /Admin: https:\/\/gothic-lockpick-database\.vercel\.app\/admin$/)
    assert.doesNotMatch(body.text, /\/admin\/admin/)
  } finally {
    globalThis.fetch = originalFetch
    restoreTelegramEnv(previousEnv)
  }
})

test('pending import notifications append admin path to deployment base URLs', async () => {
  const previousEnv = captureTelegramEnv()
  const calls: { input: RequestInfo | URL; init?: RequestInit }[] = []
  process.env.TELEGRAM_BOT_TOKEN = '123:test-token'
  process.env.TELEGRAM_ADMIN_CHAT_ID = '256626875'
  delete process.env.ADMIN_URL
  process.env.VERCEL_URL = 'gothic-lockpick-database.vercel.app'
  globalThis.fetch = (async (input, init) => {
    calls.push({ input, init })
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  }) as typeof fetch

  try {
    await notifyPendingImportBatch({
      batchId: 'batch-1',
      itemCount: 1,
      validCount: 1,
      invalidCount: 0,
    })

    const body = JSON.parse(String(calls[0]!.init?.body)) as { text: string }
    assert.match(body.text, /Admin: https:\/\/gothic-lockpick-database\.vercel\.app\/admin$/)
  } finally {
    globalThis.fetch = originalFetch
    restoreTelegramEnv(previousEnv)
  }
})

test('pending lock notifications skip duplicates and skipped auto-solve submissions', async () => {
  const previousEnv = captureTelegramEnv()
  let fetchCalled = false
  process.env.TELEGRAM_BOT_TOKEN = '123:test-token'
  process.env.TELEGRAM_ADMIN_CHAT_ID = '256626875'
  globalThis.fetch = (async () => {
    fetchCalled = true
    return new Response('{}')
  }) as typeof fetch

  const payload = {
    name: 'Test',
    gateCount: 4,
    initialPins: [1, 2, 3, 4],
    solutionPins: [4, 4, 4, 4],
  }

  try {
    await notifyPendingLockSubmission({ payload, result: { duplicate: true } })
    await notifyPendingLockSubmission({ payload, result: { duplicate: false, skipped: true } })
    assert.equal(fetchCalled, false)
  } finally {
    globalThis.fetch = originalFetch
    restoreTelegramEnv(previousEnv)
  }
})

test('pending lock notifications send manual promotion updates', async () => {
  const previousEnv = captureTelegramEnv()
  const calls: { input: RequestInfo | URL; init?: RequestInit }[] = []
  process.env.TELEGRAM_BOT_TOKEN = '123:test-token'
  process.env.TELEGRAM_ADMIN_CHAT_ID = '256626875'
  globalThis.fetch = (async (input, init) => {
    calls.push({ input, init })
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  }) as typeof fetch

  try {
    await notifyPendingLockSubmission({
      payload: {
        name: 'Manual chest',
        gateCount: 4,
        initialPins: [1, 2, 3, 4],
        solutionPins: [4, 4, 4, 4],
        submissionKind: 'manual',
      },
      result: { duplicate: true, promotedFromAutoSolve: true },
    })

    assert.equal(calls.length, 1)
    const body = JSON.parse(String(calls[0]!.init?.body)) as { text: string }
    assert.match(body.text, /Lock confirmed manually after auto-solve/)
    assert.match(body.text, /Source: manual/)
    assert.match(body.text, /Name: Manual chest/)
  } finally {
    globalThis.fetch = originalFetch
    restoreTelegramEnv(previousEnv)
  }
})
