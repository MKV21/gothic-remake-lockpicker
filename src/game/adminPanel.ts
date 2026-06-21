import type { ChestRecord, RemoteLockRecord } from '../shared/lockTypes'

type AdminLockPayload = ChestRecord & {
  reviewStatus: 'approved' | 'pending' | 'rejected'
}

const ADMIN_TOKEN_KEY = 'gothic.adminToken'

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function getStoredToken(): string {
  return sessionStorage.getItem(ADMIN_TOKEN_KEY) ?? ''
}

function setStoredToken(token: string): void {
  if (token) {
    sessionStorage.setItem(ADMIN_TOKEN_KEY, token)
  } else {
    sessionStorage.removeItem(ADMIN_TOKEN_KEY)
  }
}

async function adminRequest<T>(
  token: string,
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  })
  const body = (await response.json().catch(() => ({}))) as { error?: string }
  if (!response.ok) throw new Error(body.error ?? `Request failed with ${response.status}`)
  return body as T
}

function lockToPayload(lock: RemoteLockRecord): AdminLockPayload {
  return {
    name: lock.displayName,
    reviewStatus: lock.reviewStatus,
    gateCount: lock.gateCount,
    initialPins: lock.initialPins,
    solutionPins: lock.solutionPins,
    links: lock.links,
    solutionMoves: lock.solutionMoves,
  }
}

function maxNameScore(lock: RemoteLockRecord): number {
  const scores = lock.names.filter((name) => name.status !== 'rejected').map((name) => name.score)
  return scores.length === 0 ? -Infinity : Math.max(...scores)
}

function lockSummary(lock: RemoteLockRecord): string {
  const score = maxNameScore(lock)
  const scoreLabel = Number.isFinite(score) ? String(score) : 'no active names'
  const hidden = Number.isFinite(score) && score <= -5 ? ' · hidden public' : ''
  return `${lock.gateCount} gates · ${lock.reviewStatus} · score ${scoreLabel}${hidden}`
}

function setStatus(container: HTMLElement, message: string, isError = false): void {
  const status = container.querySelector<HTMLElement>('.admin-status')
  if (!status) return
  status.textContent = message
  status.classList.toggle('admin-status--error', isError)
}

function renderEditor(container: HTMLElement, lock: RemoteLockRecord | undefined): void {
  const editor = container.querySelector<HTMLElement>('#admin-editor')
  if (!editor) return

  if (!lock) {
    editor.innerHTML = ''
    return
  }

  editor.innerHTML = `
    <div class="admin-editor-header">
      <h3>Edit Chest</h3>
      <span>${escapeHtml(lock.id)}</span>
    </div>
    <textarea id="admin-lock-json" class="admin-json" spellcheck="false">${escapeHtml(
      JSON.stringify(lockToPayload(lock), null, 2),
    )}</textarea>
    <div class="admin-editor-actions">
      <button type="button" id="admin-save-lock" class="chest-btn">Save</button>
      <button type="button" id="admin-delete-lock" class="chest-btn chest-btn--danger">Delete</button>
    </div>
  `
}

function renderLockList(
  container: HTMLElement,
  locks: RemoteLockRecord[],
  selectLock: (lock: RemoteLockRecord) => void,
): void {
  const list = container.querySelector<HTMLUListElement>('#admin-lock-list')
  if (!list) return

  if (locks.length === 0) {
    list.innerHTML = '<li class="chest-empty">No database chests yet</li>'
    return
  }

  list.innerHTML = locks
    .map(
      (lock) => `
        <li class="admin-lock-item">
          <button type="button" class="admin-lock-select" data-id="${lock.id}">
            <strong>${escapeHtml(lock.displayName)}</strong>
            <span>${escapeHtml(lockSummary(lock))}</span>
            <span>pins ${lock.initialPins.join(', ')}</span>
          </button>
        </li>
      `,
    )
    .join('')

  list.querySelectorAll<HTMLButtonElement>('.admin-lock-select').forEach((button) => {
    button.addEventListener('click', () => {
      const lock = locks.find((item) => item.id === button.dataset.id)
      if (lock) selectLock(lock)
    })
  })
}

