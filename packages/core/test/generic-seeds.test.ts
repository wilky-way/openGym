import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { importProgramme, saveImportedProgramme } from '../src/programme-import'
import { programmeSchemaIssues } from '../src/programme-model-schema'
import { validateProgression } from '../src/progression-validate'
import { validateDefinition } from '../../server/src/library-validation'
import { startProgramme } from '../src/programme-lifecycle'
import { advanceProgramme } from '../src/programme'
import { finishProgrammeBlock } from '../src/programme-rollover'
import { projectCycle, addProgrammeDays } from '../src/programme-calendar'
import { queueNext } from '../src/queue'
import { buildCombinedEntries, requireProgrammeStart } from '../src/session-merge'
import { programmeInstanceFor } from '../src/session-start'
import { buildCompletedWorkout } from '../src/finish-workout'
import { repeatSessionEntries } from '../src/session-repeat'
import { preview } from '../src/progression-engine/preview'
import { evaluate, type EngineInput } from '../src/progression-engine'
import { CATALOGUE, EXIDX } from '../src/exercises'
import { workoutVolume } from '../src/history'
import { dbLoadFor, entryDbLoad, ownedWeightsFor, volumeFactor } from '../src/dumbbells'
import type { Row, Entry } from '../src/session-types'

// All logs and loads below are invented test inputs, never seed defaults.
const schedules = {
  'full-body': ['A','B','A','B','A','B'],
  'dumbbell-only': ['A','B','C'],
  machines: ['A','B','C'],
  'upper-lower': ['Upper 1','Lower 1','Upper 2','Lower 2'],
  'push-pull-legs': ['Push','Pull','Legs'],
  'simple-5x5': ['A','B','A','B','A','B'],
}
type Slug = keyof typeof schedules
const slugs = Object.keys(schedules) as Slug[]
function expectedIds(slug: Slug, name: string): string[] {
  if (slug==='dumbbell-only') return ['1760','0289','0293','1459']
  if (slug==='machines') return ['0576','1350','0585','0599']
  if (slug==='upper-lower') return name.startsWith('Upper') ? ['0025','0027','1162'] : ['0043','0032']
  if (slug==='push-pull-legs') return name==='Push' ? ['0025','1162'] : name==='Pull' ? ['0027','0198'] : ['0043','1459']
  return name==='A' ? ['0043','0025','0027'] : ['0032','1162','0027']
}
const seed = (slug: Slug) => JSON.parse(readFileSync(new URL(`../../../seeds/generic-v1/${slug}.json`, import.meta.url), 'utf8'))
// Tolerant persisted state harness, following the existing programme/session tests.
function setup(slug: Slug, unit = 'kg') {
  const state: any = {unit, effortScale:'rir', routines:[], workouts:[], dayPlan:{}, week:{}, exWeights:{}}
  const imported = importProgramme(seed(slug), {strictPrescriptions:true})
  saveImportedProgramme(state, imported)
  const cycle = startProgramme(state, state.programmes.definitions[0], {cycleId:'invented',today:'2026-01-05',now:1,perWeek:seed(slug).daysPerWeek})
  return {state, cycle, date:'2026-01-05'}
}
type Harness = ReturnType<typeof setup>
function next(h: Harness) {
  const cycle = h.state.programmes.cycles.find((c: any) => c.status === 'active')
  if (!cycle) throw new Error('Expected an active invented cycle')
  const occurrence = projectCycle(cycle, h.state.workouts, h.date, h.state.queue).next!
  const date = occurrence.date
  if (!date) throw new Error('Expected a projected date')
  const id = queueNext(h.state, date, date)
  expect(id).toBe(occurrence.routineId)
  requireProgrammeStart(h.state, [id!], date)
  return {date, occurrence, ...buildCombinedEntries(h.state, [id!])}
}
function finish(h: Harness, edit: (row: Row, entry: Entry, i: number) => Partial<Row> = () => ({w:100})) {
  const built = next(h), serial = h.state.workouts.length + 1
  const entries = built.entries.map(e => ({...e,sets:e.sets.map((row,i) => ({...row,done:true,...edit(row,e,i)}))}))
  const active = {id:`invented-${serial}`,d:built.date,unit:h.state.unit,start:serial*1000,name:built.routines[0]!.name,
    routineIds:built.routineIds,programmeInstance:programmeInstanceFor(built.routines) ?? undefined,entries}
  const workout = buildCompletedWorkout(active,{end:serial*1000+1})
  h.state.workouts.push(workout)
  advanceProgramme(h.state,built.date,serial*1000+2)
  h.date = addProgrammeDays(built.date,1)!
  if (!h.state.programmes.cycles.some((c: any) => c.status === 'active')) {
    const finished = h.state.programmes.cycles.find((c: any) => c.status === 'finished')
    finishProgrammeBlock(h.state,finished.id,'repeat',{today:h.date})
  }
  return {built,workout}
}
const loadOf = (entry: Entry) => entry.sets!.map(s => s.w)
const repsOf = (entry: Entry) => entry.sets!.map(s => s.r)
function input(h: Harness, asOf?: string): EngineInput {
  const cycle = h.state.programmes.cycles.find((c: any) => c.status === 'active')
  return {definition:cycle.snapshot,cycle,historyCycles:h.state.programmes.cycles,logs:h.state.workouts,
    weeks:[cycle.weekIndex],profile:{unit:h.state.unit,effortScale:'rir'},...(asOf ? {asOf} : {})}
}

