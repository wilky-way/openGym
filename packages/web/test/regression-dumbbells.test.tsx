import { prepareExerciseSheets } from './regression-test-support'
// @vitest-environment happy-dom
// The dumbbell inventory sheet (Settings → Equipment → Dumbbells, issue #376) writes the list of
// bells for the profile's unit, stamped, the way lib/dumbbells.js reads it.
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore, DEF } from '../src/store/useStore'
import { useUI } from '../src/store/useUI'
import { dumbbellInventorySheet } from '../src/sheets'

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
const button: any = (host: any, text: any) : any => [...(host.querySelectorAll('button') as any)].find((b: any) : any => b.textContent.trim().startsWith(text))
const chips: any = (host: any) : any => [...(host.querySelectorAll('.chip') as any)].map((c: any) : any => c.textContent.trim())

describe('dumbbell inventory sheet', () : any => {
  beforeEach(() : any => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    useUI.setState({ sheets: [], toastMsg: '' })
    useStore.setState({ S: { ...JSON.parse(JSON.stringify(DEF)), unit: 'kg' }, user: null })
    document.body.innerHTML = ''
  })
  afterEach(() : any => { act(() : any => { mounted.splice(0).forEach((root: any) : any => root.unmount()) }) })

  it('starts empty, fills the usual rack, and a tap takes a bell off', () : any => {
    act(() : any => dumbbellInventorySheet())
    const host: any = mountTopSheet()
    expect(host.textContent).toContain('No list yet')
    act(() : any => button(host, 'Fill in 2 to 50 kg, every 2').click())
    expect(S().dumbbells.kg.weights).toHaveLength(25)
    expect(S().dumbbells.kg._ts).toEqual(expect.any(Number))
    expect(chips(host)[0]).toBe('2')
    act(() : any => (host.querySelector('[aria-label="Remove 2 kg"]') as any).click())
    expect(S().dumbbells.kg.weights[0]).toBe(4)
    act(() : any => button(host, 'Clear the list').click())
    expect(S().dumbbells.kg.weights).toEqual([])
  })

  it('adds a typed weight in order and keeps the other unit alone', () : any => {
    useStore.setState((s: any) : any => ({ S: { ...s.S, dumbbells: { kg: { weights: [3, 9], _ts: 1 }, lb: { weights: [10], _ts: 1 } } } }))
    act(() : any => dumbbellInventorySheet())
    const host: any = mountTopSheet()
    const input: any = (host.querySelector('input') as any)
    act(() : any => {
      const set: any = (Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value') as any).set
      set.call(input, '6')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    act(() : any => button(host, 'Add').click())
    expect(S().dumbbells.kg.weights).toEqual([3, 6, 9])
    expect(S().dumbbells.lb).toEqual({ weights: [10], _ts: 1 })
  })

  it('offers the lb rack to a lb profile', () : any => {
    useStore.setState((s: any) : any => ({ S: { ...s.S, unit: 'lb' } }))
    act(() : any => dumbbellInventorySheet())
    const host: any = mountTopSheet()
    act(() : any => button(host, 'Fill in 5 to 100 lb, every 5').click())
    expect(S().dumbbells.lb.weights.slice(0, 3)).toEqual([5, 10, 15])
  })
})

beforeEach(() : any => prepareExerciseSheets())
