import { createXetoxycImportBatch, importPayloadMaxBytes } from '../_lib/importService.js'
import { enforceRateLimit } from '../_lib/rateLimit.js'
import {
  getVisitorIdentity,
  handleApiError,
  readJsonBody,
  sendJson,
  sendMethodNotAllowed,
  type ApiRequest,
  type ApiResponse,
} from '../_lib/http.js'
import { ApiError } from '../_lib/db.js'

type ImportPayload = {
  payload?: unknown
}

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (req.method !== 'POST') {
    sendMethodNotAllowed(res, ['POST'])
    return
  }

  try {
    const identity = getVisitorIdentity(req, res)
    await enforceRateLimit({
      action: 'import-xetoxyc',
      ...identity,
      limit: 3,
      ipLimit: 15,
      windowHours: 24,
    })
    const body = await readJsonBody<ImportPayload>(req, {
      maxBytes: importPayloadMaxBytes() + 4096,
    })
    if (typeof body.payload !== 'string') {
      throw new ApiError(400, 'Import payload must be a JSON string')
    }
    sendJson(res, 201, await createXetoxycImportBatch(body.payload, identity))
  } catch (error) {
    handleApiError(res, error)
  }
}
