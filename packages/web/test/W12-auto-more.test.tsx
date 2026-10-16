// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { freshState, useStore } from '../src/store/useStore'
import { useUI } from '../src/store/useUI'
import { exercisePicker } from '../src/sheets'
import { prepareExerciseSheets } from './W12-test-support'
import { configureUx, createBrowserUx } from '../src/platform/ux'
let host: HTMLDivElement, root: ReturnType<typeof createRoot>, callback: IntersectionObserverCallback, watched: Element | null
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useStore.setState({ S: freshState() }); useUI.setState({ sheets: [] })
  prepareExerciseSheets(); watched = null
  configureUx({ ...createBrowserUx(), observeIntersection: cb => {
    callback = cb
    return { observe: (element: Element) => { watched = element }, disconnect: () => { watched = null } } as unknown as IntersectionObserver
  } })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers() })
describe('lists load their next page as you scroll', () => {
  it('picker: the next 50, the same way', () => {
    exercisePicker(vi.fn())
    const sheet = useUI.getState().sheets.at(-1)!
    act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
    expect(host.querySelectorAll('.list > .item').length - 1).toBe(50)
    act(() => callback([{ target: watched!, isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver))
    expect(host.querySelectorAll('.list > .item').length - 1).toBe(100)
  })
})
