// @vitest-environment happy-dom
import { configureUx, createBrowserUx } from '../../src/platform/ux'
// The live result count in the exercise search (idea: GitLab !31, sagnikpatra301): the Library
// and the exercise picker show how many exercises are left once a search or a filter narrows
// the list, and say it in words to a screen reader.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { DEF, useStore } from '../../src/store/useStore'
import { useUI } from '../../src/store/useUI'
import Library from '../../src/views/Library'
import { EXDB, searchExercises } from '@opengym/core/exercises'

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
const count: any = (host: any) => host.querySelector('.search .search-count')

beforeEach(() => {
  configureUx(createBrowserUx())
  useUI.setState({ sheets: [], toastMsg: '' })
  useStore.setState({ S: structuredClone(DEF), user: null })
  document.body.innerHTML = ''
})
afterEach(() => { act(() => { mounted.splice(0).forEach((root: any) => root.unmount()) }) })

// The screens run the same search over the same catalogue, so the expected numbers come from it.
const matches: any = (q: any) => searchExercises(EXDB, q).length

describe('exercise search result count', () => {
  const cases: [string, () => HTMLDivElement][] = [
    ['Library', () => mount(<Library />)],
  ]
  for (const [where, open] of cases) {
    it(`${where}: appears with a search, follows it, and goes when the search is cleared`, () => {
      const host: any = open()
      const input: any = host.querySelector('.search input')
      expect(count(host)).toBeNull()
      expect(host.querySelector('.search').classList.contains('has-count')).toBe(false)

      act(() => type(input, 'bench press'))
      const n: any = matches('bench press')
      expect(n).toBeGreaterThan(1)
      expect(count(host).textContent).toBe(String(n))
      expect(count(host).getAttribute('aria-label')).toBe(`${n} exercises`)
      expect(host.querySelector('.search').classList.contains('has-count')).toBe(true)

      act(() => type(input, 'bench press dumbbell incline'))
      expect(Number(count(host).textContent)).toBe(matches('bench press dumbbell incline'))

      act(() => type(input, ''))
      expect(count(host)).toBeNull()
    })

    it(`${where}: counts a body-part filter too, and reads "1 exercise" for one`, () => {
      const host: any = open()
      act(() => chip(host, 'neck').click())
      const neck: any = EXDB.filter((e: any) => e.bp === 'neck').length
      expect(Number(count(host).textContent)).toBe(neck)
      const one: any = EXDB.find((e: any) => searchExercises(EXDB, e.n).length === 1)
      act(() => chip(host, 'All').click())
      act(() => type(host.querySelector('.search input'), one.n))
      expect(count(host).textContent).toBe('1')
      expect(count(host).getAttribute('aria-label')).toBe('1 exercise')
    })
  }
})
