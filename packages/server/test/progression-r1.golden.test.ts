import { installProgression } from '../src/progression'
import { ApiError } from '../src/http'
import { MAX_STORED_BYTES, type DataService } from '../src/data'
import type { GymApp } from '../src/app'
import { describe, expect, test } from 'bun:test'
import { fixture, progressionServer, applyBody } from './progression-helpers'
import { syntheticSlot } from '../../core/test/fixtures/synthetic-programme'
import { buildSessionEntries } from '@opengym/core/session-start'
import { createExerciseIndex } from '@opengym/core/exercises'
import { rpeRule } from '../../core/test/fixtures/synthetic-p3'

const apply='/api/progression/apply', preview='/api/progression/preview'
const linear={id:'linear',kind:'linear',increment:5,unit:'lb',every:{sessions:1},success:'all-sets-all-reps',rounding:{increment:5,mode:'nearest',usePlates:false}}
const rows=(state:any)=>buildSessionEntries(state,state.routines[1],createExerciseIndex(state.customEx))[0]!.sets
describe('hand-computed wire goldens',()=> {
  test('rule-free percentage cycle is byte-exact, with or without frozen seeds',async()=> {
    for(const seeded of [false,true]) {
      const h=progressionServer(),s=fixture(),c=s.programmes.cycles[0],d=c.snapshot
      d.progressionRules=[];c.tm={bench:100}
      if(seeded) {c.tmSeed={bench:200};d.tmSeeds={bench:{value:200,unit:'lb'}}}
      else {delete c.tmSeed;delete d.tmSeeds}
      for(const w of d.weeks) {const slot=syntheticSlot({...d,weeks:[w]});slot.progression.rules=[];slot.tm.percentages=[80,90];slot.pyramid=[5,5]}
      for(const r of s.routines) {r.ex[0].progression.rules=[];r.ex[0].tm.percentages=[80,90]}
      h.plant(s);const before=h.stored()!
      // TM100 × 80%/90% = 80/90 lb; the unrelated seed must not replace the cache.
      expect(rows(s).map((r:any)=>r.w)).toEqual([80,90])
      for(const dryRun of [true,false]) {
        expect(await h.call('POST',apply,{...applyBody,dryRun})).toMatchObject({status:200,body:{stateRev:4,changed:[]}})
        expect(h.stored()).toBe(before);expect(rows(JSON.parse(h.stored()!)).map((r:any)=>r.w)).toEqual([80,90])
      }
    }
  })
  test('mixed cycle refreshes engine bench TM and preserves unrelated legacy TM and seed',async()=> {
    const h=progressionServer(),s=fixture(),c=s.programmes.cycles[0],d=c.snapshot
    c.tm={legacy:150,bench:95};c.tmSeed.legacy=300;d.tmSeeds.legacy={value:300,unit:'lb'}
    for(const w of d.weeks) {
      const slot=syntheticSlot({...d,weeks:[w]});slot.tm.percentages=[80,90];slot.pyramid=[5,5]
      w.days[0].sessions[0].routineSnapshot.ex.push({...structuredClone(slot),slotId:'legacy',progression:{...slot.progression,rules:[]},tm:{key:'legacy',percentages:[80,90],reference:'tm'}})
    }
    for(const r of s.routines) {r.ex[0].tm.percentages=[80,90];r.ex.push({...structuredClone(r.ex[0]),slotId:'legacy',progression:{...r.ex[0].progression,rules:[]},tm:{key:'legacy',percentages:[80,90],reference:'tm'}})}
    h.plant(s)
    expect((await h.call('POST',apply,applyBody)).status).toBe(200)
    const saved=JSON.parse(h.stored()!)
    expect(saved.programmes.cycles[0].tm).toEqual({legacy:150,bench:100})
    expect(saved.programmes.cycles[0].tmSeed).toEqual({bench:100,legacy:300})
    expect(saved.routines[1].ex[1]).toEqual(s.routines[1].ex[1]);expect(saved.workouts).toEqual(s.workouts)
    // Engine: 100 × .8/.9 = 80/90; legacy: cached150 × 80%/90% = 120/135.
    expect(buildSessionEntries(saved,saved.routines[1],createExerciseIndex(saved.customEx)).map((e:any)=>e.sets.map((r:any)=>r.w))).toEqual([[80,90],[120,135]])
    const before=h.stored()!
    expect((await h.call('POST',apply,{...applyBody,expectedRev:saved._rev,expectedWid:saved._wid})).body.changed).toEqual([])
    expect(h.stored()).toBe(before)
  })
  test('engine zero and null replace single-arm history on parent and both limbs',async()=> {
    for(const assisted of [true,false]) {
      const h=progressionServer(),s=fixture(),d=s.programmes.cycles[0].snapshot,id='single',weight=assisted ? 5 : 200
      s.customEx=[{id,name:'Synthetic single-arm machine',eq:'leverage machine',unilateral:true,...(assisted ? {assisted:true} : {})}]
      d.progressionRules=assisted ? [linear] : [{...rpeRule(),weeks:{'*':[{reps:5,rir:0},{reps:5,rir:0}]}}]
      for(const w of d.weeks) {const slot=syntheticSlot({...d,weeks:[w]});slot.id=id;slot.weight=weight;slot.side=true;slot.progression.rules=[d.progressionRules[0].id]}
      for(const r of s.routines) {r.ex[0].id=id;r.ex[0].weight=weight;r.ex[0].side=true}
      s.programmes.cycles[0].occurrences[1].pinnedOn='2026-01-12'
      const reps=assisted ? 5 : 20, side=()=>({w:weight,r:reps,done:true})
      s.workouts=[{id:'prior',d:'2026-01-04',start:10,unit:'lb',routineIds:['r2'],entries:[{id,occurrenceId:'o1',target:{slotId:'bench',sets:2,reps:5,side:true},sets:[0,1].map(()=>({w:weight,r:reps*2,done:true,sides:{L:side(),R:side()}}))}]}]
      h.plant(s);expect((await h.call('POST',apply,applyBody)).status).toBe(200)
      const saved=JSON.parse(h.stored()!),built=rows(saved)
      // Assistance: one successful exposure at5 minus5 = 0. RPE: 20 reps per
      // limb exceed the estimator's rep cap, so the athlete chooses (null).
      expect(saved.routines[1].ex[0].pyramidWeight).toEqual(assisted ? [0,0] : [null,null])
      expect(built).toHaveLength(2)
      for(const row of built) {
        expect(row.sides).toBeDefined()
        for(const value of [row,row.sides!.L,row.sides!.R]) {
          if(assisted) expect(value.w).toBe(0)
          else expect(Object.hasOwn(value,'w')).toBe(false)
        }
      }
      expect(saved.workouts).toEqual(s.workouts)
    }
  })
  test('undeclared apply keys are rejected, including future asOf, with bytes and revision unchanged',async()=> {
    const h=progressionServer(),before=h.stored()!
    for(const unknown of [{asOf:'2026-01-06'},{hypotheticalLogs:[]},{surprise:true}]) {
      expect(await h.call('POST',apply,{...applyBody,...unknown})).toMatchObject({status:400,body:{error:'invalid request'}})
      expect(h.stored()).toBe(before)
    }
  })
  test('future logs cannot move current loads even when preview asOf is future',async()=> {
    const h=progressionServer(),s=fixture(),d=s.programmes.cycles[0].snapshot
    d.progressionRules=[linear]
    for(const w of d.weeks) {const slot=syntheticSlot({...d,weeks:[w]});slot.weight=100;slot.progression.rules=['linear']}
    const log=(date:string)=>({id:'future',d:date,start:10,unit:'lb',entries:[{id:'0025',occurrenceId:'o1',target:{slotId:'bench',sets:2,reps:5},sets:[{w:100,r:5,done:true},{w:100,r:5,done:true}]}]})
    s.workouts=[log('2026-01-06')];h.plant(s);const before=h.stored()!
    // No success at/before Jan5: authored100. Including Jan6 incorrectly gives105.
    for(const asOf of [undefined,'2026-01-06']) {
      const response=await h.call('POST',preview,{source:{definition:d},cycleId:'c',weeks:[1,2],...(asOf ? {asOf} : {})})
      expect(response.status).toBe(200);expect(response.body.weeks.map((w:any)=>w.slots[0].sets.map((r:any)=>r.load))).toEqual([[100,100],[100,100]])
      expect(h.stored()).toBe(before)
    }
    expect((await h.call('POST',apply,applyBody)).status).toBe(200)
    const saved=JSON.parse(h.stored()!);expect(saved.routines[1].ex[0].pyramidWeight).toEqual([100,100]);expect(saved.workouts).toEqual(s.workouts)
    // Earlier declared preview cutoff still excludes a valid success on Jan5.
    s.workouts=[log('2026-01-05')];h.plant(s)
    expect((await h.call('POST',preview,{source:{definition:d},cycleId:'c',weeks:[2],asOf:'2026-01-04'})).body.weeks[0].slots[0].sets[0].load).toBe(100)
    expect((await h.call('POST',preview,{source:{definition:d},cycleId:'c',weeks:[2]})).body.weeks[0].slots[0].sets[0].load).toBe(105)
  })
  test('malformed history refuses both dry-run and apply before invoking the writer',async()=> {
    for(const malformed of [null,42,'synthetic',true,[]]) {
      const h=progressionServer(),s=fixture();s.workouts.push(malformed);h.plant(s)
      const before=h.stored()!,history=h.db.query('SELECT * FROM state_doc_history').all()
      let writes=0;const write=h.data.compareAndWrite.bind(h.data)
      h.data.compareAndWrite=(uid,body)=>{writes++;return write(uid,body)}
      for(const dryRun of [true,false]) {
        const result=await h.call('POST',apply,{...applyBody,dryRun})
        expect(result).toMatchObject({status:422,body:{error:'malformed history',code:'INVALID_RULES',issues:[{path:'workouts.1',message:'Expected a workout object; apply would discard this history entry.'}]}})
        expect(h.stored()).toBe(before);expect(h.db.query('SELECT * FROM state_doc_history').all()).toEqual(history);expect(writes).toBe(0)
      }
    }
  })
  test('malformed routines refuse dry-run and apply without losing stored document or history bytes',async()=> {
    for(const malformed of [null,42,'synthetic',true,[]]) {
      const h=progressionServer(),s=fixture();s.routines.push(malformed);h.plant(s)
      const before=h.stored()!,history=h.db.query('SELECT * FROM state_doc_history').all()
      let writes=0;const write=h.data.compareAndWrite.bind(h.data)
      h.data.compareAndWrite=(uid,body)=>{writes++;return write(uid,body)}
      for(const dryRun of [true,false]) {
        const result=await h.call('POST',apply,{...applyBody,dryRun})
        expect(result).toMatchObject({status:422,body:{error:'malformed history',code:'INVALID_RULES',issues:[{path:'routines.2',message:'Expected a routine object; apply would discard this history entry.'}]}})
        expect(h.stored()).toBe(before);expect(h.db.query('SELECT * FROM state_doc_history').all()).toEqual(history);expect(writes).toBe(0)
      }
    }
    for(const field of ['routines','workouts']) for(const malformed of [42,'synthetic',true,{}]) {
      const h=progressionServer(),s=fixture();s[field]=malformed;h.plant(s)
      const before=h.stored()!,history=h.db.query('SELECT * FROM state_doc_history').all()
      for(const dryRun of [true,false]) {
        const result=await h.call('POST',apply,{...applyBody,dryRun})
        expect(result).toMatchObject({status:422,body:{error:'malformed history',code:'INVALID_RULES',issues:[{path:field,message:`Expected a ${field==='routines' ? 'routine' : 'workout'} array.`}]}})
        expect(h.stored()).toBe(before);expect(h.db.query('SELECT * FROM state_doc_history').all()).toEqual(history)
      }
    }
    const h=progressionServer(),s=fixture();s.routines.push(null);s.workouts.push(false);h.plant(s)
    const before=h.stored()!
    expect(await h.call('POST',apply,applyBody)).toMatchObject({status:422,body:{issues:[{path:'workouts.1'},{path:'routines.2'}]}})
    expect(h.stored()).toBe(before)
  })

  test('million-row malformed documents stay within the storage cap and refuse before the writer',async()=> {
    const state=fixture();state.routines=Array(1_000_000).fill(null)
    const before=JSON.stringify(state);expect(before.length).toBeLessThan(MAX_STORED_BYTES)
    const handlers=new Map<string,(context:any)=>Promise<Response>>()
    let writes=0
    const app={post:(path:string,handler:(context:any)=>Promise<Response>)=>handlers.set(path,handler)} as unknown as GymApp
    const data={get:()=>({state,rev:4}),compareAndWrite:()=>{writes++}} as unknown as DataService
    installProgression(app,data)
    for(const dryRun of [true,false]) {
      const body={...applyBody,dryRun}
      const context={get:(key:string)=>key==='session' ? {user:{id:'synthetic'}} : {readJson:async()=>body},req:{raw:new Request('http://localhost/api/progression/apply')}}
      let failure:unknown
      try {await handlers.get('/api/progression/apply')!(context)} catch(error) {failure=error}
      expect(failure).toBeInstanceOf(ApiError)
      const refused=failure as ApiError
      expect(refused.status).toBe(422);expect(refused.extra.code).toBe('INVALID_RULES')
      const issues=refused.extra.issues as {path:string;message:string}[]
      expect(issues).toHaveLength(1_000_000)
      expect(issues[0]?.path).toBe('routines.0');expect(issues.at(-1)?.path).toBe('routines.999999')
      expect(writes).toBe(0);expect(JSON.stringify(state)).toBe(before)
    }
  })

})
