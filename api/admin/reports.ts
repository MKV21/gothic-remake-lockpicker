import { assertAdmin } from '../_lib/adminAuth.js'
import { listAdminUsageStats } from '../_lib/analyticsService.js'
import { listReports } from '../_lib/lockService.js'
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
    const [reports, stats] = await Promise.all([listReports(), listAdminUsageStats()])
    sendJson(res, 200, { reports, stats })
  } catch (error) {
    handleApiError(res, error)
  }
}
