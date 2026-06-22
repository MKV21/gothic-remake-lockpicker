export type Direction = 'left' | 'right'

export type LinkType = 'none' | 'same' | 'opposite'

export type ReviewStatus = 'approved' | 'pending' | 'rejected'

export type ImportItemStatus = 'pending' | 'approved' | 'rejected' | 'invalid'

export type SolveMove = {
  card: number
  direction: Direction
}

export type ChestRecord = {
  name: string
  // Optional for backward compatibility: older saves had no gateCount and were
  // always 6 gates. When missing we fall back to the number of saved pins.
  gateCount?: number
  initialPins: (number | null)[]
  solutionPins: (number | null)[]
  links?: LinkType[][]
  solutionMoves?: SolveMove[]
}

export type LockNameRecord = {
  id: string
  name: string
  score: number
  status: ReviewStatus
  source?: string | null
}

export type RemoteLockRecord = {
  id: string
  gateCount: number
  initialPins: number[]
  solutionPins: number[]
  links: LinkType[][]
  solutionMoves: SolveMove[]
  fingerprint: string
  displayName: string
  reviewStatus: ReviewStatus
  names: LockNameRecord[]
  createdAt: string
  updatedAt: string
}

export type AdminLockRecord = RemoteLockRecord & {
  admin: {
    firstReportVisitorHash: string | null
    firstReportIpHash: string | null
    firstReportSource: string | null
    firstReportCreatedAt: string | null
  }
}

export type AdminImportItemRecord = {
  id: string
  batchId: string
  status: ImportItemStatus
  source: string
  storageKey: string | null
  name: string | null
  fingerprint: string | null
  gateCount: number | null
  initialPins: number[] | null
  solutionPins: number[] | null
  links: LinkType[][] | null
  solutionMoves: SolveMove[] | null
  error: string | null
  duplicateLockId: string | null
  isConflict: boolean
  approvedLockId: string | null
  visitorHash: string | null
  ipHash: string | null
  batchCreatedAt: string
  createdAt: string
  updatedAt: string
}

export type ImportSubmissionResult = {
  batchId: string
  itemCount: number
  validCount: number
  invalidCount: number
}

export type LockMatchRecord = {
  id: string
  gateCount: number
  initialPins: number[]
  displayName: string
  score: number
  reviewStatus: ReviewStatus
  names: LockNameRecord[]
}

export type UsageTopLockRecord = {
  id: string
  displayName: string
  gateCount: number
  initialPins: number[]
  reviewStatus: ReviewStatus
  loadCount: number
  loadCount7d: number
  lastLoadedAt: string | null
}

export type UsageDailyRecord = {
  day: string
  pageViews: number
  matchSearches: number
  lockLoads: number
  lockSubmissions: number
  importBatches: number
}

export type UsageStatsRecord = {
  totals: {
    pageViews: number
    uniqueVisitors: number
    matchSearches: number
    lockLoads: number
    lockSubmissions: number
    importBatches: number
    importItems: number
    pendingLocks: number
    pendingImports: number
    pendingNames: number
  }
  recent: {
    pageViews24h: number
    pageViews7d: number
    matchSearches7d: number
    lockLoads7d: number
    lockSubmissions7d: number
    importBatches7d: number
  }
  daily: UsageDailyRecord[]
  topLocks: UsageTopLockRecord[]
}
