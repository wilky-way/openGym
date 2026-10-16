// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createBrowserPlatform } from '../src/platform/browser'
import { browserWorkoutJournal, WORKOUT_JOURNAL_DATABASE } from '../src/platform/storage'
import { configureClientIO } from '../src/lib/client-io'
import { createSyncEngine } from '../src/store/sync-engine'
import { freshState, initializeStore, KEY, useStore } from '../src/store/useStore'
import { configureUI, useUI } from '../src/store/useUI'
import { captureDurableWorkoutTarget, workoutTargetUpdate } from '../src/views/workout-target'
import { finishWorkout, configureWorkoutSheets } from '../src/sheets-d'
import SyncBanner from '../src/components/SyncBanner'
import { connectionView } from '../src/components/ServerSync'
import type { Platform } from '@opengym/contract/platform/adapters'
import { editCompletedSession } from '@opengym/core/session-edit'

vi.mock('../src/lib/sound', () => ({beep:vi.fn(), chime:vi.fn(), vibrate:vi.fn(), alertBuzz:vi.fn()}))
let platform: Platform & {workoutJournal:ReturnType<typeof browserWorkoutJournal>}, full = false, engine: ReturnType<typeof createSyncEngine>, root: Root | undefined
let host: HTMLDivElement, puts: any[]
const S = () => useStore.getState().S
function open(serverState: any = null) {
  initializeStore(platform)
  engine = createSyncEngine(useStore.setState, useStore.getState, {platform, api:async (path, options) => {
    if (options?.method === 'PUT') { puts.push(JSON.parse(String(options.body))); return {rev:2} }
    if (path === '/api/config') return {allow_guest:true}
    if (path === '/api/me') return {user:{id:'synthetic'}}
    return {state:serverState, rev:1}
  }, prompts:{askAddDeviceData:() => false, toast:message => useUI.getState().toast(message)}})
  useStore.setState({...engine.actions, ready:true})
}
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers({toFake:['Date']}); vi.setSystemTime(new Date('2026-10-15T12:00:00Z'))
  localStorage.clear(); full = false; puts = []
  const browser = createBrowserPlatform(), bytes = new Map<string,string>()
  platform = {...browser, workoutJournal:browserWorkoutJournal(new IDBFactory()),
    kv:{get:key => bytes.get(key) ?? null, set:(key,value) => {if(full) throw new DOMException('quota','QuotaExceededError'); bytes.set(key,value)}, remove:key => {bytes.delete(key)}, subscribe:() => () => {}},
    transport:{fetch:async () => new Response('{}')},
  }
  configureClientIO(platform)
  configureUI({platform, deviceId:() => 'synthetic', notifyRestOver:async () => {}})
  platform.kv.set(KEY,JSON.stringify({...freshState(),sound:false,connStatus:false,connLocal:false,workoutView:'list'}))
  platform.kv.set('gym_owner','synthetic'); platform.kv.set('gym_user',JSON.stringify({id:'synthetic'}))
  open()
  useUI.setState({sheets:[], toastMsg:'', work:null, timer:null})
  configureWorkoutSheets({confirmSheet:opts => opts.onConfirm?.(), menuSheet:() => {}, bwSheet:opts => opts.onDone(null)})
  host = document.createElement('div'); document.body.append(host)
})
afterEach(async () => {
  act(() => root?.unmount()); root = undefined
  useUI.getState().stopWork(); useUI.getState().stopRest()
  await useStore.getState().flushWorkoutJournal(); engine.dispose()
  host.remove(); vi.restoreAllMocks(); vi.useRealTimers()
})
function start(id='session', startedAt=1) {
  useStore.getState().update(s => { s.active = {id,start:startedAt,d:'2026-10-15',cur:0,entries:[
    {id:'synthetic-lift', sets:[{w:40,r:5},{sec:45}]},
  ]} })
}
function tick() {
  return workoutTargetUpdate(captureDurableWorkoutTarget(false), s => {s.active.entries[0].sets[0].done = true})
}
it('keeps ticking, holding, editing and Finish working under quota, journals reload recovery, and PUTs history', async () => {
  start()
  full = true
  expect(tick()).toBe(true)
  expect(useStore.getState().sync.localDurability).toBe('memory')
  // Actual hold fallback completion uses the same durable check that previously refused it.
  useUI.getState().startWork(45,'Hold',null,{idx:0,i:1,id:'synthetic-lift'})
  vi.setSystemTime(Date.now()+12000)
  useUI.getState().finishWorkEarly()
  expect(S().active.entries[0].sets[1]).toMatchObject({done:true,sec:12})
  expect(workoutTargetUpdate(captureDurableWorkoutTarget(false), s => {s.active.entries[0].sets[0].w = 55})).toBe(true)
  await useStore.getState().flushWorkoutJournal()
  expect(useStore.getState().sync.localDurability).toBe('journal')
  await act(async () => {root=createRoot(host); root.render(<MemoryRouter><SyncBanner /></MemoryRouter>)})
  expect(host.textContent).toContain('Can’t save on this device')
  expect(host.textContent).not.toContain('All synced')
  expect(connectionView({...useStore.getState().sync,status:'ok'})?.line).not.toBe('All synced')
  act(() => root!.unmount()); root=undefined
  const logged = structuredClone(S().active)
  engine.dispose(); open()
  expect(S().active.entries[0].sets[0].done).toBeUndefined() // primary copy predates quota
  await useStore.getState().boot()
  expect(S().active).toEqual(logged)
  expect(useStore.getState().sync.localDurability).toBe('journal')
  expect(useStore.getState().user?.id).toBe('synthetic')
  finishWorkout()
  expect(S().active).toBeNull()
  expect(S().workouts[0].entries[0].sets[0]).toMatchObject({w:55,done:true})
  await useStore.getState().flushWorkoutJournal()
  await useStore.getState().pushState()
  const finishPut=puts.find(p => p.state.workouts.some((w:any) => w.id === 'session'))
  expect(finishPut).toBeTruthy()
  expect(finishPut.state.workouts[0].entries[0].sets[1]).toMatchObject({sec:12,done:true})
  expect(finishPut.state.active).toBeNull()
  expect(useStore.getState().sync.remoteRecovery).toBe('confirmed')
  await useStore.getState().flushWorkoutJournal()
  expect(await platform.workoutJournal.keys()).toEqual([])
  const receipts=await platform.workoutJournal.receipts()
  expect(receipts).toHaveLength(1)
  expect(JSON.parse(receipts[0]![1])).toMatchObject({active:null,finished:null,closed:{id:'session',start:1}})
  engine.dispose(); open(); await useStore.getState().boot()
  expect(S().active).toBeNull() // server acknowledgement must not reopen old primary active
  full=false; useStore.getState().update(() => {})
  await useStore.getState().flushWorkoutJournal()
  expect(await platform.workoutJournal.keys()).toEqual([])
})
it.each(['account','profile','workout','generation','durable workout','unknown owner'] as const)('keeps the %s replacement fence closed after quota', async change => {
  start(); full=true; expect(tick()).toBe(true)
  const target=captureDurableWorkoutTarget(false)
  if(change === 'account') {full=false;platform.kv.set('gym_owner','other');full=true}
  if(change === 'profile') useStore.setState({S:{...S(),profileId:'other'}})
  if(change === 'workout') useStore.setState({S:{...S(),active:{...S().active,id:'other'}}})
  if(change === 'durable workout') {
    full=false
    const saved=JSON.parse(platform.kv.get(KEY)!)
    saved.active.id='replacement'
    platform.kv.set(KEY,JSON.stringify(saved));full=true
  }
  if(change === 'generation') useStore.setState({documentInstance:(useStore.getState().documentInstance || 0)+1})
  if(change === 'unknown owner') vi.spyOn(platform.kv,'get').mockImplementation(key => {if(key === 'gym_owner') throw new Error('blocked');return null})
  const mutate = () => workoutTargetUpdate(target,s => {s.active.entries[0].sets[0].w=99})
  if(change === 'unknown owner') expect(mutate).toThrow('blocked')
  else expect(mutate()).toBe(false)
  expect(S().active.entries[0].sets[0].w).toBe(40)
})
it('keeps destructive snapshot checks strict while ordinary logging is degraded', () => {
  start(); full=true; expect(tick()).toBe(true)
  expect(captureDurableWorkoutTarget()()).toBe(false)
})
it('restores a finished but unacknowledged session from the compact journal', async () => {
  start();full=true;expect(tick()).toBe(true)
  finishWorkout();await useStore.getState().flushWorkoutJournal()
  const finished=structuredClone(S().workouts[0])
  engine.dispose();open();await useStore.getState().boot()
  expect(S().active).toBeNull();expect(S().workouts).toContainEqual(finished)
})

