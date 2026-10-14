// @vitest-environment happy-dom
import React, { act } from 'react'
import { readFileSync } from 'node:fs'
import { URL as FileURL } from 'node:url'
import { runInNewContext } from 'node:vm'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useUI } from '../src/store/useUI'
import { useStore } from '../src/store/useStore'
import { createBrowserPlatform } from '../src/platform/browser'
import { configureClientIO } from '../src/lib/client-io'
import { configureUx, createBrowserUx } from '../src/platform/ux'
import { configureCamera } from '../src/platform/camera'
import CameraScan from '../src/components/CameraScan'
import QrCanvas from '../src/components/QrCanvas'
import TimerFlash from '../src/components/TimerFlash'
import Toast from '../src/components/Toast'
import ErrorBoundary from '../src/components/ErrorBoundary'
import QueueRow from '../src/components/QueueRow'
const mocks = vi.hoisted(() => ({ draw: vi.fn(), decode: vi.fn() }))
vi.mock('../src/lib/qr', () => ({ renderQrToCanvas: (...args: unknown[]) => mocks.draw(...args) }))
vi.mock('../src/lib/scan-web', () => ({ decodeSource: (...args: unknown[]) => mocks.decode(...args) }))
let host: HTMLDivElement, root: Root
const original = useStore.getState()
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  configureUx(createBrowserUx()); mocks.draw.mockReset(); mocks.decode.mockReset()
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-01-15T12:00:00Z'))
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  useUI.setState({ timer: null, work: null, sheets: [], timerFlashId: 0, toastMsg: '', toastAction: null })
})
afterEach(() => {
  act(() => root.unmount()); host.remove(); useStore.setState(original)
  useUI.getState().stopRest(); useUI.getState().stopWork()
  vi.useRealTimers(); vi.restoreAllMocks()
})
it('QrCanvas hides failed values and ignores completion from a replaced value', async () => {
  let finish!: (count: number) => void
  mocks.draw.mockImplementationOnce(() => new Promise<number>(resolve => { finish = resolve })).mockResolvedValueOnce(0).mockResolvedValueOnce(21)
  await act(async () => root.render(<QrCanvas value="old" />))
  await act(async () => root.render(<QrCanvas value="invalid" />))
  await act(async () => finish(21))
  expect(host.querySelector('canvas')!.style.opacity).toBe('0')
  await act(async () => root.render(<QrCanvas value="new" size={120} />))
  expect(host.querySelector('canvas')!.style.opacity).toBe('1')
  expect(host.querySelector('canvas')!.style.width).toBe('120px')
})
it('CameraScan closes a late camera stream after unmount', async () => {
  let opened!: (stream: MediaStream) => void
  const stopped = vi.fn()
  configureCamera({ supported: () => true, open: () => new Promise(resolve => { opened = resolve }) })
  await act(async () => root.render(<CameraScan onFound={() => {}} onCancel={() => {}} />))
  await act(async () => root.render(null))
  await act(async () => opened({ getTracks: () => [{ stop: stopped }] } as unknown as MediaStream))
  expect(stopped).toHaveBeenCalledTimes(1)
})
it('CameraScan decodes a ready frame once and stops its stream before reporting', async () => {
  const stopped = vi.fn(), found = vi.fn(() => expect(stopped).toHaveBeenCalledTimes(1))
  const stream = new MediaStream()
  Object.defineProperty(stream, 'getTracks', { value: () => [{ stop: stopped }] })
  configureCamera({ supported: () => true, open: async () => stream })
  const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
  vi.spyOn(HTMLMediaElement.prototype, 'readyState', 'get').mockReturnValue(2)
  mocks.decode.mockResolvedValue({ value: 'synthetic', fmt: 'qrcode' })
  await act(async () => root.render(<CameraScan onFound={found} onCancel={() => {}} />))
  expect(play).toHaveBeenCalledTimes(1)
  Object.defineProperty(host.querySelector('video'), 'readyState', { configurable: true, value: 2 })
  await act(async () => vi.advanceTimersByTimeAsync(151))
  expect(found).toHaveBeenCalledExactlyOnceWith({ value: 'synthetic', fmt: 'qrcode' })
  expect(mocks.decode).toHaveBeenCalledTimes(1)
  await act(async () => vi.advanceTimersByTime(600))
  expect(found).toHaveBeenCalledTimes(1)
})
it.each(['denied', 'unavailable'])('CameraScan displays %s and keeps Cancel usable', async kind => {
  const cancel = vi.fn()
  configureCamera({ supported: () => kind === 'denied', open: async () => { throw new DOMException('denied', 'NotAllowedError') } })
  await act(async () => root.render(<CameraScan onFound={() => {}} onCancel={cancel} />))
  expect(host.textContent).toContain(kind === 'denied' ? 'Camera access was denied' : 'No camera available')
  act(() => host.querySelector('button')!.click())
  expect(cancel).toHaveBeenCalledTimes(1)
})
it('TimerFlash restores the original theme on retrigger and unmount', () => {
  document.documentElement.dataset.theme = 'dark'
  act(() => root.render(<TimerFlash />))
  act(() => useUI.setState({ timerFlashId: 1 }))
  act(() => vi.advanceTimersByTime(1))
  expect(document.documentElement.dataset.theme).toBe('light')
  act(() => useUI.setState({ timerFlashId: 2 }))
  act(() => vi.advanceTimersByTime(601))
  expect(document.documentElement.dataset.theme).toBe('dark')
  act(() => root.render(null))
  expect(document.documentElement.dataset.theme).toBe('dark')
  vi.advanceTimersByTime(2400)
  expect(document.documentElement.dataset.theme).toBe('dark')
})
it('Toast displays its actionable status and runs Undo once', () => {
  const undo = vi.fn()
  act(() => { useUI.getState().toast('Removed', { action: 'Undo', onAction: undo }); root.render(<Toast />) })
  expect(host.querySelector('[role="status"]')!.textContent).toBe('RemovedUndo')
  const button = host.querySelector('button')!
  act(() => button.click()); act(() => button.click())
  expect(undo).toHaveBeenCalledTimes(1)
  expect(host.querySelector('button')).toBeNull()
})
it('ErrorBoundary uses Platform reload and discards only the active workout on request', () => {
  const platform = createBrowserPlatform(); platform.nav.reload = vi.fn(); configureClientIO(platform)
  useStore.setState({ S: { ...original.S, active: { id: 'synthetic' } } })
  vi.spyOn(console, 'error').mockImplementation(() => {})
  function Broken(): React.ReactNode { throw new Error('synthetic render') }
  act(() => root.render(<ErrorBoundary><Broken /></ErrorBoundary>))
  expect(host.textContent).toContain('Your data is safe on this device.')
  const buttons = host.querySelectorAll<HTMLButtonElement>('button')
  act(() => buttons[0]!.click())
  expect(platform.nav.reload).toHaveBeenCalledTimes(1)
  expect(useStore.getState().S.active).toEqual({ id: 'synthetic' })
  act(() => buttons[1]!.click())
  expect(useStore.getState().S.active).toBeNull()
  expect(useStore.getState().S.workouts).toEqual(original.S.workouts)
  expect(platform.nav.reload).toHaveBeenCalledTimes(2)
})
it('QueueRow keeps completed chips inert and starts pending chips in managed rounds', () => {
  const start = vi.fn()
  const S = { routines: [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }], workouts: [{ d: '2026-01-14', start: 2, routineId: 'a' }], week: {}, dayPlan: {}, queue: { ids: ['a', 'b'], since: 1, startsOn: '2026-01-14', label: 'Synthetic' } }
  act(() => root.render(<QueueRow S={S} today="2026-01-15" onStart={start} managed />))
  const buttons = host.querySelectorAll<HTMLButtonElement>('button')
  expect(buttons[0]!.disabled).toBe(true)
  expect(host.textContent).toContain('Rotation')
  expect(host.textContent).toContain('Next: Beta, today')
  act(() => buttons[1]!.click())
  expect(start).toHaveBeenCalledExactlyOnceWith('b')
})