describe.each(slugs)('original generic seed: %s', slug => {
  it('validates through import and the library validator without mappings, maxes or starting loads', () => {
    const d = seed(slug), imported = importProgramme(JSON.stringify(d), {strictPrescriptions:true})
    expect(CATALOGUE).toHaveLength(5632)
    expect(programmeSchemaIssues(d)).toEqual([])
    expect(validateProgression(d).issues).toEqual([])
    expect(validateDefinition(d).issues).toEqual([]) // software conformance, not publication approval
    expect(imported.unknown).toEqual([])
    expect(imported.unprescribed).toEqual([])
    expect(imported.warnings).toEqual([])
    expect(d.tmSeeds).toBeUndefined()
    const h = setup(slug), before = JSON.stringify(h.state)
    const result = preview(input(h))
    expect(result.error).toBeUndefined()
    expect(result.weeks[0]!.slots.length).toBeGreaterThan(0)
    expect(result.weeks.flatMap(w => w.slots.flatMap(s => s.sets)).every(s => s.load === null)).toBe(true)
    expect(JSON.stringify(h.state)).toBe(before)
    for (const r of h.state.routines) for (const e of r.ex) {
      expect(EXIDX[e.id]).toBeDefined()
      expect(e.weight).toBeUndefined()
      expect(e.tm).toBeUndefined()
      if (slug === 'dumbbell-only') { expect(EXIDX[e.id]!.eq).toBe('dumbbell'); expect(e.dbLoad).toBe(e.id==='1760'?'as':'each') }
      if (slug === 'machines') expect(EXIDX[e.id]!.eq).toBe('leverage machine')
    }
    for (const e of next(h).entries) {
      expect(e.target.weight).toBeNull()
      expect(e.sets.every(s => !Object.hasOwn(s,'w') && !s.done)).toBe(true)
      expect(repsOf(e)).toEqual(Array(e.sets.length).fill(d.progressionRules[0].kind === 'double' ? 8 : d.weeks[0].days[0].sessions[0].routineSnapshot.ex[0].reps))
    }
  })

  it('runs the exact ordered schedule through Start/Finish and explicit block Repeat', () => {
    const h = setup(slug), names: string[] = []
    for (let i=0;i<schedules[slug].length*2;i++) {
      const {built,workout} = finish(h)
      const name=built.routines[0]!.name!.split(' · ')[1]!
      names.push(name)
      expect(built.entries.map(e=>e.id)).toEqual(expectedIds(slug,name))
      for (const e of built.entries) {
        expect(e.sets).toHaveLength(slug==='simple-5x5'?5:3)
        if (slug==='simple-5x5' || slug==='full-body') expect(repsOf(e)).toEqual(Array(slug==='simple-5x5'?5:3).fill(slug==='simple-5x5'?5:6))
      }
      expect(workout.entries!.every(e => e.occurrenceId && e.target?.slotId && e.sets!.every(s => s.done && s.w===100))).toBe(true)
      expect(workout.programmeInstance?.instanceId).toBe(built.occurrence.instanceId)
    }
    expect(names).toEqual([...schedules[slug],...schedules[slug]])
    expect(h.state.programmes.cycles[0].repeatedAs).toBe('invented:lap2')
    expect(h.state.programmes.cycles[1].repeatedAs).toBe('invented:lap2:lap3')
    expect(h.state.workouts).toHaveLength(schedules[slug].length*2)
    // Repeat today preserves the chosen old load and does not tick the current programme queue.
    const before = JSON.stringify(h.state), old = h.state.workouts[0]
    const repeated = repeatSessionEntries(h.state,old)
    expect(repeated.entries.length).toBe(old.entries.length)
    expect(repeated.entries.every(e => e.sets!.every(s => s.w===100 && !s.done))).toBe(true)
    expect(JSON.stringify(h.state)).toBe(before)
  })

  it('leaves blank logged loads unavailable, then follows explicit athlete choices across sessions', () => {
    const h = setup(slug)
    finish(h, () => ({}))
    for (const e of next(h).entries) expect(e.sets.every(s => s.w == null)).toBe(true)
    // Every template repeats at least one lift in its next session.
    const id = next(h).entries.at(-1)!.id!
    finish(h, () => ({w:80}))
    const found: Entry[] = []
    for (let i=0;i<10 && !found.length;i++) {
      const e = next(h).entries.find(e => e.id === id)
      if (e) found.push(e)
      else finish(h)
    }
    expect(found).toHaveLength(1)
    expect(loadOf(found[0]!)).toEqual(Array(found[0]!.sets!.length).fill(seed(slug).progressionRules[0].kind==='linear'?82.5:80))
  })
})