it('continues in memory with an honest warning when IndexedDB also refuses writes', async () => {
  vi.spyOn(platform.workoutJournal,'put').mockRejectedValue(new Error('IDB quota'))
  start();full=true;expect(tick()).toBe(true)
  await useStore.getState().flushWorkoutJournal()
  expect(useStore.getState().sync.localDurability).toBe('memory')
  expect(connectionView(useStore.getState().sync)?.banner).toContain('kept in memory')
  expect(tick()).toBe(true)
  expect(S().active.entries[0].sets[0].done).toBe(true)
})
it('a fully saved journal does not turn a clean reload into a storage warning', async () => {
  start();expect(tick()).toBe(true);await useStore.getState().flushWorkoutJournal()
  engine.dispose();open();await useStore.getState().boot()
  expect(S().active.entries[0].sets[0].done).toBe(true)
  expect(useStore.getState().sync.localDurability).toBe('saved')
})

it.each([false, true])('does not recover an explicitly deleted unacknowledged workout (quota=%s)', async quota => {
  start(); expect(tick()).toBe(true)
  full = quota
  finishWorkout(); await useStore.getState().flushWorkoutJournal()
  expect(S().workouts.some((w:any) => w.id === 'session')).toBe(true)
  useStore.getState().update(s => { s.workouts = [] })
  await useStore.getState().flushWorkoutJournal()
  expect(S().deleted.workouts.session).toBeGreaterThan(0)
  engine.dispose(); open(); await useStore.getState().boot()
  expect(S().workouts).toHaveLength(0)
  expect(S().active).toBeNull()
})
it.each([false, true])('prunes explicitly discarded journals (quota=%s)', async quota => {
  for (let i=0;i<5;i++) {
    full=false
    useStore.getState().update(s => {s.active={id:'discard'+i,start:i+1,d:'2026-10-15',cur:0,entries:[{id:'synthetic-lift',sets:[{w:40,r:5}]}]}})
    full=quota
    expect(tick()).toBe(true)
    await useStore.getState().flushWorkoutJournal()
    useStore.getState().update(s => {s.active=null})
    await useStore.getState().flushWorkoutJournal()
  }
  expect(await platform.workoutJournal.keys()).toEqual([])
  const records=await platform.workoutJournal.receipts()
  expect(records).toHaveLength(quota ? 1 : 0)
  if (quota) expect(JSON.parse(records[0]![1])).toMatchObject({active:null,finished:null,closed:{id:'discard4'}})
  engine.dispose(); open(); await useStore.getState().boot()
  expect(S().active).toBeNull()
  full=false; useStore.getState().update(() => {})
  await useStore.getState().flushWorkoutJournal()
  expect(await platform.workoutJournal.keys()).toEqual([])
  expect(await platform.workoutJournal.receipts()).toEqual([])
})
it('a surviving deletion tombstone defeats an old finished journal even if its baseline matches', async () => {
  start(); expect(tick()).toBe(true); finishWorkout()
  await useStore.getState().flushWorkoutJournal()
  const key=(await platform.workoutJournal.keys())[0]!
  const record=JSON.parse((await platform.workoutJournal.get(key))!)
  useStore.getState().update(s => {s.workouts=[]})
  await useStore.getState().flushWorkoutJournal()
  // Model a legacy database without terminal decisions, then inject a stale
  // finished payload with a matching fingerprint to isolate tombstone precedence.
  engine.dispose(); platform={...platform,workoutJournal:browserWorkoutJournal(new IDBFactory())}; open()
  start(); await useStore.getState().flushWorkoutJournal()
  const activeKey=(await platform.workoutJournal.keys())[0]!
  const current=JSON.parse((await platform.workoutJournal.get(activeKey))!)
  record.baseline=current.baseline; record.scope=current.scope
  await platform.workoutJournal.put(key,JSON.stringify(record))
  engine.dispose(); open(); await useStore.getState().boot()
  expect(S().workouts).toHaveLength(0)
})

