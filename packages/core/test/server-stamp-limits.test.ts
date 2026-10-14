import {describe,it,expect} from 'vitest'
import {DELETED_MAX,mergeDeletions,stampPut,type SyncRecord} from '../src/server-stamp'
describe('server stamp record limits',()=>{
 it('caps tombstones by absolute clock while keeping add-backs on ties',()=>{
  const old=Object.fromEntries(Array.from({length:DELETED_MAX+2},(_,i)=>[`r${i}`,i+1]))
  const joined=mergeDeletions({routines:old},{routines:{r5001:-5002}})
  expect(Object.keys(joined!.routines)).toHaveLength(DELETED_MAX)
  expect(joined!.routines.r0).toBeUndefined()
  expect(joined!.routines.r1).toBeUndefined()
  expect(joined!.routines.r5001).toBe(-5002)
  expect(Object.keys(old)).toHaveLength(DELETED_MAX+2)
 })
 it('keeps the six latest prior values in insertion order for repeated field edits',()=>{
  let cur:SyncRecord={restSec:0,routines:[],workouts:[]}
  for(let i=1;i<=9;i++) {
   const next:SyncRecord={restSec:i,routines:[],workouts:[]}
   stampPut(cur,next,{stamped:true,now:100+i})
   cur=next
  }
  expect(cur._prior.restSec).toHaveLength(6)
  expect(new Set(cur._prior.restSec).size).toBe(6)
 })
 it('caps prior field history at 5000 keys and removes history for absent entries',()=>{
  const cur:SyncRecord={routines:[],workouts:[],_prior:Object.fromEntries(Array.from({length:5000},(_,i)=>[`old${i}`,['synthetic-hash']]))}
  cur._prior['routines|gone|name']=['synthetic-hash']
  const next:SyncRecord={routines:[],workouts:[],newSetting:'synthetic'}
  stampPut(cur,next,{stamped:true,now:100})
  expect(Object.keys(next._prior)).toHaveLength(5000)
  expect(next._prior.old0).toBeUndefined()
  expect(next._prior['routines|gone|name']).toBeUndefined()
  expect(next._prior.newSetting).toHaveLength(1)
 })
})
