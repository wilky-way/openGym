import { afterEach, expect, test, vi } from 'vitest'
import * as progression from '@opengym/core/progression'
import * as programmeAgent from '@opengym/core/programme-agent'
import { createTools } from '../src/tools'
import { target } from './http-helpers'

const custom = { id:'custom-invocation',n:'Synthetic assisted lift',bp:'chest',eq:'leverage machine',assisted:true }
let api: Awaited<ReturnType<typeof target>> | undefined
afterEach(async()=>{vi.restoreAllMocks();if(api){await api.close();api=undefined}})
const state=()=>({_rev:7,_wid:'synthetic-epoch',unit:'kg',customEx:[custom],routines:[],workouts:[]})
test('list_routines invokes the real policy helper with the HTTP profile custom exercise index',async()=>{
  api=await target({...state(),routines:[{id:'r',name:'Synthetic custom routine',prog:'double',ex:[{id:custom.id,sets:2,reps:8,weight:40}]}]})
  // Forced reps makes index lookup inert here. Observe the real call without replacing behavior.
  const policy=vi.spyOn(progression,'policyFor')
  const tool=createTools({env:api.env,fetcher:api.fetcher}).find(t=>t.name==='list_routines')!
  const result=await tool.handler({})
  expect(result.routines[0]).toMatchObject({id:'r',exercise_count:1,policy:'double'})
  expect(policy).toHaveBeenCalledTimes(1)
  expect(policy.mock.calls[0]![3]?.[custom.id]).toMatchObject(custom)
  expect(api.calls.every(c=>c.method==='GET')).toBe(true)
})
test('activate_programme invokes the real action helper with custom index and persists custom prescription',async()=>{
  const definition={id:'synthetic-custom-invocation',name:'Synthetic custom programme',unit:'kg',weeks:[{index:1,days:[{key:'d1',sessions:[{sessionTemplateId:'s',routineSnapshot:{ex:[{id:custom.id,slotId:'custom-slot',sets:2,reps:8,weight:40}]}}]}]}]}
  api=await target({...state(),programmes:{definitions:[definition],cycles:[]}})
  // Activation uses an explicit catalogue from state, so the index is inert at that validation edge.
  const action=vi.spyOn(programmeAgent,'applyProgrammeAgentAction')
  const tools=createTools({env:api.env,fetcher:api.fetcher})
  const result=await tools.find(t=>t.name==='activate_programme')!.handler({programme_id:definition.id,expected_rev:7,expected_wid:'synthetic-epoch',today:'2026-10-13'})
  expect(result.ok).toBe(true);expect(action).toHaveBeenCalledTimes(1)
  expect(action.mock.calls[0]![4]?.[custom.id]).toMatchObject(custom)
  const saved=(await api.request('GET','/api/data')).body.state
  expect(saved.customEx).toEqual([custom])
  expect(saved.routines[0].ex[0]).toMatchObject({id:custom.id,slotId:'custom-slot',sets:2,reps:8,weight:40})
  expect(api.calls.filter(c=>c.method==='PUT')).toHaveLength(1)
})
