// @vitest-environment happy-dom
// Settings v1.3.11: the root, the pages, the search and the rest wheels. Every row the search
// knows has to be a row on its page, and every page and row title has a word in each pack.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PAGES, PAGE_IDS, ROOT_GROUPS, SEARCH, pageVisible, searchSettings, pageTrail, fold } from '../src/views/settings-pages'

Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})

const mocks: any = vi.hoisted(() => {
  const state: any = { S: null, user: null, sync: null, push: false, sheets: [], navs: [], toast: null }
  state.snapshot = () => ({
    S: state.S, user: state.user, sync: state.sync, config: null,
    update: (mut: any) => { const next: any = structuredClone(state.S); mut(next); state.S = next },
    replaceState: vi.fn(), setUser: vi.fn(), pullState: vi.fn(), pushState: vi.fn(), setUnit: vi.fn(),
    resetEverything: vi.fn(), resetDemo: vi.fn(), importBackup: vi.fn(), importConflict: vi.fn(),
  })
  return state
})
vi.mock('../src/store/useStore', () => {
  const useStore: any = (selector: any) => selector ? selector(mocks.snapshot()) : mocks.snapshot()
  useStore.getState = mocks.snapshot
  useStore.subscribe = () => () => {}
  return { useStore, DEF: { reminder: { time: '17:30' } }, hasData: () => false }
})
vi.mock('../src/store/useUI', () => {
  const snap: any = () => ({ toast: mocks.toast, openSheet: (render: any) => { mocks.sheets.push(render); return { close: vi.fn() } } })
  const useUI: any = (selector: any) => selector ? selector(snap()) : snap()
  useUI.getState = snap
  return { useUI }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => (...a: any) => mocks.navs.push(a) }))
vi.mock('../src/lib/api', () => ({ api: vi.fn((path: any) => Promise.resolve(path === '/api/account/passkeys' ? { passkeys: [] } : {})), webauthnOK: () => false, passkeyLogin: vi.fn(), passkeyRegister: vi.fn(), IS_ANDROID: false }))
vi.mock('../src/lib/push', () => ({ pushSupported: () => mocks.push, enablePush: vi.fn(), disablePush: vi.fn(), sendTestPush: vi.fn(), syncPushSubscription: vi.fn(() => Promise.resolve(mocks.pushOn)) }))
vi.mock('../src/lib/wakelock', () => ({ wakeLockSupported: () => true }))

vi.mock('../src/sheets', () => ({
  starterPlanSheet: vi.fn(), confirmSheet: vi.fn(), importFromApp: vi.fn(), importFromHevy: vi.fn(),
  equipmentProfileSheet: vi.fn(), plateInventorySheet: vi.fn(), menuSheet: vi.fn(),
}))

import { configureTestClient } from './client-fixture'
import { configureSettingsB } from '../src/views/SettingsB'
import { configureSettingsA } from '../src/lib/settings-a-services'
import * as sheets from '../src/sheets'
import Settings from '../src/views/Settings'

Object.assign(globalThis,{__APP_VERSION__:'test'})

let host: any, root: any
beforeEach(() => {
  configureTestClient()
  configureSettingsB({navigate:()=>{},starterPlanSheet:sheets.starterPlanSheet,confirmSheet:sheets.confirmSheet,menuSheet:sheets.menuSheet,equipmentProfileSheet:profile=>sheets.equipmentProfileSheet(profile??undefined),plateInventorySheet:sheets.plateInventorySheet,dumbbellInventorySheet:()=>{}})
  configureSettingsA({confirmSheet:sheets.confirmSheet,menuSheet:sheets.menuSheet,download:()=>{},importFromApp:()=>{},importFromHevy:()=>{}})
  mocks.S = {
    unit: 'kg', restSec: 90, restPauseSec: 15, sound: true, vibrate: true, effort: 'none', gifSize: 'full', lang: 'en',
    workouts: [], routines: [], exWeights: {}, equipProfiles: [{ id: 'p1', name: 'Home', equipment: [] }], activeEquipId: 'p1',
    reminder: { on: false, time: '17:30' },
  }
  mocks.user = null
  mocks.sync = null
  mocks.push = false
  mocks.pushOn = false
  mocks.toast = vi.fn()
  mocks.sheets = []
  mocks.navs = []
  Object.defineProperty(navigator, 'vibrate', { value: () => true, configurable: true, writable: true })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  delete (navigator as any).vibrate
})

