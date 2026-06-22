import { assertAdmin } from '../_lib/adminAuth.js'
import { listAdminImportItems } from '../_lib/importService.js'
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
    sendJson(res, 200, { imports: await listAdminImportItems() })
  } catch (error) {
    handleApiError(res, error)
  }
}
