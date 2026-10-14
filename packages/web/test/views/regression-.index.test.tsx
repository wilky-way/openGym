// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import Stats from '../../src/views/Stats'
import StructuralBalance from '../../src/views/StructuralBalance'
import { DEF, useStore } from '../../src/store/useStore'
import { configureUx, createBrowserUx } from '../../src/platform/ux'
import { bindTestViewServices } from './StructuralBalance.services'
import { bindUI } from '../../src/components/ui'
import { useUI } from '../../src/store/useUI'
const captures = vi.hoisted(() => ({ maps: [] as any[], charts: [] as any[] }))
vi.mock('../../src/components/BodyMap', () => ({ default: (p: any) => {
  captures.maps.push(p); return <button data-muscle onClick={() => p.onMuscle('chest')}>Pick chest</button>
}, BodyMapLegend: () => null }))
vi.mock('../../src/components/LineChart', () => ({ default: (p: any) => { captures.charts.push(p); return <div data-chart /> } }))
vi.mock('../../src/components/Heatmap', () => ({ default: () => null }))
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const NOW = Date.parse('2026-01-22T12:00:00Z'), DAY = 86400000
let root: Root, host: HTMLDivElement
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(NOW); configureUx(createBrowserUx()); bindTestViewServices(); bindUI(useUI)
  captures.maps = []; captures.charts = []; useStore.setState({ S: structuredClone(DEF), user: null }); useUI.setState({ sheets: [] })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers() })
const btn = (s: string) => [...host.querySelectorAll('button')].find(b => b.textContent?.trim() === s)!
const click = (s: string) => act(() => btn(s).click())
function mount(S: any, View = Stats) { useStore.setState({ S: { ...structuredClone(DEF), ...S } }); act(() => root.render(<View />)) }
const ex = (id: string, extra: any = {}) => ({ id, n: 'My '+id, bp: 'chest', tg: 'chest', eq: 'barbell', custom: true, ...extra })
const w = (id: string, weights: number[], age = 1, cfg: any = {}) => ({ id: 'w'+age, d: new Date(NOW-age*DAY).toISOString().slice(0,10), start: NOW-age*DAY, entries: [{ id, ...cfg, sets: weights.map(weight => ({ w: weight, r: 6, done: true })) }] })
const chart = () => captures.charts.at(-1)
it('scores custom muscles in the current plan, balance window, recovery and retained-strength rows', () => {
  const custom = ex('custom-chest')
  mount({ customEx: [custom], week: { 1: 'r' }, routines: [{ id: 'r', ex: [{ id: custom.id, sets: 3 }] }], workouts: [w(custom.id,[50,50])] })
  expect(captures.maps.at(-1).load.chest).toBe(2)
  expect(host.querySelector('[data-muscle-volume="chest"] .v')!.textContent).toBe('2/3 · 67%')
  expect(host.querySelector('[data-weekly-muscle-volume]')!.textContent).toContain('3 sets')
  click('Fatigue'); expect(captures.maps.at(-1).load.chest).toBeGreaterThan(0)
  click('Strength'); expect(captures.maps.at(-1).load.chest).toBe(1)
  act(() => (host.querySelector('[data-muscle]') as HTMLButtonElement).click())
  expect(host.textContent).toContain('My custom-chest'); expect(host.textContent).toContain('Est. 1RM')
})
it('keeps custom last-trained recency and 90-day set counts in detrained rows', () => {
  mount({ customEx: [ex('custom-old')], workouts: [w('custom-old',[50],35)] })
  click('Strength'); const row = [...host.querySelectorAll('.mrow')].find(r => r.querySelector('.nm')?.textContent === 'Chest')!
  expect(row.textContent).toContain('Weeks since training: 5'); expect(row.textContent).toContain('1 sets')
})
it('uses the custom index for all-time assistance ranking and occurrence minima', () => {
  mount({ customEx: [ex('custom-assist', { assisted: true })], workouts: [w('custom-assist',[70,30],3),w('custom-assist',[60,40],2)] })
  expect(chart().points.map((p: any) => p.y)).toEqual([30,40]); expect(host.textContent).toContain('Best: 30 kg')
  expect(host.textContent).not.toContain('Est. 1RM'); expect(host.querySelectorAll('.card h2').length).toBeGreaterThan(1)
  click('Per set'); expect(chart().unit).toBe('reps'); expect(chart().series[0].points[0].y).toBe(6)
})
it('uses custom assistance across multiple occurrences in one workout', () => {
  const workout = w('custom-assist',[30]); workout.entries.push({ ...workout.entries[0]!, sets: [{ w:70,r:6,done:true }] })
  mount({ customEx:[ex('custom-assist',{assisted:true})], workouts:[workout] })
  expect(chart().points[0].y).toBe(30)
})
it('converts custom dumbbell history to its current meaning for progress and e1RM', () => {
  mount({ customEx: [ex('custom-db', { eq:'dumbbell', n:'My single arm press' })], dbLoad:{'custom-db':'total'}, workouts:[w('custom-db',[20],3,{target:{dbLoad:'each'}}),w('custom-db',[30],2,{target:{dbLoad:'each'}})] })
  expect(chart().points.map((p: any) => p.y)).toEqual([20,30])
  click('Est. 1RM'); expect(chart().points.map((p: any) => p.y)).toEqual([24,36]); expect(host.textContent).toContain('Best: 36 kg')
})
it('does not invent estimated effort on a custom assisted-only history', () => {
  mount({ customEx:[ex('custom-assist',{assisted:true})],workouts:[w('custom-assist',[50],2)] })
  expect([...host.querySelectorAll('.card h2')].some(h=>h.textContent?.startsWith('Effort'))).toBe(false)
})
it('resolves estimated effort with custom bodyweight anchors and loads', () => {
  mount({ customEx:[ex('custom-bw',{eq:'body weight'})], bodyweight:[{d:'2026-01-20',w:80}],workouts:[w('custom-bw',[20,20,20],2),w('custom-bw',[15,15],1)] })
  const card = [...host.querySelectorAll('.card')].find(c=>c.querySelector('h2')?.textContent?.startsWith('Effort'))!
  expect(card.textContent).toContain('5 estimated of 5 sets'); expect(card.querySelector('.stat-v')!.textContent).toBe('0.8 RIR')
})
it('labels custom bodyweight sets as added load', () => {
  mount({customEx:[ex('custom-bw',{eq:'body weight'})],workouts:[w('custom-bw',[20],1)]})
  expect(host.textContent).toContain('+20 × 6')
})
it('scores an overridden custom dumbbell balance role and names its exercise', () => {
  mount({customEx:[ex('custom-db',{assisted:true})],balanceTemplate:'atg',bodyweight:[{d:'2026-01-20',w:100}],balanceOverrides:{'atg:inclineDbPress':{id:'custom-db',_ts:1}},workouts:[w('0030',[100],2),w('custom-db',[20],1)]},StructuralBalance)
  const row = host.querySelector('[data-role-id="inclineDbPress"]')!
  expect(row.textContent).toContain('My custom-db'); expect((row as HTMLElement).dataset.status).not.toBe('no-data'); expect(row.textContent).toContain('76%')
})

