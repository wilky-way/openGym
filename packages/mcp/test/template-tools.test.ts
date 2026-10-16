import { afterEach, expect, test } from 'vitest'
import { createTemplateTools } from '../src/template-tools'
import { createTools } from '../src/tools'
import { target } from './http-helpers'
import { createExerciseIndex, isBodyweightEq, isAssisted } from '@opengym/core/exercises'
import { isBw } from '@opengym/core/history'

let api: Awaited<ReturnType<typeof target>> | undefined
const state = (): any => ({_rev:7,_wid:'epoch',unit:'kg',routines:[{id:'old',name:'Old',extra:{keep:1},ex:[{id:'0001',sets:3,reps:5,restSec:90,unknownSlot:{keep:2}}]}],workouts:[],customEx:[{id:'custom-old',custom:true,n:'Synthetic row',eq:'dumbbell',primaries:['back'],extension:{keep:3}}],week:{'1':['old']},dayPlan:{},unknown:{keep:4},programmes:{cycles:[]}})
const creation = {name:'Synthetic template',exercises:[{exercise_id:'0001',sets:3,reps:8,weight:100,unit:'lb',rest_sec:120},{exercise_id:'custom-old',sets:2,reps:10}],placement:{kind:'none'}}
const custom = {name:'Synthetic assisted row',muscles:['back'],secondary_muscles:['biceps'],equipment:'leverage machine',bodyweight:false,assisted:true,notes:'Synthetic only'}
afterEach(async()=>{await api?.close();api=undefined})
async function setup(initial = state(), extra = {}) {
  api = await target(initial)
  const env = {...api.env,OPENGYM_ENABLE_ROUTINE_WRITES:'1',OPENGYM_ENABLE_EXERCISE_WRITES:'1',...extra}
  const tools = createTemplateTools({env,fetcher:api.fetcher,now:()=>Date.parse('2026-07-27T12:00:00Z')})
  const call = async (name: string,p: any = {}) => tools.find(t=>t.name === name)!.handler(p) as Promise<any>
  const read = async () => (await api!.request('GET','/api/data')).body
  const editAs = async (change: (s: any)=>void, token = api!.browserToken) => {
    const got = await read(), s = structuredClone(got.state);change(s)
    return api!.request('PUT','/api/data',{state:s,baseRev:got.rev,baseWid:s._wid},token)
  }
  const apply = async (name: string,p: any) => {const preview = await call(name,p);return call(name,{...p,apply:true,preview_token:preview.preview_token})}
  return {env,tools,call,read,editAs,apply}
}

