import {test} from 'bun:test'
import assert from 'node:assert/strict'
import {dataServer,mint} from './data-helpers'
import {user} from './helpers'
import {editCompletedSession} from '../../core/src/session-edit'
import {buildCompletedWorkout} from '../../core/src/finish-workout'
import {TRAINING_HEARTBEAT_MS} from '../src/training-guard'

function fixture() {
  const h=dataServer(['u1']),browser=h.auth.mint(user('u1'),'browser'),agent=h.auth.mint(user('u1'),'agent'),peer=h.auth.mint(user('u1'),'paired')
  const call=async(token:string,path:string,body?:unknown)=>{
    const r=await fetch(h.api+path,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})})
    return {status:r.status,body:await r.json() as any}
  }
  const put=async(token:string,changes:any,trainingClose?:unknown)=>{
    const got=h.data.get('u1'),r=await fetch(h.api+'/api/data',{method:'PUT',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({state:{unit:'kg',routines:[],workouts:[],...got.state,...changes},baseRev:got.rev,baseWid:got.state?._wid??null,trainingClose})})
    return {status:r.status,body:await r.json() as any}
  }
  const activity=(token:string,body:any)=>call(token,'/api/activity',body)
  const status=(token=agent)=>call(token,'/api/data/activity')
  return {h,browser,agent,peer,put,activity,status}
}
test('history editor incarnations fence independently without changing saved identity or weakening late-heartbeat tombstones',async()=>{
  const {h,browser,agent,peer,put,activity,status}=fixture()
  const running:any={id:'saved',start:1000,d:'2026-10-01',name:'Synthetic',entries:[{id:'0001',sets:[{done:true,w:50,r:5}]}]}
  await put(browser,{active:running});const workout=buildCompletedWorkout(running,{end:2000})
  await put(browser,{active:null,workouts:[workout]});assert.equal((await status()).body.status,'idle')
  const editor=(incarnation:string)=>{const s:any=structuredClone(h.data.get('u1').state);editCompletedSession(s,'saved');s.active.editBase.sheetInstanceId=incarnation;return s.active}
  const signal=(incarnation:string,active:boolean)=>({active,reason:active?undefined:'editor-closed',profileId:'u1',sessionId:'saved',startedAt:1000,editingWorkoutId:'saved',editorInstanceId:incarnation})
  const a=editor('editor-A');assert.equal(a.id,workout.id);assert.equal(a.start,workout.start)
  await put(browser,{active:a});assert.equal((await status()).body.status,'active');assert.equal((await put(agent,{note:'blocked'})).status,423)
  const proofA=(await status(browser)).body.own
  // The old historical row existed before this editor and cannot prove Save/cancel.
  await put(browser,{active:null});assert.equal((await status()).body.status,'active')
  await activity(peer,signal('editor-A',false));assert.equal((await status()).body.status,'active')
  await activity(browser,signal('editor-A',false));assert.equal((await status()).body.status,'idle')
  await activity(browser,signal('editor-A',true));assert.equal((await status()).body.status,'idle')
  const b=editor('editor-B');await put(browser,{active:b});assert.equal((await put(agent,{})).status,423)
  await activity(browser,signal('editor-A',false));await put(browser,{active:null},proofA);assert.equal((await status()).body.status,'active')
  await activity(browser,signal('editor-B',false));assert.equal((await status()).body.status,'idle')
  await put(browser,{active:a});await activity(browser,signal('editor-B',true));assert.equal((await status()).body.status,'idle')
})
test('editor heartbeats fence before a document PUT and missing-incarnation editors require an explicit own lease close',async()=>{
  const {h,browser,agent,put,activity,status}=fixture()
  await put(browser,{active:{id:'saved',start:1000}});await put(browser,{active:null,workouts:[{id:'saved',start:1000}]})
  await activity(browser,{active:true,sessionId:'saved',startedAt:1000,editingWorkoutId:'saved',editorInstanceId:'heartbeat-editor'})
  assert.equal((await put(agent,{})).status,423)
  await activity(browser,{active:false,reason:'editor-closed',profileId:'u1',sessionId:'saved',startedAt:1000,editingWorkoutId:'saved',editorInstanceId:'heartbeat-editor'})
  const oldEditor={id:'saved',start:1000,editingWorkoutId:'saved',editBase:{}}
  await put(browser,{active:oldEditor});assert.equal((await status()).body.status,'active')
  await put(browser,{active:null});await activity(browser,{active:false,reason:'editor-closed',profileId:'u1',sessionId:'saved',startedAt:1000,editingWorkoutId:'saved'})
  assert.equal((await put(agent,{})).status,423)
  h.clock.t+=TRAINING_HEARTBEAT_MS+1;assert.equal((await status()).body.status,'unknown')
  await put(browser,{active:null},(await status(browser)).body.own);assert.equal((await status()).body.status,'idle')
  // An old editor has no distinct incarnation: a new positive observation must fence again.
  await put(browser,{active:oldEditor});assert.equal((await put(agent,{})).status,423)
})
for (const observation of ['put','heartbeat'] as const) test(`observed v1 active ${observation} fences trusted idle; only its upgraded owning device can attest closure`,async()=>{
  const {h,browser,agent,peer,put,activity,status}=fixture(),legacy=mint('u1')
  await put(browser,{active:null});assert.equal((await put(agent,{})).status,200)
  if(observation==='put') assert.equal((await put(legacy,{active:{id:'legacy-running',start:1000}})).status,200)
  else assert.equal((await activity(legacy,{active:true,sessionId:'legacy-running',startedAt:1000})).status,200)
  assert.equal((await status()).body.status,'active');assert.equal((await put(agent,{})).status,423)
  await put(legacy,{active:null,workouts:[{id:'legacy-running',start:1000}]})
  await activity(legacy,{active:false,reason:'discarded',profileId:'u1',sessionId:'legacy-running',startedAt:1000})
  await put(peer,{active:null});assert.equal((await status()).body.status,'active')
  h.clock.t+=TRAINING_HEARTBEAT_MS+1;assert.equal((await status()).body.status,'unknown')
  const session=h.auth.sessionOf(new Request('http://synthetic/',{headers:{Authorization:'Bearer '+legacy}}))!
  const upgraded=h.auth.renew(session),own=(await status(upgraded)).body.own
  assert.ok(own?.session,'authenticated predecessor binding must retain owning-device recovery')
  await put(peer,{active:null},own);assert.equal((await status()).body.status,'unknown')
  await put(upgraded,{active:null},own);assert.equal((await status()).body.status,'idle')
  await activity(legacy,{active:true,sessionId:'another-legacy',startedAt:2000});assert.equal((await put(agent,{})).status,423)
})