const mount: any = (page: any = null, find: any = null, via: any = null) => act(() => root.render(<Settings page={page} find={find} via={via} />))
const rowTitled: any = (title: any) => [...host.querySelectorAll('.lrow')].find((r: any) => r.querySelector('.lrow-t')?.textContent === title)
const titles: any = () => [...host.querySelectorAll('.lrow .lrow-t')].map((e: any) => e.textContent)

it('finds the effort tracking switch in Settings search', () => {
 expect(searchSettings("Don't track effort", guestWeb).map((x: any) => x.title)).toContain("Don't track effort")
})

// This test's guest in a browser, as the page itself sees it.
const guestWeb: any = {
  user: null, mobile: false, android: false, demo: false, wakeOK: true, hasMedia: false, pwOn: false, webauthn: false,
  sound: true, playOnSilent: false, canVibrate: true, vibrate: true, profiles: true, nameLang: false,
  pushOK: false, reminderOn: false, nudge: false, autoBackup: false, synced: false, installTip: true, androidWeb: false,
}

describe('the root', () => {
  it('is an account card and one row per page, in the four groups, with value previews', () => {
    mount()
    expect(host.querySelector('.sp-acct .lrow-t').textContent).toBe('Guest')
    expect(host.querySelector('.sp-acct .lrow-s').textContent).toBe('Your data lives on this device. Sign in to sync.')

    expect(titles()).toEqual(['Guest', 'Workout', 'Timer alerts', 'Plan & schedule', 'Units & language', 'Equipment', 'Look & Home', 'Data & backup', 'About & updates'])
    expect(rowTitled('Workout').querySelector('.lrow-v').textContent).toBe('1:30 rest · Cards')
    expect(rowTitled('Timer alerts').querySelector('.lrow-v').textContent).toBe('Sound · Vibrate')
    expect(rowTitled('Plan & schedule').querySelector('.lrow-v').textContent).toMatch(/^Fixed Week · Mon/)
    expect(rowTitled('Units & language').querySelector('.lrow-v').textContent).toBe('kg · English')
    expect(rowTitled('Equipment').querySelector('.lrow-v').textContent).toBe('Everything')
    expect(rowTitled('About & updates').querySelector('.lrow-v').textContent).toMatch(/^v\d|^vtest/)
  })

  it('marks the page rows so a long preview wraps instead of losing its second half', () => {
    mount()
    const rows: any = ['Workout', 'Timer alerts', 'Plan & schedule', 'Units & language', 'Look & Home'].map(rowTitled)
    for (const r of rows) expect(r.classList.contains('sp-root-row')).toBe(true)
    // index.css: the marked rows' value may wrap, and never shrinks below its longest word
    const css: any = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')
    const rule: any = css.match(/^\.lrow\.sp-root-row \.lrow-v\{([^}]*)\}/m)?.[1] || ''
    expect(rule).toMatch(/white-space:normal/)
    expect(rule).toMatch(/line-clamp:3/)
    expect(rule).toMatch(/min-width:min-content/)
    // the sub-page title takes a second line rather than an ellipsis ("Alertas do temporizador")
    const title: any = css.match(/^\.sp-title\{([^}]*)\}/m)?.[1] || ''
    expect(title).not.toMatch(/nowrap/)
    expect(title).toMatch(/line-clamp:2/)
  })

  it('previews a rest that was never on the old list, and no timer at all', () => {
    mocks.S.restSec = 105
    mount()
    expect(rowTitled('Workout').querySelector('.lrow-v').textContent).toBe('1:45 rest · Cards')
    mocks.S.restSec = 0
    mount()
    expect(rowTitled('Workout').querySelector('.lrow-v').textContent).toBe('No rest timer · Cards')
  })

  it('signed in, Reminders is there and the card names the account', () => {
    mocks.user = { id: 'u1', name: 'Dana' }
    mount()
    expect(titles()).toContain('Reminders')
    expect(host.querySelector('.sp-acct .lrow-t').textContent).toBe('Dana')
    expect(host.querySelector('.sp-avatar').textContent).toBe('D')
  })

  it('a row opens its page; the card opens Account', () => {
    mount()
    act(() => rowTitled('Timer alerts').click())
    act(() => host.querySelector('.sp-acct').click())
    expect(mocks.navs).toEqual([['/settings/alerts'], ['/settings/account']])
  })

  it('searches every setting and a hit goes to its page with the row to flash', () => {
    mount()
    const input: any = host.querySelector('.sp-search input')
    const type: any = (v: any) => act(() => {
      const set: any = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      set.call(input, v)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    type('haptic')
    expect(titles()).toEqual(['Vibrate'])
    expect(host.querySelector('.lrow .lrow-s').textContent).toBe('Timer alerts')
    act(() => rowTitled('Vibrate').click())
    expect(mocks.navs.at(-1)).toEqual(['/settings/alerts', { state: { find: 'Vibrate' } }])
    type('zzzz')
    expect(host.querySelector('.sp-empty').textContent).toBe('No setting matches “zzzz”.')
  })
})