describe.each(['full-body','simple-5x5'] as const)('%s linear boundaries', slug => {
  it('increments only after all sets succeed, holds on a missed rep or missing set', () => {
    const hit = setup(slug)
    finish(hit)
    expect(loadOf(next(hit).entries.at(-1)!)).toEqual(Array(slug==='simple-5x5'?5:3).fill(102.5))
    for (const missing of [false,true]) {
      const h = setup(slug), b = next(h)
      if (missing) b.entries.at(-1)!.sets.pop()
      // A missing row must travel through the same production finish serializer.
      const entries = b.entries.map(e => ({...e,sets:e.sets.map((s,i) => ({...s,w:100,r:missing?s.r:i===0?1:s.r,done:true}))}))
      h.state.workouts.push(buildCompletedWorkout({id:'short',d:b.date,start:1000,unit:'kg',routineIds:b.routineIds,programmeInstance:programmeInstanceFor(b.routines) ?? undefined,entries},{end:1001}))
      advanceProgramme(h.state,b.date,1002);h.date=addProgrammeDays(b.date,1)!
      expect(loadOf(next(h).entries.at(-1)!)).toEqual(Array(slug==='simple-5x5'?5:3).fill(100))
    }
  })

  it('holds after two misses, resets90% after three from next day, with fixed set/rep targets', () => {
    const h=setup(slug), count=slug==='simple-5x5'?5:3, reps=slug==='simple-5x5'?5:6
    for(let i=0;i<2;i++) finish(h,()=>({w:100,r:1}))
    expect(loadOf(next(h).entries.at(-1)!)).toEqual(Array(count).fill(100))
    const {built}=finish(h,()=>({w:100,r:1}))
    // Finish just advanced to W2. Inspect the triggering W1 at its own date;
    // W2's calendar preview correctly starts after the reset is effective.
    const at=(date:string):EngineInput=>({...input(h,date),weeks:[built.occurrence.weekIndex],cycle:{...input(h).cycle!,weekIndex:built.occurrence.weekIndex}})
    const today=evaluate(at(built.date)), tomorrow=evaluate(at(addProgrammeDays(built.date,1)!))
    expect(today.weeks[0]!.slots.find(s=>s.exerciseId==='0027')!.sets.map(s=>s.load)).toEqual(Array(count).fill(100))
    expect(tomorrow.weeks[0]!.slots.find(s=>s.exerciseId==='0027')!.sets.map(s=>s.load)).toEqual(Array(count).fill(90))
    const row=next(h).entries.at(-1)!
    expect(loadOf(row)).toEqual(Array(count).fill(90));expect(repsOf(row)).toEqual(Array(count).fill(reps))
  })

  it('rounds a97.5kg actual-load reset87.75kg to87.5kg on the authored grid', () => {
    const h=setup(slug)
    for(let i=0;i<3;i++) finish(h,()=>({w:97.5,r:1}))
    expect(loadOf(next(h).entries.at(-1)!)).toEqual(Array(slug==='simple-5x5'?5:3).fill(87.5))
  })
})

