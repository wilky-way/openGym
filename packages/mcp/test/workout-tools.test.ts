import { afterEach, expect, it, vi } from 'vitest'
import { createWorkoutTools, logWorkoutSchema, prepareLoggedWorkout, resolveWorkoutExercise } from '../src/workout-tools'
import { createTools } from '../src/tools'
import { createExerciseIndex } from '@opengym/core/exercises'
import { buildBackfillSession, fileBackfillWorkout } from '../../core/src/past-workout'
import { activate, advanceProgramme } from '@opengym/core/programme'
import { refillAfter } from '@opengym/core/rotation'
import { deleteEditedWorkout } from '@opengym/core/session-edit'
import { target } from './http-helpers'

const now = Date.parse('2026-10-14T23:00:00Z')
const input = {date:'2026-10-13',name:'Synthetic class',duration_min:45,notes:'Synthetic note',exercises:[
  {exercise:'supermans',sets:[{reps:10},{reps:12,done:false}]},
  {exercise:'donkey kicks',sets:[{reps:12}]},
]}
const state = (): any => ({_rev:7,_wid:'epoch',unit:'kg',routines:[],workouts:[],customEx:[],exWeights:{},
  queue:{ids:['r'],type:'manual'},programmes:{cycles:[]},unknown:{keep:true}})
const env = {OPENGYM_URL:'http://127.0.0.1:1234',OPENGYM_UID:'test-uid',OPENGYM_TOKEN:'synthetic-token',OPENGYM_ENABLE_PROGRAMME_WRITES:'1'}
function fakeApi(initial = state(), conflicts = 0, onConflict?: (s: any) => void) {
  let saved = structuredClone(initial), failures = conflicts
  const calls: {method: string; path: string; body?: any; auth: string}[] = []
  const fetcher: any = async (url: string, init: any) => {
    const path = new URL(url).pathname, body = init.body && JSON.parse(init.body)
    calls.push({method:init.method,path,body,auth:init.headers.Authorization})
    const reply = (data: any, status = 200) => ({ok:status === 200,status,json:async()=>structuredClone(data)})
    if (path === '/api/me') return reply({user:{id:'test-uid'}})
    if (init.method === 'GET') return reply({rev:saved._rev,state:saved})
    if (failures-- > 0) {saved._rev++;saved._wid='new-epoch';onConflict?.(saved);return reply({},409)}
    expect(body.baseRev).toBe(saved._rev); expect(body.baseWid).toBe(saved._wid)
    saved = {...body.state,_rev:saved._rev+1,_wid:'committed'}
    return reply({ok:true,rev:saved._rev,wid:saved._wid})
  }
  return {calls,fetcher,get saved(){return saved}}
}
async function loggedState(S = state()) {
  const api = fakeApi(S)
  await invoke('log_workout', {...input,dry_run:false}, api)
  return api.saved
}
const invoke = (name: string, p: any, api: ReturnType<typeof fakeApi>, config = env) =>
  createWorkoutTools({env:config,fetcher:api.fetcher,now,id:'synthetic-workout'}).find(t=>t.name===name)!.handler(p)