test('seven tranche tools and two max tools preserve the original registry',()=>{
  const names = createTools().map(t=>t.name)
  for (const tool of createTemplateTools()) expect(names).toContain(tool.name)
  expect(names).toContain('set_training_max');expect(names).toContain('undo_training_max')
  expect(names.length).toBe(44);expect(new Set(names).size).toBe(44)
})
test('search_exercises returns explicit catalogue/custom IDs and never writes',async()=>{
  const {call} = await setup()
  const result = await call('search_exercises',{query:'Synthetic row',limit:1})
  expect(result.matches[0]).toMatchObject({exercise_id:'custom-old',name:'Synthetic row',custom:true})
  expect((await call('search_exercises',{query:'bench',limit:3})).matches).toHaveLength(3)
  expect(api!.calls.filter(c=>c.method === 'PUT')).toEqual([])
})
test('create_routine previews, applies exact converted configuration, keeps unknown data, and stamps sync changes',async()=>{
  const {call,read} = await setup(), before = await read()
  const preview = await call('create_routine',creation)
  expect(preview.applied).toBe(false);expect(preview.target.ex[0]).toMatchObject({weight:45.25,sets:3,reps:8,restSec:120})
  expect(await read()).toEqual(before)
  const applied = await call('create_routine',{...creation,apply:true,preview_token:preview.preview_token})
  expect(applied.undo_available).toBe(true)
  const saved = (await read()).state
  expect(saved.unknown).toEqual(before.state.unknown);expect(saved.customEx).toEqual(before.state.customEx)
  expect(saved.routines[1]).toMatchObject(preview.target);expect(saved.routines[1]._ts).toBeGreaterThan(0)
  expect(saved.week).toEqual(before.state.week)
  await expect(call('create_routine',{...creation,apply:true,preview_token:preview.preview_token})).rejects.toHaveProperty('code','PREVIEW_REQUIRED')
})
test('edit_routine preserves slot extensions and order, explicit supersets and date placement',async()=>{
  const {apply,read} = await setup()
  const p = {routine_id:'old',name:'Edited',exercises:[{exercise_id:'custom-old',sets:2,reps:8,superset:'pair'},{exercise_id:'0001',source_index:0,sets:4,reps:6,superset:'pair',rest_sec:30}],placement:{kind:'date',date:'2026-07-28'}}
  const result = await apply('edit_routine',p)
  const s = (await read()).state, routine = s.routines[0]
  expect(routine.ex.map((e: any)=>e.id)).toEqual(['custom-old','0001'])
  expect(routine.ex[1]).toMatchObject({unknownSlot:{keep:2},sets:4,reps:6,restSec:30,sg:'pair'})
  expect(routine.extra).toEqual({keep:1});expect(s.week).toEqual({});expect(s.dayPlan).toEqual({'2026-07-28':'old'})
  expect(result.changes).toHaveProperty('routines');expect(result.changes).toHaveProperty('dayPlan')
})
test.each([
  {kind:'week',days:['2','4']},
  {kind:'queue',index:0,starts_on:'2026-07-28',label:'Synthetic pass'},
])('create_routine explicit plan/queue placement %j',async placement=>{
  const {apply,read} = await setup()
  const result = await apply('create_routine',{...creation,placement}), s = (await read()).state
  if (placement.kind === 'week') {expect(s.week['2']).toEqual([result.target.id]);expect(s.week['4']).toEqual([result.target.id]);expect(s.week['1']).toEqual(['old'])}
  else expect(s.queue).toMatchObject({ids:[result.target.id],startsOn:'2026-07-28',strict:true,label:'Synthetic pass'})
})
test('edit_routine supports explicit unplacement without losing unrelated plan entries',async()=>{
  const initial = state();initial.week['2']=['other','old'];initial.dayPlan['2026-07-29']='old'
  const {apply,read} = await setup(initial)
  await apply('edit_routine',{routine_id:'old',placement:{kind:'none'}})
  const s = (await read()).state;expect(s.week).toEqual({'2':['other']});expect(s.dayPlan).toEqual({})
})
test('delete_routine removes only owned pointers, stamps tombstone, and sealed undo restores placement',async()=>{
  const initial = state();initial.queue = {ids:['old','other'],since:1,startsOn:'2026-07-27',label:'Manual',extension:'keep'};initial.dayPlan['2026-07-28']='old'
  const {apply,read} = await setup(initial), deleted = await apply('delete_routine',{routine_id:'old'})
  let s = (await read()).state
  expect(s.routines).toEqual([]);expect(s.deleted.routines.old).toBeGreaterThan(0)
  expect(s.queue).toMatchObject({ids:['other'],extension:'keep'});expect(s.week).toEqual({})
  await apply('undo_template_change',{undo_token:deleted.undo_token})
  s = (await read()).state
  expect(s.routines[0]).toMatchObject(initial.routines[0]);expect(s.deleted.routines.old).toBeLessThan(0)
  expect(s.week).toEqual(initial.week);expect(s.dayPlan).toEqual(initial.dayPlan);expect(s.queue).toEqual(initial.queue)
})
test('custom exercise create/edit is indexed, honors bodyweight/assisted flags and preserves metadata',async()=>{
  const {call,apply,read} = await setup()
  const created = await apply('create_custom_exercise',custom), eid = created.target.id
  let s = (await read()).state, index = createExerciseIndex(s.customEx)
  expect(isAssisted(eid,index)).toBe(true);expect(isBodyweightEq(eid,index)).toBe(false)
  expect((await call('search_exercises',{query:'Synthetic assisted row'})).matches[0].exercise_id).toBe(eid)
  await apply('edit_custom_exercise',{exercise_id:'custom-old',name:'Renamed',equipment:'dumbbell',bodyweight:true,assisted:false,notes:'Updated'})
  s = (await read()).state;index = createExerciseIndex(s.customEx)
  expect(s.customEx[0]).toMatchObject({extension:{keep:3},n:'Renamed',desc:'Updated',bodyweight:true})
  expect(isBw({id:'custom-old'},index)).toBe(true)
  await apply('create_routine',{...creation,exercises:[{exercise_id:eid,sets:2,reps:6}]})
})
test.each(['create_routine','create_custom_exercise'])('%s apply requires its explicit gate and exact preview',async name=>{
  const {call,read,env} = await setup(state(),{OPENGYM_ENABLE_ROUTINE_WRITES:'0',OPENGYM_ENABLE_EXERCISE_WRITES:'0'}), input = name === 'create_routine' ? creation:custom
  const before = await read(), preview = await call(name,input)
  await expect(call(name,{...input,apply:true})).rejects.toHaveProperty('code','PREVIEW_REQUIRED')
  await expect(call(name,{...input,apply:true,preview_token:preview.preview_token})).rejects.toHaveProperty('code','WRITES_DISABLED')
  env.OPENGYM_ENABLE_ROUTINE_WRITES='1';env.OPENGYM_ENABLE_EXERCISE_WRITES='1'
  await expect(call(name,{...input,name:'Changed intent',apply:true,preview_token:preview.preview_token})).rejects.toHaveProperty('code','PREVIEW_REQUIRED')
  expect(await read()).toEqual(before)
})
test.each(['rev','wid','fingerprint'])('preview rejects changed %s, with no retry/rebase',async mode=>{
  await setup()
  let tamper = false
  const fetcher: any = async (url: string,init: RequestInit)=>{
    const r = await api!.fetcher(url,init)
    if (!tamper || new URL(url).pathname !== '/api/data' || init.method !== 'GET') return r
    const data: any = await r.json()
    if (mode === 'rev') {data.rev++;data.state._rev++}
    else if (mode === 'wid') data.state._wid='restored'
    else data.state.unknown.changed=true
    return {...r,json:async()=>data}
  }
  const tools = createTemplateTools({env:{...api!.env,OPENGYM_ENABLE_ROUTINE_WRITES:'1'},fetcher})
  const call = (p: any)=>tools.find(t=>t.name === 'create_routine')!.handler(p) as Promise<any>
  const preview = await call(creation);tamper=true
  const before = await api!.request('GET','/api/data')
  await expect(call({...creation,apply:true,preview_token:preview.preview_token})).rejects.toHaveProperty('code','REV_CONFLICT')
  expect(api!.calls.filter(c=>c.method === 'PUT')).toEqual([])
  expect(await api!.request('GET','/api/data')).toEqual(before)
})
test('server rejects a device start racing the final agent PUT, without a single retry',async()=>{
  await setup()
  let race = false
  const fetcher: any = async (url: string,init: RequestInit) => {
    if (race && new URL(url).pathname === '/api/data' && init.method === 'PUT') {
      race=false
      await api!.request('POST','/api/activity',{active:true,startedAt:200},api!.browserToken)
    }
    return api!.fetcher(url,init)
  }
  const tools = createTemplateTools({env:{...api!.env,OPENGYM_ENABLE_ROUTINE_WRITES:'1'},fetcher}), call = (p: any)=>tools.find(t=>t.name==='create_routine')!.handler(p) as Promise<any>
  const preview = await call(creation);race=true
  await expect(call({...creation,apply:true,preview_token:preview.preview_token})).rejects.toMatchObject({status:423,code:'TRAINING_NOW'})
  expect(api!.calls.filter(c=>c.path === '/api/data' && c.method === 'PUT')).toHaveLength(1)
  expect((await api!.request('GET','/api/data')).body.state.routines).toHaveLength(1)
})
test('agent previews remain readable while training, applies refuse, peer/omitted active cannot clear',async()=>{
  const {call,editAs,read} = await setup()
  await editAs(s=>s.active={id:'active',start:100,entries:[]})
  const preview = await call('create_routine',creation);expect(preview.training_status).toBe('active')
  expect((await call('search_exercises',{query:'row'})).total).toBeGreaterThan(0)
  await editAs(s=>s.active=null,api!.pairedToken);await editAs(s=>delete s.active)
  const before=await read()
  // Peer PUTs change revision, so get a fresh preview before checking activity.
  const fresh=await call('create_routine',creation)
  await expect(call('create_routine',{...creation,apply:true,preview_token:fresh.preview_token})).rejects.toHaveProperty('code','TRAINING_NOW')
  expect(await read()).toEqual(before)
})
test('undo_template_change refuses later target edits and unrelated document changes',async()=>{
  const {apply,call,editAs,read} = await setup(), result = await apply('edit_custom_exercise',{exercise_id:'custom-old',name:'Edited'})
  await editAs(s=>s.unknown.newer=true)
  const before=await read()
  await expect(call('undo_template_change',{undo_token:result.undo_token})).rejects.toHaveProperty('code','UNDO_MODIFIED')
  expect(await read()).toEqual(before)
})
test.each(['active','paused'])('routine edit/delete and custom metadata protect %s programme references',async status=>{
  const initial=state();initial.programmes.cycles=[{id:'cycle',status,occurrences:[{routineId:'old'}]}];initial.routines[0].ex[0].id='custom-old'
  const {call,read}=await setup(initial),before=await read()
  for (const [name,p] of [['edit_routine',{routine_id:'old',name:'No'}],['delete_routine',{routine_id:'old'}],['edit_custom_exercise',{exercise_id:'custom-old',notes:'No'}]] as const)
    await expect(call(name,p)).rejects.toHaveProperty('code','PROGRAMME_OWNED')
  expect(await read()).toEqual(before)
})
test.each([
  {queue:{ids:['old'],programmeCycleId:'cycle'}},
  {queue:{ids:['old'],rotationId:'rotation'}},
  {rotation:{id:'rotation',sequence:['old']}},
])('owned queues and rotations cannot be silently changed %j',async extra=>{
  const {call}=await setup({...state(),...extra})
  await expect(call('delete_routine',{routine_id:'old'})).rejects.toHaveProperty('code','QUEUE_OWNED')
})
test.each([
  {...creation,exercises:[{exercise_id:'bench press',sets:3,reps:8}]},
  {...creation,exercises:[{exercise_id:'not-an-id',sets:3,reps:8}]},
  {...creation,exercises:[{exercise_id:'constructor',sets:3,reps:8}]},
  {...creation,exercises:[{exercise_id:'0001',sets:0,reps:8}]},
  {...creation,exercises:[{exercise_id:'0001',sets:3,reps:-1}]},
  {...creation,exercises:[{exercise_id:'0001',sets:3,reps:8,weight:9999,unit:'kg'}]},
  {...creation,exercises:[{exercise_id:'0001',sets:3,reps:8,rest_sec:3601}]},
  {...creation,exercises:[{exercise_id:'0001',sets:3,reps:8,superset:'alone'}]},
])('semantic bounds and explicit IDs refuse invalid routine inputs %j',async input=>{
  const initial=state();initial.unit='lb'
  const {call,read}=await setup(initial),before=await read()
  await expect(call('create_routine',input)).rejects.toBeInstanceOf(Error)
  expect(await read()).toEqual(before)
})
test('prototype keys, contradictory flags, duplicate ids, and ambiguous slots fail closed',async()=>{
  const {call}=await setup()
  await expect(call('create_custom_exercise',{...custom,bodyweight:true})).rejects.toHaveProperty('code','EINVAL')
  await expect(call('create_routine',JSON.parse('{"name":"x","__proto__":{"polluted":true}}'))).rejects.toHaveProperty('code','EINVAL')
  await expect(call('edit_custom_exercise',JSON.parse('{"exercise_id":"custom-old","constructor":{"polluted":true}}'))).rejects.toHaveProperty('code','EINVAL')
  expect(({} as any).polluted).toBeUndefined()
})

