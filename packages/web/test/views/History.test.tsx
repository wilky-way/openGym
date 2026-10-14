// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import History, { historyRows } from '../../src/views/History'
import { DEF, useStore } from '../../src/store/useStore'
import { bindViewServices } from '../../src/views/view-services'
import { setNav } from '../../src/lib/nav'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
it('orders workouts and off-day notes newest first with reverse stored order on ties', () => {
  const a = { id: 'a', d: '2026-01-21' }, b = { id: 'b', d: a.d }
  const S = { workouts: [a, b], dayNotes: { '2026-01-22': { text: 'Rest' }, '2026-01-21': { text: 'hidden' }, '2026-01-20': {} } }
  expect(historyRows(S)).toEqual([{ d: '2026-01-22', note: { tag: null, text: 'Rest' } }, { d: b.d, w: b }, { d: a.d, w: a }])
})
it('wires history row actions, past logging and stats navigation through the seam', () => {
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  const detail = vi.fn(), past = vi.fn(), nav = vi.fn(); setNav(nav)
  const w = { id: 'a', d: '2026-01-21' }; useStore.setState({ S: { ...structuredClone(DEF), workouts: [w] } })
  bindViewServices({ workoutDetailSheet: detail, logPastWorkoutSheet: past, WorkoutRow: (p: any) => <button data-workout onClick={p.onClick}>{p.w.id}</button>, DayNoteRow: () => null } as any)
  try {
    act(() => root.render(<History />)); act(() => (host.querySelector('[data-workout]') as HTMLButtonElement).click()); expect(detail).toHaveBeenCalledWith(w)
    act(() => [...host.querySelectorAll('button')].find(b => b.textContent?.includes('Log a past workout'))!.click()); expect(past).toHaveBeenCalledOnce()
    act(() => (host.querySelector('[aria-label="Stats"]') as HTMLButtonElement).click()); expect(nav).toHaveBeenCalledWith('/stats')
  } finally { act(() => root.unmount()); host.remove(); setNav(() => {}) }
})
