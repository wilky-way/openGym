import { configureUx, createBrowserUx } from '../../src/platform/ux'
// @vitest-environment happy-dom
// Favourites (issue #6): the Library floats starred exercises to the top of the current
// result list — after the search and body-part filters, without reordering the rest.
import React, { act } from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Library from '../../src/views/Library'
import { EXDB } from '@opengym/core/exercises'
import { _setLangState } from '@opengym/core/i18n-core'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks: any = vi.hoisted(() => {
  const state: any = { S: null }
  state.snapshot = () => ({ S: state.S, user: null, update: (mut: any) => { const next: any = structuredClone(state.S); mut(next); state.S = next } })
  return state
})
vi.mock('../../src/store/useStore', () => {
  const useStore: any = (selector: any) => selector ? selector(mocks.snapshot()) : mocks.snapshot()
  useStore.getState = mocks.snapshot
  return { useStore }
})
vi.mock('../../src/lib/nav', () => ({ nav: () => {} }))
vi.mock('../../src/views/view-services', () => ({ exerciseDetailSheet: vi.fn(), addToRoutineSheet: vi.fn(), customExSheet: vi.fn() }))

const mounted: any = []
function render() {
  const host: any = document.createElement('div')
  document.body.appendChild(host)
  const root: any = createRoot(host)
  mounted.push(root)
  act(() => root.render(<Library />))
  return host
}
const names: any = (host: any) => [...host.querySelectorAll('.item .tt')].map((el: any) => el.textContent).slice(1)   // drop "Create your own"
const cssSource: any = readFileSync(resolve(process.cwd(), 'src/views/views.css'), 'utf8')

beforeEach(() => {
  mocks.S = { unit: 'kg', lang: 'en', routines: [], workouts: [], customEx: [], exWeights: {}, equipProfiles: [], activeEquipId: null, equipFilterOn: false }
  document.body.innerHTML = ''
})
afterEach(() => { act(() => { mounted.splice(0).forEach((root: any) => root.unmount()) }) })

describe('Library favourites', () => {
  it('puts favourites first, marked with a star, and leaves the rest in catalogue order', () => {
    const plain: any = names(render())
    act(() => { mounted.splice(0).forEach((root: any) => root.unmount()) })
    const fav: any = [plain[6], plain[2]]
    mocks.S.favEx = fav.map((n: any) => EXDB.find((e: any) => e.n === n)!.id)
    const host: any = render()
    const shown: any = names(host)
    expect(shown.slice(0, 2)).toEqual(plain.filter((n: any) => fav.includes(n)))
    expect(shown.slice(2)).toEqual(plain.filter((n: any) => !fav.includes(n)))
    const rows: any = [...host.querySelectorAll('.item')].slice(1)
    expect(rows[0].querySelector('.fav-star')).not.toBeNull()
    expect(rows[2].querySelector('.fav-star')).toBeNull()
  })

  // The Library is the one page whose header puts a text button beside the title, so it leaves the
  // title the least room of anywhere in the app — 95px for Polish, 125px for Russian on a 320px
  // screen. The button must stay reachable (it is flex:none, the title block shrinks), but a title
  // squeezed that far must not come apart: at 34px "Упражнения" broke into three lines, so the
  // title drops a step on phone widths and breaks a word only as a last resort.
  it('keeps the header button reachable without shredding the title', () => {
    expect(cssSource).toContain('.hdr>div{min-width:0}')
    expect(cssSource).toContain('.hdr>.btn{flex:none}')
    expect(cssSource).toMatch(/@media \(max-width:420px\)\{\.hdr h1\{font-size:30px\}\}/)
    const h1: any = cssSource.match(/^\.hdr h1\{([^}]*)\}/m)
    expect(h1?.[1]).toContain('overflow-wrap:break-word')
    expect(h1[1]).not.toContain('overflow-wrap:anywhere')
    expect(h1[1]).not.toContain('hyphens:auto')
  })

  it('keeps a favourite on top inside a body-part filter, but never pulls one in from elsewhere', () => {
    const chest: any = EXDB.filter((e: any) => e.bp === 'chest')
    const legs: any = EXDB.find((e: any) => e.bp !== 'chest')
    mocks.S.favEx = [chest[4].id, legs.id]
    const host: any = render()
    const chip: any = [...host.querySelectorAll('.chips .chip')].find((b: any) => b.textContent === 'chest')
    act(() => chip.click())
    const shown: any = names(host)
    expect(shown[0]).toBe(chest[4].n)
    expect(shown).not.toContain(legs.n)
  })
})

