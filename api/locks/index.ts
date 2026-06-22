import { createOrReportLock } from '../_lib/lockService.js'
import { enforceRateLimit } from '../_lib/rateLimit.js'
import { notifyPendingLockSubmission } from '../_lib/telegram.js'
import {
  getVisitorIdentity,
  handleApiError,
  readJsonBody,
  sendJson,
  sendMethodNotAllowed,
  type ApiRequest,
  type ApiResponse,
} from '../_lib/http.js'
import type { ChestRecord } from '../../src/shared/lockTypes.js'

type SubmitLockPayload = ChestRecord & {
  submissionKind?: 'manual' | 'auto-solve'
}

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (req.method !== 'POST') {
    sendMethodNotAllowed(res, ['POST'])
    return
  }

  try {
    const identity = getVisitorIdentity(req, res)
    await enforceRateLimit({ action: 'submit-lock', ...identity, limit: 30, windowHours: 24 })
    const payload = await readJsonBody<SubmitLockPayload>(req)
    const result = await createOrReportLock(payload, {
      ...identity,
      source: payload.submissionKind === 'auto-solve' ? 'auto-solve' : 'manual',
    })
    await notifyPendingLockSubmission({ payload, result })
    sendJson(res, result.duplicate ? 200 : 201, result)
  } catch (error) {
    handleApiError(res, error)
  }
}
