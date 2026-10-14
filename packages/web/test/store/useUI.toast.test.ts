const uiState = (): any => useUI.getState()
import { installUIEnvironment } from './environment'
const { api } = vi.hoisted(() => ({ api: vi.fn<(...args: any[]) => Promise<any>>(() => Promise.resolve({ ok: true })) }))
// Ported legacy twin; malformed fixtures intentionally retain tolerant JS shapes.
// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUI } from '../../src/store/useUI'

// Inject browser capabilities and pin the clock for every legacy timer case.
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-15T12:00:00Z'))
  installUIEnvironment(api)
})

beforeEach(() => { vi.useFakeTimers(); useUI.setState({ toastMsg: '', toastAction: null }) })
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })

describe('toast with an action', () => {
  it('a plain toast is text only and goes after 2.2 s', () => {
    uiState().toast('Saved')
    expect(uiState().toastMsg).toBe('Saved')
    expect(uiState().toastAction).toBeNull()
    vi.advanceTimersByTime(2199)
    expect(uiState().toastMsg).toBe('Saved')
    vi.advanceTimersByTime(2)
    expect(uiState().toastMsg).toBe('')
  })

  it('stays 5 s with an action, and the action fires once', () => {
    const onAction = vi.fn()
    uiState().toast('Set 2 gone.', { action: 'Undo', onAction })
    expect(uiState().toastAction.label).toBe('Undo')
    vi.advanceTimersByTime(4900)
    expect(uiState().toastMsg).toBe('Set 2 gone.')
    uiState().runToastAction()
    uiState().runToastAction()
    expect(onAction).toHaveBeenCalledTimes(1)
    expect(uiState().toastMsg).toBe('')
  })

  it('times out after 5 s without running the action', () => {
    const onAction = vi.fn()
    uiState().toast('Set 2 gone.', { action: 'Undo', onAction })
    vi.advanceTimersByTime(5001)
    expect(uiState().toastMsg).toBe('')
    expect(uiState().toastAction).toBeNull()
    uiState().runToastAction()
    expect(onAction).not.toHaveBeenCalled()
  })

  it('a new toast replaces the old one and its action', () => {
    const first = vi.fn()
    uiState().toast('Set 2 gone.', { action: 'Undo', onAction: first })
    uiState().toast('Copied')
    expect(uiState().toastAction).toBeNull()
    uiState().runToastAction()
    expect(first).not.toHaveBeenCalled()
  })

  it('holds still while touched and carries on afterwards', () => {
    uiState().toast('Set 2 gone.', { action: 'Undo', onAction: () => {} })
    vi.advanceTimersByTime(3000)
    uiState().pauseToast()
    vi.advanceTimersByTime(20000)
    expect(uiState().toastMsg).toBe('Set 2 gone.')
    uiState().resumeToast()
    vi.advanceTimersByTime(1900)
    expect(uiState().toastMsg).toBe('Set 2 gone.')
    vi.advanceTimersByTime(200)
    expect(uiState().toastMsg).toBe('')
  })
})
