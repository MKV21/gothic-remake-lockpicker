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