it.each([
  { name: 'NotAllowedError' },
  { name: 'SecurityError' },
  new DOMException('permission', 'NotAllowedError'),
  runInNewContext('Object.assign(new Error("camera"), {name: "NotAllowedError"})') as Error,
])('CameraScan preserves structural permission-error classification: $name', async rejection => {
  configureCamera({ supported: () => true, open: async () => { throw rejection } })
  await act(async () => root.render(<CameraScan onFound={() => {}} onCancel={() => {}} />))
  expect(host.textContent).toContain('Camera access was denied')
})

it('Toast stylesheet makes live actions visible and clickable', () => {
  const style = document.createElement('style')
  style.textContent = readFileSync(new FileURL('../src/components/widgets.css', import.meta.url), 'utf8')
  document.head.append(style)
  try {
    const undo = vi.fn()
    act(() => { useUI.getState().toast('Removed', { action: 'Undo', onAction: undo }); root.render(<Toast />) })
    const toast = host.querySelector<HTMLElement>('#toast')!
    expect(getComputedStyle(toast).opacity).toBe('1')
    expect(getComputedStyle(toast).pointerEvents).toBe('auto')
    expect(getComputedStyle(toast).display).toBe('flex')
    act(() => host.querySelector<HTMLButtonElement>('.toast-act')!.click())
    expect(undo).toHaveBeenCalledTimes(1)
  } finally { style.remove() }
})
