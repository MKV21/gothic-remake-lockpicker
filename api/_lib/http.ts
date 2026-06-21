import { createHash, randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { ApiError } from './db.js'

export type ApiRequest = IncomingMessage & {
  body?: unknown
  query?: Record<string, string | string[]>
}

export type ApiResponse = ServerResponse

const VISITOR_COOKIE = 'glpd_visitor'
const MAX_JSON_BODY_BYTES = 64 * 1024

export function appendSetCookie(res: ApiResponse, cookie: string): void {
  const existing = res.getHeader('Set-Cookie')
  if (Array.isArray(existing)) {
    res.setHeader('Set-Cookie', [...existing, cookie])
    return
  }
  if (typeof existing === 'string') {
    res.setHeader('Set-Cookie', [existing, cookie])
    return
  }
  res.setHeader('Set-Cookie', cookie)
}

export function sendJson(
  res: ApiResponse,
  statusCode: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  for (const [key, value] of Object.entries(headers)) res.setHeader(key, value)
  res.end(JSON.stringify(body))
}

export function sendMethodNotAllowed(res: ApiResponse, methods: string[]): void {
  sendJson(res, 405, { error: 'Method not allowed' }, { Allow: methods.join(', ') })
}

export function handleApiError(res: ApiResponse, error: unknown): void {
  if (error instanceof ApiError) {
    sendJson(res, error.statusCode, { error: error.message })
    return
  }

  console.error(error)
  sendJson(res, 500, { error: 'Internal server error' })
}

export async function readJsonBody<T>(req: ApiRequest): Promise<T> {
  if (req.body !== undefined) return req.body as T

  const chunks: Buffer[] = []
  let byteLength = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    byteLength += buffer.byteLength
    if (byteLength > MAX_JSON_BODY_BYTES) {
      throw new ApiError(413, 'Request body too large')
    }
    chunks.push(buffer)
  }

  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw) return {} as T

  try {
    return JSON.parse(raw) as T
  } catch {
    throw new ApiError(400, 'Invalid JSON body')
  }
}

export function getQueryParam(req: ApiRequest, name: string): string | undefined {
  const queryValue = req.query?.[name]
  if (Array.isArray(queryValue)) return queryValue[0]
  if (queryValue) return queryValue

  const url = new URL(req.url ?? '/', 'http://localhost')
  return url.searchParams.get(name) ?? undefined
}

export function parseCookies(req: ApiRequest): Record<string, string> {
  const header = req.headers.cookie
  if (!header) return {}

  return Object.fromEntries(
    header.split(';').map((cookie) => {
      const [key, ...valueParts] = cookie.trim().split('=')
      return [key, decodeURIComponent(valueParts.join('='))]
    }),
  )
}

function hashValue(value: string): string {
  const salt = process.env.VISITOR_HASH_SALT ?? 'local-development-salt'
  return createHash('sha256').update(`${salt}:${value}`).digest('hex')
}

export type VisitorIdentity = {
  visitorHash: string
  ipHash: string
}

export function getVisitorIdentity(req: ApiRequest, res: ApiResponse): VisitorIdentity {
  const cookies = parseCookies(req)
  const visitorId = cookies[VISITOR_COOKIE] || randomUUID()
  const forwardedFor = req.headers['x-forwarded-for']
  const ip = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor?.split(',')[0]

  if (!cookies[VISITOR_COOKIE]) {
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
    appendSetCookie(
      res,
      `${VISITOR_COOKIE}=${encodeURIComponent(visitorId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${secure}`,
    )
  }

  return {
    visitorHash: hashValue(visitorId),
    ipHash: hashValue(ip ?? 'unknown'),
  }
}