it('dry run defaults true, returns exact record/ids/customs, and never mutates or PUTs',async()=>{
  const original=state(), api=fakeApi(original), before=JSON.stringify(original)
  const result=await invoke('log_workout',input,api,{...env,OPENGYM_ENABLE_PROGRAMME_WRITES:'0'})
  expect(result.dry_run).toBe(true);expect(result.workout.loggedBy).toBe('agent')
  expect(result.resolved_exercises[0].id).toBe('3436');expect(result.created_exercises).toHaveLength(1)
  expect(result.workout.entries.map((e:any)=>e.sets.map((s:any)=>s.w))).toEqual([[0,0],[0]])
  expect(result.workout.entries[0].sets.map((s:any)=>s.done)).toEqual([true,false])
  expect(result.workout.end-result.workout.start).toBe(45*60000)
  expect(api.calls.some(c=>c.method==='PUT')).toBe(false);expect(api.saved).toEqual(original);expect(JSON.stringify(original)).toBe(before)
})
it('MCP and the UI backfill helpers produce byte-equal records for the same session input',()=>{
  const S=state(), result=prepareLoggedWorkout(S,input,{id:'same',now})
  const index=createExerciseIndex(result.state.customEx)
  const active=buildBackfillSession(S,{id:'same',iso:input.date,durationMin:45,routineIds:[]},index)
  const session={...active,name:input.name,note:input.notes,loggedBy:'agent',entries:[
    {id:'3436',target:{mode:'reps'},sets:[{done:true,w:0,r:10},{done:false,w:0,r:12}]},
    {id:result.resolved_exercises[1]!.id,target:{mode:'reps'},sets:[{done:true,w:0,r:12}]},
  ]}
  const ui=fileBackfillWorkout(S.workouts,session,index,now)
  expect(JSON.stringify(result.workout)).toBe(JSON.stringify(ui.workout))
  expect(JSON.stringify(result.state.workouts)).toBe(JSON.stringify(ui.workouts))
})
it('resolves ids, custom names, plurals and a unique typo, and lists all ambiguous candidates',()=>{
  const customs=[{id:'custom',n:'Synthetic wobble',custom:true}]
  expect(resolveWorkoutExercise('custom',customs,'x',now).exercise.id).toBe('custom')
  expect(resolveWorkoutExercise('synthetic wobble',customs,'x',now).exercise.id).toBe('custom')
  expect(resolveWorkoutExercise('synthetic wobbel',customs,'x',now).exercise.id).toBe('custom')
  expect(resolveWorkoutExercise('supermans',[],'x',now).exercise.id).toBe('3436')
  expect(()=>resolveWorkoutExercise('dumbbell rows',[],'x',now)).toThrow(/AMBIGUOUS|Choose an exercise id/)
  try {resolveWorkoutExercise('dumbbell rows',[],'x',now)} catch(e) {expect((e as any).code).toBe('AMBIGUOUS_EXERCISE');expect((e as Error).message).toContain('0293')}
  expect(()=>resolveWorkoutExercise('zzzznonexistentzzzz',[],'x',now)).toThrow('No exercise matches')
})
it('never creates a duplicate custom donkey kick, including exact user-authored names',()=>{
  const created=resolveWorkoutExercise('donkey kicks',[],'new',now)
  expect(created).toMatchObject({created:true,exercise:{id:'new',eq:'body weight',custom:true}})
  expect(created.exercise.n).toContain('agent-created')
  expect(resolveWorkoutExercise('donkey kicks',[created.exercise],'other',now)).toMatchObject({created:false,exercise:{id:'new'}})
  expect(resolveWorkoutExercise('donkey kicks',[{id:'mine',n:'Donkey kick',custom:true}],'other',now)).toMatchObject({created:false,exercise:{id:'mine'}})
})
it('explicit write plus existing gate is required, before any HTTP',async()=>{
  const api=fakeApi()
  await expect(invoke('log_workout',{...input,dry_run:false},api,{...env,OPENGYM_ENABLE_PROGRAMME_WRITES:'0'})).rejects.toMatchObject({code:'WRITES_DISABLED'})
  await expect(invoke('delete_workout',{workout_id:'w',confirm:true},api,{...env,OPENGYM_ENABLE_PROGRAMME_WRITES:'0'})).rejects.toMatchObject({code:'WRITES_DISABLED'})
  expect(api.calls).toEqual([])
})
it('commits via authenticated conditional PUT, preserving unrelated state and freestyle programme position',async()=>{
  const S=state(), api=fakeApi(S), result=await invoke('log_workout',{...input,dry_run:false},api)
  expect(result.appliedRev).toBe(8);expect(api.saved.workouts).toEqual([result.workout]);expect(api.saved.customEx).toEqual(result.created_exercises)
  for(const field of ['unknown','queue','programmes','routines','exWeights']) expect(api.saved[field]).toEqual(S[field])
  expect(api.calls.every(c=>c.auth==='Bearer synthetic-token')).toBe(true)
  expect(api.calls.find(c=>c.method==='PUT')!.body).toMatchObject({baseRev:7,baseWid:'epoch'})
})
it('409 rebases the additive log on fresh history and settings without duplication',async()=>{
  const concurrent={id:'concurrent',d:'2026-10-12',start:1,entries:[]}
  const api=fakeApi(state(),1,S=>{S.workouts.push(concurrent);S.unknown={newer:true}})
  const result=await invoke('log_workout',{...input,dry_run:false},api)
  expect(api.saved.workouts.map((w:any)=>w.id)).toEqual(['concurrent','synthetic-workout'])
  expect(api.saved.unknown).toEqual({newer:true});expect(api.saved.customEx).toHaveLength(1)
  expect(api.calls.filter(c=>c.method==='PUT').map(c=>c.body.baseRev)).toEqual([7,8])
  expect(result.appliedRev).toBe(9)
})
it.each(['log_workout','delete_workout'])('409 revalidates active-session guard for %s',async name=>{
  const S=await loggedState()
  const api=fakeApi(S,1,S=>{S.active={id:'live',entries:[]}})
  await expect(invoke(name,name==='log_workout'?{...input,dry_run:false}:{workout_id:'synthetic-workout',confirm:true},api)).rejects.toMatchObject({code:'TRAINING_NOW'})
  expect(api.calls.filter(c=>c.method==='PUT')).toHaveLength(1);expect(api.saved.active.id).toBe('live')
})
it('bounds conflict retries and refuses identity-less writes',async()=>{
  const api=fakeApi(state(),10)
  await expect(invoke('log_workout',{...input,dry_run:false},api)).rejects.toMatchObject({status:409})
  expect(api.calls.filter(c=>c.method==='PUT')).toHaveLength(3)
  const S=state();delete S._wid;const noId=fakeApi(S)
  await expect(invoke('log_workout',{...input,dry_run:false},noId)).rejects.toMatchObject({code:'WRITE_ID_REQUIRED'})
  expect(noId.calls.some(c=>c.method==='PUT')).toBe(false)
})
it('rejects wrong profiles and active sessions without a write',async()=>{
  const api=fakeApi({...state(),active:{id:'running'}})
  await expect(invoke('log_workout',input,api)).rejects.toMatchObject({code:'TRAINING_NOW'})
  const tools=createWorkoutTools({env:{...env,OPENGYM_UID:'wrong'},fetcher:api.fetcher,now})
  await expect(tools[0]!.handler(input)).rejects.toMatchObject({code:'PROFILE_MISMATCH'})
  expect(api.calls.some(c=>c.method==='PUT')).toBe(false)
})
it('redacts renewed credentials in workout output and exercise ambiguity errors on the first call',async()=>{
  const token='synthetic-renewed-credential', config={...env,OPENGYM_TOKEN:'synthetic-first-credential'}
  const S=state();S.customEx=[{id:'c1',n:token,custom:true},{id:'c2',n:token,custom:true}]
  const api=fakeApi(S), fetcher:any=async(url:string,init:any)=>url.endsWith('/api/me')?
    {ok:true,status:200,json:async()=>({user:{id:'test-uid'},token})}:api.fetcher(url,init)
  const log=createWorkoutTools({env:config,fetcher,now,id:'redaction'})[0]!
  const result=await log.handler({...input,name:token,exercises:[{exercise:'c1',sets:[{reps:10}]}]})
  expect(JSON.stringify(result)).not.toContain(token);expect(result.workout.name).toBe('[redacted]')
  await expect(log.handler({...input,exercises:[{exercise:token,sets:[{reps:10}]}]})).rejects.toThrow('[redacted]')
  try {await log.handler({...input,exercises:[{exercise:token,sets:[{reps:10}]}]})} catch(e) {expect((e as Error).message).not.toContain(token)}
})
it('ordinary routines carry their plan and programme routines alone receive programme occurrence attribution',()=>{
  const S=state();S.routines=[{id:'r',name:'Synthetic routine',ex:[{id:'3436',sets:1,reps:5,prog:'off'}]}]
  const p={date:'2026-10-13',routine_id:'r',exercises:[{exercise:'3436',sets:[{reps:10}]}]}
  let result=prepareLoggedWorkout(S,p,{id:'w',now})
  expect(result.workout.routineIds).toEqual(['r']);expect(result.workout.entries[0]).toMatchObject({rid:'r',planned:{sets:1,reps:5}})
  expect(result.workout.programmeInstance).toBeUndefined()
  S.routines[0].programme={cycleId:'c',instanceId:'c:w1d1',weekIndex:1,ordinal:1,series:'x'}
  result=prepareLoggedWorkout(S,p,{id:'w',now})
  expect(result.workout.programmeInstance).toMatchObject({cycleId:'c',instanceId:'c:w1d1'})
  const freestyle=prepareLoggedWorkout(S,{...p,routine_id:undefined},{id:'w',now})
  expect(freestyle.workout.programmeInstance).toBeUndefined();expect(freestyle.workout.routineIds).toEqual([])
  expect(()=>prepareLoggedWorkout(S,{...p,routine_id:'missing'},{id:'w',now})).toThrow('Routine not found')
})
it('uses profile units by default, converts explicit weights, and records timed floor work',()=>{
  const result=prepareLoggedWorkout({...state(),unit:'lb'},{date:'2026-10-13',exercises:[
    {exercise:'0293',sets:[{reps:8,weight:20,unit:'kg'},{reps:8,weight:30}]},
    {exercise:'3436',sets:[{seconds:30}]},
    {exercise:'3590',sets:[{reps:10}]},
    {exercise:'0003',sets:[{reps:12}]},
  ]},{id:'w',now})
  expect(result.workout.entries[0]!.sets.map(s=>s.w)).toEqual([44,30])
  expect(result.workout.entries[1]!.sets).toEqual([{done:true,w:0,sec:30}])
  expect(result.workout.entries).toHaveLength(4)
})
it('historical custom exercises retain dumbbell volume, least-assistance loads and muscle snapshots',()=>{
  const S=state();S.customEx=[
    {id:'custom-bell',n:'Synthetic bilateral press',eq:'dumbbell',bp:'chest',custom:true},
    {id:'custom-assist',n:'Synthetic assisted pull',eq:'leverage machine',bp:'back',assisted:true,custom:true},
  ]
  S.dbLoad={'custom-bell':{mode:'each'}}
  const result=prepareLoggedWorkout(S,{date:'2026-10-13',exercises:[
    {exercise:'custom-bell',sets:[{reps:8,weight:20}]},
    {exercise:'custom-assist',sets:[{reps:8,weight:50},{reps:8,weight:30}]},
  ]},{id:'w',now})
  expect(result.workout.vol).toBe(960)
  expect(result.workout.entries[0]!.target).toMatchObject({dbLoad:'each'})
  expect(result.workout.entries[1]!.topW).toBe(30)
  expect(result.workout.entries[0]!.muscleSnapshot).toMatchObject({n:'Synthetic bilateral press',bp:'chest'})
})
it('refuses invalid sets/dates/durations and empty completed logs without HTTP writes',async()=>{
  for (const p of [ {...input,date:'2026-02-30'}, {...input,duration_min:1441},
    {...input,exercises:[{exercise:'3436',sets:[{reps:1.5}]}]},
    {...input,exercises:[{exercise:'3436',sets:[{reps:10,seconds:10}]}]},
    {...input,exercises:[{exercise:'3436',sets:[{reps:-1}]}]},
  ]) expect(logWorkoutSchema.safeParse(p).success).toBe(false)
  for(const p of [{...input,date:'2026-10-15'}, {...input,exercises:[{exercise:'3436',sets:[{reps:5,done:false}]}]},
    {...input,exercises:[{exercise:'3436',sets:[{reps:5},{seconds:10}]}]}]) {
    const api=fakeApi();await expect(invoke('log_workout',p,api)).rejects.toMatchObject({code:'EINVAL'});expect(api.calls.some(c=>c.method==='PUT')).toBe(false)
  }
})
it('keeps unknown set counts unspecified and permits an explicitly logged zero reps',()=>{
  const result=prepareLoggedWorkout(state(),{date:'2026-10-13',exercises:[
    {exercise:'3436',sets:[{}, {reps:0}]},
  ]},{id:'w',now})
  expect(result.workout.entries[0]!.sets).toEqual([{done:true,w:0},{done:true,w:0,r:0}])
})
it('delete requires confirmation, sealed agent provenance, and rejects the removed force arg',async()=>{
  const S=await loggedState();S.workouts.push({id:'human'})
  const api=fakeApi(S)
  await expect(invoke('delete_workout',{workout_id:'synthetic-workout'},api)).rejects.toMatchObject({code:'EINVAL'})
  await expect(invoke('delete_workout',{workout_id:'human',confirm:true},api)).rejects.toMatchObject({code:'NOT_AGENT_WORKOUT'})
  await expect(invoke('delete_workout',{workout_id:'human',confirm:true,force:true},api)).rejects.toMatchObject({code:'EINVAL'})
  expect(createWorkoutTools()[1]!.schema).not.toHaveProperty('force')
  const result=await invoke('delete_workout',{workout_id:'synthetic-workout',confirm:true},api)
  expect(result.deleted).toBe(true);expect(api.saved.workouts).toEqual([{id:'human'}])
  expect(api.saved.deleted.workouts['synthetic-workout']).toBe(now+1)
  await expect(invoke('delete_workout',{workout_id:'missing',confirm:true},api)).rejects.toMatchObject({code:'NOT_FOUND'})
})
it('delete rebases on concurrent additions and rechecks changed provenance',async()=>{
  const S=await loggedState()
  const api=fakeApi(S,1,S=>S.workouts.push({id:'new'}))
  await invoke('delete_workout',{workout_id:'synthetic-workout',confirm:true},api)
  expect(api.saved.workouts).toEqual([{id:'new'}])
  const changed=fakeApi(S,1,S=>{S.workouts[0].loggedBy='human'})
  await expect(invoke('delete_workout',{workout_id:'synthetic-workout',confirm:true},changed)).rejects.toMatchObject({code:'NOT_AGENT_WORKOUT'})
  expect(changed.calls.filter(c=>c.method==='PUT')).toHaveLength(1)
})
it.each(['stamp','note','sets','missing-seal'])('undo refuses a changed agent workout (%s), initially and on 409',async change=>{
  const mutate=(S:any)=>{
    const w=S.workouts[0]
    if(change==='stamp') w._ts++
    if(change==='note') w.note='Phone edit'
    if(change==='sets') w.entries[0].sets[0].r++ // Even an edit without a newer stamp fails closed.
    if(change==='missing-seal') delete w.agentUndoDigest
  }
  const S=await loggedState(), changed=structuredClone(S);mutate(changed)
  const first=fakeApi(changed)
  await expect(invoke('delete_workout',{workout_id:'synthetic-workout',confirm:true},first)).rejects.toMatchObject({code:'WORKOUT_MODIFIED'})
  expect(first.calls.some(c=>c.method==='PUT')).toBe(false)
  const raced=fakeApi(S,1,mutate)
  await expect(invoke('delete_workout',{workout_id:'synthetic-workout',confirm:true},raced)).rejects.toMatchObject({code:'WORKOUT_MODIFIED'})
  expect(raced.calls.filter(c=>c.method==='PUT')).toHaveLength(1);expect(raced.saved.workouts).toHaveLength(1)
})
it('MCP undo matches UI deletion working-weight lowering, including custom assistance and unrelated weights',async()=>{
  const S=state();S.customEx=[{id:'assist',n:'Synthetic assist',eq:'leverage machine',assisted:true,custom:true}]
  S.workouts=[{id:'prior',d:'2026-10-12',entries:[{id:'0293',sets:[{done:true,w:20,r:8}]},{id:'assist',sets:[{done:true,w:50,r:8}]}]}]
  const api=fakeApi(S)
  await invoke('log_workout',{date:'2026-10-13',dry_run:false,exercises:[
    {exercise:'0293',sets:[{weight:30,reps:8}]},{exercise:'assist',sets:[{weight:30,reps:8}]},
    {exercise:'3436',sets:[{weight:10,reps:8}]},
  ]},api)
  const synced=structuredClone(api.saved)
  synced.exWeights={'0293':{w:30,d:'2026-10-13'},assist:{w:30,d:'2026-10-13'},'3436':{w:10,d:'2026-10-13'},other:{w:100,d:'2026-10-14'}}
  const ui=structuredClone(synced);ui.active={editingWorkoutId:'synthetic-workout'}
  deleteEditedWorkout(ui,createExerciseIndex(ui.customEx))
  const del=fakeApi(synced)
  await invoke('delete_workout',{workout_id:'synthetic-workout',confirm:true},del)
  expect(JSON.stringify(del.saved.workouts)).toBe(JSON.stringify(ui.workouts))
  expect(JSON.stringify(del.saved.exWeights)).toBe(JSON.stringify(ui.exWeights))
  expect(del.saved.exWeights).toEqual({'0293':{w:20,d:'2026-10-12'},assist:{w:50,d:'2026-10-12'},other:{w:100,d:'2026-10-14'}})
})
it.each(['refill','incomplete','planner','programme'])('routine log queue equals UI past-log byte for byte (%s)',kind=>{
  const S=state();S.routines=[{id:'a',name:'A',ex:[]},{id:'b',name:'B',ex:[{id:'3436',sets:1,reps:5}]}]
  S.rotation={id:'rot',sequence:['a','b'],label:'Split'}
  S.queue={ids:['a','b'],rotationId:'rot',label:'Old pass',since:1,startsOn:'2026-10-01'}
  S.dayPlan={'2026-10-14':'a','2026-10-15':'b','2026-10-16':'other'}
  if(kind!=='incomplete') S.workouts=[{id:'first',d:'2026-10-12',start:2,routineIds:['a'],entries:[]}]
  if(kind==='planner') delete S.queue.rotationId
  if(kind==='programme') S.queue.programmeCycleId='cycle'
  const p={date:'2026-10-13',routine_id:'b',exercises:[{exercise:'3436',sets:[{reps:5}]}]}
  const mcp=prepareLoggedWorkout(S,p,{id:'same',now})
  const ui=structuredClone(S),index=createExerciseIndex(ui.customEx)
  const draft=buildBackfillSession(ui,{id:'same',iso:p.date,durationMin:60,routineIds:['b']},index)
  const filed=fileBackfillWorkout(ui.workouts,{...draft,entries:mcp.workout.entries as unknown as typeof draft.entries},index,now)
  ui.workouts=filed.workouts;ui.active=null
  refillAfter(ui,filed.workout,'2026-10-14',now) // Actual UI finish call after filing the record.
  expect(JSON.stringify(mcp.state.queue)).toBe(JSON.stringify(ui.queue))
  expect(JSON.stringify(mcp.state.dayPlan)).toBe(JSON.stringify(ui.dayPlan))
  if(kind==='refill') {
    expect(mcp.state.queue).toEqual({ids:['a','b'],since:now,startsOn:'2026-10-14',label:'Split',rotationId:'rot'})
    expect(mcp.state.dayPlan).toEqual({'2026-10-16':'other'})
  } else expect(mcp.state.queue).toEqual(S.queue)
})
it('programme routine log advances the week and queue exactly as UI finish, and undo reconciles occurrence credit',async()=>{
  const S=state()
  const definition:any={id:'synthetic',name:'Synthetic',unit:'kg',weeks:[1,2].map(index=>({index,days:[{key:'d1',sessions:[{routineSnapshot:{ex:[{id:'3436',sets:1,reps:5}]}}]}]}))}
  activate(S,definition,{cycleId:'c',today:'2026-10-12',now})
  const p={date:'2026-10-13',routine_id:'c-w1d1',exercises:[{exercise:'3436',sets:[{reps:5}]}]}
  const mcp=prepareLoggedWorkout(S,p,{id:'same',now}),ui=structuredClone(S),index=createExerciseIndex([])
  const draft=buildBackfillSession(ui,{id:'same',iso:p.date,durationMin:60,routineIds:[p.routine_id]},index)
  draft.entries= draft.entries.map(e=>({...e,sets:[{done:true,w:0,r:5}]}))
  const filed=fileBackfillWorkout(ui.workouts,draft,index,now)
  ui.workouts=filed.workouts;ui.active=null
  refillAfter(ui,filed.workout,'2026-10-14',now)
  advanceProgramme(ui,'2026-10-14',now)
  expect(JSON.stringify(mcp.state.queue)).toBe(JSON.stringify(ui.queue))
  expect(JSON.stringify(mcp.state.programmes)).toBe(JSON.stringify(ui.programmes))
  expect(mcp.state.programmes.cycles[0].weekIndex).toBe(2)
  expect(mcp.state.queue.ids).toEqual(['c-w2d1'])
  const api=fakeApi(S)
  await invoke('log_workout',{...p,dry_run:false},api)
  expect(api.saved.queue).toEqual(ui.queue)
  const deletedUI=structuredClone(api.saved)
  deletedUI.active={editingWorkoutId:'synthetic-workout'}
  deleteEditedWorkout(deletedUI,index);advanceProgramme(deletedUI,'2026-10-14',now)
  await invoke('delete_workout',{workout_id:'synthetic-workout',confirm:true},api)
  expect(api.saved.queue).toEqual(deletedUI.queue)
  expect(api.saved.programmes).toEqual(deletedUI.programmes)
})
it.each(['weight','reps','seconds'])('rejects nonfinite and out-of-range %s before HTTP or serialization',async field=>{
  const max=field==='seconds'?86400:9999
  for(const value of [NaN,Infinity,-Infinity,-1,max+1,Number.MAX_VALUE]) {
    const api=fakeApi()
    await expect(invoke('log_workout',{...input,dry_run:false,exercises:[{exercise:'3436',sets:[{[field]:value}]}]},api)).rejects.toMatchObject({code:'EINVAL'})
    expect(api.calls).toEqual([])
  }
  expect(logWorkoutSchema.safeParse({...input,exercises:[{exercise:'3436',sets:[{[field]:max}]}]}).success).toBe(true)
})
it('rejects converted loads exceeding the persisted weight bound and keeps accepted extremes finite',async()=>{
  const api=fakeApi({...state(),unit:'lb'})
  await expect(invoke('log_workout',{...input,dry_run:false,exercises:[{exercise:'0293',sets:[{weight:9999,unit:'kg',reps:1}]}]},api)).rejects.toMatchObject({code:'EINVAL'})
  expect(api.calls.some(c=>c.method==='PUT')).toBe(false)
  const accepted=fakeApi()
  const result=await invoke('log_workout',{...input,dry_run:false,exercises:[{exercise:'0293',sets:[{weight:9999,reps:9999}]}]},accepted)
  expect(Number.isFinite(result.workout.vol)).toBe(true)
  expect(accepted.saved.workouts[0].entries[0].sets[0]).toMatchObject({w:9999,r:9999})
})

