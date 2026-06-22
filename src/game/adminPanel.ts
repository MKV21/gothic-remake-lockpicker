import type { AdminLockRecord, ChestRecord, RemoteLockRecord, ReviewStatus } from '../shared/lockTypes'
import { getLanguage, t } from '../i18n'
import { countSetLinks } from '../shared/lockValidation'

type AdminLockPayload = ChestRecord & {
  reviewStatus: ReviewStatus
}

type AdminPanelOptions = {
  layout?: 'sidebar' | 'page'
}

type AdminFilters = {
  query: string
  status: 'all' | ReviewStatus
  links: 'all' | 'with-links' | 'without-links'
  sort: 'updated-desc' | 'created-desc' | 'links-desc' | 'score-asc'
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

async function adminRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers)
  if (options.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  headers.set('X-Admin-CSRF', '1')

  const response = await fetch(path, {
    ...options,
    credentials: 'same-origin',
    headers,
  })
  const body = (await response.json().catch(() => ({}))) as { error?: string }
  if (!response.ok) throw new Error(body.error ?? `Request failed with ${response.status}`)
  return body as T
}

async function createAdminSession(password: string): Promise<void> {
  await adminRequest<{ ok: true }>('/api/admin/session', {
    method: 'POST',
    body: JSON.stringify({ password }),
  })
}

async function clearAdminSession(): Promise<void> {
  await adminRequest<{ ok: true }>('/api/admin/session', { method: 'DELETE' })
}

