// @vitest-environment happy-dom
import { configureUx, createBrowserUx } from '../../src/platform/ux'
// List or cards (S.exerciseView): one button beside the search field switches every exercise
// list — the Library, the add-exercise picker and the muscle explorer — between rows with a 50px
// thumbnail and a grid of picture cards with the name under the picture. The list stays the default, so a profile that
// never touches the button sees exactly what it saw before.
import React, { act } from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { DEF, useStore } from '../../src/store/useStore'
import { useUI } from '../../src/store/useUI'
import Library from '../../src/views/Library'
import Muscles from '../../src/views/Muscles'

const mounted: any = []
const view: any = () => useStore.getState().S.exerciseView
function render(node: any) {
  const host: any = document.createElement('div')
  document.body.appendChild(host)
  const root: any = createRoot(host)
  mounted.push(root)
  act(() => root.render(node))
  return host
}
// Renders whatever sheet is on top and returns its host element.

const toggle: any = (host: any) => host.querySelector('button[aria-label="Cards"]')
// The button belongs to the search row, next to the field — never in a header (see the next test).
const besideSearch: any = (btn: any) => btn.parentElement.classList.contains('search-row') && !!btn.parentElement.querySelector('.search input')
const isCards: any = (host: any) => host.querySelector('.list').classList.contains('ex-grid')
const pickMuscle: any = (host: any) => act(() => host.querySelector('.chip[aria-pressed]').click())
const setView: any = (v: any) => useStore.setState((s: any) => ({ S: { ...s.S, exerciseView: v } }))

beforeEach(() => {
  configureUx(createBrowserUx())
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ sheets: [], toastMsg: '' })
  useStore.setState({ S: structuredClone(DEF), user: null })
  document.body.innerHTML = ''
})
afterEach(() => { act(() => { mounted.splice(0).forEach((root: any) => root.unmount()) }) })

describe('exercise list or cards', () => {
  it('Library: a list until the button beside the search turns the cards on, and back', () => {
    const host: any = render(<Library />)
    expect(isCards(host)).toBe(false)
    expect(besideSearch(toggle(host))).toBe(true)
    expect(toggle(host).closest('.hdr')).toBeNull()
    expect(toggle(host).getAttribute('aria-pressed')).toBe('false')
    act(() => toggle(host).click())
    expect(view()).toBe('cards')
    expect(isCards(host)).toBe(true)
    expect(toggle(host).getAttribute('aria-pressed')).toBe('true')
    act(() => toggle(host).click())
    expect(view()).toBe('list')
    expect(isCards(host)).toBe(false)
  })

  it('reads a profile saved before the setting existed as the list', () => {
    useStore.setState((s: any) => { const S: any = { ...s.S }; delete S.exerciseView; return { S } })
    expect(isCards(render(<Library />))).toBe(false)
  })

  it('keeps "Create your own exercise" a full-width row above the cards', () => {
    setView('cards')
    const first: any = render(<Library />).querySelector('.list.ex-grid > .item')
    expect(first.classList.contains('ex-new')).toBe(true)
  })



  it('Muscles page: the results follow the setting, with the button beside their search', () => {
    setView('cards')
    const host: any = render(<Muscles />)
    pickMuscle(host)
    expect(isCards(host)).toBe(true)
    expect(besideSearch(toggle(host))).toBe(true)
    expect(toggle(host).closest('.hdr')).toBeNull()
  })

  // The desktop layout turns every #app list into two columns and forces every sheet list back
  // into one column, both on an id selector — the grid has to win over each of them.
  it('lays the cards out as a grid over the desktop two-column and the sheet column rules', () => {
    const css: any = readFileSync(resolve(process.cwd(), 'src/views/views.css'), 'utf8')
    const rule: any = css.match(/^([^{}\n]*\.list\.ex-grid[^{}\n]*)\{([^}]*)\}/m)
    expect(rule?.[1]).toContain('#app .list.ex-grid')
    expect(rule[1]).toContain('#modal-root .list.ex-grid')
    expect(rule[2]).toContain('display:grid')
  })
})
