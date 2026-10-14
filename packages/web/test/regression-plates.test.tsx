import { prepareExerciseSheets } from './regression-test-support'
// @vitest-environment happy-dom
// The plate-loading editor (barWeightSheet) and the plate inventory sheet write S.loadKind,
// S.barWeights and S.plates the way lib/plates.js reads them: a load kind and a unit's plate list
// are stamped with the time they were set, the way back to the default included, so the last
// change wins a sync (lib/sync-merge.js).
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore, DEF } from '../src/store/useStore'
import { useUI } from '../src/store/useUI'
import { barWeightSheet, plateInventorySheet } from '../src/sheets'
import { EXIDX } from '@opengym/core/exercises'
import { loadKindFor } from '@opengym/core/plates'

const SQUAT: any = '0043'      // barbell
const COCOONS: any = '0260'    // body weight
const LEG_PRESS: any = EXIDX['0585']! ? '0585' : Object.values(EXIDX).find((e: any) : any => e.eq === 'leverage machine')!.id
const DUMBBELL: any = Object.values(EXIDX).find((e: any) : any => e.eq === 'dumbbell')!.id

const mounted: any = []
function mountTopSheet() : any {
  const sheet: any = useUI.getState().sheets.at(-1)
  const host: any = document.createElement('div')
  document.body.appendChild(host)
  const root: any = createRoot(host)
  mounted.push(root)
  act(() : any => root.render(sheet.render(() : any => useUI.getState().closeSheet(sheet.id))))
  return host
}
const S: any = () : any => useStore.getState().S
const stamped: any = (kind: any) : any => ({ kind, _ts: expect.any(Number) })
const segButton: any = (host: any, text: any) : any => [...(host.querySelectorAll('.seg button') as any)].find((b: any) : any => b.textContent.trim() === text)
const button: any = (host: any, text: any) : any => [...(host.querySelectorAll('button') as any)].find((b: any) : any => b.textContent.trim() === text)
// A labelled Stepper is .stp-w > .stp-l (label) + .stp (Decrease, value input, Increase).
const stepperOf: any = (host: any, label: any) : any => [...(host.querySelectorAll('.stp-w') as any)].find((el: any) : any => (el.querySelector('.stp-l') as any)?.textContent.trim() === label)
const valueOf: any = (st: any) : any => (st.querySelector('input') as any).value
const dec: any = (st: any) : any => (st.querySelector('[aria-label="Decrease"]') as any)
const inc: any = (st: any) : any => (st.querySelector('[aria-label="Increase"]') as any)

