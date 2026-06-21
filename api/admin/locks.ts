import { assertAdmin } from '../_lib/adminAuth.js'
import { listAdminLocks } from '../_lib/lockService.js'
import {
  handleApiError,
  sendJson,
  sendMethodNotAllowed,
  type ApiRequest,
  type ApiResponse,
} from '../_lib/http.js'

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (req.method !== 'GET') {
    sendMethodNotAllowed(res, ['GET'])
    return
  }

  try {
    assertAdmin(req)
    sendJson(res, 200, { locks: await listAdminLocks() })
  } catch (error) {
    handleApiError(res, error)
  }
}