it('uses custom metadata that overrides a catalogue id in every planned-volume card', () => {
  mount({customEx:[ex('0030',{tg:'calves',bp:'lower legs'})],week:{1:'r'},routines:[{id:'r',ex:[{id:'0030',sets:3}]}],workouts:[w('0030',[50],1)]})
  expect(host.querySelector('[data-muscle-volume="calves"] .v')!.textContent).toBe('1/3 · 33%')
  expect(host.querySelector('[data-weekly-muscle-volume]')!.textContent).toContain('Calves')
  expect(host.querySelector('[data-weekly-muscle-volume]')!.textContent).not.toContain('Chest')
})
it('offers balance for a custom planned-only profile and uses custom cardio fallback', () => {
  mount({customEx:[ex('0030',{tg:'calves',bp:'lower legs'})],week:{1:'r'},routines:[{id:'r',ex:[{id:'0030',sets:3}]}]})
  expect(captures.maps.at(-1).load).toEqual({})
  expect(host.querySelector('[data-muscle-volume="calves"] .v')!.textContent).toBe('0/3 · 0%')
  act(() => root.unmount()); root = createRoot(host)
  mount({customEx:[ex('my-cardio',{eq:'machine',bp:'cardio',tg:'cardiovascular system'})],workouts:[{...w('my-cardio',[]),entries:[{id:'my-cardio',sets:[{mode:'reps',done:false},{mode:'time',done:false}]}]}]})
  expect(host.textContent).toContain('Top speed per workout')
})
it('hides muscle balance when an overridden catalogue routine trains no drawable muscles', () => {
  mount({customEx:[ex('5889',{tg:'unmapped',bp:'cardio',sm:[]})],week:{1:'r'},routines:[{id:'r',ex:[{id:'5889',sets:3}]}]})
  expect(host.querySelector('[data-muscle]')).toBeNull()
})
it('keeps legacy positive topW on a custom assisted zero-load row as load progress', () => {
  mount({customEx:[ex('custom-assist',{assisted:true})],workouts:[w('custom-assist',[0],1,{topW:20})]})
  expect(chart().unit).toBe('kg'); expect(chart().points[0].y).toBe(20)
})
