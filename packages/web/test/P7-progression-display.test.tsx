import * as engine from '@opengym/core/progression-engine/index'
// @vitest-environment happy-dom
import './workout-sheet-environment'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { createExerciseIndex } from '@opengym/core/exercises'
import { preview } from '@opengym/core/progression-engine/index'
import { beginWorkout, finishWorkout } from '../src/sheets-d'
import { KEY, useStore } from '../src/store/useStore'
import { configureProgrammeUi } from '../src/lib/programme-ui-services'
import { workoutSheetPlatform } from './workout-sheet-environment'
import { useUI } from '../src/store/useUI'
import { progressionDisplay, entryPrescription } from '../src/lib/progression-display'
import ProgressionPrescription from '../src/components/ProgressionPrescription'
import ProgrammeToday from '../src/components/ProgrammeToday'
import Programs from '../src/views/Programs'
import Workout from '../src/views/Workout'
import { p7Fixture } from './p7-fixture'

let roots: Root[] = []
function mount(element: React.ReactNode) {
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host); roots.push(root); act(() => root.render(element)); return host
}
const cycle = (S: any) => S.programmes.cycles[0]
const display = (S: any, weeks = [1,2]) => progressionDisplay(S,cycle(S).snapshot,cycle(S),weeks,'2026-10-12')!
const persisted = () => workoutSheetPlatform.kv.get(KEY)
const memory = () => JSON.stringify(useStore.getState().S)
function plant(S: any) { useStore.setState({S, user:null}); useStore.getState().update(() => {}) }
function start(S: any) { useStore.setState({S,user:null}); beginWorkout([S.routines[0].id],null); return structuredClone(useStore.getState().S) }
function expand(host: HTMLElement) { act(() => host.querySelectorAll('.prescription-why').forEach(d => { (d as HTMLDetailsElement).open = true; d.dispatchEvent(new Event('toggle')) })) }
beforeEach(() => {
  vi.setSystemTime(new Date('2026-10-12T12:00:00Z'))
  configureProgrammeUi({platform:workoutSheetPlatform,initialProgramId:()=> 'c',startFlow:vi.fn(),confirmSheet:vi.fn(),workoutDetailSheet:vi.fn(),dayOverrideSheet:vi.fn()})
})
afterEach(() => { act(() => roots.splice(0).forEach(r => r.unmount())); document.body.innerHTML = '' })

