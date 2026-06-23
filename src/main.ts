import './style.css'
import { mountAdminPanel } from './game/adminPanel'
import type { ChestRecord } from './game/chest'
import {
  clearChestName,
  mountChestPanel,
  submitSolvedChestFromPanel,
  type ChestPanelController,
} from './game/chestPanel'
import { mountLockCards, updateLockCards } from './game/lockCards'
import { matchLocks, trackPageView } from './game/remote'
import { solveLock, type SolveMove } from './game/solver'
import { renderSolution, solutionViewHint, type SolutionView } from './game/solutionPanel'
import { clampGateCount, createGameState, MIN_MATCH_PIN_COUNT, resetGameState } from './game/types'
import { getLanguage, languageLabel, setLanguage, t, type Language } from './i18n'

const APP_VERSION = '0.4.14'
const state = createGameState()
let cachedSolutionMoves: SolveMove[] | undefined
let cachedSolutionResult: ReturnType<typeof solveLock> | undefined
let solutionView: SolutionView = 'moves'
let chestPanelController: ChestPanelController | undefined
let matchTimer: number | undefined
let matchRequestId = 0

type TabId = 'setup' | 'solution'

const MOBILE_MQ = window.matchMedia('(max-width: 767px)')
const isAdminRoute = window.location.pathname.replace(/\/$/, '') === '/admin'
const currentLanguage = getLanguage()