it('refuses a stale degraded callback after a valid same-generation peer workout replacement', () => {
  start(); full=true; expect(tick()).toBe(true)
  const target=captureDurableWorkoutTarget(false)
  full=false
  const saved=JSON.parse(platform.kv.get(KEY)!)
  saved.active={...saved.active,id:'replacement'}
  platform.kv.set(KEY,JSON.stringify(saved))
  platform.kv.set('gym_state_owner','synthetic')
  platform.kv.set('gym_state_wid',`g${useStore.getState().documentInstance ?? 0}:peer`)
  full=true
  expect(workoutTargetUpdate(target,s => {s.active.entries[0].sets[0].w=99})).toBe(false)
  expect(S().active.entries[0].sets[0].w).not.toBe(99)
})
it('permits degraded same-session progress after an unrelated valid peer write', () => {
  start(); full=true; expect(tick()).toBe(true)
  const target=captureDurableWorkoutTarget(false)
  full=false
  const saved=JSON.parse(platform.kv.get(KEY)!); saved.restSec=120
  platform.kv.set(KEY,JSON.stringify(saved)); platform.kv.set('gym_state_owner','synthetic')
  platform.kv.set('gym_state_wid',`g${useStore.getState().documentInstance ?? 0}:peer`)
  full=true
  expect(workoutTargetUpdate(target,s => {s.active.entries[0].sets[0].w=55})).toBe(true)
  expect(S().active.entries[0].sets[0].w).toBe(55)
})

