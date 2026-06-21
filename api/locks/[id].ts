import { getLock } from '../_lib/lockService.js'
import { ApiError } from '../_lib/db.js'
import {
  getQueryParam,
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
    const id = getQueryParam(req, 'id')
    if (!id) throw new ApiError(400, 'Missing lock id')
    sendJson(res, 200, { lock: await getLock(id) })
  } catch (error) {
    handleApiError(res, error)
  }
}