function renderAdminApp(): void {
  document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
    <main class="admin-page">
      <header class="admin-page-header">
        <div>
          <h1 class="app-title">${t('admin')}</h1>
          <p class="app-meta">${t('appVersion')} v${APP_VERSION}</p>
        </div>
        <div class="admin-page-header-actions">
          <a class="chest-btn" href="/">${t('appTitle')}</a>
          <label class="language-select">
            <span>${t('language')}</span>
            <select id="language-picker" aria-label="${t('language')}">
              <option value="en" ${currentLanguage === 'en' ? 'selected' : ''}>${languageLabel('en')}</option>
              <option value="de" ${currentLanguage === 'de' ? 'selected' : ''}>${languageLabel('de')}</option>
            </select>
          </label>
        </div>
      </header>
      <div id="admin-page-panel"></div>
    </main>
  `

  document.querySelector<HTMLSelectElement>('#language-picker')?.addEventListener('change', (event) => {
    setLanguage((event.target as HTMLSelectElement).value as Language)
    window.location.reload()
  })

  mountAdminPanel(document.querySelector<HTMLDivElement>('#admin-page-panel')!, {
    layout: 'page',
  })
}

function renderSolverApp(): void {
  document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
<main class="layout" data-active-tab="setup">
  <section class="game-area" aria-label="Game area">
    <header class="app-header">
      <div class="app-header-row">
        <h1 class="app-title">${t('appTitle')}</h1>
        <label class="language-select">
          <span>${t('language')}</span>
          <select id="language-picker" aria-label="${t('language')}">
            <option value="en" ${currentLanguage === 'en' ? 'selected' : ''}>${languageLabel('en')}</option>
            <option value="de" ${currentLanguage === 'de' ? 'selected' : ''}>${languageLabel('de')}</option>
          </select>
        </label>
      </div>
      <p class="app-subtitle">${t('appSubtitle')}</p>
      <p class="app-meta">
        ${t('appVersion')} v${APP_VERSION} · ${t('attributionBasedOn')}
        <a href="https://xetoxyc.github.io/gothic-remake-lockpicker/" target="_blank" rel="noreferrer">Xetoxyc's web solver</a>
        (<a href="https://github.com/Xetoxyc/gothic-remake-lockpicker" target="_blank" rel="noreferrer">${t('attributionSource')}</a>) ·
        <a href="https://github.com/MKV21/gothic-remake-lockpicker" target="_blank" rel="noreferrer">${t('attributionFork')}</a>
      </p>
    </header>

    <details class="help-panel" aria-label="${t('helpHowItWorks')}">
      <summary class="help-title">${t('helpHowItWorks')}</summary>
      <div class="help-grid">
        <div class="help-item help-item--wide">
          <h3>${t('helpOrientationTitle')}</h3>
          <p>${t('helpOrientationText1')}</p>
          <p>${t('helpOrientationText2')}</p>
          <figure class="help-figure">
            <img
              src="${import.meta.env.BASE_URL}lock-orientation.png"
              alt="${t('helpImageAlt')}"
              width="794"
              height="601"
              loading="lazy"
            />
            <figcaption>${t('helpOrientationCaption')}</figcaption>
          </figure>
        </div>
        <div class="help-item">
          <h3>${t('helpHolesTitle')}</h3>
          <p>${t('helpHolesText')}</p>
          <ul class="help-legend">
            <li>
              <span class="legend-swatch legend-swatch--start" aria-hidden="true"></span>
              <span class="help-desktop-only">${t('helpStartDesktop')}</span>
              <span class="help-mobile-only">${t('helpStartMobile')}</span>
            </li>
            <li>
              <span class="legend-swatch legend-swatch--target" aria-hidden="true"></span>
              <span class="help-desktop-only">${t('helpTargetDesktop')}</span>
              <span class="help-mobile-only">${t('helpTargetMobile')}</span>
            </li>
          </ul>
        </div>
        <div class="help-item">
          <h3>${t('helpLinksTitle')}</h3>
          <p>${t('helpLinksText')}</p>
          <ul class="help-legend help-legend--links">
            <li><span class="link-legend link-legend--none">·</span> ${t('helpLinksNone')}</li>
            <li><span class="link-legend link-legend--same">S</span> ${t('helpLinksSame')}</li>
            <li><span class="link-legend link-legend--opposite">O</span> ${t('helpLinksOpposite')}</li>
          </ul>
        </div>
      </div>
    </details>

    <div class="gate-toolbar">
      <label class="gate-select">
        <span>${t('gateCount')}</span>
        <select id="gate-count" aria-label="${t('gateCount')}">
          <option value="4">4 ${t('gates')}</option>
          <option value="5">5 ${t('gates')}</option>
          <option value="6" selected>6 ${t('gates')}</option>
          <option value="7">7 ${t('gates')}</option>
        </select>
      </label>
      <button type="button" id="reset-lock" class="reset-btn">${t('reset')}</button>
    </div>
    <div id="lock-cards"></div>
  </section>

  <aside class="sidebar" aria-label="Sidebar">
    <div class="sidebar-chest">
      <div id="chest-panel"></div>
    </div>
    <div class="sidebar-solution">
      <div class="solution-header">
        <h2>${t('solution')}</h2>
        <div class="solution-view-toggle" role="radiogroup" aria-label="${t('solutionFormat')}">
          <label class="solution-view-option">
            <input type="radio" name="solution-view" value="moves" checked />
            <span>Moves</span>
          </label>
          <label class="solution-view-option">
            <input type="radio" name="solution-view" value="keyboard" />
            <span>Keyboard</span>
          </label>
          <label class="solution-view-option">
            <input type="radio" name="solution-view" value="xbox" />
            <span>Xbox</span>
          </label>
          <label class="solution-view-option">
            <input type="radio" name="solution-view" value="ps5" />
            <span>PS5</span>
          </label>
          <label class="solution-view-option">
            <input type="radio" name="solution-view" value="switch" />
            <span>Switch</span>
          </label>
        </div>
      </div>
      <p class="panel-hint" id="solution-hint"></p>
      <ul id="inputs"></ul>
    </div>
  </aside>

  <nav class="tab-bar" role="tablist" aria-label="${t('mainTabs')}">
    <button type="button" class="tab-btn" role="tab" data-tab="setup" aria-selected="true">${t('setupTab')}</button>
    <button type="button" class="tab-btn" role="tab" data-tab="solution" aria-selected="false">${t('solution')}</button>
  </nav>
</main>
`

const layoutEl = document.querySelector<HTMLDivElement>('.layout')!
const lockCardsEl = document.querySelector<HTMLDivElement>('#lock-cards')!
const chestPanelEl = document.querySelector<HTMLDivElement>('#chest-panel')!
const inputsEl = document.querySelector<HTMLUListElement>('#inputs')!
const solutionHintEl = document.querySelector<HTMLParagraphElement>('#solution-hint')!
const solutionViewInputs = document.querySelectorAll<HTMLInputElement>(
  '.solution-view-toggle input[name="solution-view"]',
)
const gateCountEl = document.querySelector<HTMLSelectElement>('#gate-count')!
const resetLockEl = document.querySelector<HTMLButtonElement>('#reset-lock')!
const languagePickerEl = document.querySelector<HTMLSelectElement>('#language-picker')!
const tabButtons = document.querySelectorAll<HTMLButtonElement>('.tab-bar [role="tab"]')

function isMobileLayout(): boolean {
  return MOBILE_MQ.matches
}

function setActiveTab(tab: TabId): void {
  layoutEl.dataset.activeTab = tab
  tabButtons.forEach((btn) => {
    const selected = btn.dataset.tab === tab
    btn.setAttribute('aria-selected', String(selected))
    btn.classList.toggle('tab-btn--active', selected)
  })

  if (tab === 'setup') {
    layoutEl.scrollTo(0, 0)
  } else {
    document.querySelector<HTMLElement>('.sidebar-solution')?.scrollTo(0, 0)
  }
}

function syncGateSelect(): void {
  gateCountEl.value = String(clampGateCount(state.gateCount))
}

function refreshCards(): void {
  updateLockCards(lockCardsEl, state)
}

function clearCachedSolution(): void {
  cachedSolutionMoves = undefined
  cachedSolutionResult = undefined
  inputsEl.innerHTML = ''
}

function syncSolutionHint(): void {
  solutionHintEl.textContent = solutionViewHint(solutionView)
}

function renderCachedSolution(): void {
  if (!cachedSolutionResult) {
    inputsEl.innerHTML = ''
    return
  }

  renderSolution(inputsEl, cachedSolutionResult, {
    view: solutionView,
    gateCount: clampGateCount(state.gateCount),
  })
}

function currentStartPins(): (number | null)[] {
  const gateCount = clampGateCount(state.gateCount)
  return state.cards
    .slice(0, gateCount)
    .map((card) => (card.startPin === null ? null : card.startPin + 1))
}

function enteredStartPinCount(pins: readonly (number | null)[]): number {
  let count = 0
  for (const pin of pins) {
    if (pin === null) break
    count++
  }
  return count
}

function scheduleRemoteMatch(): void {
  if (matchTimer !== undefined) window.clearTimeout(matchTimer)

  const pins = currentStartPins()
  if (enteredStartPinCount(pins) < MIN_MATCH_PIN_COUNT) {
    matchRequestId++
    chestPanelController?.clearRemoteMatches(t('startFirstPinsToSearch'))
    return
  }

  matchTimer = window.setTimeout(async () => {
    const requestId = ++matchRequestId
    try {
      const matches = await matchLocks(clampGateCount(state.gateCount), currentStartPins())
      if (requestId !== matchRequestId) return
      chestPanelController?.renderRemoteMatches(matches)
    } catch (error) {
      if (requestId !== matchRequestId) return
      chestPanelController?.clearRemoteMatches(
        error instanceof Error ? `${t('databaseUnavailable')}: ${error.message}` : t('databaseUnavailable'),
      )
    }
  }, 250)
}

function handleLockChange(): void {
  clearCachedSolution()
  refreshCards()
  scheduleRemoteMatch()
}

function handleChestLoad(chest?: ChestRecord): void {
  cachedSolutionMoves = chest?.solutionMoves
  cachedSolutionResult =
    cachedSolutionMoves !== undefined ? { ok: true, moves: cachedSolutionMoves } : undefined
  syncGateSelect()
  remountCards()
  renderCachedSolution()
  scheduleRemoteMatch()
}

async function runSolve(): Promise<void> {
  const result = solveLock(state)
  cachedSolutionResult = result
  renderCachedSolution()

  if (result.ok && isMobileLayout()) {
    setActiveTab('solution')
  }

  if (!result.ok) return

  cachedSolutionMoves = result.moves
  await submitSolvedChestFromPanel(chestPanelEl, state, result.moves)
}

function remountCards(): void {
  mountLockCards(lockCardsEl, state, {
    onChange: handleLockChange,
    onSolve: runSolve,
  })
}

tabButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    setActiveTab(btn.dataset.tab as TabId)
  })
})

