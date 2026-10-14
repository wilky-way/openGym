import type { SyncRecord, StampReport } from '../src/server-stamp'
import {test} from 'vitest'
import assert from 'node:assert/strict'
import {keepUnknown} from '../src/server-stamp'
test('old clients keep authored targets, instructions and open slots in routines and workout rows',()=>{
 const cfg: SyncRecord={id:'0025',slotId:'back',open:true,label:'Synthetic pick',instructions:'Synthetic rule',sets:3,reps:15,repsMin:10,setTargets:[{rpe:8},{rir:2},{pct:75}],setRepsMin:[10,10,10]}
 const row: SyncRecord={w:50,r:10,done:true,target:{rpe:8,pct:75},repTarget:{min:10,max:15}}
 const cur: SyncRecord={routines:[{id:'r',ex:[cfg]}],workouts:[{id:'w',entries:[{id:'0025',target:cfg,sets:[row]}]}]}
 const next: SyncRecord={routines:[{id:'r',ex:[{id:'0025',sets:3,reps:15,repsMin:10}]}],workouts:[{id:'w',entries:[{id:'0025',sets:[{w:50,r:10,done:true}]}]}]}
 keepUnknown(cur,next)
 assert.deepEqual(next.routines[0].ex[0],cfg);assert.deepEqual(next.workouts[0].entries[0].sets[0],row)
 assert.deepEqual(next.workouts[0].entries[0].target,cfg)
})
