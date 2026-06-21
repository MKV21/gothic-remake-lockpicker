import { findMatches } from '../_lib/lockService.js'
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
    const matches = await findMatches(getQueryParam(req, 'gateCount'), getQueryParam(req, 'pins'))
    sendJson(res, 200, { matches })
  } catch (error) {
    handleApiError(res, error)
  }
}
