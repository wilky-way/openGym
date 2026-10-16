import test from 'node:test'
import assert from 'node:assert/strict'
import { stampPut } from '../sync-stamps.js'

for (const stamped of [false,true]) test(`effort scale memory survives an older writer (stamped=${stamped})`,()=>{
  const cur={effort:'none',lastEffortScale:'rpe',routines:[],workouts:[]}
  const next={effort:'none',routines:[],workouts:[]}
  stampPut(cur,next,{stamped,now:100})
  assert.equal(next.lastEffortScale,'rpe')
  const chosen={effort:'rir',lastEffortScale:'rir',routines:[],workouts:[]}
  stampPut(cur,chosen,{stamped,now:100})
  assert.equal(chosen.lastEffortScale,'rir')
  const reset={resetAt:200,effort:'none',routines:[],workouts:[]}
  stampPut(cur,reset,{stamped,now:300})
  assert.equal(reset.lastEffortScale,undefined)
})

const cfg = () => ({ id:'0025',slotId:'pick',open:true,label:'Synthetic pick',instructions:'Synthetic rule',generatedRules:[{until_rpe:8}],authoredInstructions:'Synthetic rule',noteKind:'planner',sets:3,reps:10,pyramid:[5,10,10],setTargets:[{rpe:8,pct:75},{rir:2,pct:65},{rir:2,pct:65}],setRepsMin:[4,8,8],tm:{key:'0025',percentages:[75,65,65]} })
for (const sets of [2,3,4]) test(`F1 stamped old Settings writer keeps authored fields when changing row count to ${sets}`,()=>{
  const cur={routines:[{id:'r',ex:[cfg()]}],workouts:[],programmes:{cycles:[{id:'c',status:'active',occurrences:[],snapshot:{weeks:[{index:1,days:[{key:'d1',sessions:[{routineSnapshot:{ex:[cfg()]}}]}]}]}}]}},next=structuredClone(cur)
  next.routines[0].ex=[{id:'0025',sets,reps:10}]
  next.programmes.cycles[0].snapshot.weeks[0].days[0].sessions[0].routineSnapshot.ex=structuredClone(next.routines[0].ex)
  stampPut(cur,next,{stamped:true,overRead:true,now:100})
  const e=next.routines[0].ex[0]
  assert.equal(e.instructions,'Synthetic rule');assert.equal(e.open,true);assert.equal(e.label,'Synthetic pick')
  assert.deepEqual(e.generatedRules,[{until_rpe:8}]);assert.equal(e.authoredInstructions,'Synthetic rule');assert.equal(e.noteKind,'planner')
  assert.equal(e.setTargets.length,sets);assert.deepEqual(e.setTargets[0],{rpe:8,pct:75})
  assert.deepEqual(e.setTargets.at(-1),{rir:2,pct:65});assert.equal(e.setRepsMin.length,sets)
  assert.equal(e.tm,undefined) // A flat edit retains displayed percentages in setTargets.
  assert.deepEqual(next.programmes.cycles[0].snapshot.weeks[0].days[0].sessions[0].routineSnapshot.ex[0],e)
})

for (const status of ['archived','finished']) for (const reverse of [false,true]) test(`F3 API ${status} rejects a late queue in direction ${reverse}`,()=>{
  const terminal={routines:[],workouts:[],queue:null,programmes:{cycles:[{id:'old',status,occurrences:[],_f:{status:100}}]}}
  const stale=structuredClone(terminal); stale.programmes.cycles[0].status='active';stale.programmes.cycles[0]._f.status=50
  stale.queue={programmeCycleId:'old',ids:['r']};stale.edited={queue:200}
  const [cur,next]=reverse?[stale,terminal]:[terminal,stale]
  stampPut(cur,next,{stamped:true,now:300})
  assert.equal(next.queue,null);assert.equal(next.programmes.cycles[0].status,status)
})

test('F3 Switch restores a successor queue and adopted routine ownership from a later old writer',()=>{
  const old={id:'old',status:'archived',occurrences:[],_f:{status:100}}
  const successor={id:'new',status:'active',weekIndex:1,lengthWeeks:2,since:100,startsOn:'2026-10-19',snapshot:{name:'Synthetic'},occurrences:[{instanceId:'new:w1d1',routineId:'personal',dayKey:'d1',weekIndex:1,ordinal:1,status:'pending'}]}
  const cur={routines:[{id:'personal',programme:{cycleId:'new',series:'new:d1'},ex:[]}],workouts:[],queue:{programmeCycleId:'new',ids:['personal']},programmes:{cycles:[old,successor]}}
  const next=structuredClone(cur);next.programmes.cycles.pop();next.programmes.cycles[0].status='active';next.programmes.cycles[0]._f.status=50
  next.routines[0].programme={cycleId:'old',series:'old:d1'};next.routines[0]._f={programme:200};next.queue={programmeCycleId:'old',ids:['personal'],label:'Stale'};next.edited={queue:200}
  stampPut(cur,next,{stamped:true,now:300})
  assert.equal(next.routines[0].programme.cycleId,'new');assert.equal(next.routines[0].programme.series,'new:d1')
  assert.equal(next.queue.programmeCycleId,'new');assert.deepEqual(next.queue.ids,['personal']);assert.equal(next.queue.startsOn,'2026-10-19')
})

test('F1 prescription normalization stays identical in frontend and API',async()=>{
  const {readFile}=await import('node:fs/promises')
  assert.equal(await readFile(new URL('../programme-prescription.js',import.meta.url),'utf8'),await readFile(new URL('../../frontend/src/lib/programme-prescription.js',import.meta.url),'utf8'))
})
