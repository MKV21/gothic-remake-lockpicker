import {
  applyChestToGameState,
  deleteChest,
  gameStateToChest,
  getChest,
  listChests,
  saveChest,
  type ChestListItem,
  type ChestRecord,
} from './chest'
import {
  getRemoteLock,
  submitLock,
  suggestRemoteName,
  voteRemoteName,
} from './remote'
import type { SolveMove } from './solver'
import type { GameState } from './types'
import type { LockMatchRecord, RemoteLockRecord } from '../shared/lockTypes'
import { chestFromRemoteLock } from '../shared/lockValidation'

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

export function getChestName(container: HTMLElement): string {
  return container.querySelector<HTMLInputElement>('#chest-name')?.value.trim() ?? ''
}

function setChestName(container: HTMLElement, name: string): void {
  const nameInput = container.querySelector<HTMLInputElement>('#chest-name')
  if (nameInput) nameInput.value = name
}

export async function saveChestFromPanel(
  container: HTMLElement,
  state: GameState,
  options: {
    solutionMoves?: SolveMove[]
    statusMessage?: string
    onLoad?: (chest?: ChestRecord) => void
  } = {},
): Promise<boolean> {
  const { solutionMoves, statusMessage, onLoad } = options
  const name = getChestName(container)
  if (!name) {
    setStatus(container, 'Enter a chest name to save solution', true)
    return false
  }

  try {
    const saved = await saveChest(gameStateToChest(name, state, solutionMoves))
    setStatus(container, statusMessage ?? `Saved "${saved.name}"`)
    if (onLoad) await renderChestList(container, onLoad, state)
    return true
  } catch {
    setStatus(container, 'Failed to save chest', true)
    return false
  }
}

async function renderChestList(
  container: HTMLElement,
  onLoad: (chest?: ChestRecord) => void,
  state: GameState,
): Promise<void> {
  const list = container.querySelector<HTMLUListElement>('#chest-list')
  if (!list) return

  let chests: ChestListItem[] = []
  try {
    chests = await listChests()
  } catch {
    list.innerHTML = '<li class="chest-empty">Could not load chests</li>'
    return
  }

  if (chests.length === 0) {
    list.innerHTML = '<li class="chest-empty">No saved chests yet</li>'
    return
  }

  list.innerHTML = chests
    .map(
      (chest) => `
      <li class="chest-item" data-id="${chest.id}">
        <span class="chest-item-name">${escapeHtml(chest.name)}</span>
        <div class="chest-item-actions">
          <button type="button" class="chest-btn chest-btn--load" data-id="${chest.id}">Load</button>
          <button type="button" class="chest-btn chest-btn--delete" data-id="${chest.id}">Del</button>
        </div>
      </li>
    `,
    )
    .join('')

  list.querySelectorAll<HTMLButtonElement>('.chest-btn--load').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        const chest = await getChest(button.dataset.id!)
        applyChestToGameState(state, chest)
        const nameInput = container.querySelector<HTMLInputElement>('#chest-name')
        if (nameInput) nameInput.value = chest.name
        setStatus(container, `Loaded "${chest.name}"`)
        onLoad(chest)
      } catch {
        setStatus(container, 'Failed to load chest', true)
      }
    })
  })

  list.querySelectorAll<HTMLButtonElement>('.chest-btn--delete').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        await deleteChest(button.dataset.id!)
        setStatus(container, 'Chest deleted')
        await renderChestList(container, onLoad, state)
      } catch {
        setStatus(container, 'Failed to delete chest', true)
      }
    })
  })
}

function renderNameList(container: HTMLElement, lock: RemoteLockRecord): void {
  const list = container.querySelector<HTMLUListElement>('#remote-name-list')
  if (!list) return

  if (lock.names.length === 0) {
    list.innerHTML = '<li class="chest-empty">No names proposed yet</li>'
    return
  }

  list.innerHTML = lock.names
    .map(
      (name) => `
      <li class="remote-name-item">
        <span class="remote-name-text">${escapeHtml(name.name)}</span>
        <span class="remote-name-meta">${name.score} vote${name.score === 1 ? '' : 's'} · ${name.status}</span>
        <div class="remote-name-actions">
          <button type="button" class="chest-btn remote-vote" data-name-id="${name.id}" data-vote="1">+</button>
          <button type="button" class="chest-btn remote-vote" data-name-id="${name.id}" data-vote="-1">-</button>
        </div>
      </li>
    `,
    )
    .join('')
}

