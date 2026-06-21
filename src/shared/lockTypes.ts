export type Direction = 'left' | 'right'

export type LinkType = 'none' | 'same' | 'opposite'

export type ReviewStatus = 'approved' | 'pending' | 'rejected'

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
