import { createHmac, timingSafeEqual } from 'node:crypto'
import { parseCookies, type ApiRequest } from './http.js'
import { ApiError } from './db.js'

const ADMIN_SESSION_COOKIE = 'glpd_admin'
const ADMIN_SESSION_TTL_SECONDS = 8 * 60 * 60

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

function signAdminSession(token = getAdminToken()): string {
  return createHmac('sha256', token)
    .update('gothic-lockpick-admin-session:v1')
    .digest('base64url')
}

function cookieSecureSuffix(): string {
  return process.env.NODE_ENV === 'production' ? '; Secure' : ''
}

export function createAdminSessionCookie(): string {
  return `${ADMIN_SESSION_COOKIE}=${signAdminSession()}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${ADMIN_SESSION_TTL_SECONDS}${cookieSecureSuffix()}`
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
  if (session && safeEqual(session, signAdminSession(token))) {
    const method = req.method ?? 'GET'
    const csrf = req.headers['x-admin-csrf']
    if (method !== 'GET' && csrf !== '1') throw new ApiError(403, 'Missing CSRF header')
    return
  }

  throw new ApiError(401, 'Unauthorized')
}