function statusLabel(status: ReviewStatus): string {
  switch (status) {
    case 'approved':
      return t('approved')
    case 'pending':
      return t('pending')
    case 'rejected':
      return t('rejected')
  }
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

function setLinkCount(lock: RemoteLockRecord): number {
  return countSetLinks(lock.links, lock.gateCount)
}

function maxNameScore(lock: RemoteLockRecord): number {
  const scores = lock.names.filter((name) => name.status !== 'rejected').map((name) => name.score)
  return scores.length === 0 ? -Infinity : Math.max(...scores)
}

function formatTimestamp(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(getLanguage(), {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date)
}

function shortHash(value: string | null): string {
  return value ? value.slice(0, 12) : '-'
}

function isAdminLockRecord(lock: RemoteLockRecord): lock is AdminLockRecord {
  return 'admin' in lock
}

function adminIdentityLabel(lock: AdminLockRecord): string {
  if (lock.admin.firstReportIpHash) return `IP ${shortHash(lock.admin.firstReportIpHash)}`
  if (lock.admin.firstReportVisitorHash) return `Visitor ${shortHash(lock.admin.firstReportVisitorHash)}`
  return '-'
}

function adminIdentityTitle(lock: AdminLockRecord): string {
  return [
    `${t('ipHash')}: ${lock.admin.firstReportIpHash ?? '-'}`,
    `${t('visitorHash')}: ${lock.admin.firstReportVisitorHash ?? '-'}`,
    `${t('source')}: ${lock.admin.firstReportSource ?? '-'}`,
    `${t('created')}: ${lock.admin.firstReportCreatedAt ? formatTimestamp(lock.admin.firstReportCreatedAt) : '-'}`,
  ].join('\n')
}

function entryCountLabel(visibleCount: number, totalCount: number): string {
  if (visibleCount === totalCount) return `${t('entryCount')}: ${totalCount}`
  return `${t('entryCount')}: ${visibleCount} / ${totalCount}`
}

function lockSummary(lock: RemoteLockRecord): string {
  const score = maxNameScore(lock)
  const scoreLabel = Number.isFinite(score) ? String(score) : t('noActiveNames')
  const hidden = Number.isFinite(score) && score <= -5 ? ` · ${t('hiddenPublic')}` : ''
  return `${lock.gateCount} ${t('gates')} · ${setLinkCount(lock)} ${t('linksSet')} · ${statusLabel(lock.reviewStatus)} · ${t('score')} ${scoreLabel}${hidden}`
}

function filterAndSortLocks<T extends RemoteLockRecord>(locks: T[], filters: AdminFilters): T[] {
  const query = filters.query.trim().toLocaleLowerCase()

  return locks
    .filter((lock) => {
      if (filters.status !== 'all' && lock.reviewStatus !== filters.status) return false

      const linkCount = setLinkCount(lock)
      if (filters.links === 'with-links' && linkCount === 0) return false
      if (filters.links === 'without-links' && linkCount > 0) return false

      if (!query) return true
      return [
        lock.displayName,
        lock.fingerprint,
        lock.initialPins.join(','),
        ...lock.names.map((name) => name.name),
      ].some((value) => value.toLocaleLowerCase().includes(query))
    })
    .sort((a, b) => {
      switch (filters.sort) {
        case 'created-desc':
          return Date.parse(b.createdAt) - Date.parse(a.createdAt)
        case 'links-desc':
          return setLinkCount(b) - setLinkCount(a) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
        case 'score-asc':
          return maxNameScore(a) - maxNameScore(b) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
        case 'updated-desc':
        default:
          return Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
      }
    })
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
      <h3>${t('editChest')}</h3>
      <span>${escapeHtml(lock.id)}</span>
      <span>${setLinkCount(lock)} ${t('linksSet')}</span>
      ${
        isAdminLockRecord(lock)
          ? `<span>${t('ipHash')}: ${escapeHtml(lock.admin.firstReportIpHash ?? '-')}</span>
             <span>${t('visitorHash')}: ${escapeHtml(lock.admin.firstReportVisitorHash ?? '-')}</span>
             <span>${t('source')}: ${escapeHtml(lock.admin.firstReportSource ?? '-')}</span>`
          : ''
      }
      <span>${t('created')}: ${escapeHtml(formatTimestamp(lock.createdAt))}</span>
      <span>${t('updated')}: ${escapeHtml(formatTimestamp(lock.updatedAt))}</span>
    </div>
    <textarea id="admin-lock-json" class="admin-json" spellcheck="false">${escapeHtml(
      JSON.stringify(lockToPayload(lock), null, 2),
    )}</textarea>
    <div class="admin-editor-actions">
      <button
        type="button"
        id="admin-approve-lock"
        class="chest-btn chest-btn--approve"
        ${lock.reviewStatus === 'approved' ? 'disabled' : ''}
      >${lock.reviewStatus === 'approved' ? t('approved') : t('approve')}</button>
      <button type="button" id="admin-save-lock" class="chest-btn">${t('save')}</button>
      <button type="button" id="admin-delete-lock" class="chest-btn chest-btn--danger">${t('delete')}</button>
    </div>
  `
}

function renderLockList(
  container: HTMLElement,
  locks: AdminLockRecord[],
  selectLock: (lock: AdminLockRecord) => void,
  approveLock: (lock: AdminLockRecord) => void,
  selectedLockId: string | undefined,
  layout: 'sidebar' | 'page',
): void {
  const list = container.querySelector<HTMLElement>('#admin-lock-list')
  if (!list) return

  if (locks.length === 0) {
    list.innerHTML = `<p class="chest-empty">${t('noDatabaseChests')}</p>`
    return
  }

  if (layout === 'page') {
    list.innerHTML = `
      <table class="admin-lock-table">
        <thead>
          <tr>
            <th>${t('actions')}</th>
            <th>${t('name')}</th>
            <th>${t('reviewStatus')}</th>
            <th>${t('ipHash')}</th>
            <th>${t('gates')}</th>
            <th>${t('pins')}</th>
            <th>${t('linksSet')}</th>
            <th>${t('score')}</th>
            <th>${t('created')}</th>
            <th>${t('updated')}</th>
          </tr>
        </thead>
        <tbody>
          ${locks
            .map((lock) => {
              const score = maxNameScore(lock)
              return `
                <tr
                  class="${lock.id === selectedLockId ? 'admin-lock-row admin-lock-row--selected' : 'admin-lock-row'}"
                  data-id="${escapeHtml(lock.id)}"
                  tabindex="0"
                  aria-label="${escapeHtml(lock.displayName)}"
                >
                  <td>
                    <button
                      type="button"
                      class="admin-table-approve"
                      data-id="${escapeHtml(lock.id)}"
                      title="${escapeHtml(t('approve'))}"
                      aria-label="${escapeHtml(`${t('approve')}: ${lock.displayName}`)}"
                      ${lock.reviewStatus === 'approved' ? 'disabled' : ''}
                    >&#10003;</button>
                  </td>
                  <td>
                    <span class="admin-table-name">${escapeHtml(lock.displayName)}</span>
                  </td>
                  <td>${escapeHtml(statusLabel(lock.reviewStatus))}</td>
                  <td>
                    <span class="admin-hash" title="${escapeHtml(adminIdentityTitle(lock))}">
                      ${escapeHtml(adminIdentityLabel(lock))}
                    </span>
                  </td>
                  <td>${lock.gateCount}</td>
                  <td>${escapeHtml(lock.initialPins.join(', '))}</td>
                  <td>${setLinkCount(lock)}</td>
                  <td>${Number.isFinite(score) ? score : '-'}</td>
                  <td>${escapeHtml(formatTimestamp(lock.createdAt))}</td>
                  <td>${escapeHtml(formatTimestamp(lock.updatedAt))}</td>
                </tr>
              `
            })
            .join('')}
        </tbody>
      </table>
    `
    list.querySelectorAll<HTMLButtonElement>('.admin-table-approve').forEach((button) => {
      button.addEventListener('click', () => {
        const lock = locks.find((item) => item.id === button.dataset.id)
        if (lock) approveLock(lock)
      })
    })
    list.querySelectorAll<HTMLTableRowElement>('.admin-lock-row').forEach((row) => {
      const selectRow = (): void => {
        const lock = locks.find((item) => item.id === row.dataset.id)
        if (lock) selectLock(lock)
      }
      row.addEventListener('click', (event) => {
        if ((event.target as HTMLElement).closest('button')) return
        selectRow()
      })
      row.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        selectRow()
      })
    })
    return
  }

  list.innerHTML = locks
    .map(
      (lock) => `
        <li class="admin-lock-item">
          <button type="button" class="admin-lock-select" data-id="${escapeHtml(lock.id)}">
            <strong>${escapeHtml(lock.displayName)}</strong>
            <span>${escapeHtml(lockSummary(lock))}</span>
            <span>${t('pins')} ${lock.initialPins.join(', ')}</span>
            <span>${t('created')}: ${escapeHtml(formatTimestamp(lock.createdAt))}</span>
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

export function mountAdminPanel(container: HTMLElement, options: AdminPanelOptions = {}): void {
  const layout = options.layout ?? 'sidebar'
  let locks: AdminLockRecord[] = []
  let selectedLock: AdminLockRecord | undefined
  let filters: AdminFilters = {
    query: '',
    status: 'all',
    links: 'all',
    sort: 'updated-desc',
  }

  async function approveLock(lock: AdminLockRecord): Promise<void> {
    try {
      await adminRequest<{ lock: RemoteLockRecord }>(
        `/api/admin/locks/${encodeURIComponent(lock.id)}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            reviewStatus: 'approved',
          }),
        },
      )
      await loadLocks(lock.id)
      setStatus(container, `${t('approved')}: "${lock.displayName}"`)
    } catch (error) {
      setStatus(container, error instanceof Error ? error.message : t('failedSave'), true)
    }
  }

  const renderLocks = (): AdminLockRecord[] => {
    const visibleLocks = layout === 'page' ? filterAndSortLocks(locks, filters) : locks
    renderLockList(container, visibleLocks, (lock) => {
      selectedLock = lock
      renderLocks()
      renderEditor(container, lock)
    }, approveLock, selectedLock?.id, layout)
    return visibleLocks
  }

  const renderFilteredLocks = (): void => {
    const visibleLocks = renderLocks()
    if (layout !== 'page') return
    if (!selectedLock || !visibleLocks.some((lock) => lock.id === selectedLock?.id)) {
      selectedLock = visibleLocks[0]
      renderLocks()
      renderEditor(container, selectedLock)
    }
    setStatus(container, entryCountLabel(visibleLocks.length, locks.length))
  }

  container.innerHTML = `
    <section class="admin-panel admin-panel--${layout}">
      <h2>${t('admin')}</h2>
      <p class="panel-hint">${t('adminHint')}</p>
      <form id="admin-login" class="admin-login" method="post" action="/api/admin/session" autocomplete="on">
        <input id="admin-username" name="username" type="text" value="admin" autocomplete="username" />
        <input id="admin-password" name="password" type="password" placeholder="${t('adminPassword')}" autocomplete="current-password" />
        <button type="submit" class="chest-save">${t('unlock')}</button>
      </form>
      <div class="admin-actions">
        <button type="button" id="admin-refresh" class="chest-btn">${t('adminRefresh')}</button>
        <button type="button" id="admin-lock-session" class="chest-btn">${t('adminLock')}</button>
      </div>
      <p class="admin-status" aria-live="polite"></p>
      ${
        layout === 'page'
          ? `<div class="admin-filter-bar">
              <label>
                <span>${t('search')}</span>
                <input id="admin-filter-query" type="search" placeholder="${t('search')}" />
              </label>
              <label>
                <span>${t('reviewStatus')}</span>
                <select id="admin-filter-status">
                  <option value="all">${t('all')}</option>
                  <option value="pending">${t('pending')}</option>
                  <option value="approved">${t('approved')}</option>
                  <option value="rejected">${t('rejected')}</option>
                </select>
              </label>
              <label>
                <span>${t('linksSet')}</span>
                <select id="admin-filter-links">
                  <option value="all">${t('all')}</option>
                  <option value="with-links">${t('withLinks')}</option>
                  <option value="without-links">${t('withoutLinks')}</option>
                </select>
              </label>
              <label>
                <span>${t('sort')}</span>
                <select id="admin-sort">
                  <option value="updated-desc">${t('sortUpdated')}</option>
                  <option value="created-desc">${t('sortCreated')}</option>
                  <option value="links-desc">${t('sortLinks')}</option>
                  <option value="score-asc">${t('sortScore')}</option>
                </select>
              </label>
            </div>`
          : ''
      }
      <div class="admin-workspace">
        <div id="admin-lock-list" class="admin-lock-list"></div>
        <div id="admin-editor" class="admin-editor-pane"></div>
      </div>
    </section>
  `

  const loadLocks = async (preferredLockId = selectedLock?.id): Promise<void> => {
    try {
      const body = await adminRequest<{ locks: AdminLockRecord[] }>('/api/admin/locks')
      if (!Array.isArray(body.locks)) throw new Error(t('failedLoad'))
      locks = body.locks
      const visibleLocks = layout === 'page' ? filterAndSortLocks(locks, filters) : locks
      const previousSelection = preferredLockId
        ? locks.find((lock) => lock.id === preferredLockId)
        : undefined
      if (layout === 'page') {
        selectedLock =
          previousSelection && visibleLocks.some((lock) => lock.id === previousSelection.id)
            ? previousSelection
            : visibleLocks[0]
      } else {
        selectedLock = previousSelection ?? locks[0]
      }
      renderLocks()
      renderEditor(container, selectedLock)
      setStatus(container, entryCountLabel(visibleLocks.length, locks.length))
    } catch (error) {
      const message = error instanceof Error ? error.message : t('failedLoad')
      setStatus(
        container,
        message === 'Unauthorized' ? t('enterAdminPassword') : message,
        true,
      )
    }
  }

  if (layout === 'page') {
    container.querySelector<HTMLInputElement>('#admin-filter-query')?.addEventListener('input', (event) => {
      filters = { ...filters, query: (event.target as HTMLInputElement).value }
      renderFilteredLocks()
    })
    container.querySelector<HTMLSelectElement>('#admin-filter-status')?.addEventListener('change', (event) => {
      filters = { ...filters, status: (event.target as HTMLSelectElement).value as AdminFilters['status'] }
      renderFilteredLocks()
    })
    container.querySelector<HTMLSelectElement>('#admin-filter-links')?.addEventListener('change', (event) => {
      filters = { ...filters, links: (event.target as HTMLSelectElement).value as AdminFilters['links'] }
      renderFilteredLocks()
    })
    container.querySelector<HTMLSelectElement>('#admin-sort')?.addEventListener('change', (event) => {
      filters = { ...filters, sort: (event.target as HTMLSelectElement).value as AdminFilters['sort'] }
      renderFilteredLocks()
    })
  }

  container.querySelector<HTMLFormElement>('#admin-login')?.addEventListener('submit', async (event) => {
    event.preventDefault()
    const input = container.querySelector<HTMLInputElement>('#admin-password')
    const password = input?.value.trim() ?? ''
    if (!password) {
      setStatus(container, t('enterAdminPassword'), true)
      return
    }

    try {
      await createAdminSession(password)
      await loadLocks()
    } catch (error) {
      const message = error instanceof Error ? error.message : t('failedLoad')
      setStatus(
        container,
        message === 'Unauthorized' ? t('enterAdminPassword') : message,
        true,
      )
    }
  })

  container.querySelector<HTMLButtonElement>('#admin-refresh')?.addEventListener('click', () => {
    void loadLocks()
  })

  container.querySelector<HTMLButtonElement>('#admin-lock-session')?.addEventListener('click', async () => {
    await clearAdminSession().catch(() => undefined)
    locks = []
    selectedLock = undefined
    const input = container.querySelector<HTMLInputElement>('#admin-password')
    if (input) input.value = ''
    renderLocks()
    renderEditor(container, undefined)
    setStatus(container, t('lockSessionClosed'))
  })

  container.addEventListener('click', async (event) => {
    const target = event.target as HTMLElement

    if (target.id === 'admin-approve-lock') {
      if (!selectedLock) return
      await approveLock(selectedLock)
    }

    if (target.id === 'admin-save-lock') {
      if (!selectedLock) return
      const textarea = container.querySelector<HTMLTextAreaElement>('#admin-lock-json')
      try {
        const payload = JSON.parse(textarea?.value ?? '{}') as AdminLockPayload
        const body = await adminRequest<{ lock: RemoteLockRecord }>(
          `/api/admin/locks/${encodeURIComponent(selectedLock.id)}`,
          {
            method: 'PATCH',
            body: JSON.stringify(payload),
          },
        )
        await loadLocks(body.lock.id)
        renderEditor(container, selectedLock)
        setStatus(container, `${t('lockSaved')}: "${body.lock.displayName}"`)
      } catch (error) {
        setStatus(container, error instanceof Error ? error.message : t('failedSave'), true)
      }
    }

    if (target.id === 'admin-delete-lock') {
      if (!selectedLock) return
      const confirmed = window.confirm(`${t('delete')} "${selectedLock.displayName}"?`)
      if (!confirmed) return

      try {
        await adminRequest<{ ok: true }>(
          `/api/admin/locks/${encodeURIComponent(selectedLock.id)}`,
          { method: 'DELETE' },
        )
        selectedLock = undefined
        renderEditor(container, undefined)
        await loadLocks()
        setStatus(container, t('lockDeleted'))
      } catch (error) {
        setStatus(container, error instanceof Error ? error.message : t('failedDelete'), true)
      }
    }
  })

  void loadLocks()
}