describe('plate loading editor', () : any => {
  beforeEach(() : any => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    useUI.setState({ sheets: [], toastMsg: '' })
    useStore.setState({ S: { ...JSON.parse(JSON.stringify(DEF)), unit: 'lb' }, user: null })
    document.body.innerHTML = ''
  })
  afterEach(() : any => { act(() : any => { mounted.splice(0).forEach((root: any) : any => root.unmount()) }) })

  it('the exercises used here are what the test assumes', () : any => {
    expect(EXIDX[SQUAT]!.eq).toBe('barbell')
    expect(EXIDX[LEG_PRESS]!.eq).toBe('leverage machine')
    expect(EXIDX[COCOONS]!.eq).toBe('body weight')
    expect(EXIDX[DUMBBELL]!.eq).toBe('dumbbell')
  })

  it('the editor derives its default from the same config the workout rows use', () : any => {
    // A body-weight exercise a routine runs as a weighted lift (bodyweight: false): the rows
    // show no line, so the editor must show Off — and picking Single stack must stick.
    act(() : any => barWeightSheet(COCOONS, { id: COCOONS, bodyweight: false }))
    const host: any = mountTopSheet()
    expect(segButton(host, 'Off').classList.contains('on')).toBe(true)
    act(() : any => segButton(host, 'Single stack').click())
    expect(S().loadKind[COCOONS]).toEqual(stamped('single'))
    // Without a config the equipment decides: body weight → single stack by default.
    useStore.setState((s: any) : any => ({ S: { ...s.S, loadKind: {} } }))
    act(() : any => barWeightSheet(COCOONS))
    const host2: any = mountTopSheet()
    expect(segButton(host2, 'Single stack').classList.contains('on')).toBe(true)
  })

  it('a pick the equipment alone cannot settle is stored, not read back as the default', () : any => {
    // The exercise-detail sheet has no routine config, so it cannot know whether the routine logs
    // this body-weight exercise as added weight ('single') or as a plain total ('none') — the two
    // readings of the bodyweight flag disagree. The segment shows the body-weight default, and
    // tapping it used to match the cfg-less default and delete the key: the pick stored nothing
    // and the rows of a bodyweight:false routine went on showing no plate line at all.
    act(() : any => barWeightSheet(COCOONS))
    const host: any = mountTopSheet()
    expect(segButton(host, 'Single stack').classList.contains('on')).toBe(true)
    act(() : any => segButton(host, 'Single stack').click())
    expect(S().loadKind[COCOONS]).toEqual(stamped('single'))
    expect(loadKindFor(S(), { id: COCOONS, bodyweight: false })).toBe('single')
    // 'Off' is the other reading's default and is stored just the same.
    act(() : any => segButton(host, 'Off').click())
    expect(S().loadKind[COCOONS]).toEqual(stamped('none'))
  })

  it('a dumbbell still stores no kind of its own for the one its equipment already implies', () : any => {
    // The two readings of the bodyweight flag differ for a dumbbell too ('single' as added
    // weight, 'none' as a plain loaded lift), but the cfg-less default — 'none' — is what a
    // dumbbell row derives, so the segment and the rows already agree and the pick is only
    // restating it. Storing it would freeze 'none' onto the exercise everywhere and override the
    // 'single' an entry with bodyweight: true derives, with no way left to take it off: the pick
    // puts the exercise back on its equipment's (a stamped null) instead.
    act(() : any => barWeightSheet(DUMBBELL))
    const host: any = mountTopSheet()
    expect(segButton(host, 'Off').classList.contains('on')).toBe(true)
    act(() : any => segButton(host, 'Off').click())
    expect(S().loadKind[DUMBBELL]).toEqual(stamped(null))
    expect(loadKindFor(S(), { id: DUMBBELL, bodyweight: true })).toBe('single')
  })

  it('a barbell defaults to per side and stores nothing until you pick something else', () : any => {
    act(() : any => barWeightSheet(SQUAT))
    const host: any = mountTopSheet()
    expect((host.querySelector('h3') as any).textContent).toBe('Plate loading')
    expect(segButton(host, 'Per side').classList.contains('on')).toBe(true)
    expect(S().loadKind).toEqual({})
    act(() : any => segButton(host, 'Single stack').click())
    expect(S().loadKind[SQUAT]).toEqual(stamped('single'))
    act(() : any => segButton(host, 'Per side').click())
    // Back to what the equipment implies: a stamped null, not a dropped key, so the way back
    // wins a sync against the other device's older 'single' instead of losing to it.
    expect(S().loadKind[SQUAT]).toEqual(stamped(null))
    expect(segButton(host, 'Per side').classList.contains('on')).toBe(true)
    act(() : any => segButton(host, 'Off').click())
    expect(S().loadKind[SQUAT]).toEqual(stamped('none'))
    expect(host.textContent).toContain('No plate line under the sets.')
  })

  it('"No bar" is an explicit 0 in barWeights; off again deletes it', () : any => {
    act(() : any => barWeightSheet(SQUAT))
    const host: any = mountTopSheet()
    const sw: any = (host.querySelector('.switch, [role="switch"], input[type="checkbox"]') as any)
    expect(sw).toBeTruthy()
    act(() : any => sw.click())
    expect(S().barWeights[SQUAT]).toBe(0)
    expect(host.textContent).toContain('Plates are counted from 0')
    expect(host.textContent).not.toContain('Bar (lb)')   // the stepper is gone while there is no bar
    act(() : any => (host.querySelector('.switch, [role="switch"], input[type="checkbox"]') as any).click())
    expect(S().barWeights[SQUAT]).toBeUndefined()
  })

  it('the bar stepper writes the override; stepping to 0 falls back to the default', () : any => {
    act(() : any => barWeightSheet(SQUAT))
    const host: any = mountTopSheet()
    const st: any = stepperOf(host, 'Bar (lb)')
    expect(st).toBeTruthy()
    expect(valueOf(st)).toBe('45')
    act(() : any => inc(st).click())
    expect(S().barWeights[SQUAT]).toBe(47.5)
    for (let i: any = 0; i < 19; i++) act(() : any => dec(stepperOf(host, 'Bar (lb)')).click())
    expect(S().barWeights[SQUAT]).toBeUndefined()
    expect(valueOf(stepperOf(host, 'Bar (lb)'))).toBe('45')
    expect(host.textContent).toContain('Default for this bar type.')
  })

  it('a machine can be made a single stack with its own base weight', () : any => {
    act(() : any => barWeightSheet(LEG_PRESS))
    const host: any = mountTopSheet()
    expect(segButton(host, 'Off').classList.contains('on')).toBe(true)
    act(() : any => segButton(host, 'Single stack').click())
    expect(S().loadKind[LEG_PRESS]).toEqual(stamped('single'))
    const st: any = stepperOf(host, 'Base weight (lb)')
    expect(st).toBeTruthy()
    expect(host.textContent).not.toContain('No bar')
    expect(valueOf(st)).toBe('0')
    act(() : any => inc(st).click())
    expect(S().barWeights[LEG_PRESS]).toBe(2.5)
  })
})

