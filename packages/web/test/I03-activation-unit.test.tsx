// @vitest-environment happy-dom
import './programme-ui-harness'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import Programs from '../src/views/Programs'
import { useStore } from '../src/store/useStore'
import { initializePublicActions } from '../src/store/public-actions'
import { testPlatform } from './programme-ui-harness'
import { materializeTmSeed } from '@opengym/core/materialize-tm-seed'
import { convertWeightPrecise } from '@opengym/core/progression-engine/units'
import { progressionDisplay } from '../src/lib/progression-display'
import { p7Fixture } from './p7-fixture'

const pairs = [['lb', 'kg'], ['kg', 'lb'], ['lb', 'lb'], ['kg', 'kg']] as const
let root: Root | undefined
beforeEach(() => {
 globalThis.IS_REACT_ACT_ENVIRONMENT = true
 vi.setSystemTime(new Date('2026-10-12T12:00:00Z'))
 initializePublicActions({platform: testPlatform, toast: () => {}, materializeTmSeed})
})
afterEach(() => {act(() => root?.unmount()); root = undefined; document.body.innerHTML = ''})
function fixture(definitionUnit: 'lb'|'kg', profileUnit: 'lb'|'kg', kind: 'manual'|'fixed'|'history') {
 const S = p7Fixture(), d = structuredClone(S.programmes.cycles[0].snapshot)
 d.unit = definitionUnit; d.tmSeeds = {bench: {value: 100, unit: definitionUnit}}
 for (const week of d.weeks) {
  week.unit = definitionUnit
  week.days[0].sessions[0].routineSnapshot.ex[0].pyramid = [5, 5]
  week.days[0].sessions[0].routineSnapshot.ex[0].tm = {key: 'bench', percentages: [65, 65]}
 }
 for (const rows of Object.values(d.progressionRules[0].weeks) as any[]) for (const row of rows) row.pct = .65
 d.progressionRules[0].rounding.increment = .5
 if (kind === 'history') d.tmSeeds = {bench: {fromE1rm: {pct: .9}}}
 S.unit = profileUnit; S.routines = []; S.queue = null; S.programmes = {definitions: [d], cycles: []}
 S.workouts = kind === 'history' ? [{id: 'synthetic-prior-history', unit: profileUnit, d: '2026-10-11', start: Date.parse('2026-10-11T10:00:00Z'), end: Date.parse('2026-10-11T11:00:00Z'), entries: [{id: '0025', sets: [{w: 100, r: 1, done: true}]}]}] : []
 useStore.getState().replaceState(S, false)
 return d
}
function mountedPreview() {
 const host = document.createElement('div'); document.body.append(host); root = createRoot(host)
 act(() => root!.render(<Programs/>))
 act(() => (host.querySelector('.program-card') as HTMLButtonElement).click())
 click(host, 'Start this program')
 return host
}
function click(host: HTMLElement, text: string) {
 const button = [...host.querySelectorAll('button')].find(b => b.textContent?.trim() === text)!
 expect(button, text).toBeTruthy(); act(() => button.click())
}
function enterTm(host: HTMLElement, value: number) {
 const input = host.querySelector('input[type=number]')!
 act(() => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, String(value))
  input.dispatchEvent(new Event('input', {bubbles: true})); input.dispatchEvent(new Event('change', {bubbles: true}))
 })
}
function checkLoad(cycle: any, expected: number, unit: 'lb'|'kg') {
 const display = progressionDisplay(useStore.getState().S, cycle.snapshot, cycle, [1], '2026-10-12')!
 expect(display.result.error).toBeUndefined()
 const set = display.slots[0]!.prescription.sets[0]!
 expect(set.unit).toBe(unit); expect(Math.abs(set.load! - expected)).toBeLessThan(.251)
}
for (const kind of ['manual', 'fixed', 'history'] as const) it.each(pairs)(`mounted Programs activates ${kind} seeds in definition %s / profile %s units`, (definitionUnit, profileUnit) => {
 fixture(definitionUnit, profileUnit, kind)
 const host = mountedPreview()
 if (kind === 'manual') enterTm(host, 100)
 click(host, 'Confirm load')
 const cycle = useStore.getState().S.programmes.cycles[0]
 expect(cycle, host.textContent!).toBeTruthy()
 // The established e1RM estimator rounds to a tenth in the definition unit.
 const expectedSeed = kind === 'fixed' ? 100 : kind === 'history' ? Math.round(convertWeightPrecise(100, profileUnit, definitionUnit) * 10) / 10 * .9 : convertWeightPrecise(100, profileUnit, definitionUnit)
 const profileTm = convertWeightPrecise(expectedSeed, definitionUnit, profileUnit)
 expect(cycle.tmSeed.bench).toBeCloseTo(convertWeightPrecise(profileTm, profileUnit, definitionUnit), 10)
 expect(cycle.tm.bench).toBeCloseTo(profileTm, 10); expect(cycle.tmUnit).toBe(profileUnit)
 checkLoad(cycle, profileTm * .65, profileUnit)
})
it('LoadPreview labels the manual profile TM and its converted definition-unit seed', () => {
 fixture('lb', 'kg', 'manual')
 const host = mountedPreview(); enterTm(host, 100)
 expect(host.querySelector('input[type=number]')!.closest('label')!.textContent).toContain('Reference max (basis unspecified): bench (kg)')
 expect(host.querySelector('output[aria-label="Program training max: bench"]')?.textContent).toBe('220.46 lb')
})
it('Codex C-F6: a manual 100 kg TM at 65% prescribes 65 kg in an lb programme', () => {
 const d = fixture('lb', 'kg', 'manual')
 const cycle = useStore.getState().startProgramme(d, {today: '2026-10-12', tm: {bench: 100}})
 expect(cycle.tmSeed!.bench).toBeCloseTo(100 * 2.2046226218, 10)
 checkLoad(cycle, 65, 'kg')
})
it.each(pairs)('activation without the resolver converts manual %s programme / %s profile TMs once', (definitionUnit, profileUnit) => {
 const d = fixture(definitionUnit, profileUnit, 'manual')
 initializePublicActions({platform: testPlatform, toast: () => {}})
 const cycle = useStore.getState().startProgramme(d, {tm: {bench: 100}})
 expect(cycle.tmSeed!.bench).toBeCloseTo(convertWeightPrecise(100, profileUnit, definitionUnit), 10)
 checkLoad(cycle, 65, profileUnit)
})
it.each(pairs)('an explicitly tagged %s TM is not converted again from the %s profile unit', (definitionUnit, profileUnit) => {
 const d = fixture(definitionUnit, profileUnit, 'manual')
 const options = {tm: {bench: 100}, tmUnit: definitionUnit}
 const before = structuredClone(options)
 const cycle = useStore.getState().startProgramme(d, options)
 expect(cycle.tmSeed!.bench).toBe(100)
 expect(cycle.tm!.bench).toBeCloseTo(convertWeightPrecise(100, definitionUnit, profileUnit), 10)
 expect(options).toEqual(before)
})