// Each search hit is a row on its page, on the device and profile it was offered for. The ctx is
// the one Settings builds (views/Settings.jsx) for the same mocks; push-dependent web rows are
// the exception the page settles on open (`via`), tested on their own below.
describe('the search lands on a row', () => {
  const scenarios: any = {
    'guest in a browser': () => {},
    'signed in, browser without push': () => { mocks.user = { id: 'u1', name: 'Dana' }; mocks.sync = { status: 'ok', server: 'https://gym.example' } },
  }
  const ctxNow: any = () => ({
    ...guestWeb, user: mocks.user, pushOK: mocks.push,
    reminderOn: !!mocks.S.reminder?.on, nudge: !!mocks.S.reminder?.nudge, autoBackup: !!mocks.S.autoBackup,
    synced: !!mocks.sync, installTip: true, hasMedia: false, wakeOK: true,
  })
  for (const [name, setUp] of Object.entries(scenarios) as [string,()=>void][]) it(name, async () => {
    setUp()
    const ctx: any = ctxNow()
    const byPage: any = {}
    for (const e of SEARCH) if (pageVisible(PAGES[e.page]!.parent || e.page, ctx) && (!e.when || e.when(ctx))) (byPage[e.page] ||= []).push(e.title)
    for (const [page, want] of Object.entries(byPage) as [string,string[]][]) {
      mount(page)
      await act(async () => {})   // the passkey list, asked of the server on open
      const have: any = [...titles(), ...[...host.querySelectorAll('.btn')].map((b: any) => b.textContent.trim())]
      for (const title of want) expect(have, `${page}: ${title}`).toContain(title)
    }
  })

  it('finds the rows that used to be missing', () => {
    const tr: any = (s: any) => s
    const web: any = { ...guestWeb, user: { id: 'u' }, synced: true, pushOK: true, reminderOn: true, nudge: true }
    expect(searchSettings('reminder time', web, tr).map((h: any) => h.title)).toEqual(['Reminder time'])
    expect(searchSettings('tone', web, tr).map((h: any) => h.title)).toContain('Nudge tone')
    expect(searchSettings('test notification', web, tr).map((h: any) => h.title)).toEqual(['Send test notification'])
    expect(searchSettings('server', web, tr).map((h: any) => h.title)).toContain('Sync now')
    expect(searchSettings('sync', web, tr).map((h: any) => h.title)).toContain('Sync now')
    expect(searchSettings('loop', web, tr).map((h: any) => h.title)).toContain('How you train')
    expect(searchSettings('swipe', web, tr)[0]!.title).toBe('Swipe actions')
    expect(searchSettings('gesture', web, tr).map((h: any) => h.title)).toEqual(['Swipe actions'])
    expect(searchSettings('home screen', web, tr).map((h: any) => h.title)).toEqual(['In Safari: Share → Add to Home Screen'])
    expect(searchSettings('install', { ...web, androidWeb: true }, tr).map((h: any) => h.title)).toEqual(['In Chrome: ⋮ menu → Add to Home screen'])
  })

  it('a web reminder row waits for push to answer, and flashes Push notifications when it stays off', async () => {
    vi.useFakeTimers()
    try {
      mocks.user = { id: 'u1', name: 'Dana' }
      mocks.push = true
      mocks.S.reminder = { on: true, time: '17:30' }
      mount('reminders', 'Nudge me when I skip a planned workout', 'Push notifications')
      await act(async () => { await vi.advanceTimersByTimeAsync(1600) })
      expect(rowTitled('Push notifications').classList.contains('sp-flash')).toBe(true)
      expect(mocks.toast).toHaveBeenCalledWith('Turn on push notifications first.')

      // push on: the row appears once the server answers, and that row is the one flashed
      mocks.pushOn = true
      mocks.toast.mockClear()
      act(() => root.render(null))
      mount('reminders', 'Nudge me when I skip a planned workout', 'Push notifications')
      await act(async () => { await vi.advanceTimersByTimeAsync(50) })
      expect(rowTitled('Nudge me when I skip a planned workout').classList.contains('sp-flash')).toBe(true)
      await act(async () => { await vi.advanceTimersByTimeAsync(1600) })
      expect(mocks.toast).not.toHaveBeenCalled()
    } finally { vi.useRealTimers() }
  })
})

