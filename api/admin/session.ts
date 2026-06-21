import {
  clearAdminSessionCookie,
  createAdminSessionCookie,
  verifyAdminPassword,
} from '../_lib/adminAuth.js'
import { ApiError } from '../_lib/db.js'
import { enforceRateLimit } from '../_lib/rateLimit.js'
import {
  appendSetCookie,
  getVisitorIdentity,
  handleApiError,
  readJsonBody,
  sendJson,
  sendMethodNotAllowed,
  type ApiRequest,
  type ApiResponse,
} from '../_lib/http.js'

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (req.method !== 'POST' && req.method !== 'DELETE') {
    sendMethodNotAllowed(res, ['POST', 'DELETE'])
    return
  }

  try {
    if (req.method === 'DELETE') {
      appendSetCookie(res, clearAdminSessionCookie())
      sendJson(res, 200, { ok: true })
      return
    }

    const identity = getVisitorIdentity(req, res)
    await enforceRateLimit({
      action: 'admin-login',
      ...identity,
      limit: 10,
      ipLimit: 50,
      windowHours: 1,
    })

    const body = await readJsonBody<{ password?: string }>(req)
    if (!verifyAdminPassword(body.password ?? '')) throw new ApiError(401, 'Unauthorized')

    appendSetCookie(res, createAdminSessionCookie())
    sendJson(res, 200, { ok: true })
  } catch (error) {
    handleApiError(res, error)
  }
}
