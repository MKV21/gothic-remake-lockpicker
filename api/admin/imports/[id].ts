import { assertAdmin } from '../../_lib/adminAuth.js'
import { ApiError } from '../../_lib/db.js'
import { approveAdminImportItem, rejectAdminImportItem } from '../../_lib/importService.js'
import {
  getQueryParam,
  handleApiError,
  readJsonBody,
  sendJson,
  sendMethodNotAllowed,
  type ApiRequest,
  type ApiResponse,
} from '../../_lib/http.js'

type ImportPatch = {
  status?: unknown
}

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (req.method !== 'PATCH') {
    sendMethodNotAllowed(res, ['PATCH'])
    return
  }

  try {
    assertAdmin(req)
    const id = getQueryParam(req, 'id')
    if (!id) throw new ApiError(400, 'Missing import item id')

    const body = await readJsonBody<ImportPatch>(req)
    if (body.status === 'approved') {
      sendJson(res, 200, { item: await approveAdminImportItem(id) })
      return
    }
    if (body.status === 'rejected') {
      sendJson(res, 200, { item: await rejectAdminImportItem(id) })
      return
    }

    throw new ApiError(400, 'status must be approved or rejected')
  } catch (error) {
    handleApiError(res, error)
  }
}