let api: Awaited<ReturnType<typeof target>> | undefined
afterEach(async()=>{vi.restoreAllMocks();if(api){await api.close();api=undefined}})
it('public tools log and undo through the real authenticated conditional API on a synthetic server only',async()=>{
  vi.spyOn(Date,'now').mockReturnValue(now)
  api=await target(state())
  const tools=createTools({env:api.env,fetcher:api.fetcher}), log=tools.find(t=>t.name==='log_workout')!, del=tools.find(t=>t.name==='delete_workout')!
  const preview=await log.handler(input)
  expect(preview.dry_run).toBe(true);expect(api.calls.some(c=>c.method==='PUT')).toBe(false)
  const written=await log.handler({...input,dry_run:false})
  const saved=await api.request('GET','/api/data')
  expect(saved.body.state.workouts[0]).toMatchObject(written.workout)
  await del.handler({workout_id:written.workout.id,confirm:true})
  const removed=await api.request('GET','/api/data')
  expect(removed.body.state.workouts).toEqual([]);expect(removed.body.state.deleted.workouts[written.workout.id]).toBeGreaterThan(0)
},20000)

it('real API programme rollover persists the next queue and remains undoable',async()=>{
  vi.spyOn(Date,'now').mockReturnValue(now)
  const S=state(),definition:any={id:'synthetic',name:'Synthetic',unit:'kg',weeks:[1,2].map(index=>({index,
    days:[{key:'d1',sessions:[{routineSnapshot:{ex:[{id:'3436',sets:1,reps:5}]}}]}]}))}
  activate(S,definition,{cycleId:'c',today:'2026-10-12',now})
  api=await target(S)
  const tools=createTools({env:api.env,fetcher:api.fetcher})
  const result=await tools.find(t=>t.name==='log_workout')!.handler({date:'2026-10-13',routine_id:'c-w1d1',dry_run:false,exercises:[{exercise:'3436',sets:[{reps:5}]}]})
  const saved=await api.request('GET','/api/data')
  expect(saved.body.state.queue.ids).toEqual(['c-w2d1'])
  expect(saved.body.state.programmes.cycles[0].weekIndex).toBe(2)
  await tools.find(t=>t.name==='delete_workout')!.handler({workout_id:result.workout.id,confirm:true})
  expect((await api.request('GET','/api/data')).body.state.workouts).toEqual([])
},20000)
it('real API saved phone edit preserves provenance but invalidates agent undo',async()=>{
  vi.spyOn(Date,'now').mockReturnValue(now)
  api=await target(state())
  const tools=createTools({env:api.env,fetcher:api.fetcher})
  const result=await tools.find(t=>t.name==='log_workout')!.handler({...input,dry_run:false})
  const got=(await api.request('GET','/api/data')).body
  const updated=got.state;updated.workouts[0].note='Saved on phone';updated.workouts[0]._ts=now+1
  expect((await api.request('PUT','/api/data',{state:updated,baseRev:got.rev,baseWid:updated._wid})).status).toBe(200)
  const writes=api.calls.filter(c=>c.method==='PUT').length
  await expect(tools.find(t=>t.name==='delete_workout')!.handler({workout_id:result.workout.id,confirm:true})).rejects.toMatchObject({code:'WORKOUT_MODIFIED'})
  expect(api.calls.filter(c=>c.method==='PUT')).toHaveLength(writes)
  const retained=(await api.request('GET','/api/data')).body.state.workouts[0]
  expect(retained).toMatchObject({loggedBy:'agent',note:'Saved on phone'})
},20000)
