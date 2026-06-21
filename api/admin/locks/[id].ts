import { assertAdmin } from '../../_lib/adminAuth.js'
import { ApiError } from '../../_lib/db.js'
import {
  deleteAdminLock,
  getLock,
  isStatusOnlyAdminLockPatch,
  setAdminLockReviewStatus,
  updateAdminLock,
} from '../../_lib/lockService.js'
import {
  getQueryParam,
  handleApiError,
  readJsonBody,
  sendJson,
  sendMethodNotAllowed,
  type ApiRequest,
  type ApiResponse,
} from '../../_lib/http.js'
import type { ChestRecord } from '../../../src/shared/lockTypes.js'
import type { ReviewStatus } from '../../../src/shared/lockTypes.js'

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'PATCH' && req.method !== 'DELETE') {
    sendMethodNotAllowed(res, ['GET', 'PATCH', 'DELETE'])
    return
  }

  try {
    assertAdmin(req)
    const id = getQueryParam(req, 'id')
    if (!id) throw new ApiError(400, 'Missing lock id')

    if (req.method === 'GET') {
      sendJson(res, 200, { lock: await getLock(id, { includeHidden: true }) })
      return
    }

    if (req.method === 'DELETE') {
      await deleteAdminLock(id)
      sendJson(res, 200, { ok: true })
      return
    }

    const body = await readJsonBody<
      Partial<ChestRecord> & { reviewStatus?: ReviewStatus }
    >(req)
    if (isStatusOnlyAdminLockPatch(body)) {
      sendJson(res, 200, { lock: await setAdminLockReviewStatus(id, body.reviewStatus) })
      return
    }

    sendJson(res, 200, { lock: await updateAdminLock(id, body) })
  } catch (error) {
    handleApiError(res, error)
  }
}