// #290 took the title-casing off every translated name; the packs stored lower-case then read
// lower-case down the whole list. Only German's own casing is left alone.
// The header counts the catalogue, and from the first exercise of your own, those too (owner
// request for v1.3.10): "1324 exercises + 5 of your own". It has to stay one line on a
// phone, so it runs under the title row at full width, never wraps, and ellipsizes as a last resort.
describe('Library header count', () => {
  const sub: any = (host: any) => host.querySelector('.hdr .sub').textContent
  const own: any = (n: any) => Array.from({ length: n }, (_: any, i: any) => ({ id: 'c' + i, n: 'my move ' + i, bp: 'chest', eq: '', custom: true }))
  afterEach(() => _setLangState('en', {}, null, null))

  it('shows only the catalogue while you have no exercises of your own', () => {
    expect(sub(render())).toBe(`${EXDB.length} exercises`)
  })

  it('adds "+ 1 of your own" for a single custom exercise', () => {
    mocks.S.customEx = own(1)
    expect(sub(render())).toBe(`${EXDB.length} exercises + 1 of your own`)
  })

  it('adds the count for several custom exercises', () => {
    mocks.S.customEx = own(5)
    expect(sub(render())).toBe(`${EXDB.length} exercises + 5 of your own`)
  })

  it('keeps the subtitle on one line on wider screens, clipping with an ellipsis', () => {
    expect(sub(render())).toBeTruthy()
    const rule: any = cssSource.match(/^\.hdr\.lib-hdr>\.sub\.lib-count\{([^}]*)\}/m)?.[1] || ''
    expect(rule).toContain('white-space:nowrap')
    expect(rule).toContain('overflow:hidden')
    expect(rule).toContain('text-overflow:ellipsis')
    expect(rule).toContain('flex:1 0 100%')
    expect(cssSource).toMatch(/^\.hdr\.lib-hdr\{[^}]*flex-wrap:wrap/m)
  })

  it('lets the subtitle wrap on narrow phones so nothing is cut at 320 px', () => {
    const narrow: any = cssSource.match(/@media \(max-width:360px\)\{\.hdr\.lib-hdr>\.sub\.lib-count\{([^}]*)\}\}/)?.[1] || ''
    expect(narrow).toContain('white-space:normal')
    expect(narrow).toContain('overflow:visible')
  })
})

describe('Library similar exercises', () => {
  const search: any = (host: any, text: any) => {
    const input: any = host.querySelector('.search input')
    const setter: any = Object.getOwnPropertyDescriptor((window as any).HTMLInputElement.prototype, 'value')!.set
    act(() => { setter.call(input, text); input.dispatchEvent(new Event('input', { bubbles: true })) })
  }
  const label: any = (host: any) => host.querySelector('.similar-label')?.textContent || null

  it('offers what comes close instead of "No match" when nothing matches exactly', () => {
    const host: any = render()
    search(host, 'dumbbell curl qwxz')
    expect(label(host)).toBe('No exact match. These come close:')
    expect(host.textContent).not.toContain('No match')
    expect(names(host).slice(0, 5).some((n: any) => /dumbbell.*curl/.test(n))).toBe(true)
  })

  it('lists similar ones under a short result list, without repeating a result', () => {
    const host: any = render()
    search(host, 'face pull')
    expect(label(host)).toBe('Similar exercises')
    const all: any = names(host)
    expect(new Set(all).size).toBe(all.length)
  })
})

beforeEach(() => { configureUx(createBrowserUx()); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-01-22T12:00:00Z')) })
afterEach(() => vi.useRealTimers())