it('uses exactly P5 preview sets and Why, without changing the input document', () => {
  const S = p7Fixture(), before = JSON.stringify(S), d = display(S)
  expect(d.result).toEqual(preview({definition:cycle(S).snapshot,cycle:cycle(S),logs:[],weeks:[1,2],asOf:'2026-10-12',now:'2026-10-12',profile:{...S,effortScale:'rir'}},{},createExerciseIndex(S.customEx)))
  expect(d.slots.map(x => x.prescription.sets.map(s => s.load))).toEqual([[80,90],[85,95]])
  expect(JSON.stringify(S)).toBe(before)
  const host = mount(<ProgressionPrescription display={d} scale="rir"/>)
  expect(host.textContent).toContain('Prescribed: 2 working sets'); expect(host.textContent).toContain('2 RIR'); expect(host.textContent).toContain('80%'); expect(host.textContent).not.toContain('0.8%')
  expand(host)
  for (const {prescription:p} of d.slots) for (const why of [...p.why,...p.sets.flatMap(s => s.why)]) {
    expect(host.textContent).toContain(why.text)
    for (const [key,value] of Object.entries(why.inputs)) { expect(host.textContent).toContain(key); expect(host.textContent).toContain(String(value)) }
  }
})
it.each(['rir','rpe','none'])('converts display effort to %s without rewriting targets or logged effort', scale => {
  const S = start(p7Fixture()); S.active.entries[0].sets[0].rpe = 9
  const before = JSON.stringify(S), host = mount(<ProgressionPrescription display={display(S)} scale={scale}/>)
  expect(host.textContent).toContain(scale === 'rir' ? '2 RIR' : scale === 'rpe' ? 'RPE 8' : '2 RIR')
  expect(JSON.stringify(S)).toBe(before)
})
it('returns no computed display for instruction-only or unattached rules', () => {
  const S = p7Fixture(false); expect(display(S)).toBeNull()
  cycle(S).snapshot.progressionRules = cycle(p7Fixture()).snapshot.progressionRules
  expect(display(S)).toBeNull()
})
it('uses immutable seeds, never the TM display cache or a fresh e1RM', () => {
  const S = p7Fixture(); cycle(S).tm = {bench:999}; expect(display(S).slots[0]!.prescription.sets[0]!.load).toBe(80)
  cycle(S).snapshot.tmSeeds = {bench:{fromE1rm:{pct:.9}}}; delete cycle(S).tmSeed
  const d = display(S); expect(d.slots[0]!.prescription.sets[0]!.load).toBeNull(); expect(d.result.warnings.some(w => w.code === 'tm.seed-unfrozen')).toBe(true)
  expect(mount(<ProgressionPrescription display={d} scale="rir"/>).textContent).toContain('Choose load')
})
it('displays zero load and zero sets without inventing a row', () => {
  const S = p7Fixture(); cycle(S).tmSeed.bench = 0
  expect(display(S).slots[0]!.prescription.sets[0]!.load).toBeNull()
  const d = display(p7Fixture()); d.slots[0]!.prescription.sets[0]!.load = 0
  expect(mount(<ProgressionPrescription display={d} scale="rir" week={1}/>).textContent).toContain('0 lb')
  const snap = cycle(S).snapshot; snap.progressionRules = [{id:'ramp',kind:'volume-ramp',scope:{slots:[{week:1,day:'d1',session:'main',slot:'bench'}]},startSets:0,addPerWeek:0,maxSets:0,weeks:[1],distribute:'round-robin-by-slot-order',holdIfMissedReps:false}]
  snap.weeks[0].days[0].sessions[0].routineSnapshot.ex[0].progression.rules = ['ramp']
  snap.weeks[1].days[0].sessions[0].routineSnapshot.ex[0].progression.rules = []
  const zero = display(S,[1]); expect(zero.slots[0]!.prescription.sets).toEqual([])
  expect(mount(<ProgressionPrescription display={zero} scale="rir"/>).textContent).toContain('No working sets prescribed')
})
it('surfaces invalid rules and unsupported slots without guessed loads', () => {
  const S = p7Fixture(); cycle(S).snapshot.progressionRules[0].kind = 'unrecognized'
  const d = display(S); expect(d.result.error).toBeTruthy(); expect(d.slots).toEqual([])
  expect(mount(<ProgressionPrescription display={d} scale="rir"/>).textContent).toContain('Prescription unavailable')
})
it('filters invalid log dates exactly like P5 and preserves the offending bytes', () => {
  const S = p7Fixture(); S.workouts = [{d:'2026-02-30',unknown:3}]; const before = JSON.stringify(S)
  expect(display(S).result.warnings).toContainEqual({code:'log.invalid-date',message:'Excluded log 0: expected a valid YYYY-MM-DD date.'})
  expect(JSON.stringify(S)).toBe(before)
})
it('forwards the real custom assisted catalogue to preview and name lookup', () => {
  const S = p7Fixture(); S.customEx = [{id:'p7-assisted',n:'Synthetic assisted display',eq:'leverage machine',target:'chest',assisted:true}]
  const snap = cycle(S).snapshot
  snap.progressionRules = [{id:'linear',kind:'linear',increment:5,unit:'lb',every:{sessions:1},success:'all-sets-all-reps',rounding:{increment:5,mode:'nearest',usePlates:false}}]
  for (const w of snap.weeks) { const e = w.days[0].sessions[0].routineSnapshot.ex[0]; e.id='p7-assisted'; e.weight=100; e.progression.rules=['linear'] }
  const o = cycle(S).occurrences[0]
  S.workouts = [{id:'prior',d:'2026-10-12',start:100,entries:[{id:'p7-assisted',occurrenceId:o.instanceId,target:{slotId:'bench',sets:2,reps:5},sets:[{w:100,r:5,done:true},{w:100,r:5,done:true}]}]}]
  const d = display(S,[2]); expect(d.slots[0]!.name).toBe('Synthetic assisted display'); expect(d.slots[0]!.prescription.sets[0]!.load).toBe(95)
})
it('addresses active entries by exact occurrence and slot, and refuses swaps or ambiguous ids', () => {
  const S = start(p7Fixture()), entry = S.active.entries[0]
  expect(entryPrescription(S,entry,'2026-10-12')!.slots).toHaveLength(1)
  entry.id = '0043'; expect(entryPrescription(S,entry,'2026-10-12')).toBeNull()
  entry.id = '0025'; cycle(S).occurrences.push({...cycle(S).occurrences[0]}); expect(entryPrescription(S,entry,'2026-10-12')).toBeNull()
  entry.occurrenceId = 'absent'; expect(entryPrescription(S,entry,'2026-10-12')).toBeNull()
})
it('Today and the program weeks grid expose expandable prescriptions with unchanged saved bytes', () => {
  plant(p7Fixture()); const before = memory(), saved = persisted()
  const today = mount(<ProgrammeToday/>), grid = mount(<Programs/>)
  expect(today.textContent).toContain('80 lb'); expect(today.textContent).not.toContain('95 lb')
  expect(grid.querySelector('.program-weeks-grid .progression-prescription')).toBeTruthy()
  expect(grid.textContent).toContain('95 lb'); expect(grid.querySelector('button details')).toBeNull()
  expand(today); expand(grid); expect(memory()).toBe(before); expect(persisted()).toBe(saved)
})
it.each(['cards','list','compact'])('ExerciseBlock stays read-only in %s and keeps athlete overrides', layout => {
  const S = start(p7Fixture()); S.active.workoutView = layout; S.active.entries[0].sets[0].w = 123
  plant(S); const before = memory(), saved = persisted(), host = mount(<Workout/>)
  expect(host.textContent).toContain('80 lb'); expect(host.querySelector<HTMLInputElement>('input')?.value).toBe('123')
  expand(host); expect(memory()).toBe(before); expect(persisted()).toBe(saved)
  const increase = host.querySelector<HTMLButtonElement>('.setrow .w button[aria-label="Increase"]')
  expect(increase).toBeTruthy(); act(() => increase!.click())
  expect(useStore.getState().S.active.entries[0].sets[0].w).toBeGreaterThan(123)
  expect(host.textContent).toContain('80 lb')
})
it('I01-style rule-free activation, start, logging and finish preserve each saved document through display', () => {
  const S = p7Fixture(false); plant(S)
  let before = memory(), saved = persisted(); mount(<ProgrammeToday/>); mount(<Programs/>)
  expect(memory()).toBe(before); expect(persisted()).toBe(saved)
  act(() => beginWorkout([useStore.getState().S.routines[0].id],null))
  before = memory(); saved = persisted(); const host = mount(<Workout/>); expect(host.querySelector('.progression-display')).toBeNull()
  expect(memory()).toBe(before); expect(persisted()).toBe(saved)
  act(() => useStore.getState().update(s => { s.active.entries[0].sets = s.active.entries[0].sets.map((row: any) => ({...row,w:123,r:7,done:true})) }))
  before = memory(); saved = persisted(); expect(host.querySelector<HTMLInputElement>('input')?.value).toBe('123')
  expect(memory()).toBe(before); expect(persisted()).toBe(saved)
  act(() => roots.splice(0).forEach(r => r.unmount()))
  act(() => finishWorkout()); before = memory(); saved = persisted(); mount(<ProgrammeToday/>); mount(<Programs/>)
  expect(useStore.getState().S.workouts[0].entries[0].sets[0].w).toBe(123)
  expect(memory()).toBe(before); expect(persisted()).toBe(saved)
})

