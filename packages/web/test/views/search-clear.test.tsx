// @vitest-environment happy-dom
import { configureUx, createBrowserUx } from '../../src/platform/ux'
// The × in the exercise search (Library and the exercise picker), beside the live result
// count (search-count.test.jsx). It shows while there is text, one tap empties the search, and it
// clears only the text: a body-part filter that also narrows the list keeps its count.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { DEF, useStore } from '../../src/store/useStore'
import { useUI } from '../../src/store/useUI'
import Library from '../../src/views/Library'
import { EXDB } from '@opengym/core/exercises'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const mounted: any = []
function mount(node: any) {
  const host: any = document.createElement('div')
  document.body.appendChild(host)
  const root: any = createRoot(host)
  mounted.push(root)
  act(() => root.render(node))
  return host
}

function type(el: any, value: any) {
  Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value')!.set!.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}
const chip: any = (host: any, text: any) => [...host.querySelectorAll('.chips .chip')].find((b: any) => b.textContent.trim() === text)
const clear: any = (host: any) => host.querySelector('.search .clear')
const count: any = (host: any) => host.querySelector('.search .search-count')

beforeEach(() => {
  configureUx(createBrowserUx())
  useUI.setState({ sheets: [], toastMsg: '' })
  useStore.setState({ S: structuredClone(DEF), user: null })
  document.body.innerHTML = ''
})
afterEach(() => { act(() => { mounted.splice(0).forEach((root: any) => root.unmount()) }) })

describe('exercise search clear button', () => {
  const cases: [string, () => HTMLDivElement][] = [
    ['Library', () => mount(<Library />)],
  ]
  for (const [where, open] of cases) {
    it(`${where}: shows with text, and one tap empties the search`, () => {
      const host: any = open()
      const input: any = host.querySelector('.search input')
      expect(clear(host)).toBeNull()
      act(() => type(input, 'bench press'))
      expect(clear(host).getAttribute('aria-label')).toBe('Clear')
      expect(host.querySelector('.search').classList.contains('has-clear')).toBe(true)
      act(() => clear(host).click())
      expect(input.value).toBe('')
      expect(clear(host)).toBeNull()
      expect(count(host)).toBeNull()
      expect(host.querySelector('.search').classList.contains('has-clear')).toBe(false)
    })

    it(`${where}: clears only the text; a body-part filter keeps its count`, () => {
      const host: any = open()
      act(() => chip(host, 'neck').click())
      act(() => type(host.querySelector('.search input'), 'stretch'))
      act(() => clear(host).click())
      expect(host.querySelector('.search input').value).toBe('')
      expect(Number(count(host).textContent)).toBe(EXDB.filter((e: any) => e.bp === 'neck').length)
    })
  }
})
