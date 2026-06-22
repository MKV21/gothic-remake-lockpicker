import type {
  ReviewStatus,
  UsageDailyRecord,
  UsageStatsRecord,
  UsageTopLockRecord,
} from '../../src/shared/lockTypes.js'
import { ApiError, query } from './db.js'
import {
  getVisitorIdentity,
  type ApiRequest,
  type ApiResponse,
  type VisitorIdentity,
} from './http.js'

export type UsageEventType = 'page_view' | 'match_search' | 'lock_load'

type UsageEventOptions = {
  lockId?: string | null
  metadata?: Record<string, unknown>
}

type UsageTotalsRow = {
  page_views: number
  unique_visitors: number
  match_searches: number
  lock_loads: number
  page_views_24h: number
  page_views_7d: number
  match_searches_7d: number
  lock_loads_7d: number
}

type ContentTotalsRow = {
  lock_submissions: number
  lock_submissions_7d: number
  import_batches: number
  import_items: number
  import_batches_7d: number
  pending_locks: number
  pending_imports: number
  pending_names: number
}

type TopLockRow = {
  id: string
  display_name: string
  gate_count: number
  initial_pins: unknown
  review_status: ReviewStatus
  load_count: number
  load_count_7d: number
  last_loaded_at: string | Date | null
}

type DailyUsageRow = {
  day: string | Date
  page_views: number
  match_searches: number
  lock_loads: number
  lock_submissions: number
  import_batches: number
}

function jsonValue<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback
  if (typeof value === 'string') return JSON.parse(value) as T
  return value as T
}

function numberValue(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string') return Number(value)
  return 0
}

function timestampValue(value: string | Date | null): string | null {
  if (!value) return null
  return value instanceof Date ? value.toISOString() : value
}

function dayValue(value: string | Date): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return value.slice(0, 10)
}

function isMissingAnalyticsTable(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === '42P01')
}

function isExpectedDisabledAnalytics(error: unknown): boolean {
  return error instanceof ApiError && error.statusCode === 503
}

function warnAnalyticsFailure(error: unknown): void {
  console.warn(error instanceof Error ? `Usage analytics failed: ${error.message}` : 'Usage analytics failed')
}

function emptyStats(): UsageStatsRecord {
  return {
    totals: {
      pageViews: 0,
      uniqueVisitors: 0,
      matchSearches: 0,
      lockLoads: 0,
      lockSubmissions: 0,
      importBatches: 0,
      importItems: 0,
      pendingLocks: 0,
      pendingImports: 0,
      pendingNames: 0,
    },
    recent: {
      pageViews24h: 0,
      pageViews7d: 0,
      matchSearches7d: 0,
      lockLoads7d: 0,
      lockSubmissions7d: 0,
      importBatches7d: 0,
    },
    daily: [],
    topLocks: [],
  }
}

function rowToTopLock(row: TopLockRow): UsageTopLockRecord {
  return {
    id: row.id,
    displayName: row.display_name,
    gateCount: row.gate_count,
    initialPins: jsonValue<number[]>(row.initial_pins, []),
    reviewStatus: row.review_status,
    loadCount: numberValue(row.load_count),
    loadCount7d: numberValue(row.load_count_7d),
    lastLoadedAt: timestampValue(row.last_loaded_at),
  }
}

function rowToDailyUsage(row: DailyUsageRow): UsageDailyRecord {
  return {
    day: dayValue(row.day),
    pageViews: numberValue(row.page_views),
    matchSearches: numberValue(row.match_searches),
    lockLoads: numberValue(row.lock_loads),
    lockSubmissions: numberValue(row.lock_submissions),
    importBatches: numberValue(row.import_batches),
  }
}