describe('plate inventory sheet', () : any => {
  beforeEach(() : any => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    useUI.setState({ sheets: [], toastMsg: '' })
    useStore.setState({ S: { ...JSON.parse(JSON.stringify(DEF)), unit: 'lb' }, user: null })
    document.body.innerHTML = ''
  })
  afterEach(() : any => { act(() : any => { mounted.splice(0).forEach((root: any) : any => root.unmount()) }) })

  it('lists every lb size with the standard count; the first edit copies the set and changes one count', () : any => {
    act(() : any => plateInventorySheet())
    const host: any = mountTopSheet()
    expect((host.querySelector('h3') as any).textContent).toBe('Plates')
    for (const w of ['45 lb', '35 lb', '25 lb', '15 lb', '10 lb', '5 lb', '2.5 lb', '1.25 lb']) expect(stepperOf(host, w), w).toBeTruthy()
    expect(valueOf(stepperOf(host, '45 lb'))).toBe('6')
    expect(valueOf(stepperOf(host, '15 lb'))).toBe('0')   // not in the standard set
    expect(stepperOf(host, '45 lb').textContent).toContain('pairs')
    expect(S().plates).toEqual({})
    for (let i: any = 0; i < 5; i++) act(() : any => dec(stepperOf(host, '45 lb')).click())
    expect(S().plates.lb[45]).toBe(1)
    expect(S().plates.lb[35]).toBe(6)     // the rest of the standard set came along
    expect(S().plates.lb[15]).toBeUndefined()
    expect(S().plates.lb._ts).toEqual(expect.any(Number))
    act(() : any => inc(stepperOf(host, '15 lb')).click())
    expect(S().plates.lb[15]).toBe(1)
    expect(valueOf(stepperOf(host, '45 lb'))).toBe('1')
    expect(S().plates.kg).toBeUndefined()   // the other unit is untouched
    expect(host.textContent).toContain('Your own list for lb.')
  })

  it('"Back to the standard set" empties the unit\'s own list, stamped', () : any => {
    useStore.setState((s: any) : any => ({ S: { ...s.S, plates: { lb: { 45: 1, _ts: 5 }, kg: { 20: 2 } } } }))
    act(() : any => plateInventorySheet())
    const host: any = mountTopSheet()
    expect(valueOf(stepperOf(host, '45 lb'))).toBe('1')
    act(() : any => button(host, 'Back to the standard set').click())
    // A list with no sizes, not a deleted unit: the reset has to win a sync against the other
    // device's older list rather than get it back.
    expect(S().plates).toEqual({ lb: { _ts: expect.any(Number) }, kg: { 20: 2 } })
    expect(S().plates.lb._ts).toBeGreaterThan(5)
    expect(button(host, 'Back to the standard set')).toBeUndefined()
    expect(valueOf(stepperOf(host, '45 lb'))).toBe('6')
    expect(host.textContent).toContain('The standard set, plenty of each')
    // …and the next change starts from the standard set again.
    act(() : any => dec(stepperOf(host, '45 lb')).click())
    expect(S().plates.lb[45]).toBe(5)
    expect(S().plates.lb[35]).toBe(6)
  })
})

beforeEach(() : any => prepareExerciseSheets())