it('retains numeric rep minima in Today, ExerciseBlock and the grid', () => {
  const S = p7Fixture()
  for (const sets of Object.values(cycle(S).snapshot.progressionRules[0].weeks) as any[]) for (const set of sets) { set.reps=8; set.repsMin=5 }
  plant(S); const today = mount(<ProgrammeToday/>), grid = mount(<Programs/>)
  expect(today.textContent).toContain('5–8 reps'); expect(grid.textContent).toContain('5–8 reps')
  const running = start(structuredClone(useStore.getState().S)); plant(running)
  expect(mount(<Workout/>).textContent).toContain('5–8 reps')
})
it('scopes active entry diagnostics to its exact slot and hides them after a swap', () => {
  const S = start(p7Fixture()), snap = cycle(S).snapshot, entry = S.active.entries[0]
  S.customEx = [{id:'p7-assisted',n:'Synthetic assisted',eq:'leverage machine',assisted:true}]
  const other = structuredClone(snap.weeks[0].days[0]); other.key='d2'
  other.sessions[0].routineSnapshot.ex[0].id='p7-assisted'; snap.weeks[0].days.push(other)
  const whole = display(S,[1]); expect(whole.result.slotErrors).toHaveLength(1)
  const own = entryPrescription(S,entry,'2026-10-12')!
  expect(own.result.slotErrors ?? []).toHaveLength(0); expect(own.result.warnings.some(w=>w.ref?.day==='d2')).toBe(false)
  expect(mount(<ProgressionPrescription display={own} scale="rir"/>).textContent).not.toContain('UNSUPPORTED_ASSISTED')
  entry.id='0043'; expect(entryPrescription(S,entry,'2026-10-12')).toBeNull()
  entry.id='0025'; snap.weeks[0].days[0].sessions[0].routineSnapshot.ex[0].reps='ten'
  const bad = entryPrescription(S,entry,'2026-10-12')!
  expect(bad.result.slotErrors).toHaveLength(1); expect(mount(<ProgressionPrescription display={bad} scale="rir"/>).textContent).toContain('UNSUPPORTED_REPS')
})
it('labels repeated lifts in the grid with their day and session names', () => {
  const S = p7Fixture(); const snap = cycle(S).snapshot
  const other = structuredClone(snap.weeks[0].days[0]); other.key='d2'; other.sessions[0].sessionTemplateId='second'; other.sessions[0].routineSnapshot.name='Synthetic second session'
  const e = other.sessions[0].routineSnapshot.ex[0]; e.progression.rules=['lower']
  snap.weeks[0].days.push(other)
  snap.progressionRules.push({...structuredClone(snap.progressionRules[0]),id:'lower',weeks:{'1':[{pct:.6,reps:5},{pct:.7,reps:5}]}})
  plant(S); const host = mount(<Programs/>)
  const sections = [...host.querySelectorAll('.program-weeks-grid .prescription-session')]
  expect(sections[0]!.textContent).toContain('D1 · Synthetic session'); expect(sections[0]!.textContent).toContain('80 lb')
  expect(sections[1]!.textContent).toContain('D2 · Synthetic second session'); expect(sections[1]!.textContent).toContain('60 lb')
})

