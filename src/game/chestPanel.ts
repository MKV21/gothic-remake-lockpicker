import {
  applyChestToGameState,
  gameStateToChest,
  type ChestRecord,
} from './chest'
import {
  getRemoteLock,
  submitLock,
  submitXetoxycImport,
  suggestRemoteName,
  voteRemoteName,
} from './remote'
import { t } from '../i18n'
import type { SolveMove } from './solver'
import type { GameState } from './types'
import type { LockMatchRecord, RemoteLockRecord } from '../shared/lockTypes'
import { chestFromRemoteLock, countSetLinks } from '../shared/lockValidation'

type ChestPanelOptions = {
  state: GameState
  onLoad: (chest?: ChestRecord) => void
  getSolutionMoves?: () => SolveMove[] | undefined
}

export type ChestPanelController = {
  renderRemoteMatches: (matches: LockMatchRecord[], message?: string) => void
  clearRemoteMatches: (message?: string) => void
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function setStatus(container: HTMLElement, message: string, isError = false): void {
  const status = container.querySelector<HTMLElement>('.chest-status')
  if (!status) return
  status.textContent = message
  status.classList.toggle('chest-status--error', isError)
}

function setRemoteStatus(container: HTMLElement, message: string, isError = false): void {
  const status = container.querySelector<HTMLElement>('.remote-status')
  if (!status) return
  status.textContent = message
  status.classList.toggle('remote-status--error', isError)
}

function setImportStatus(container: HTMLElement, message: string, isError = false): void {
  const status = container.querySelector<HTMLElement>('.import-status')
  if (!status) return
  status.textContent = message
  status.classList.toggle('chest-status--error', isError)
}

export function getChestName(container: HTMLElement): string {
  return container.querySelector<HTMLInputElement>('#chest-name')?.value.trim() ?? ''
}

function setChestName(container: HTMLElement, name: string): void {
  const nameInput = container.querySelector<HTMLInputElement>('#chest-name')
  if (nameInput) nameInput.value = name
}

export function clearChestName(container: HTMLElement): void {
  setChestName(container, '')
}

export async function submitSolvedChestFromPanel(
  container: HTMLElement,
  state: GameState,
  solutionMoves: SolveMove[],
): Promise<void> {
  const name = getChestName(container)
  const chest = gameStateToChest(name, state, solutionMoves)
  if (countSetLinks(chest.links, chest.gateCount) === 0) {
    setStatus(container, t('autoSubmitSkippedNoLinks'))
    return
  }

  try {
    const result = await submitLock(chest, {
      submissionKind: 'auto-solve',
    })
    if (result.skipped) {
      setStatus(container, t('autoSubmitSkippedNoLinks'))
      return
    }
    setStatus(
      container,
      result.duplicate
        ? `${t('submittedToDatabase')}: ${t('nameHiddenUntilReveal')}`
        : `${t('submittedToDatabase')}: ${t('nameHiddenUntilReveal')}`,
    )
  } catch (error) {
    setStatus(container, error instanceof Error ? error.message : t('failedSubmit'), true)
  }
}

function renderEyeButton(lockId: string): string {
  return `
    <button type="button" class="eye-button reveal-name" data-lock-id="${lockId}" title="${t('revealName')}" aria-label="${t('revealName')}">
      <span class="eye-icon" aria-hidden="true"></span>
    </button>
  `
}

function renderNameList(container: HTMLElement, lock: RemoteLockRecord, revealed: boolean): void {
  const list = container.querySelector<HTMLUListElement>('#remote-name-list')
  if (!list) return

  if (!revealed) {
    list.innerHTML = `<li class="chest-empty">${t('showNamesToSuggest')}</li>`
    return
  }

  if (lock.names.length === 0) {
    list.innerHTML = `<li class="chest-empty">${t('noNamesProposed')}</li>`
    return
  }

  list.innerHTML = lock.names
    .map(
      (name) => `
      <li class="remote-name-item">
        <span class="remote-name-text">${escapeHtml(name.name)}</span>
        <span class="remote-name-meta">${name.score} ${t('votes')} · ${name.status}</span>
        <div class="remote-name-actions">
          <button type="button" class="chest-btn remote-vote" data-name-id="${name.id}" data-vote="1">+</button>
          <button type="button" class="chest-btn remote-vote" data-name-id="${name.id}" data-vote="-1">-</button>
        </div>
      </li>
    `,
    )
    .join('')
}

function renderRemoteMatchItem(match: LockMatchRecord, revealed: boolean): string {
  const title = revealed ? match.displayName : t('hiddenName')
  const nameScores = match.names
    .filter((name) => name.status !== 'rejected')
    .map((name) => name.score)
  const nameScoreLabel = nameScores.length === 0 ? '-' : String(Math.max(...nameScores))

  return `
    <li class="remote-match-item">
      <div class="remote-match-main">
        <div class="remote-lock-title">
          <strong>${escapeHtml(title)}</strong>
          ${revealed ? '' : renderEyeButton(match.id)}
        </div>
        <span>${match.gateCount} ${t('gates')} · ${t('pins')} ${match.initialPins.join(', ')} · ${t('matchedPins')} ${match.score} · ${t('nameVotes')} ${nameScoreLabel}</span>
      </div>
      <button type="button" class="chest-btn remote-load" data-id="${match.id}">${t('load')}</button>
    </li>
  `
}

function renderRemoteLockDetails(
  container: HTMLElement,
  lock: RemoteLockRecord | undefined,
  revealedLockIds: Set<string>,
  updateLock: (lock: RemoteLockRecord) => void,
): void {
  const details = container.querySelector<HTMLElement>('#remote-lock-details')
  if (!details) return

  if (!lock) {
    details.innerHTML = ''
    return
  }
  const revealed = revealedLockIds.has(lock.id)
  const title = revealed ? lock.displayName : t('hiddenName')

  details.innerHTML = `
    <div class="remote-lock-detail">
      <div class="remote-lock-detail-header">
        <div class="remote-lock-title">
          <strong>${escapeHtml(title)}</strong>
          ${revealed ? '' : renderEyeButton(lock.id)}
        </div>
        <span>${lock.gateCount} ${t('gates')} · ${escapeHtml(lock.reviewStatus)}</span>
      </div>
      <ul id="remote-name-list" class="remote-name-list"></ul>
      ${
        revealed
          ? `<form id="remote-name-form" class="remote-name-form">
              <input id="remote-name-input" type="text" placeholder="${t('suggestBetterName')}" />
              <button type="submit" class="chest-btn">${t('suggest')}</button>
            </form>`
          : ''
      }
    </div>
  `

  renderNameList(container, lock, revealed)

  details.querySelector<HTMLButtonElement>('.reveal-name')?.addEventListener('click', () => {
    revealedLockIds.add(lock.id)
    renderRemoteLockDetails(container, lock, revealedLockIds, updateLock)
  })

  details.querySelectorAll<HTMLButtonElement>('.remote-vote').forEach((button) => {
    button.addEventListener('click', async () => {
      const nameId = button.dataset.nameId
      const value = Number(button.dataset.vote) === -1 ? -1 : 1
      if (!nameId) return

      try {
        const updated = await voteRemoteName(nameId, value)
        if (updated.hidden) {
          renderRemoteLockDetails(container, undefined, revealedLockIds, updateLock)
          setRemoteStatus(container, t('lockHiddenAfterVote'))
          return
        }
        if (!updated.lock) throw new Error(t('failedVote'))
        updateLock(updated.lock)
        setRemoteStatus(container, t('voteSaved'))
      } catch (error) {
        setRemoteStatus(
          container,
          error instanceof Error ? error.message : t('failedVote'),
          true,
        )
      }
    })
  })

  details.querySelector<HTMLFormElement>('#remote-name-form')?.addEventListener('submit', async (event) => {
    event.preventDefault()
    const input = details.querySelector<HTMLInputElement>('#remote-name-input')
    const name = input?.value.trim() ?? ''
    if (!name) {
      setRemoteStatus(container, t('enterNameSuggestion'), true)
      return
    }

    try {
      const updated = await suggestRemoteName(lock.id, name)
      updateLock(updated)
      setRemoteStatus(container, t('nameSuggestionSaved'))
      if (input) input.value = ''
    } catch (error) {
      setRemoteStatus(
        container,
        error instanceof Error ? error.message : t('failedNameSuggestion'),
        true,
      )
    }
  })
}

export function mountChestPanel(container: HTMLElement, options: ChestPanelOptions): ChestPanelController {
  const { state, onLoad, getSolutionMoves } = options
  let activeRemoteLock: RemoteLockRecord | undefined
  const revealedLockIds = new Set<string>()

  container.innerHTML = `
    <section class="chest-panel">
      <h2>${t('chests')}</h2>
      <p class="panel-hint">${t('databaseContributionHint')}</p>
      <label class="chest-field">
        <span>${t('name')}</span>
        <input id="chest-name" type="text" placeholder="${t('chestNamePlaceholder')}" />
      </label>
      <div class="chest-actions">
        <button type="button" id="chest-submit" class="chest-save chest-save--remote">${t('submitToDatabase')}</button>
      </div>
      <p class="chest-status" aria-live="polite"></p>
      <section class="remote-panel" aria-label="${t('databaseMatches')}">
        <h3>${t('databaseMatches')}</h3>
        <p class="remote-status" aria-live="polite">${t('sharedDatabasePrompt')}</p>
        <ul id="remote-match-list" class="remote-match-list"></ul>
        <div id="remote-lock-details"></div>
      </section>
      <details class="import-panel">
        <summary>${t('importXetoxycTitle')}</summary>
        <p class="panel-hint">${t('importXetoxycHint')}</p>
        <ol class="import-steps">
          <li>${t('importStepOpenXetoxyc')}</li>
          <li>${t('importStepOpenConsole')}</li>
          <li>
            ${t('importStepRunSnippet')}
            <pre class="import-code"><code>localStorage.getItem("gothic.chests")</code></pre>
          </li>
          <li>${t('importStepPasteHere')}</li>
        </ol>
        <p class="import-alt">${t('importApplicationHint')}</p>
        <textarea
          id="xetoxyc-import-json"
          class="import-textarea"
          spellcheck="false"
          placeholder="${t('importXetoxycPlaceholder')}"
        ></textarea>
        <div class="chest-actions">
          <button type="button" id="xetoxyc-import-submit" class="chest-btn">${t('submitImportForReview')}</button>
        </div>
        <p class="import-status" aria-live="polite"></p>
      </details>
    </section>
  `

  const updateActiveRemoteLock = (lock: RemoteLockRecord): void => {
    activeRemoteLock = lock
    renderRemoteLockDetails(container, activeRemoteLock, revealedLockIds, updateActiveRemoteLock)
  }

  const loadRemoteLock = async (id: string): Promise<void> => {
    try {
      const lock = await getRemoteLock(id)
      updateActiveRemoteLock(lock)
      const chest = chestFromRemoteLock(lock)
      applyChestToGameState(state, chest)
      const revealed = revealedLockIds.has(lock.id)
      setChestName(container, revealed ? chest.name : '')
      setStatus(container, revealed ? `${t('load')}: "${chest.name}"` : t('nameHiddenUntilReveal'))
      onLoad(revealed ? chest : { ...chest, name: '' })
    } catch (error) {
      setRemoteStatus(
        container,
        error instanceof Error ? error.message : t('failedDatabaseLoad'),
        true,
      )
    }
  }

  container.querySelector<HTMLButtonElement>('#chest-submit')!.addEventListener('click', async () => {
    const name = getChestName(container)
    if (!name) {
      setStatus(container, t('enterChestNameBeforeSubmitting'), true)
      return
    }

    try {
      const result = await submitLock(gameStateToChest(name, state, getSolutionMoves?.()))
      if (!result.lock) {
        setStatus(
          container,
          result.hidden ? t('submittedHiddenDuplicate') : t('submittedToDatabase'),
        )
        return
      }
      revealedLockIds.add(result.lock.id)
      updateActiveRemoteLock(result.lock)
      setStatus(
        container,
        result.duplicate
          ? `${t('submitToDatabase')}: "${result.lock.displayName}"`
          : `${t('submitToDatabase')}: "${result.lock.displayName}"`,
      )
    } catch (error) {
      setStatus(
        container,
        error instanceof Error ? error.message : t('failedSubmit'),
        true,
      )
    }
  })

  container.querySelector<HTMLButtonElement>('#xetoxyc-import-submit')?.addEventListener('click', async () => {
    const input = container.querySelector<HTMLTextAreaElement>('#xetoxyc-import-json')
    const payload = input?.value.trim() ?? ''
    if (!payload) {
      setImportStatus(container, t('importJsonRequired'), true)
      return
    }

    try {
      const result = await submitXetoxycImport(payload)
      if (input) input.value = ''
      setImportStatus(
        container,
        `${t('importSubmittedForReview')}: ${result.validCount}/${result.itemCount} ${t('validImports')}, ${result.invalidCount} ${t('invalidImports')}`,
      )
    } catch (error) {
      setImportStatus(
        container,
        error instanceof Error ? error.message : t('failedSubmit'),
        true,
      )
    }
  })

  return {
    renderRemoteMatches(matches, message) {
      const list = container.querySelector<HTMLUListElement>('#remote-match-list')
      if (!list) return

      setRemoteStatus(container, message ?? `${matches.length} ${t('databaseMatches')}`)

      if (matches.length === 0) {
        list.innerHTML = `<li class="chest-empty">${t('noDatabaseMatches')}</li>`
        return
      }

      list.innerHTML = matches
        .map((match) => renderRemoteMatchItem(match, revealedLockIds.has(match.id)))
        .join('')

      list.querySelectorAll<HTMLButtonElement>('.reveal-name').forEach((button) => {
        button.addEventListener('click', () => {
          const id = button.dataset.lockId
          if (!id) return
          revealedLockIds.add(id)
          this.renderRemoteMatches(matches, message)
        })
      })

      list.querySelectorAll<HTMLButtonElement>('.remote-load').forEach((button) => {
        button.addEventListener('click', () => {
          const id = button.dataset.id
          if (id) void loadRemoteLock(id)
        })
      })
    },
    clearRemoteMatches(message = t('sharedDatabasePrompt')) {
      const list = container.querySelector<HTMLUListElement>('#remote-match-list')
      if (list) list.innerHTML = ''
      setRemoteStatus(container, message)
    },
  }
}