export async function safeTrackUsageEvent(
  eventType: UsageEventType,
  identity: VisitorIdentity,
  options: UsageEventOptions = {},
): Promise<void> {
  try {
    await query(
      `
        INSERT INTO usage_events (event_type, lock_id, visitor_hash, ip_hash, metadata)
        VALUES ($1, $2, $3, $4, $5::jsonb)
      `,
      [
        eventType,
        options.lockId ?? null,
        identity.visitorHash,
        identity.ipHash,
        JSON.stringify(options.metadata ?? {}),
      ],
    )
  } catch (error) {
    if (isExpectedDisabledAnalytics(error)) return
    if (isMissingAnalyticsTable(error)) return
    warnAnalyticsFailure(error)
  }
}

export async function safeTrackRequestUsageEvent(
  eventType: UsageEventType,
  req: ApiRequest,
  res: ApiResponse,
  options: UsageEventOptions = {},
): Promise<void> {
  try {
    await safeTrackUsageEvent(eventType, getVisitorIdentity(req, res), options)
  } catch (error) {
    if (isExpectedDisabledAnalytics(error)) return
    warnAnalyticsFailure(error)
  }
}

export async function listAdminUsageStats(): Promise<UsageStatsRecord> {
  try {
    const [usageResult, contentResult, topLocksResult, dailyResult] = await Promise.all([
      query<UsageTotalsRow>(
        `
          SELECT
            (COUNT(*) FILTER (WHERE event_type = 'page_view'))::integer AS page_views,
            (COUNT(DISTINCT visitor_hash) FILTER (WHERE event_type = 'page_view' AND visitor_hash IS NOT NULL))::integer AS unique_visitors,
            (COUNT(*) FILTER (WHERE event_type = 'match_search'))::integer AS match_searches,
            (COUNT(*) FILTER (WHERE event_type = 'lock_load'))::integer AS lock_loads,
            (COUNT(*) FILTER (WHERE event_type = 'page_view' AND created_at >= now() - interval '24 hours'))::integer AS page_views_24h,
            (COUNT(*) FILTER (WHERE event_type = 'page_view' AND created_at >= now() - interval '7 days'))::integer AS page_views_7d,
            (COUNT(*) FILTER (WHERE event_type = 'match_search' AND created_at >= now() - interval '7 days'))::integer AS match_searches_7d,
            (COUNT(*) FILTER (WHERE event_type = 'lock_load' AND created_at >= now() - interval '7 days'))::integer AS lock_loads_7d
          FROM usage_events
        `,
      ),
      query<ContentTotalsRow>(
        `
          SELECT
            (SELECT COUNT(*)::integer FROM lock_reports) AS lock_submissions,
            (SELECT COUNT(*)::integer FROM lock_reports WHERE created_at >= now() - interval '7 days') AS lock_submissions_7d,
            (SELECT COUNT(*)::integer FROM import_batches) AS import_batches,
            (SELECT COALESCE(SUM(item_count), 0)::integer FROM import_batches) AS import_items,
            (SELECT COUNT(*)::integer FROM import_batches WHERE created_at >= now() - interval '7 days') AS import_batches_7d,
            (SELECT COUNT(*)::integer FROM locks WHERE review_status = 'pending') AS pending_locks,
            (SELECT COUNT(*)::integer FROM import_items WHERE status = 'pending') AS pending_imports,
            (SELECT COUNT(*)::integer FROM lock_names WHERE status = 'pending') AS pending_names
        `,
      ),
      query<TopLockRow>(
        `
          SELECT
            l.id,
            COALESCE(name_choice.name, 'Lock ' || l.fingerprint) AS display_name,
            l.gate_count,
            l.initial_pins,
            l.review_status,
            COUNT(e.id)::integer AS load_count,
            (COUNT(e.id) FILTER (WHERE e.created_at >= now() - interval '7 days'))::integer AS load_count_7d,
            MAX(e.created_at) AS last_loaded_at
          FROM locks l
          LEFT JOIN usage_events e ON e.lock_id = l.id AND e.event_type = 'lock_load'
          LEFT JOIN LATERAL (
            SELECT name
            FROM lock_names n
            WHERE n.lock_id = l.id
              AND n.status <> 'rejected'
            ORDER BY
              CASE n.status WHEN 'approved' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
              n.score DESC,
              n.created_at ASC
            LIMIT 1
          ) name_choice ON true
          GROUP BY l.id, name_choice.name
          ORDER BY load_count DESC, last_loaded_at DESC NULLS LAST, display_name ASC
          LIMIT 250
        `,
      ),
      query<DailyUsageRow>(
        `
          WITH days AS (
            SELECT generate_series(current_date - interval '13 days', current_date, interval '1 day')::date AS day
          ),
          usage_counts AS (
            SELECT
              created_at::date AS day,
              (COUNT(*) FILTER (WHERE event_type = 'page_view'))::integer AS page_views,
              (COUNT(*) FILTER (WHERE event_type = 'match_search'))::integer AS match_searches,
              (COUNT(*) FILTER (WHERE event_type = 'lock_load'))::integer AS lock_loads
            FROM usage_events
            WHERE created_at >= current_date - interval '13 days'
            GROUP BY created_at::date
          ),
          report_counts AS (
            SELECT created_at::date AS day, COUNT(*)::integer AS lock_submissions
            FROM lock_reports
            WHERE created_at >= current_date - interval '13 days'
            GROUP BY created_at::date
          ),
          import_counts AS (
            SELECT created_at::date AS day, COUNT(*)::integer AS import_batches
            FROM import_batches
            WHERE created_at >= current_date - interval '13 days'
            GROUP BY created_at::date
          )
          SELECT
            days.day,
            COALESCE(usage_counts.page_views, 0)::integer AS page_views,
            COALESCE(usage_counts.match_searches, 0)::integer AS match_searches,
            COALESCE(usage_counts.lock_loads, 0)::integer AS lock_loads,
            COALESCE(report_counts.lock_submissions, 0)::integer AS lock_submissions,
            COALESCE(import_counts.import_batches, 0)::integer AS import_batches
          FROM days
          LEFT JOIN usage_counts ON usage_counts.day = days.day
          LEFT JOIN report_counts ON report_counts.day = days.day
          LEFT JOIN import_counts ON import_counts.day = days.day
          ORDER BY days.day DESC
        `,
      ),
    ])

    const usage = usageResult.rows[0] ?? {
      page_views: 0,
      unique_visitors: 0,
      match_searches: 0,
      lock_loads: 0,
      page_views_24h: 0,
      page_views_7d: 0,
      match_searches_7d: 0,
      lock_loads_7d: 0,
    }
    const content = contentResult.rows[0] ?? {
      lock_submissions: 0,
      lock_submissions_7d: 0,
      import_batches: 0,
      import_items: 0,
      import_batches_7d: 0,
      pending_locks: 0,
      pending_imports: 0,
      pending_names: 0,
    }

    return {
      totals: {
        pageViews: numberValue(usage.page_views),
        uniqueVisitors: numberValue(usage.unique_visitors),
        matchSearches: numberValue(usage.match_searches),
        lockLoads: numberValue(usage.lock_loads),
        lockSubmissions: numberValue(content.lock_submissions),
        importBatches: numberValue(content.import_batches),
        importItems: numberValue(content.import_items),
        pendingLocks: numberValue(content.pending_locks),
        pendingImports: numberValue(content.pending_imports),
        pendingNames: numberValue(content.pending_names),
      },
      recent: {
        pageViews24h: numberValue(usage.page_views_24h),
        pageViews7d: numberValue(usage.page_views_7d),
        matchSearches7d: numberValue(usage.match_searches_7d),
        lockLoads7d: numberValue(usage.lock_loads_7d),
        lockSubmissions7d: numberValue(content.lock_submissions_7d),
        importBatches7d: numberValue(content.import_batches_7d),
      },
      daily: dailyResult.rows.map(rowToDailyUsage),
      topLocks: topLocksResult.rows.map(rowToTopLock),
    }
  } catch (error) {
    if (isMissingAnalyticsTable(error)) return emptyStats()
    throw error
  }
}
