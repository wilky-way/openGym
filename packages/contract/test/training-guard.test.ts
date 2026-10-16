import {expect,it} from 'vitest'
import {ROUTE_POLICY,type ActivityBody,type Routes,type TrainingActivityResponse} from '../http/api'
import type {PutDataRequest} from '../domain/state-doc'
import {REQUEST_SCHEMAS,matchRoute,validateRequest} from '../src/validators'

it('declares authenticated activity reads in the same route/policy/schema inventory',()=>{
 const route:keyof Routes='GET /api/data/activity'
 expect(matchRoute('GET','/api/data/activity')).toBe(route)
 expect(ROUTE_POLICY[route]).toEqual({auth:'session',csrf:'n/a'})
 expect(REQUEST_SCHEMAS[route]).toBeDefined();expect(validateRequest(route,undefined)).toEqual({ok:true})
 const agent:TrainingActivityResponse={status:'unknown'},owner:TrainingActivityResponse={status:'active',own:{lease:'synthetic',session:'a'.repeat(64)}}
 expect(Object.keys(agent)).toEqual(['status']);expect(owner.own?.session).toHaveLength(64)
})
it('types closure/guard envelopes while leaving authentication and semantic precedence to real handlers',()=>{
 const put:PutDataRequest={state:{routines:[],workouts:[],active:null},baseRev:3,baseWid:'synthetic',requireIdle:true,trainingClose:{lease:'owned',session:null}}
 const editor:ActivityBody={active:false,reason:'editor-closed',profileId:'synthetic',sessionId:'saved',startedAt:1000,editingWorkoutId:'saved',editorInstanceId:'incarnation'}
 const discard:ActivityBody={active:false,reason:'discarded',profileId:'synthetic',sessionId:'session',startedAt:1000}
 for(const [route,body] of [['PUT /api/data',put],['POST /api/activity',editor],['POST /api/activity',discard]] as const){
  const before=JSON.stringify(body);expect(validateRequest(route,body)).toEqual({ok:true});expect(JSON.stringify(body)).toBe(before)
 }
 // Static producer types are narrower than retained structural validators:
 // wrong values still reach handlers, preserving auth/revision/error precedence.
 expect(validateRequest('PUT /api/data',{state:{routines:[]},requireIdle:'invalid',trainingClose:{untrusted:true}})).toEqual({ok:true})
})
