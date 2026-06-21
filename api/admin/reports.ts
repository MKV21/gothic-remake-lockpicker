import { listReports } from '../_lib/lockService.js'
import {
  handleApiError,
  sendJson,
  sendMethodNotAllowed,
  type ApiRequest,
  type ApiResponse,
} from '../_lib/http.js'
import { ApiError } from '../_lib/db.js'

function assertAdmin(req: ApiRequest): void {
  const token = process.env.ADMIN_TOKEN
  if (!token) throw new ApiError(503, 'ADMIN_TOKEN is not configured')
  const auth = req.headers.authorization ?? ''
  if (auth !== `Bearer ${token}`) throw new ApiError(401, 'Unauthorized')
}

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (req.method !== 'GET') {
    sendMethodNotAllowed(res, ['GET'])
    return
  }

  try {
    assertAdmin(req)
    sendJson(res, 200, { reports: await listReports() })
  } catch (error) {
    handleApiError(res, error)
  }
}
