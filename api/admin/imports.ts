import { assertAdmin } from '../_lib/adminAuth.js'
import { ApiError } from '../_lib/db.js'
import {
  approveAdminImportItem,
  listAdminImportItems,
  rejectAdminImportItem,
} from '../_lib/importService.js'
import {
  handleApiError,
  readJsonBody,
  sendJson,
  sendMethodNotAllowed,
  type ApiRequest,
  type ApiResponse,
} from '../_lib/http.js'

type ImportPatch = {
  id?: unknown
  status?: unknown
}

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'PATCH') {
    sendMethodNotAllowed(res, ['GET', 'PATCH'])
    return
  }

  try {
    assertAdmin(req)

    if (req.method === 'GET') {
      sendJson(res, 200, { imports: await listAdminImportItems() })
      return
    }

    const body = await readJsonBody<ImportPatch>(req)
    if (typeof body.id !== 'string' || !body.id) {
      throw new ApiError(400, 'Missing import item id')
    }
    if (body.status === 'approved') {
      sendJson(res, 200, { item: await approveAdminImportItem(body.id) })
      return
    }
    if (body.status === 'rejected') {
      sendJson(res, 200, { item: await rejectAdminImportItem(body.id) })
      return
    }

    throw new ApiError(400, 'status must be approved or rejected')
  } catch (error) {
    handleApiError(res, error)
  }
}