function renderRemoteLockDetails(
  container: HTMLElement,
  lock: RemoteLockRecord | undefined,
  updateLock: (lock: RemoteLockRecord) => void,
): void {
  const details = container.querySelector<HTMLElement>('#remote-lock-details')
  if (!details) return

  if (!lock) {
    details.innerHTML = ''
    return
  }

  details.innerHTML = `
    <div class="remote-lock-detail">
      <div class="remote-lock-detail-header">
        <strong>${escapeHtml(lock.displayName)}</strong>
        <span>${lock.gateCount} gates · ${escapeHtml(lock.reviewStatus)}</span>
      </div>
      <ul id="remote-name-list" class="remote-name-list"></ul>
      <form id="remote-name-form" class="remote-name-form">
        <input id="remote-name-input" type="text" placeholder="Suggest better name" />
        <button type="submit" class="chest-btn">Suggest</button>
      </form>
    </div>
  `

  renderNameList(container, lock)

  details.querySelectorAll<HTMLButtonElement>('.remote-vote').forEach((button) => {
    button.addEventListener('click', async () => {
      const nameId = button.dataset.nameId
      const value = Number(button.dataset.vote) === -1 ? -1 : 1
      if (!nameId) return

      try {
        const updated = await voteRemoteName(nameId, value)
        updateLock(updated)
        setRemoteStatus(container, 'Vote saved')
      } catch (error) {
        setRemoteStatus(
          container,
          error instanceof Error ? error.message : 'Failed to save vote',
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
      setRemoteStatus(container, 'Enter a name suggestion first', true)
      return
    }

    try {
      const updated = await suggestRemoteName(lock.id, name)
      updateLock(updated)
      setRemoteStatus(container, 'Name suggestion saved')
      if (input) input.value = ''
    } catch (error) {
      setRemoteStatus(
        container,
        error instanceof Error ? error.message : 'Failed to save name suggestion',
        true,
      )
    }
  })
}

export function mountChestPanel(container: HTMLElement, options: ChestPanelOptions): ChestPanelController {
  const { state, onLoad, getSolutionMoves } = options
  let activeRemoteLock: RemoteLockRecord | undefined

  container.innerHTML = `
    <section class="chest-panel">
      <h2>Chests</h2>
      <p class="panel-hint">Local saves stay private drafts. Submit complete locks to the shared database when they are ready.</p>
      <label class="chest-field">
        <span>Name</span>
        <input id="chest-name" type="text" placeholder="Chest name" />
      </label>
      <div class="chest-actions">
        <button type="button" id="chest-save" class="chest-save">Save draft</button>
        <button type="button" id="chest-submit" class="chest-save chest-save--remote">Submit to database</button>
      </div>
      <p class="chest-status" aria-live="polite"></p>
      <ul id="chest-list" class="chest-list"></ul>
      <section class="remote-panel" aria-label="Shared database">
        <h3>Database matches</h3>
        <p class="remote-status" aria-live="polite">Enter gate count and start pins to search the shared database.</p>
        <ul id="remote-match-list" class="remote-match-list"></ul>
        <div id="remote-lock-details"></div>
      </section>
    </section>
  `

  const updateActiveRemoteLock = (lock: RemoteLockRecord): void => {
    activeRemoteLock = lock
    renderRemoteLockDetails(container, activeRemoteLock, updateActiveRemoteLock)
  }

  const loadRemoteLock = async (id: string): Promise<void> => {
    try {
      const lock = await getRemoteLock(id)
      updateActiveRemoteLock(lock)
      const chest = chestFromRemoteLock(lock)
      applyChestToGameState(state, chest)
      setChestName(container, chest.name)
      setStatus(container, `Loaded database lock "${chest.name}"`)
      onLoad(chest)
    } catch (error) {
      setRemoteStatus(
        container,
        error instanceof Error ? error.message : 'Failed to load database lock',
        true,
      )
    }
  }

  container.querySelector<HTMLButtonElement>('#chest-save')!.addEventListener('click', async () => {
    await saveChestFromPanel(container, state, {
      solutionMoves: getSolutionMoves?.(),
      onLoad,
    })
  })

  container.querySelector<HTMLButtonElement>('#chest-submit')!.addEventListener('click', async () => {
    const name = getChestName(container)
    if (!name) {
      setStatus(container, 'Enter a chest name before submitting', true)
      return
    }

    try {
      const result = await submitLock(gameStateToChest(name, state, getSolutionMoves?.()))
      updateActiveRemoteLock(result.lock)
      setStatus(
        container,
        result.duplicate
          ? `Existing database lock updated with "${result.lock.displayName}"`
          : `Submitted "${result.lock.displayName}" to database`,
      )
    } catch (error) {
      setStatus(
        container,
        error instanceof Error ? error.message : 'Failed to submit chest',
        true,
      )
    }
  })

  void renderChestList(container, onLoad, state)

  return {
    renderRemoteMatches(matches, message) {
      const list = container.querySelector<HTMLUListElement>('#remote-match-list')
      if (!list) return

      setRemoteStatus(container, message ?? `${matches.length} database match${matches.length === 1 ? '' : 'es'}`)

      if (matches.length === 0) {
        list.innerHTML = '<li class="chest-empty">No matching database locks</li>'
        return
      }

      list.innerHTML = matches
        .map(
          (match) => `
          <li class="remote-match-item">
            <div class="remote-match-main">
              <strong>${escapeHtml(match.displayName)}</strong>
              <span>${match.gateCount} gates · pins ${match.initialPins.join(', ')} · score ${match.score}</span>
            </div>
            <button type="button" class="chest-btn remote-load" data-id="${match.id}">Load</button>
          </li>
        `,
        )
        .join('')

      list.querySelectorAll<HTMLButtonElement>('.remote-load').forEach((button) => {
        button.addEventListener('click', () => {
          const id = button.dataset.id
          if (id) void loadRemoteLock(id)
        })
      })
    },
    clearRemoteMatches(message = 'Enter gate count and start pins to search the shared database.') {
      const list = container.querySelector<HTMLUListElement>('#remote-match-list')
      if (list) list.innerHTML = ''
      setRemoteStatus(container, message)
    },
  }
}
