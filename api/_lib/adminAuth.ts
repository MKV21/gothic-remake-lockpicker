import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { parseCookies, type ApiRequest } from './http.js'
import { ApiError } from './db.js'

const ADMIN_SESSION_COOKIE = 'glpd_admin'
const ADMIN_SESSION_TTL_SECONDS = 8 * 60 * 60
const ADMIN_SESSION_TTL_MS = ADMIN_SESSION_TTL_SECONDS * 1000

type AdminSessionPayload = {
  v: 1
  exp: number
  nonce: string
}

function getAdminToken(): string {
  const token = process.env.ADMIN_TOKEN
  if (!token) throw new ApiError(503, 'ADMIN_TOKEN is not configured')
  return token
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.byteLength === right.byteLength && timingSafeEqual(left, right)
}

function signAdminSessionPayload(payload: string, token = getAdminToken()): string {
  return createHmac('sha256', token)
    .update(payload)
    .digest('base64url')
}

function encodeAdminSessionPayload(payload: AdminSessionPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
}

function parseAdminSessionPayload(value: string): AdminSessionPayload | undefined {
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<AdminSessionPayload>
    if (decoded.v !== 1) return undefined
    if (!Number.isFinite(decoded.exp)) return undefined
    if (typeof decoded.nonce !== 'string' || decoded.nonce.length === 0) return undefined
    return decoded as AdminSessionPayload
  } catch {
    return undefined
  }
}

export function createAdminSessionValue(options: {
  now?: number
  nonce?: string
  token?: string
} = {}): string {
  const payload = encodeAdminSessionPayload({
    v: 1,
    exp: (options.now ?? Date.now()) + ADMIN_SESSION_TTL_MS,
    nonce: options.nonce ?? randomUUID(),
  })
  return `${payload}.${signAdminSessionPayload(payload, options.token ?? getAdminToken())}`
}

export function verifyAdminSessionValue(
  session: string,
  token = getAdminToken(),
  now = Date.now(),
): boolean {
  const parts = session.split('.')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return false

  const [payload, signature] = parts
  if (!safeEqual(signature, signAdminSessionPayload(payload, token))) return false

  const decoded = parseAdminSessionPayload(payload)
  if (!decoded) return false
  return decoded.exp > now
}

function cookieSecureSuffix(): string {
  return process.env.NODE_ENV === 'production' ? '; Secure' : ''
}

export function createAdminSessionCookie(): string {
  return `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(createAdminSessionValue())}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${ADMIN_SESSION_TTL_SECONDS}${cookieSecureSuffix()}`
}

export function clearAdminSessionCookie(): string {
  return `${ADMIN_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${cookieSecureSuffix()}`
}

export function verifyAdminPassword(password: string): boolean {
  return safeEqual(password, getAdminToken())
}

export function assertAdmin(req: ApiRequest): void {
  const token = getAdminToken()

  const auth = req.headers.authorization ?? ''
  if (auth.startsWith('Bearer ') && safeEqual(auth.slice('Bearer '.length), token)) return

  const session = parseCookies(req)[ADMIN_SESSION_COOKIE]
  if (session && verifyAdminSessionValue(session, token)) {
    const method = req.method ?? 'GET'
    const csrf = req.headers['x-admin-csrf']
    if (method !== 'GET' && csrf !== '1') throw new ApiError(403, 'Missing CSRF header')
    return
  }

  throw new ApiError(401, 'Unauthorized')
}