it('does not let a delayed old-engine active write repopulate an acknowledged session', async () => {
  start(); expect(tick()).toBe(true); await useStore.getState().flushWorkoutJournal()
  const key=(await platform.workoutJournal.keys())[0]!
  const old=JSON.parse((await platform.workoutJournal.get(key))!)
  const original=platform.workoutJournal.put.bind(platform.workoutJournal)
  let release!: () => void
  const paused=new Promise<void>(resolve => {release=resolve})
  // Delay before the adapter creates its transaction, as a suspended old tab can.
  const staleWrite=paused.then(() => original(key,JSON.stringify({...old,at:Date.now()+1000})))
  engine.dispose(); open()
  finishWorkout(); await useStore.getState().flushWorkoutJournal()
  await useStore.getState().pushState(); await useStore.getState().flushWorkoutJournal()
  expect(await platform.workoutJournal.keys()).toEqual([])
  release(); await staleWrite
  expect(await platform.workoutJournal.keys()).toEqual([])
  engine.dispose(); open(); await useStore.getState().boot()
  expect(S().active).toBeNull()
})
it('a delayed finished payload cannot repopulate a discarded/deleted session', async () => {
  start(); expect(tick()).toBe(true); finishWorkout(); await useStore.getState().flushWorkoutJournal()
  const key=(await platform.workoutJournal.keys())[0]!, stale=(await platform.workoutJournal.get(key))!
  useStore.getState().update(s => {s.workouts=[]}); await useStore.getState().flushWorkoutJournal()
  await platform.workoutJournal.put(key,stale)
  expect(await platform.workoutJournal.keys()).toEqual([])
})

