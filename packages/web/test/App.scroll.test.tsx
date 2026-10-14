import { configureTestClient } from './client-fixture'
import { configureShell } from '../src/shell'
// @vitest-environment happy-dom
// The route's scroll restore on the very first load. A fresh load arrives as a POP with nothing
// remembered, and used to scroll to the top a frame later — on top of a scroll a view had made on
// mount (the superset card centring its row, views/Workout.jsx), cutting a smooth scroll off. It
// goes to the top now, in the same pass, so a view's own scroll runs after it and stands.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../src/App'
import { DEF, useStore } from '../src/store/useStore'

vi.mock('../src/lib/sound', () => ({ setPlayOnSilent: vi.fn(), setVibrate: vi.fn(), setAlarmBuzzer: vi.fn() }))
vi.mock('../src/lib/api', async (importOriginal: any) => {
  const actual: any = await importOriginal()
  return { ...actual, api: vi.fn(() => Promise.resolve({})), beacon: vi.fn() }
})

Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})

let host: any, root: any, originalS: any, scrolls: any, frames: any
beforeEach(() => {
  configureShell(configureTestClient())
  originalS = useStore.getState().S
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  scrolls = []; frames = []
  ;(window as any).scrollTo = vi.fn((x: any, y: any) => scrolls.push([x, y]))
  // Frames never run on their own here: what is asked for now is all that has landed.
  window.requestAnimationFrame = vi.fn((cb: any) => { frames.push(cb); return frames.length })
  window.cancelAnimationFrame = vi.fn()
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  useStore.setState({ S: originalS })
})

describe('the first load', () => {
  it('goes to the top now, not a frame later', async () => {
    useStore.setState({ S: JSON.parse(JSON.stringify(DEF)) })
    await act(async () => { root.render(<App />) })
    expect(scrolls).toContainEqual([0, 0])
    // …and no top-of-page scroll is left waiting in a frame, where it would land on a view's own.
    const before: any = scrolls.length
    for (const cb of frames) cb()
    expect(scrolls.length).toBe(before)
  })
})
