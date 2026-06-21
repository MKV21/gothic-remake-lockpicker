import { ApiError, query } from './db.js'

export async function enforceRateLimit(options: {
  action: string
  visitorHash: string
  ipHash: string
  limit: number
  ipLimit?: number
  windowHours: number
}): Promise<void> {
  await enforceRateLimitBucket({
    ...options,
    limit: options.limit,
    scopeKey: `visitor:${options.visitorHash}:${options.action}`,
  })

  await enforceRateLimitBucket({
    ...options,
    visitorHash: '',
    limit: options.ipLimit ?? Math.max(options.limit * 5, options.limit),
    scopeKey: `ip:${options.ipHash}:${options.action}`,
  })
}

async function enforceRateLimitBucket(options: {
  action: string
  visitorHash: string
  ipHash: string
  limit: number
  scopeKey: string
  windowHours: number
}): Promise<void> {
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
    [options.scopeKey, options.action, options.visitorHash || null, options.ipHash, interval],
  )

  if ((result.rows[0]?.count ?? 0) > options.limit) {
    throw new ApiError(429, 'Rate limit exceeded')
  }
}
