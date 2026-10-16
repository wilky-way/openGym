import { prepareExerciseSheets } from './W12-test-support'
// @vitest-environment happy-dom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { EXDB } from '@opengym/core/exercises'
import { useStore } from '../src/store/useStore'
import { useUI } from '../src/store/useUI'
import { exConfigSheet } from '../src/sheets'

// A weighted machine exercise: double progression adds the two rep steppers and the
// Epley deload stepper, four in one row (QA C6).
const ex: any = EXDB.find((e: any) : any => e.id === '0009')
const mounted: any = []

function renderConfig(cfg: any = {}) : any {
  exConfigSheet(ex, { sets: 3, reps: 10, weight: 40, mode: 'reps', ...cfg }, vi.fn())
  const sheet: any = useUI.getState().sheets.at(-1)
  const host: any = document.createElement('div')
  document.body.appendChild(host)
  const root: any = createRoot(host)
  mounted.push(root)
  act(() : any => root.render(sheet.render(() : any => useUI.getState().closeSheet(sheet.id))))
  const row: any = [...(host.querySelectorAll('.cfgrow') as any)].find((r: any) : any => (r.querySelector('.stp-l') as any)?.textContent.startsWith('Step'))
  return { host, row }
}

describe('exercise configuration progression row', () : any => {
  beforeEach(() : any => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    useUI.setState({ sheets: [] })
    useStore.setState((s: any) : any => ({ S: { ...s.S, unit: 'kg' } }))
    document.body.innerHTML = ''
  })

  afterEach(() : any => {
    act(() : any => { mounted.splice(0).forEach((root: any) : any => root.unmount()) })
  })

  it('marks the four-stepper double-progression row so it can wrap into pairs on phones', () : any => {
    const { row }: any = renderConfig({ prog: 'double' })
    expect((row.querySelectorAll('.stp-w') as any)).toHaveLength(4)
    expect(row.classList.contains('cfgrow-4')).toBe(true)
  })

  it('leaves the shorter rows alone', () : any => {
    // linear on a weighted exercise: Step + Deload, two steppers
    const linear: any = renderConfig({ prog: 'linear' })
    expect((linear.row.querySelectorAll('.stp-w') as any)).toHaveLength(2)
    expect(linear.row.classList.contains('cfgrow-4')).toBe(false)
    // double on a body-weight exercise: no Epley deload, three steppers
    const bw: any = renderConfig({ prog: 'double', weight: 0, bodyweight: true })
    expect((bw.row.querySelectorAll('.stp-w') as any)).toHaveLength(3)
    expect(bw.row.classList.contains('cfgrow-4')).toBe(false)
  })
})

beforeEach(() : any => prepareExerciseSheets())