it.each([false,true])('refuses an undurable unit switch and retains later session edits (convert=%s)', async convert => {
  start(); full=true; expect(tick()).toBe(true)
  const unit=S().unit
  expect(useStore.getState().setUnit(unit === 'kg' ? 'lb' : 'kg',{convert})).toBe(false)
  expect(S().unit).toBe(unit)
  expect(workoutTargetUpdate(captureDurableWorkoutTarget(false),s => {s.active.entries[0].sets[0].w=123;s.active.entries[0].sets.push({w:50,r:3,done:true})})).toBe(true)
  const before=structuredClone(S().active)
  await useStore.getState().flushWorkoutJournal(); engine.dispose(); useStore.setState({documentInstance:undefined}); open(); await useStore.getState().boot()
  expect(S().unit).toBe(unit); expect(S().active).toEqual(before)
})
it('a stale finished journal does not report degraded durability after a healthy history edit', async () => {
  start(); expect(tick()).toBe(true); finishWorkout(); await useStore.getState().flushWorkoutJournal()
  useStore.getState().update(s => {s.workouts[0].note='edited'})
  await useStore.getState().pushState(); await useStore.getState().flushWorkoutJournal()
  engine.dispose(); useStore.setState({documentInstance:undefined}); open(); await useStore.getState().boot()
  expect(S().workouts[0].note).toBe('edited')
  expect(useStore.getState().sync.localDurability).toBe('saved')
})

it.each(['replace','finish'] as const)('refuses a degraded timed hold after a valid same-generation peer %s', action => {
  start(); full=true; expect(tick()).toBe(true)
  useUI.getState().startWork(45,'Hold',null,{idx:0,i:1,id:'synthetic-lift'})
  vi.setSystemTime(Date.now()+12000)
  full=false
  const saved=JSON.parse(platform.kv.get(KEY)!)
  saved.active=action === 'finish' ? null : {...saved.active,id:'replacement'}
  platform.kv.set(KEY,JSON.stringify(saved)); platform.kv.set('gym_state_owner','synthetic')
  platform.kv.set('gym_state_wid',`g${useStore.getState().documentInstance ?? 0}:peer`)
  full=true
  useUI.getState().finishWorkEarly()
  expect(S().active.entries[0].sets[1].done).not.toBe(true)
  expect(useUI.getState().toastMsg).toContain('hold was not logged')
})

it('keeps a new history-edit incarnation recoverable after the original session was acknowledged', async () => {
  start(); expect(tick()).toBe(true); finishWorkout(); await useStore.getState().flushWorkoutJournal()
  await useStore.getState().pushState(); await useStore.getState().flushWorkoutJournal()
  useStore.getState().update(s => { editCompletedSession(s,'session') })
  const editor=S().active.editBase.sheetInstanceId
  expect(editor).toBeTruthy()
  full=true
  expect(workoutTargetUpdate(captureDurableWorkoutTarget(false),s => {s.active.entries[0].sets[0].w=123})).toBe(true)
  await useStore.getState().flushWorkoutJournal()
  expect(await platform.workoutJournal.keys()).toHaveLength(1)
  engine.dispose(); open(); await useStore.getState().boot()
  expect(S().active.entries[0].sets[0].w).toBe(123)
  expect(S().active.editBase.sheetInstanceId).toBe(editor)
  // Save under quota must recover the changed completed row, not the old body.
  useStore.getState().saveHistoryEdit(); await useStore.getState().flushWorkoutJournal()
  engine.dispose(); open(); await useStore.getState().boot()
  expect(S().active).toBeNull()
  expect(S().workouts[0].entries[0].sets[0].w).toBe(123)
})
it('an older closure cannot erase a newer quota deletion receipt', async () => {
  start(); expect(tick()).toBe(true); full=true; finishWorkout()
  await useStore.getState().flushWorkoutJournal(); await useStore.getState().pushState(); await useStore.getState().flushWorkoutJournal()
  const [key,older]=(await platform.workoutJournal.receipts())[0]!
  useStore.getState().update(s => {s.workouts=[]}); await useStore.getState().flushWorkoutJournal()
  const newest=JSON.parse((await platform.workoutJournal.receipts())[0]![1])
  expect(newest.closed.deletedAt).toBeGreaterThan(0)
  expect(await platform.workoutJournal.put(key,JSON.stringify({...JSON.parse(older),at:Date.now()+10000}))).toBe(false)
  engine.dispose(); open(); await useStore.getState().boot()
  expect(S().active).toBeNull(); expect(S().workouts).toHaveLength(0)
})

