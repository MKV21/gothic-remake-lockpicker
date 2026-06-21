import { voteName } from '../../_lib/lockService.js'
import { ApiError } from '../../_lib/db.js'
import { enforceRateLimit } from '../../_lib/rateLimit.js'
import {
  getQueryParam,
  getVisitorIdentity,
  handleApiError,
  readJsonBody,
  sendJson,
  sendMethodNotAllowed,
  type ApiRequest,
  type ApiResponse,
} from '../../_lib/http.js'

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (req.method !== 'POST') {
    sendMethodNotAllowed(res, ['POST'])
    return
  }

  try {
    const nameId = getQueryParam(req, 'nameId')
    if (!nameId) throw new ApiError(400, 'Missing name id')
    const identity = getVisitorIdentity(req, res)
    await enforceRateLimit({ action: 'vote-name', ...identity, limit: 200, windowHours: 24 })
    const body = await readJsonBody<{ value?: number }>(req)
    sendJson(res, 200, await voteName(nameId, Number(body.value), identity.visitorHash))
  } catch (error) {
    handleApiError(res, error)
  }
}
