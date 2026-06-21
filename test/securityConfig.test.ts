import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createAdminSessionValue,
  verifyAdminSessionValue,
} from '../api/_lib/adminAuth'
import { getDatabaseSslConfig } from '../api/_lib/db'
import { getVisitorHashSalt } from '../api/_lib/http'

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
    return
  }
  process.env[name] = value
}

test('admin session values are signed and expire server-side', () => {
  const token = 'test-admin-token'
  const now = 1_700_000_000_000
  const session = createAdminSessionValue({ token, now, nonce: 'fixed-nonce' })

  assert.equal(verifyAdminSessionValue(session, token, now + 1), true)
  assert.equal(verifyAdminSessionValue(session, token, now + 8 * 60 * 60 * 1000), false)
  assert.equal(verifyAdminSessionValue(`${session}.extra`, token, now + 1), false)
  assert.equal(verifyAdminSessionValue(session.replace(/\.[^.]+$/, '.bad'), token, now + 1), false)
})

test('remote database URLs verify TLS certificates', () => {
  assert.equal(getDatabaseSslConfig('postgres://user:pass@localhost:5432/db'), false)
  assert.equal(getDatabaseSslConfig('postgres://user:pass@127.0.0.1:5432/db'), false)
  assert.deepEqual(
    getDatabaseSslConfig('postgres://user:pass@example.neon.tech/db'),
    { rejectUnauthorized: true },
  )
})

test('visitor hash salt is required in production', () => {
  const originalSalt = process.env.VISITOR_HASH_SALT
  const originalNodeEnv = process.env.NODE_ENV

  try {
    delete process.env.VISITOR_HASH_SALT
    process.env.NODE_ENV = 'production'
    assert.throws(() => getVisitorHashSalt(), /VISITOR_HASH_SALT is not configured/)

    process.env.NODE_ENV = 'development'
    assert.equal(getVisitorHashSalt(), 'local-development-salt')

    process.env.NODE_ENV = 'production'
    process.env.VISITOR_HASH_SALT = 'configured-salt'
    assert.equal(getVisitorHashSalt(), 'configured-salt')
  } finally {
    restoreEnv('VISITOR_HASH_SALT', originalSalt)
    restoreEnv('NODE_ENV', originalNodeEnv)
  }
})