describe('the search query', () => {
  const type: any = (v: any) => act(() => {
    const input: any = host.querySelector('.sp-search input')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, v)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  afterEach(() => window.history.replaceState(null, ''))
  it('comes back with Back to the same entry, and is gone when Settings is opened afresh', () => {
    window.history.replaceState({ key: 'root1', idx: 1 }, '')
    mount()
    type('vib')
    act(() => root.render(null))
    mount()                                                   // Back from the hit: same entry
    expect(host.querySelector('.sp-search input').value).toBe('vib')
    expect(titles()).toContain('Vibrate')
    act(() => root.render(null))
    window.history.replaceState({ key: 'root2', idx: 3 }, '')  // the gear, a tab, Android Back then the gear
    mount()
    expect(host.querySelector('.sp-search input').value).toBe('')
    expect(titles()).toContain('Timer alerts')
  })
})

describe('the pages', () => {
  it('each search entry is a row on its page (guest in a browser)', () => {
    const byPage: any = {}
    for (const e of SEARCH) if (pageVisible(PAGES[e.page]!.parent || e.page, guestWeb) && (!e.when || e.when(guestWeb))) (byPage[e.page] ||= []).push(e.title)
    expect(Object.keys(byPage).sort()).toEqual(['about', 'advanced', 'alerts', 'data', 'equipment', 'look', 'plan', 'units', 'workout'])
    for (const [page, want] of Object.entries(byPage) as [string,string[]][]) {
      mount(page)
      const have: any = titles()
      for (const title of want) expect(have, `${page}: ${title}`).toContain(title)
    }
  })

  it('every old row has a home: the Workout page holds the rest, logging and the before/during rows', () => {
    mount('workout')
    expect([...host.querySelectorAll('.sect-t')].map((e: any) => e.textContent)).toEqual(['Rest', 'Logging', 'Before and during'])
    expect(titles()).toEqual(['Rest timer', 'Rest-pause rest', 'Effort scale', "Don't track effort", 'Shown under each exercise', 'Layout',
      'Collapse completed exercises', 'Weigh in before workouts', 'Keep screen awake', 'Fine-tuning'])
    // QA 10-05: the "screen stays on" line is the awake row's own subtitle, not a section footer
    // that read as if it explained the animations above it.
    expect(rowTitled('Keep screen awake').querySelector('.lrow-s').textContent).toMatch(/^The screen stays on/)
    expect(rowTitled('Exercise animations')).toBeUndefined()
    expect([...host.querySelectorAll('.sect-f')].some((f: any) => /screen stays on/.test(f.textContent))).toBe(false)
    mount('advanced')
    expect(titles()).toEqual(['Planned sessions start from', 'Keep timing after target', 'Weight and reps buttons',
      'Drop and burst shortcuts on every set', 'Swipe actions', 'Exercise chips at the top', 'Superset buttons in the exercise header', 'Move, swap and remove buttons below the exercise'])
  })

  it('Collapse completed exercises is saved for every session and drops a running session\'s own choice', () => {
    mocks.S.active = { collapseCompleted: false, entries: [] }
    mount('workout')
    const sw: any = rowTitled('Collapse completed exercises').querySelector('[role="switch"]')
    expect(sw.getAttribute('aria-checked')).toBe('false')
    act(() => sw.click())
    expect(mocks.S.collapseCompleted).toBe(true)
    expect('collapseCompleted' in mocks.S.active).toBe(false)
  })

  it('the Fine-tuning switches write S.wc as the old Workout controls sheet did', () => {
    mount('advanced')
    act(() => rowTitled('Superset buttons in the exercise header').querySelector('[role="switch"]').click())
    expect(mocks.S.wc.pairButtons).toBe(true)
    // the chip row at the top of a workout (#323) is on by default; its switch turns it off
    const chips: any = rowTitled('Exercise chips at the top').querySelector('[role="switch"]')
    expect(chips.getAttribute('aria-checked')).toBe('true')
    act(() => chips.click())
    expect(mocks.S.wc.exerciseChips).toBe(false)
  })

  it('a sub-page names where back goes; Fine-tuning goes back to Workout', () => {
    mount('alerts')
    expect(host.querySelector('.sp-back').textContent).toBe('Settings')
    expect(host.querySelector('.sp-back').hasAttribute('aria-label')).toBe(false)   // its name is the word it shows
    expect(host.querySelector('.sp-title').textContent).toBe('Timer alerts')
    mount('advanced')
    expect(host.querySelector('.sp-back').textContent).toBe('Workout')
    act(() => host.querySelector('.sp-back').click())
    expect(mocks.navs.at(-1)).toEqual(['/settings/workout', { replace: true }])
  })

  it('a search hit flashes its row', () => {
    mount('alerts', 'Flash the screen')
    expect(rowTitled('Flash the screen').classList.contains('sp-flash')).toBe(true)
  })
})

describe('the rest wheels', () => {
  const doneIn: any = (sheet: any) => {
    const close: any = vi.fn()
    const h: any = document.createElement('div'); document.body.appendChild(h)
    const r: any = createRoot(h)
    act(() => r.render(sheet(close)))
    return { h, r, close }
  }
  it('Rest timer opens the wheel and stores any value as seconds in restSec', () => {
    mount('workout')
    expect(rowTitled('Rest timer').querySelector('.lrow-v').textContent).toBe('1:30')
    act(() => rowTitled('Rest timer').click())
    const { h, r }: any = doneIn(mocks.sheets.at(-1))
    expect(h.querySelector('h3').textContent).toBe('Rest timer')
    const [min, sec]: any = h.querySelectorAll('[role="spinbutton"]')
    expect(min.getAttribute('aria-valuemax')).toBe('15')
    act(() => { sec.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageUp', bubbles: true })) })
    act(() => { sec.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })) })
    act(() => { [...h.querySelectorAll('button')].find((b: any) => b.textContent === 'Done').click() })
    expect(mocks.S.restSec).toBe(101)
    act(() => r.unmount()); h.remove()
    mount('workout')
    expect(rowTitled('Rest timer').querySelector('.lrow-v').textContent).toBe('1:41')
  })

  it('0:00 is the timer off', () => {
    mocks.S.restSec = 0
    mount('workout')
    expect(rowTitled('Rest timer').querySelector('.lrow-v').textContent).toBe('Off')
  })

  it('Rest-pause rest uses the wheel too, 5 s to 5 minutes', () => {
    mount('workout')
    act(() => rowTitled('Rest-pause rest').click())
    const { h, r }: any = doneIn(mocks.sheets.at(-1))
    const [min, sec]: any = h.querySelectorAll('[role="spinbutton"]')
    expect(min.getAttribute('aria-valuemax')).toBe('5')
    act(() => { sec.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })) })
    act(() => { [...h.querySelectorAll('button')].find((b: any) => b.textContent === 'Done').click() })
    expect(mocks.S.restPauseSec).toBe(5)
    act(() => r.unmount()); h.remove()
  })
})