describe.each(['dumbbell-only','machines','upper-lower','push-pull-legs'] as const)('%s double boundaries', slug => {
  // Train only the selected recurring exercise's exposures; other sessions still finish normally.
  function exposure(h: Harness, id: string, reps: number, missing=false) {
    while (!next(h).entries.some(e=>e.id===id)) finish(h)
    return finish(h,(row,e,i)=>e.id===id ? {w:100,r:reps,...(missing && i===2?{done:false}:{})} : {w:100})
  }
  function target(h: Harness,id:string) {
    while (!next(h).entries.some(e=>e.id===id)) finish(h)
    return next(h).entries.find(e=>e.id===id)!
  }
  it('builds8→9→10→11→12 then increases load and resets8 across explicit block repeats', () => {
    const h=setup(slug),id=next(h).entries[0]!.id!
    for(let reps=8;reps<=12;reps++) {
      expect(repsOf(target(h,id))).toEqual([reps,reps,reps])
      exposure(h,id,reps)
      expect(loadOf(target(h,id))).toEqual(Array(3).fill(reps===12?102.5:100))
    }
    expect(repsOf(target(h,id))).toEqual([8,8,8])
  })
  it('requires every set at12 and resets only on the sixth short-of-ceiling exposure', () => {
    const h=setup(slug), id=next(h).entries[0]!.id!
    exposure(h,id,12,true)
    expect(loadOf(target(h,id))).toEqual([100,100,100])
    for(let i=1;i<5;i++) exposure(h,id,7)
    expect(loadOf(target(h,id))).toEqual([100,100,100])
    exposure(h,id,7)
    expect(loadOf(target(h,id))).toEqual([90,90,90])
  })
})

it.each(slugs)('%s keeps first loads blank and converts kg rules through lb Start/Finish/Repeat', slug => {
  const h=setup(slug,'lb')
  expect(next(h).entries.every(e=>e.sets.every(s=>s.w==null))).toBe(true)
  for(let i=0;i<schedules[slug].length;i++) finish(h,()=>({w:220.4622621849}))
  expect(h.state.programmes.cycles[0].repeatedAs).toBe('invented:lap2')
  const expected=seed(slug).progressionRules[0].kind==='linear'?225.9738187396:220.4622621849
  for(const e of next(h).entries) for(const w of loadOf(e)) expect(w).toBeCloseTo(expected,7)
  expect(h.state.programmes.definitions[0].progressionRules[0]).toMatchObject({unit:'kg',increment:2.5,rounding:{increment:2.5,usePlates:false}})
})

it('converts kg progression and its grid together for an lb profile; no plate inventory is inferred', () => {
  const h=setup('simple-5x5','lb')
  finish(h,()=>({w:220.4622621849})) // invented100kg inlb
  const e=next(h).entries.at(-1)!
  // 102.5kg ×2.204622621849; the kg grid also becomes5.5115565546lb, not5lb.
  for(const w of loadOf(e)) expect(w).toBeCloseTo(225.9738187396,7)
  expect(e.target.prescriptionWhy).toEqual(expect.arrayContaining([expect.objectContaining({inputs:expect.objectContaining({inventory:false,roundingIncrement:expect.closeTo(5.5115565546,7)})})]))
})

// Physical implements checked against catalogue/exercises/<id>.json: 1760 holds one
// bell with both hands; 0289, 0293 (two-arm row), and 1459 hold one in each hand.
// Barbell/cable/machine numbers already describe the complete entered load.
const loadMeaning: Record<string, { equipment: string; meaning: 'as' | 'each'; factor: number }> = {
  '1760': {equipment:'dumbbell', meaning:'as', factor:1},
  '0289': {equipment:'dumbbell', meaning:'each', factor:2},
  '0293': {equipment:'dumbbell', meaning:'each', factor:2},
  '1459': {equipment:'dumbbell', meaning:'each', factor:2},
  ...Object.fromEntries(['0043','0025','0027','0032','1162'].map(id => [id, {equipment:'barbell',meaning:'as' as const,factor:1}])),
  ...Object.fromEntries(['0576','1350','0585','0599'].map(id => [id, {equipment:'leverage machine',meaning:'as' as const,factor:1}])),
  '0198': {equipment:'cable', meaning:'as', factor:1},
}
// These slots have no per-side/bodyweight setup; narrow Config's unknown fields
// to the two fields needed by the bell helpers instead of casting their types.
const bellTarget = (e: Entry) => ({id:e.id, dbLoad:e.target?.dbLoad})

