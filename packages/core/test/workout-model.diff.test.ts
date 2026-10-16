import { expect, it } from 'vitest'
import fc from 'fast-check'
import * as port from '../src/workout-model.js'
// @ts-expect-error -- Frozen JavaScript oracle has no declarations at its snapshot path.
import * as oracle from '../../../packages/parity/fixtures/oracle/frontend/src/lib/workout-model.js'
const seed = 20261013
const runs = Number(process.env.PARITY_RUNS || 1000)
const scalar = fc.oneof(fc.integer({min:-100,max:500}), fc.constantFrom(null, undefined, '20', '', 'junk', true))
const row = fc.record({w: scalar, r: scalar, done: fc.boolean(), rir: scalar, rpe: scalar,
  phase: fc.constantFrom('work','warmup','warm-up','warm_up',' WORK ', '', null, undefined),
  type: fc.constantFrom('straight','dropset','restpause',null,undefined,'unknown'),
  warmup: fc.boolean(), failure: fc.boolean(), mode: fc.constantFrom('reps','time','cardio','AMRAP','',null),
  unit: fc.constantFrom('reps','sec','mins','none',null), sec: scalar, min: scalar,
  drops: fc.array(fc.record({w:scalar,r:scalar}), {maxLength:4}),
  clusters: fc.array(fc.record({r:scalar,restSec:scalar}), {maxLength:4}), weightOrigin: fc.constantFrom('manual',null,undefined),
  extra: fc.jsonValue({maxDepth:2})})
const set = fc.oneof(row, fc.tuple(row,row,row).map(([base,L,R])=>({...base,sides:{L,R}})), fc.jsonValue({maxDepth:2}))
function capture(fn: () => unknown): unknown {
  try { return {value:fn()} } catch(e) { return {error: e instanceof Error ? `${e.name}: ${e.message}` : String(e)} }
}
function invoke(module: Record<string, unknown>, name: string, args: unknown[]): unknown {
  const fn = module[name]
  if (typeof fn !== 'function') throw new Error(`Missing export ${name}`)
  return Reflect.apply(fn, undefined, args)
}
function compare(name: string, args: unknown[]) {
  const oldArgs = structuredClone(args), newArgs = structuredClone(args)
  const expected = capture(()=>invoke(oracle, name, oldArgs)), actual = capture(()=>invoke(port, name, newArgs))
  expect(actual, name).toStrictEqual(expected)
  expect(JSON.stringify(actual), name).toBe(JSON.stringify(expected))
  expect(newArgs, `${name}: mutations`).toStrictEqual(oldArgs)
  expect(JSON.stringify(newArgs), `${name}: mutation key order`).toBe(JSON.stringify(oldArgs))
}
it('workout readers preserve legacy values, failures and key order across seeded shapes', () => {
  fc.assert(fc.property(set, s => {
    for (const name of ['phaseForSet','isWarmupRow','setType','isDropSet','isRestPauseSet','isFailureSet',
      'toggleFailure','dropsOf','clustersOf','extraVolumeOf','isSideSet','hasCompletedWork','completedVolumeOf',
      'makeSideSet','syncSideAggregate','modeForSet','modeForEntry']) compare(name,[s])
    compare('phaseForSet',[s,'warmup'])
    compare('modeForSet',[s,{mode:'time'}])
    compare('modeForEntry',[{target:{mode:'cardio'},sets:[s,{r:8}]},'time'])
  }),{seed,numRuns:runs})
}, 60000)
it('row edits and per-side intensifiers preserve legacy values and key order', () => {
  fc.assert(fc.property(row,row,fc.integer({min:-1,max:5}),fc.integer({min:-20,max:100}), (base,side,index,n)=>{
    const sided = {...base,sides:{L:side,R:{...side,w:10,r:8}}}
    for (const s of [base,sided]) {
      compare('addDrop',[s,{w:n,r:8}]); compare('addCluster',[s,{r:n,restSec:15}])
      compare('removeDropAt',[s,index]); compare('removeClusterAt',[s,index])
      compare('setDropAt',[s,index,{w:n}]); compare('setClusterAt',[s,index,{r:n}])
      compare('setSideField',[s,'L','w',n]); compare('setSideField',[s,'R','rir',null])
      compare('setSideField',[s,'bad','w',n]); compare('toggleSide',[s,'R'])
      compare('addSideDrop',[s,n,2.5]); compare('removeSideDropAt',[s,index])
      compare('setSideDropAt',[s,'L',index,{w:n}]); compare('addSideCluster',[s,15])
      compare('removeSideClusterAt',[s,index]); compare('setSideClusterAt',[s,'R',index,n])
    }
    compare('nextDropWeight',[n,20,2.5]); compare('nextBurstReps',[n]); compare('splitBurstReps',[n])
    compare('normalizeMode',[base.mode,'time'])
  }),{seed:seed+1,numRuns:runs})
}, 60000)
it('function grids preserve snapping, fallback and floating-point behavior', () => {
  fc.assert(fc.property(fc.double({min:0,max:1000,noNaN:true}), fc.double({min:1,max:90,noNaN:true}), (w,pct)=>{
    for (const grid of [(n:number)=>Math.floor(n/5)*5, ()=>-1, ()=>NaN]) {
      const expected = oracle.nextDropWeight(w,pct,grid), actual = port.nextDropWeight(w,pct,grid)
      expect(actual).toBe(expected)
      expect(JSON.stringify(actual)).toBe(JSON.stringify(expected))
    }
  }),{seed:seed+2,numRuns:runs})
}, 60000)
