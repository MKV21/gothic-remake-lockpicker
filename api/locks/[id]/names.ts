import { suggestName } from '../../_lib/lockService'
import { ApiError } from '../../_lib/db'
import { enforceRateLimit } from '../../_lib/rateLimit'
import {
  getQueryParam,
  getVisitorIdentity,
  handleApiError,
  readJsonBody,
  sendJson,
  sendMethodNotAllowed,
  type ApiRequest,
  type ApiResponse,
} from '../../_lib/http'

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (req.method !== 'POST') {
    sendMethodNotAllowed(res, ['POST'])
    return
  }

  try {
    const id = getQueryParam(req, 'id')
    if (!id) throw new ApiError(400, 'Missing lock id')
    const identity = getVisitorIdentity(req, res)
    await enforceRateLimit({ action: 'suggest-name', ...identity, limit: 60, windowHours: 24 })
    const body = await readJsonBody<{ name?: string }>(req)
    const lock = await suggestName(id, body.name ?? '', identity)
    sendJson(res, 201, { lock })
  } catch (error) {
    handleApiError(res, error)
  }
}
