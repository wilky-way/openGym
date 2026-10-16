import { prepareExerciseSheets } from './W12-test-support'
// @vitest-environment happy-dom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { EXDB } from '@opengym/core/exercises'
import { useStore } from '../src/store/useStore'
import { useUI } from '../src/store/useUI'
import { exConfigSheet } from '../src/sheets'
import { bindUI } from '../src/components/ui'

// Triple progression (issue #179) on the exercise's settings: picked like any rule, with the set
// ceiling next to the rep range.
const ex: any = EXDB.find((e: any) : any => e.id === '0009')
const mounted: any = []

function render(sheet: any) : any {
  const host: any = document.createElement('div')
  document.body.appendChild(host)
  const root: any = createRoot(host)
  mounted.push([root, host])
  act(() : any => root.render(sheet.render(() : any => useUI.getState().closeSheet(sheet.id))))
  return host
}
const open: any = (cfg: any = {}, onSave: any = vi.fn()) : any => {
  exConfigSheet(ex, { sets: 3, reps: 12, weight: 40, mode: 'reps', ...cfg }, onSave)
  return render(useUI.getState().sheets.at(-1))
}
const rowNamed: any = (host: any, title: any) : any => [...(host.querySelectorAll('.lrow') as any)].find((r: any) : any => (r.querySelector('.lrow-t') as any)?.textContent === title)
const labels: any = (host: any) : any => [...(host.querySelectorAll('.stp-l') as any)].map((l: any) : any => l.textContent)
const stepperValue: any = (host: any, label: any) : any => [...(host.querySelectorAll('.stp-w') as any)].find((w: any) : any => (w.querySelector('.stp-l') as any)?.textContent === label)?.querySelector('input')?.value
const save: any = (host: any) : any => act(() : any => [...(host.querySelectorAll('button') as any)].find((b: any) : any => b.textContent.trim() === 'Save').click())
const pickRule: any = (host: any, name: any) : any => {
  act(() : any => rowNamed(host, 'Rule').click())
  const picker: any = render(useUI.getState().sheets.at(-1))
  const options: any = [...(picker.querySelectorAll('button.lrow') as any)].map((el: any) : any => (el.querySelector('.lrow-t') as any)?.textContent)
  const el: any = [...(picker.querySelectorAll('button.lrow') as any)].find((b: any) : any => (b.querySelector('.lrow-t') as any)?.textContent === name)
  if (el) act(() : any => el.click())
  return options
}

describe('exercise settings: triple progression', () : any => {
  beforeEach(() : any => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    bindUI(useUI)
    useUI.setState({ sheets: [] })
    useStore.setState((s: any) : any => ({ S: { ...s.S, unit: 'kg' } }))
    document.body.innerHTML = ''
  })
  afterEach(() : any => { act(() : any => { mounted.splice(0).forEach(([root, host]: any) : any => { root.unmount(); host.remove() }) }) })

  it('picked as the rule, it shows its explanation, the rep range and where the sets stop', () : any => {
    const onSave: any = vi.fn()
    const host: any = open({}, onSave)
    expect(pickRule(host, 'Triple progression')).toContain('Triple progression')
    expect(host.textContent).toContain('then a set is added')
    expect(labels(host)).toEqual(expect.arrayContaining(['Sets from', 'Reps from', 'Reps up to', 'Sets up to']))
    expect(labels(host)).not.toContain('Reps')
    // Room for two more sets to begin with, the usual 3 to 5.
    expect(stepperValue(host, 'Sets up to')).toBe('5')
    save(host)
    expect(onSave.mock.calls[0][0]).toMatchObject({ prog: 'triple', sets: 3, setsMax: 5, reps: 12, repsMin: 10 })
  })

  it('reopens a saved triple plan with its numbers, and a ceiling at the sets is not written', () : any => {
    const onSave: any = vi.fn()
    const host: any = open({ prog: 'triple', sets: 4, setsMax: 4, reps: 12, repsMin: 8 }, onSave)
    expect(stepperValue(host, 'Sets up to')).toBe('4')
    expect(stepperValue(host, 'Reps from')).toBe('8')
    save(host)
    expect(onSave.mock.calls[0][0]).toMatchObject({ prog: 'triple', sets: 4, repsMin: 8 })
    expect('setsMax' in onSave.mock.calls[0][0]).toBe(false)
  })

  it('is not offered on bodyweight work with nothing added, which climbs reps and sets already', () : any => {
    const host: any = open({ bodyweight: true, weight: 0 })
    expect(pickRule(host, 'nothing')).not.toContain('Triple progression')
  })

  it('a plan with another rule saves no set ceiling', () : any => {
    const onSave: any = vi.fn()
    const host: any = open({ prog: 'double', repsMin: 8, setsMax: 5 }, onSave)
    expect(labels(host)).not.toContain('Sets up to')
    save(host)
    expect('setsMax' in onSave.mock.calls[0][0]).toBe(false)
  })
})

beforeEach(() : any => prepareExerciseSheets())
