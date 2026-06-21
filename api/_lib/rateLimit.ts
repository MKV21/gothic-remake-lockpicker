import { ApiError, query } from './db.js'

export async function enforceRateLimit(options: {
  action: string
  visitorHash: string
  ipHash: string
  limit: number
  windowHours: number
}): Promise<void> {
  const scopeKey = `${options.visitorHash}:${options.action}`
  const interval = `${options.windowHours} hours`
  const result = await query<{ count: number }>(
    `
      INSERT INTO rate_limits (scope_key, action, visitor_hash, ip_hash, window_start, count)
      VALUES ($1, $2, $3, $4, now(), 1)
      ON CONFLICT (scope_key, action)
      DO UPDATE SET
        count = CASE
          WHEN rate_limits.window_start < now() - ($5::interval) THEN 1
          ELSE rate_limits.count + 1
        END,
        window_start = CASE
          WHEN rate_limits.window_start < now() - ($5::interval) THEN now()
          ELSE rate_limits.window_start
        END,
        updated_at = now()
      RETURNING count
    `,
    [scopeKey, options.action, options.visitorHash, options.ipHash, interval],
  )

  if ((result.rows[0]?.count ?? 0) > options.limit) {
    throw new ApiError(429, 'Rate limit exceeded')
  }
}
