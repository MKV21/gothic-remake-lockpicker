import { groupInputChain, movesToInputChain } from './inputChain'
import { OUTPUT_PROFILES, type OutputProfile } from './outputProfiles'
import { type SolveMove, type SolveResult } from './solver'
import { t } from '../i18n'

export type SolutionView = OutputProfile

type MoveRun = {
  move: SolveMove
  count: number
}

function groupMoves(moves: SolveMove[]): MoveRun[] {
  const runs: MoveRun[] = []

  for (const move of moves) {
    const last = runs[runs.length - 1]
    if (last && last.move.card === move.card && last.move.direction === move.direction) {
      last.count++
    } else {
      runs.push({ move, count: 1 })
    }
  }

  return runs
}

function inputKeyClass(key: string): string {
  switch (key) {
    case 'reset':
      return 'input-key input-key--reset'
    case 'nav':
      return 'input-key input-key--nav'
    default:
      return 'input-key input-key--move'
  }
}

function renderInputChain(moves: SolveMove[], gateCount: number, profile: Exclude<OutputProfile, 'moves'>): string {
  const chain = movesToInputChain(moves, gateCount)
  const runs = groupInputChain(chain)
  const labels = OUTPUT_PROFILES[profile]
  const keys = runs
    .map((run) => {
      const spec = labels[run.key]
      const label =
        run.count > 1
          ? `${spec.label}<span class="solution-repeat">×${run.count}</span>`
          : spec.label
      return `<kbd class="${inputKeyClass(spec.className)}">${label}</kbd>`
    })
    .join('<span class="input-chain-sep" aria-hidden="true">·</span>')

  return `
    <li class="solution-input-chain">
      <div class="input-chain-keys">${keys}</div>
    </li>
  `
}

function renderMoveList(moves: SolveMove[]): string {
  const runs = groupMoves(moves)

  return runs
    .map((run, index) => {
      const direction = run.move.direction === 'left' ? 'Left (A)' : 'Right (D)'
      const label = `${t('gate')} ${run.move.card} - ${direction}`
      const repeat = run.count > 1 ? ` <span class="solution-repeat">×${run.count}</span>` : ''
      return `<li class="solution-step"><span class="solution-index">${index + 1}.</span> ${label}${repeat}</li>`
    })
    .join('')
}

export function renderSolution(
  container: HTMLElement,
  result: SolveResult,
  options: { view: SolutionView; gateCount: number },
): void {
  if (!result.ok) {
    container.innerHTML = `<li class="solution-error">${result.error}</li>`
    return
  }

  if (result.moves.length === 0) {
    container.innerHTML = `<li class="solution-empty">${t('alreadySolved')}</li>`
    return
  }

  container.innerHTML =
    options.view === 'moves'
      ? renderMoveList(result.moves)
      : renderInputChain(result.moves, options.gateCount, options.view)
}

export function solutionViewHint(view: SolutionView): string {
  if (view === 'keyboard') {
    return t('keyboardHint')
  }

  if (view !== 'moves') {
    return t('controllerHint')
  }

  return t('shortestMovesHint')
}
