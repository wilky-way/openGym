import { prepareExerciseSheets } from './regression-test-support'
// @vitest-environment happy-dom
import { act } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { swapActiveWorkoutExercise } from '../src/sheets'
import { EXDB } from '@opengym/core/exercises'
import { DEF, useStore } from '../src/store/useStore'
import { useUI } from '../src/store/useUI'

const clone: any = (value: any) : any => JSON.parse(JSON.stringify(value))
const ids: any = EXDB.slice(0, 3).map((exercise: any) : any => exercise.id)

function entry(id: any, done: any = false) : any {
  return {
    id,
    target: { mode: 'reps', sets: 1, reps: 5, weight: 40 },
    sets: [{ w: 40, r: 5, done }]
  }
}

function installActive() : any {
  const S: any = clone(DEF)
  S.active = {
    id: 'swap-test', d: '2026-08-27', start: Date.now(), routineId: null,
    name: 'Swap test', bw: null, cur: 1,
    entries: [entry(ids[0]), entry(ids[0]), entry(ids[1])]
  }
  useStore.setState({ S, user: null })
}

function submitSwap(index: any, exercise: any, config: any) : any {
  swapActiveWorkoutExercise(index)
  const picker: any = useUI.getState().sheets.at(-1)
  const pickerView: any = picker.render(picker.close)
  act(() : any => pickerView.props.onPick(exercise))
  const configSheet: any = useUI.getState().sheets.at(-1)
  const configView: any = configSheet.render(configSheet.close)
  act(() : any => configView.props.onSave(config))
}

beforeEach(() : any => {
  vi.useFakeTimers()
  localStorage.clear()
  useUI.getState().stopRest()
  useUI.getState().stopWork()
  useUI.setState({ sheets: [], timer: null, work: null })
  installActive()
})

describe('active exercise swap sheet flow', () : any => {
  it('invalidates a timed callback and replaces only the selected duplicate', () : any => {
    const callback: any = vi.fn()
    useUI.getState().startWork(5, 'Hold', callback)

    submitSwap(1, EXDB[2]!, { mode: 'reps', sets: 2, reps: 8, weight: 30, note: 'New target' })
    vi.advanceTimersByTime(10_000)

    const active: any = useStore.getState().S.active
    expect(useUI.getState().work).toBeNull()
    expect(callback).not.toHaveBeenCalled()
    expect(active.entries.map((value: any) : any => value.id)).toEqual([ids[0], ids[2], ids[1]])
    expect(active.entries[1].target).toMatchObject({ mode: 'reps', sets: 2, reps: 8, weight: 30, note: 'New target' })
    expect(active.entries[0].sets).toEqual([{ w: 40, r: 5, done: false }])
    expect(active.entries[2].sets).toEqual([{ w: 40, r: 5, done: false }])
    expect(active.cur).toBe(1)
  })
})

// A slot of a routine kept out of progression (rehab, deload) stays out when it is swapped,
// whether the replacement takes its place or, beside logged sets, goes in after it.
describe('swapping an exercise kept out of progression', () : any => {
  const install: any = (done: any) : any => {
    const S: any = clone(DEF)
    S.routines = [{ id: 'rehab', name: 'Rehab', excludeFromProgression: true, ex: [] }]
    S.active = {
      id: 'swap-noprog', d: '2026-08-27', start: Date.now(), routineIds: ['rehab'], name: 'Rehab', bw: null, cur: 0,
      entries: [{ ...entry(ids[0], done), rid: 'rehab', noProg: true }],
    }
    useStore.setState({ S, user: null })
  }

  it('keeps it out when the replacement takes the slot', () : any => {
    install(false)
    submitSwap(0, EXDB[2]!, { mode: 'reps', sets: 1, reps: 12, weight: 10 })
    const [swapped]: any = useStore.getState().S.active.entries
    expect(swapped).toMatchObject({ id: ids[2], rid: 'rehab', noProg: true })
    expect(swapped.plan.kind).toBe('off')
  })

  it('keeps it out when the replacement goes in after logged sets', () : any => {
    install(true)
    submitSwap(0, EXDB[2]!, { mode: 'reps', sets: 1, reps: 12, weight: 10 })
    const confirm: any = useUI.getState().sheets.at(-1)
    act(() : any => confirm.render(confirm.close).props.onConfirm())
    const entries: any = useStore.getState().S.active.entries
    expect(entries.map((e: any) : any => e.id)).toEqual([ids[0], ids[2]])
    expect(entries[1]).toMatchObject({ rid: 'rehab', noProg: true })
    expect(entries[1].plan.kind).toBe('off')
  })
})

// QA 1.3.9: the swap borrowed the routine editor's words — "Add exercise" over the picker and
// "Add to routine" on the confirm — while it changes only today's session.
describe('swap wording', () : any => {
  it('titles the picker as a swap and confirms into this workout', () : any => {
    swapActiveWorkoutExercise(1)
    const picker: any = useUI.getState().sheets.at(-1)
    const pickerView: any = picker.render(picker.close)
    expect(pickerView.props.title).toBe('Swap exercise')
    act(() : any => pickerView.props.onPick(EXDB[2]!))
    const configSheet: any = useUI.getState().sheets.at(-1)
    const configView: any = configSheet.render(configSheet.close)
    expect(configView.props.saveLabel).toBe('Use in this workout')
  })
})

beforeEach(() : any => prepareExerciseSheets())
