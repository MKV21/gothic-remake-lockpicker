import { ApiError } from '../_lib/db.js'
import { setNameStatus } from '../_lib/lockService.js'
import {
  handleApiError,
  readJsonBody,
  sendJson,
  sendMethodNotAllowed,
  type ApiRequest,
  type ApiResponse,
} from '../_lib/http.js'

function assertAdmin(req: ApiRequest): void {
  const token = process.env.ADMIN_TOKEN
  if (!token) throw new ApiError(503, 'ADMIN_TOKEN is not configured')
  const auth = req.headers.authorization ?? ''
  if (auth !== `Bearer ${token}`) throw new ApiError(401, 'Unauthorized')
}

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (req.method !== 'POST') {
    sendMethodNotAllowed(res, ['POST'])
    return
  }

  try {
    assertAdmin(req)
    const body = await readJsonBody<{ nameId?: string; status?: 'approved' | 'pending' | 'rejected' }>(req)
    if (!body.nameId) throw new ApiError(400, 'nameId is required')
    if (body.status !== 'approved' && body.status !== 'pending' && body.status !== 'rejected') {
      throw new ApiError(400, 'status must be approved, pending, or rejected')
    }
    sendJson(res, 200, { lock: await setNameStatus(body.nameId, body.status) })
  } catch (error) {
    handleApiError(res, error)
  }
}