function resetLock(): void {
  resetGameState(state)
  clearCachedSolution()
  clearChestName(chestPanelEl)
  remountCards()
  chestPanelController?.clearRemoteMatches()
}

gateCountEl.addEventListener('change', () => {
  state.gateCount = clampGateCount(Number(gateCountEl.value))
  clearCachedSolution()
  remountCards()
  scheduleRemoteMatch()
})

solutionViewInputs.forEach((input) => {
  input.addEventListener('change', () => {
    if (!input.checked) return
    solutionView = input.value as SolutionView
    syncSolutionHint()
    renderCachedSolution()
  })
})

resetLockEl.addEventListener('click', resetLock)

languagePickerEl.addEventListener('change', () => {
  setLanguage(languagePickerEl.value as Language)
  window.location.reload()
})

syncGateSelect()
syncSolutionHint()
setActiveTab('setup')
remountCards()

chestPanelController = mountChestPanel(chestPanelEl, {
  state,
  onLoad: handleChestLoad,
  getSolutionMoves: () => cachedSolutionMoves,
})
scheduleRemoteMatch()
}

if (isAdminRoute) {
  renderAdminApp()
} else if (new URLSearchParams(window.location.search).has('admin')) {
  window.location.replace('/admin')
} else {
  renderSolverApp()
  void trackPageView()
}
