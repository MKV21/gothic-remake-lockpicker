import { safeTrackRequestUsageEvent } from '../_lib/analyticsService.js'
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
    if (getQueryParam(req, 'event') === 'page-view') {
      await safeTrackRequestUsageEvent('page_view', req, res)
      sendJson(res, 200, { ok: true })
      return
    }

    const gateCount = getQueryParam(req, 'gateCount')
    const pins = getQueryParam(req, 'pins')
    const matches = await findMatches(gateCount, pins)
    const pinCount = pins ? pins.split(',').filter(Boolean).length : 0
    if (pinCount >= 3) {
      await safeTrackRequestUsageEvent('match_search', req, res, {
        metadata: {
          gateCount: Number(gateCount),
          pinCount,
          matchCount: matches.length,
        },
      })
    }
    sendJson(res, 200, { matches })
  } catch (error) {
    handleApiError(res, error)
  }
}