it('refuses malformed cycle metadata and attached malformed definitions without guessing or changing bytes', () => {
  const S = p7Fixture(); cycle(S).week1StartDate='2026-02-30'; const before=JSON.stringify(S)
  expect(display(S).slots).toEqual([]); expect(display(S).result.error).toBeTruthy(); expect(JSON.stringify(S)).toBe(before)
  cycle(S).week1StartDate='2026-10-12'; cycle(S).snapshot.weeks.unshift(null)
  expect(display(S).result.error?.code).toBe('INVALID_DEFINITION')
})

it('reuses one engine replay across workout renders and invalidates it on a new immutable document', () => {
 const S = start(p7Fixture()), entry = S.active.entries[0], replay = vi.spyOn(engine, 'preview')
 try {
   const a = entryPrescription(S, entry, '2026-10-12')!, b = entryPrescription(S, entry, '2026-10-12')!
   expect(replay).toHaveBeenCalledTimes(1); expect(a).toEqual(b)
   a.slots = []; expect(entryPrescription(S, entry, '2026-10-12')!.slots.length).toBeGreaterThan(0)
   const next = structuredClone(S); next.sound = !next.sound
   expect(entryPrescription(next, next.active.entries[0], '2026-10-12')).toEqual(b); expect(replay).toHaveBeenCalledTimes(2)
   entryPrescription(next, next.active.entries[0], '2026-10-13'); expect(replay).toHaveBeenCalledTimes(3)
 } finally {replay.mockRestore()}
})

it('shows effective seed units without implicit writes and exposes explicit max adjustment', () => {
 const S = p7Fixture(); S.unit = 'kg'; S.programmes.cycles[0].tm = {bench: 999}; plant(S)
 const before = JSON.stringify(useStore.getState().S), saved = workoutSheetPlatform.kv.get(KEY), host = mount(<Programs/>), panel = host.querySelector('.training-maxes')!
 expect(panel).toBeTruthy(); expect(panel.querySelector('input')).toBeNull(); expect(panel.querySelector('button')?.textContent).toBe('Adjust max')
 expect(panel.textContent).toContain('45.36 kg'); expect(panel.textContent).toContain('Seed'); expect(panel.textContent).not.toContain('999')
 expect(panel.textContent).toContain('Reference max (basis unspecified)'); expect(JSON.stringify(useStore.getState().S)).toBe(before); expect(workoutSheetPlatform.kv.get(KEY)).toBe(saved)
})