export function mountAdminPanel(container: HTMLElement): void {
  let token = getStoredToken()
  let locks: RemoteLockRecord[] = []
  let selectedLock: RemoteLockRecord | undefined

  container.innerHTML = `
    <section class="admin-panel">
      <h2>Admin</h2>
      <p class="panel-hint">Enter the admin password/token to review, edit, or delete database chests.</p>
      <form id="admin-login" class="admin-login">
        <input id="admin-token" type="password" placeholder="Admin password" autocomplete="current-password" />
        <button type="submit" class="chest-save">Unlock</button>
      </form>
      <div class="admin-actions">
        <button type="button" id="admin-refresh" class="chest-btn">Refresh</button>
        <button type="button" id="admin-lock-session" class="chest-btn">Lock</button>
      </div>
      <p class="admin-status" aria-live="polite"></p>
      <ul id="admin-lock-list" class="admin-lock-list"></ul>
      <div id="admin-editor"></div>
    </section>
  `

  const loadLocks = async (): Promise<void> => {
    if (!token) {
      setStatus(container, 'Enter admin password first', true)
      return
    }

    try {
      const body = await adminRequest<{ locks: RemoteLockRecord[] }>(token, '/api/admin/locks')
      locks = body.locks
      renderLockList(container, locks, (lock) => {
        selectedLock = lock
        renderEditor(container, lock)
      })
      setStatus(container, `Loaded ${locks.length} chest${locks.length === 1 ? '' : 's'}`)
      if (!selectedLock && locks[0]) {
        selectedLock = locks[0]
        renderEditor(container, selectedLock)
      }
    } catch (error) {
      setStatus(container, error instanceof Error ? error.message : 'Failed to load admin locks', true)
    }
  }

  container.querySelector<HTMLFormElement>('#admin-login')?.addEventListener('submit', (event) => {
    event.preventDefault()
    const input = container.querySelector<HTMLInputElement>('#admin-token')
    token = input?.value.trim() ?? ''
    setStoredToken(token)
    if (input) input.value = ''
    void loadLocks()
  })

  container.querySelector<HTMLButtonElement>('#admin-refresh')?.addEventListener('click', () => {
    void loadLocks()
  })

  container.querySelector<HTMLButtonElement>('#admin-lock-session')?.addEventListener('click', () => {
    token = ''
    locks = []
    selectedLock = undefined
    setStoredToken('')
    renderLockList(container, [], () => undefined)
    renderEditor(container, undefined)
    setStatus(container, 'Admin session locked')
  })

  container.addEventListener('click', async (event) => {
    const target = event.target as HTMLElement

    if (target.id === 'admin-save-lock') {
      if (!selectedLock) return
      const textarea = container.querySelector<HTMLTextAreaElement>('#admin-lock-json')
      try {
        const payload = JSON.parse(textarea?.value ?? '{}') as AdminLockPayload
        const body = await adminRequest<{ lock: RemoteLockRecord }>(
          token,
          `/api/admin/locks/${encodeURIComponent(selectedLock.id)}`,
          {
            method: 'PATCH',
            body: JSON.stringify(payload),
          },
        )
        selectedLock = body.lock
        await loadLocks()
        renderEditor(container, selectedLock)
        setStatus(container, `Saved "${selectedLock.displayName}"`)
      } catch (error) {
        setStatus(container, error instanceof Error ? error.message : 'Failed to save chest', true)
      }
    }

    if (target.id === 'admin-delete-lock') {
      if (!selectedLock) return
      const confirmed = window.confirm(`Delete "${selectedLock.displayName}" from the database?`)
      if (!confirmed) return

      try {
        await adminRequest<{ ok: true }>(
          token,
          `/api/admin/locks/${encodeURIComponent(selectedLock.id)}`,
          { method: 'DELETE' },
        )
        selectedLock = undefined
        renderEditor(container, undefined)
        await loadLocks()
        setStatus(container, 'Chest deleted')
      } catch (error) {
        setStatus(container, error instanceof Error ? error.message : 'Failed to delete chest', true)
      }
    }
  })

  if (token) void loadLocks()
}