it('a delayed real Finish acknowledgement cannot erase another engine quota deletion', async () => {
  await useStore.getState().boot(); start(); expect(tick()).toBe(true)
  full=true; finishWorkout(); await useStore.getState().flushWorkoutJournal()
  const old=engine, put=platform.workoutJournal.put.bind(platform.workoutJournal)
  let release!: () => void, entered!: () => void
  const gate=new Promise<void>(resolve=>{release=resolve}), began=new Promise<void>(resolve=>{entered=resolve})
  let delayed=false
  vi.spyOn(platform.workoutJournal,'put').mockImplementation(async (key,value) => {
    const record=JSON.parse(value)
    if (!delayed && record.closed && !record.closed.deletedAt) {delayed=true;entered();await gate}
    return put(key,value)
  })
  await useStore.getState().pushState()
  await Promise.race([began,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Acknowledgement did not enter')),1000))])
  const remote=puts.find(p=>p.state.workouts.length)!.state
  open(remote); await useStore.getState().boot()
  expect(S().workouts).toHaveLength(1)
  full=false; useStore.getState().update(()=>{}); await useStore.getState().flushWorkoutJournal()
  full=true; useStore.getState().update(s=>{s.workouts=[]}); await useStore.getState().flushWorkoutJournal()
  release(); await old.actions.flushWorkoutJournal(); old.dispose()
  engine.dispose(); open(remote); await useStore.getState().boot()
  expect(S().workouts).toHaveLength(0)
})
it('refuses a degraded timed hold when a peer completed the same session set', () => {
  start(); full=true; expect(tick()).toBe(true)
  useUI.getState().startWork(45,'Hold',null,{idx:0,i:1,id:'synthetic-lift'})
  vi.setSystemTime(Date.now()+12000)
  full=false
  const saved=JSON.parse(platform.kv.get(KEY)!); saved.active.entries[0].sets[1]={sec:99,done:true}
  platform.kv.set(KEY,JSON.stringify(saved)); platform.kv.set('gym_state_owner','synthetic')
  platform.kv.set('gym_state_wid',`g${useStore.getState().documentInstance ?? 0}:peer`)
  full=true; useUI.getState().finishWorkEarly()
  expect(S().active.entries[0].sets[1].done).not.toBe(true)
  expect(useUI.getState().toastMsg).toContain('hold was not logged')
})

it.each([false,true])('a delayed healthy-Finish retirement preserves a newer deletion receipt (expected forwarded=%s)', async forward => {
  await useStore.getState().boot(); start(); expect(tick()).toBe(true); finishWorkout(); await useStore.getState().flushWorkoutJournal()
  const old=engine, remove=platform.workoutJournal.delete.bind(platform.workoutJournal)
  let release!: () => void, entered!: () => void
  const gate=new Promise<void>(resolve=>{release=resolve}), began=new Promise<void>(resolve=>{entered=resolve})
  vi.spyOn(platform.workoutJournal,'delete').mockImplementationOnce(async (key,expected) => {
    entered(); await gate; return forward ? remove(key,expected) : remove(key)
  })
  await useStore.getState().pushState()
  await Promise.race([began,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Retirement did not enter')),1000))])
  const remote=puts.find(p=>p.state.workouts.length)!.state
  open(remote); await useStore.getState().boot()
  full=true; useStore.getState().update(s=>{s.workouts=[]}); await useStore.getState().flushWorkoutJournal()
  expect(JSON.parse((await platform.workoutJournal.receipts())[0]![1]).closed.deletedAt).toBeGreaterThan(0)
  release(); await old.actions.flushWorkoutJournal(); old.dispose()
  expect(JSON.parse((await platform.workoutJournal.receipts())[0]![1]).closed.deletedAt).toBeGreaterThan(0)
  engine.dispose(); open(remote); await useStore.getState().boot()
  expect(S().workouts).toHaveLength(0)
})

it('RM r2: a delayed older active snapshot must not replace newer unsaved sets', async () => {
  start();await useStore.getState().flushWorkoutJournal()
  const old=engine,put=platform.workoutJournal.put.bind(platform.workoutJournal)
  let release!:()=>void,began!:()=>void
  const gate=new Promise<void>(resolve=>{release=resolve}),entered=new Promise<void>(resolve=>{began=resolve})
  vi.spyOn(platform.workoutJournal,'put').mockImplementationOnce(async(key,value)=>{began();await gate;return put(key,value)})
  full=true
  vi.setSystemTime(Date.now()+1000)
  expect(workoutTargetUpdate(captureDurableWorkoutTarget(false),s=>{s.active.entries[0].sets[0].w=55})).toBe(true)
  await entered
  open()
  vi.setSystemTime(Date.now()+1000)
  expect(workoutTargetUpdate(captureDurableWorkoutTarget(false),s=>{s.active.entries[0].sets[0].w=99;s.active.entries[0].sets.push({w:99,r:8,done:true})})).toBe(true)
  const latest=structuredClone(S().active)
  await useStore.getState().flushWorkoutJournal()
  release();await old.actions.flushWorkoutJournal();old.dispose()
  engine.dispose();useStore.setState({documentInstance:undefined});open();await useStore.getState().boot()
  expect(S().active).toEqual(latest)
})
it('RM r2 separate IDB adapters reject an older active payload after newer active commit', async () => {
  const factory=new IDBFactory(),a=browserWorkoutJournal(factory),b=browserWorkoutJournal(factory)
  const key=JSON.stringify(['scope','session',1])
  const old={scope:'scope',baseline:'baseline',at:100,ts:100,active:{id:'session',start:1,entries:[{id:'synthetic-lift',sets:[{w:55,r:5}]}]},finished:null}
  const newer={...old,at:200,ts:200,active:{...old.active,entries:[{id:'synthetic-lift',sets:[{w:99,r:5},{w:99,r:8,done:true}]}]}}
  expect(await b.put(key,JSON.stringify(newer))).toBe(true)
  await a.put(key,JSON.stringify(old))
  expect(JSON.parse((await b.get(key))!).active).toEqual(newer.active)
})

it('equal-clock conflicting active checkpoints cannot replace an already committed body', async () => {
  start(); full=true; expect(tick()).toBe(true); await useStore.getState().flushWorkoutJournal()
  const key=(await platform.workoutJournal.keys())[0]!, raw=(await platform.workoutJournal.get(key))!, record=JSON.parse(raw)
  const conflict=structuredClone(record);conflict.active.entries[0].sets[0].w=999
  expect(await platform.workoutJournal.put(key,JSON.stringify(conflict))).toBe(false)
  expect(await platform.workoutJournal.get(key)).toBe(raw)
  expect(await platform.workoutJournal.put(key,JSON.stringify({...record,at:record.at+1000}))).toBe(true)
})

it.each(['active','finished'] as const)('v1 journal upgrade preserves a newer %s payload without ordering metadata', async kind => {
  const factory=new IDBFactory(),key='old-session'
  const active={id:'session',start:1,entries:[{id:'synthetic-lift',sets:[{w:99,r:8,done:true}]}]}
  const stored={scope:'scope',baseline:'baseline',at:200,ts:200,active:kind==='active'?active:null,finished:kind==='finished'?active:null}
  await new Promise<void>((resolve,reject)=>{
    const request=factory.open(WORKOUT_JOURNAL_DATABASE,1)
    request.onupgradeneeded=()=>{request.result.createObjectStore('sessions')}
    request.onerror=()=>reject(request.error)
    request.onsuccess=()=>{
      const db=request.result,tx=db.transaction('sessions','readwrite')
      tx.objectStore('sessions').put(JSON.stringify(stored),key)
      tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>reject(tx.error)
    }
  })
  const journal=browserWorkoutJournal(factory),old={...stored,at:100,ts:100,active:{...active,entries:[]},finished:null}
  expect(await journal.put(key,JSON.stringify(old))).toBe(false)
  expect(JSON.parse((await journal.get(key))!)).toEqual(stored)
})

it('starts a new session when already over quota and keeps logging and holding recoverable', async () => {
  full=true; start()
  expect(JSON.parse(platform.kv.get(KEY)!).active).toBeNull()
  expect(tick()).toBe(true)
  useUI.getState().startWork(45,'Hold',null,{idx:0,i:1,id:'synthetic-lift'})
  vi.setSystemTime(Date.now()+12000);useUI.getState().finishWorkEarly()
  expect(S().active.entries[0].sets[1]).toMatchObject({done:true,sec:12})
  const latest=structuredClone(S().active)
  await useStore.getState().flushWorkoutJournal();engine.dispose();open();await useStore.getState().boot()
  expect(S().active).toEqual(latest)
  expect(tick()).toBe(true)
})
it('recovers an offline quota Finish across an unrelated primary setting write', async () => {
  start();full=true;expect(tick()).toBe(true);finishWorkout()
  await useStore.getState().flushWorkoutJournal()
  const completed=structuredClone(S().workouts[0])
  full=false
  const saved=JSON.parse(platform.kv.get(KEY)!);saved.restSec=120;saved._ts=(saved._ts || 0)+1
  platform.kv.set(KEY,JSON.stringify(saved));platform.kv.set('gym_state_owner','synthetic')
  platform.kv.set('gym_state_wid',`g${useStore.getState().documentInstance ?? 0}:peer-setting`)
  full=true;engine.dispose();open();await useStore.getState().boot()
  expect(S().active).toBeNull();expect(S().workouts).toContainEqual(completed);expect(S().restSec).toBe(120)
})
it('recovers active quota progress across an unrelated primary setting write', async () => {
  start();full=true;expect(tick()).toBe(true);await useStore.getState().flushWorkoutJournal()
  const latest=structuredClone(S().active)
  full=false
  const saved=JSON.parse(platform.kv.get(KEY)!);saved.restSec=120
  platform.kv.set(KEY,JSON.stringify(saved));platform.kv.set('gym_state_owner','synthetic')
  platform.kv.set('gym_state_wid',`g${useStore.getState().documentInstance ?? 0}:peer-setting`)
  full=true;engine.dispose();open();await useStore.getState().boot()
  expect(S().active).toEqual(latest);expect(S().restSec).toBe(120)
})

it('logs and completes a hold in the next session after quota-era Finish', async () => {
  start();full=true;expect(tick()).toBe(true);finishWorkout();await useStore.getState().flushWorkoutJournal()
  start('next-session',2);expect(tick()).toBe(true)
  useUI.getState().startWork(45,'Hold',null,{idx:0,i:1,id:'synthetic-lift'})
  vi.setSystemTime(Date.now()+12000);useUI.getState().finishWorkEarly()
  expect(S().active.entries[0].sets[1]).toMatchObject({done:true,sec:12})
  const latest=structuredClone(S().active)
  await useStore.getState().flushWorkoutJournal();engine.dispose();open();await useStore.getState().boot()
  expect(S().active).toEqual(latest);expect(S().workouts.some((w:any)=>w.id==='session')).toBe(true)
})
it('edits history opened after quota begins and recovers its changed saved row', async () => {
  start();expect(tick()).toBe(true);finishWorkout();await useStore.getState().flushWorkoutJournal()
  full=true;useStore.getState().update(s=>{editCompletedSession(s,'session')})
  expect(workoutTargetUpdate(captureDurableWorkoutTarget(false),s=>{s.active.entries[0].sets[0].w=123})).toBe(true)
  useStore.getState().saveHistoryEdit();await useStore.getState().flushWorkoutJournal()
  engine.dispose();open();await useStore.getState().boot()
  expect(S().active).toBeNull();expect(S().workouts[0].entries[0].sets[0].w).toBe(123)
})
