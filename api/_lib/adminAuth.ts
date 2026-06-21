import type { ApiRequest } from './http.js'
import { ApiError } from './db.js'

export function assertAdmin(req: ApiRequest): void {
  const token = process.env.ADMIN_TOKEN
  if (!token) throw new ApiError(503, 'ADMIN_TOKEN is not configured')

  const auth = req.headers.authorization ?? ''
  if (auth !== `Bearer ${token}`) throw new ApiError(401, 'Unauthorized')
}