test('same-document revision/identity race at PUT is refused atomically without retry',async()=>{
  const {read,editAs} = await setup()
  let race = false
  const fetcher: any = async (url: string,init: RequestInit) => {
    if (race && new URL(url).pathname === '/api/data' && init.method === 'PUT') {race=false;await editAs(s=>s.unknown.raced=true)}
    return api!.fetcher(url,init)
  }
  const tools=createTemplateTools({env:{...api!.env,OPENGYM_ENABLE_ROUTINE_WRITES:'1'},fetcher}), call=(p: any)=>tools.find(t=>t.name==='create_routine')!.handler(p) as Promise<any>
  const preview=await call(creation);race=true
  await expect(call({...creation,apply:true,preview_token:preview.preview_token})).rejects.toMatchObject({code:'REV_CONFLICT',status:409})
  expect((await read()).state.routines).toHaveLength(1);expect((await read()).state.unknown.raced).toBe(true)
  expect(api!.calls.filter(c=>c.method==='PUT' && c.body?.requireIdle)).toHaveLength(1)
})
test('preview fingerprint rejects restores while undo refuses a changed target',async()=>{
  const {apply,editAs,call}=await setup(),result=await apply('create_custom_exercise',custom)
  await editAs(s=>s.customEx.find((e: any)=>e.id===result.target.id).n='Changed by owner')
  await expect(call('undo_template_change',{undo_token:result.undo_token})).rejects.toHaveProperty('code','UNDO_MODIFIED')
})
test('ambiguous repeated slots and malformed custom indexes cannot discard extension data',async()=>{
  const initial=state();initial.routines[0].ex.push({...initial.routines[0].ex[0],unknownSlot:{second:true}})
  const {call}=await setup(initial)
  await expect(call('edit_routine',{routine_id:'old',exercises:[{exercise_id:'0001',sets:3,reps:5}]})).rejects.toHaveProperty('code','AMBIGUOUS_SLOT')
  const preview=await call('edit_routine',{routine_id:'old',exercises:[{exercise_id:'0001',source_index:1,sets:3,reps:5},{exercise_id:'0001',source_index:0,sets:3,reps:5}]})
  expect(preview.target.ex.map((e: any)=>e.unknownSlot)).toEqual([{second:true},{keep:2}])
})
test('duplicate custom id index is refused instead of implicitly selecting one',async()=>{
  const initial=state();initial.customEx.push({...initial.customEx[0],n:'Other'})
  const {call}=await setup(initial)
  await expect(call('search_exercises',{query:'Synthetic'})).rejects.toHaveProperty('code','INVALID_INDEX')
})
test('preview tokens expire and cannot cross process/profile or credential',async()=>{
  await setup()
  let time=Date.parse('2026-07-27T12:00:00Z')
  const env={...api!.env,OPENGYM_ENABLE_ROUTINE_WRITES:'1'},tools=createTemplateTools({env,fetcher:api!.fetcher,now:()=>time})
  const tool=tools.find(t=>t.name==='create_routine')!,p: any=await tool.handler(creation)
  const other=createTemplateTools({env,fetcher:api!.fetcher})
  await expect(other.find(t=>t.name==='create_routine')!.handler({...creation,apply:true,preview_token:p.preview_token})).rejects.toHaveProperty('code','PREVIEW_REQUIRED')
  time+=15*60000+1
  await expect(tool.handler({...creation,apply:true,preview_token:p.preview_token})).rejects.toHaveProperty('code','PREVIEW_REQUIRED')
})
test('owned snapshot references protect custom metadata even if current materialization is missing',async()=>{
  const initial=state();initial.programmes.cycles=[{id:'cycle',status:'paused',snapshot:{weeks:[{days:[{sessions:[{routineSnapshot:{ex:[{id:'custom-old'}]}}]}]}]}}]
  const {call}=await setup(initial)
  await expect(call('edit_custom_exercise',{exercise_id:'custom-old',name:'No'})).rejects.toHaveProperty('code','PROGRAMME_OWNED')
})