describe.each(['kg','lb'])('%s entered loads and historical volume', unit => {
  it.each(slugs)('%s preserves every slot through import/save/Start/Finish/history/Repeat', slug => {
    const h=setup(slug,unit), d=seed(slug)
    // An explicit single-bell slot must override an athlete's old per-bell default.
    h.state.dbLoad={'1760':{mode:'each',_ts:1}}
    const authored = d.weeks.flatMap((w: any) => w.days.flatMap((day: any) => day.sessions.flatMap((s: any) => s.routineSnapshot.ex)))
    for (const e of authored) {
      const expected=loadMeaning[e.id]!
      expect(expected).toBeDefined()
      expect(EXIDX[e.id]!.eq).toBe(expected.equipment)
      expect(e.side).toBeUndefined()
      expect(e.dbLoad).toBe(expected.equipment==='dumbbell'?expected.meaning:undefined)
    }
    let visited=0
    for (let i=0;i<schedules[slug].length;i++) {
      const {built,workout}=finish(h,()=>({w:20,r:8}))
      // Round-trip the exact production Finish payload through persisted JSON.
      const saved=JSON.parse(JSON.stringify(workout))
      h.state.workouts[h.state.workouts.length-1]=saved
      const before=JSON.stringify(h.state), repeated=repeatSessionEntries(h.state,saved)
      expect(repeated.skipped).toBe(0)
      expect(repeated.entries.map(e=>e.id)).toEqual(saved.entries.map((e: Entry)=>e.id))
      let total=0
      for (const [j,e] of built.entries.entries()) {
        const expected=loadMeaning[e.id!]!, historical=saved.entries[j], again=repeated.entries[j]!
        const volume=expected.factor*20*8*(slug==='simple-5x5'?5:3)
        expect(dbLoadFor(h.state,bellTarget(e))).toBe(expected.meaning)
        expect(e.target.side).toBeUndefined()
        expect(entryDbLoad(historical)).toBe(expected.meaning)
        expect(entryDbLoad({target:bellTarget(again)})).toBe(expected.meaning)
        expect(volumeFactor(historical)).toBe(expected.factor)
        expect(workoutVolume({entries:[historical]})).toBe(volume)
        expect(again.sets!.map(s=>[s.w,s.done])).toEqual(Array(e.sets.length).fill([20,false]))
        // Repeat keeps planned rep targets; the athlete again logs eight actual reps.
        expect(repsOf(again)).toEqual(repsOf(e))
        const completed=buildCompletedWorkout({id:'invented-repeat',d:built.date,start:1,
          entries:[{...again,sets:again.sets!.map(s=>({...s,r:8,done:true}))}]},{end:2})
        expect(workoutVolume(completed)).toBe(volume)
        expect(completed.entries[0]!.target?.dbLoad).toBe(historical.target.dbLoad)
        total+=volume
        visited++
      }
      expect(workoutVolume(saved)).toBe(total)
      expect(JSON.stringify(h.state)).toBe(before)
    }
    expect(visited).toBe(authored.length)
    expect(h.state.programmes.cycles[0].repeatedAs).toBe('invented:lap2')
    for (const e of next(h).entries) expect(dbLoadFor(h.state,bellTarget(e))).toBe(loadMeaning[e.id!]!.meaning)
  })

  it('uses owned single-bell weights for goblet without inventing paired inventory or unilateral rows', () => {
    const h=setup('dumbbell-only',unit), rack=unit==='kg'?[12,16,20,24]:[10,20,30,40]
    h.state.dumbbells={[unit]:{weights:rack,_ts:1}}
    h.state.dbLoad={'1760':{mode:'each',_ts:1}}
    const first=next(h).entries
    expect(first.every(e=>e.sets.every(s=>s.w==null))).toBe(true)
    const {workout}=finish(h,()=>({w:20,r:8}))
    const goblet=workout.entries.find(e=>e.id==='1760')!
    expect(goblet.target?.dbLoad).toBe('as')
    expect(ownedWeightsFor(h.state,bellTarget(goblet))).toEqual(rack)
    expect(goblet.sets!.every(s=>!s.sides && s.w===20)).toBe(true)
    expect(workoutVolume({entries:[goblet]})).toBe(480)
    const repeated=repeatSessionEntries(h.state,workout).entries.find(e=>e.id==='1760')!
    expect(ownedWeightsFor(h.state,bellTarget(repeated))).toEqual(rack)
    expect(repeated.sets!.map(s=>s.w)).toEqual([20,20,20])
    const nextGoblet=next(h).entries.find(e=>e.id==='1760')!
    // Programme prescriptions retain the authored kg grid, converted for lb.
    for (const w of loadOf(nextGoblet)) expect(w).toBeCloseTo(unit==='kg'?20:22.046226218,7)
    expect(repsOf(nextGoblet)).toEqual([9,9,9])
    expect(ownedWeightsFor(h.state,bellTarget(nextGoblet))).toEqual(rack)
    for (const e of workout.entries.filter(e=>e.id!=='1760')) {
      expect(ownedWeightsFor(h.state,bellTarget(e))).toEqual(rack)
      expect(workoutVolume({entries:[e]})).toBe(960)
    }
  })
})
