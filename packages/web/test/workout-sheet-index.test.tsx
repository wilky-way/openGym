// GM safety divergence from legacy: callbacks bind owner/session/editor/row identity; stale targets abort.
// @vitest-environment happy-dom
import { workoutSheetPlatform } from './workout-sheet-environment'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { parse } from '@babel/parser'
import { DEF, clone, useStore } from '../src/store/useStore'
import { useUI } from '../src/store/useUI'
import { beginWorkout, repeatWorkout, logPastWorkoutSheet, addRoutineToSessionSheet, exerciseNoteSheet, finishWorkout, supersetSheet, setsLine, configureWorkoutSheets, exitWorkoutEdit } from '../src/sheets-d'
import { editCompletedSession } from '@opengym/core/session-edit'
import { createExerciseIndex } from '@opengym/core/exercises'
const assist = {id:'synthetic-assist',n:'Synthetic assisted pull',eq:'leverage machine',bp:'back',assisted:true,custom:true}
const bell = {id:'synthetic-bell',n:'Synthetic bell press',eq:'dumbbell',bp:'chest',custom:true}
const cardio = {id:'synthetic-cardio',n:'Synthetic treadmill',eq:'machine',bp:'cardio',custom:true}
const hold = {id:'synthetic-hold',n:'Synthetic hold',eq:'body weight',bp:'waist',custom:true}
const st = () => useStore.getState().S
const roots: Root[] = []
function install(extra: Record<string,any> = {}) {const S={...clone(DEF),sound:false,weighIn:false,customEx:[assist,bell,cardio,hold],...extra};useStore.setState({S,index:createExerciseIndex(S.customEx)})}
const active = (id: string, rows: any[], extra: any = {}) => ({id:'now',d:'2026-10-13',start:Date.now()-60000,name:'Synthetic',routineIds:[],entries:[{id,sets:rows,...extra}],cur:0})
const old = (id: string, rows: any[], extra: any = {}) => ({...active(id,rows,extra),id:'old',d:'2026-10-12',start:Date.now()-86400000,end:Date.now()-86340000,prs:[]})
function renderTop(): HTMLDivElement {const sheet=useUI.getState().sheets.at(-1)!;const host=document.createElement('div');document.body.append(host);const root=createRoot(host);roots.push(root);act(()=>root.render(sheet.render(()=>useUI.getState().closeSheet(sheet.id))));return host}
function click(host: HTMLElement, text: string) {act(()=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent===text)!.click())}
function type(el: HTMLInputElement, text: string) {act(()=>{Object.getOwnPropertyDescriptor(el.constructor.prototype,'value')!.set!.call(el,text);el.dispatchEvent(new Event('input',{bubbles:true}))})}
afterEach(()=>{act(()=>roots.splice(0).forEach(r=>r.unmount()));document.body.innerHTML=''})
it('live planned start uses a custom cardio exercise when constructing set rows',()=>{
 install({routines:[{id:'routine',name:'Hold',ex:[{id:cardio.id,sets:1,min:10,speed:5}]}]});act(()=>beginWorkout(['routine'],null));expect(st().active.entries[0].sets[0]).toMatchObject({min:10,speed:5});expect(st().active.entries[0].sets[0].r).toBeUndefined()
})
it('backfill and add routine use custom exercise modes and preserve the live cursor and exclusions',()=>{
 install({routines:[{id:'routine',name:'Hold',ex:[{id:cardio.id,sets:1,min:10,speed:5}]}]});act(()=>logPastWorkoutSheet({iso:'2026-10-12',routineIds:['routine']}));click(renderTop(),'Continue');expect(st().active.entries[0].sets[0]).toMatchObject({min:10,speed:5});expect(st().active.backfill.durationMin).toBe(60)
 install({routines:[{id:'routine',name:'Hold',ex:[{id:cardio.id,sets:1,min:10,speed:5}]}],active:{...active(bell.id,[]),noProg:true,cur:4}});act(()=>addRoutineToSessionSheet());const host=renderTop();act(()=>host.querySelector<HTMLElement>('.item')!.click());expect(st().active.entries[1].sets[0]).toMatchObject({min:10,speed:5});expect(st().active.entries[1].noProg).toBe(true);expect(st().active.cur).toBe(4)
})
it('repeat keeps custom exercise rows, source data, and guards the delayed weigh-in callback',()=>{
 const saved=old(bell.id,[{w:20,r:8,done:true}],{target:{mode:'reps',sets:1,reps:8,dbLoad:'each'}});install();const before=clone(saved);act(()=>repeatWorkout(saved));expect(st().active.entries[0].id).toBe(bell.id);expect(st().active.entries[0].sets[0]).toMatchObject({w:20,r:8,done:false});expect(saved).toEqual(before)
 install({weighIn:true});let done!: (bw:number|null)=>void;configureWorkoutSheets({bwSheet:o=>{done=o.onDone},confirmSheet:()=>{},menuSheet:()=>{}});repeatWorkout(saved);useStore.getState().update(s=>{s.active=active(hold.id,[])});done(80);expect(st().active.entries[0].id).toBe(hold.id);expect(useUI.getState().toastMsg).toBe('The workout changed. Open this action again.')
})
it('exercise notes resolve a custom exercise name through the caller index',()=>{
 install({active:active(bell.id,[])});act(()=>exerciseNoteSheet(0));expect(renderTop().querySelector('h3')!.textContent).toBe(bell.n)
})
it('finish folds custom assistance toward the least help for PR, top load, and cached weight',()=>{
 install({active:active(assist.id,[{w:50,r:5,done:true},{w:30,r:5,done:true}]),workouts:[old(assist.id,[{w:40,r:5,done:true}])],exWeights:{[assist.id]:{w:40}}});act(()=>finishWorkout());const w=st().workouts.at(-1);expect(w.prs).toEqual([assist.id]);expect(w.entries[0].topW).toBe(30);expect(st().exWeights[assist.id].w).toBe(30);expect(renderTop().textContent).not.toContain('Best estimated 1RM:')
})
it('finish rejects a false assistance PR when prior sets include a smaller load',()=>{
 install({active:active(assist.id,[{w:30,r:5,done:true}]),workouts:[old(assist.id,[{w:60,r:5,done:true},{w:20,r:5,done:true}])],exWeights:{[assist.id]:{w:20}}});act(()=>finishWorkout());expect(st().workouts.at(-1).prs).toEqual([]);expect(st().exWeights[assist.id].w).toBe(20)
})
it('finish counts both custom dumbbells and compares prior total loads as per-bell loads',()=>{
 install({active:active(bell.id,[{w:25,r:5,done:true}],{target:{mode:'reps',dbLoad:'each'}}),workouts:[old(bell.id,[{w:40,r:5,done:true}],{target:{mode:'reps',dbLoad:'total'}})]});act(()=>finishWorkout());expect(st().workouts.at(-1).vol).toBe(250);expect(st().workouts.at(-1).prs).toEqual([bell.id]);expect(st().workouts.at(-1).entries[0].muscleSnapshot).toBeTruthy()
})
it('backfill rebuilds custom assistance badges chronologically and stops both timers',()=>{
 const A=active(assist.id,[{w:30,r:5,done:true}]);A.d='2026-10-11';A.start=Date.now()-172800000;(A as any).backfill={durationMin:60,replaceId:null};install({active:A,workouts:[{...old(assist.id,[{w:40,r:5,done:true}]),prs:[assist.id]}]});act(()=>finishWorkout());expect(st().workouts[0].prs).toEqual([assist.id]);expect(st().workouts[1].prs).toEqual([]);expect(st().active).toBeNull();expect(useUI.getState().timer).toBeNull();expect(useUI.getState().work).toBeNull()
})
it('finish summary computes the next custom lower-body step from its routine',()=>{
 const leg={...bell,id:'synthetic-leg',n:'Synthetic leg press',eq:'machine',bp:'upper legs'};install({customEx:[leg],active:active(leg.id,[{w:60,r:5,done:true}],{rid:'r',target:{mode:'reps',sets:1,reps:5,weight:60,prog:'linear'}}),routines:[{id:'r',name:'Legs',ex:[{id:leg.id,sets:1,reps:5,weight:60,prog:'linear'}]}]});act(()=>finishWorkout());expect(renderTop().textContent).toContain('Next time: 65 kg')
})
it('summary finds custom cardio rows and formats their completed minutes and speed',()=>{
 install({active:active(cardio.id,[{min:10,speed:5,r:3,w:20,done:true}],{target:{id:cardio.id}})});act(()=>finishWorkout());const host=renderTop();expect(host.textContent).toContain('10 min');expect(host.textContent).not.toContain('Last time and next time');expect(host.textContent).toContain(cardio.n)
})
it('superset settings trim the name, preserve round rest, and submit on Enter',()=>{
 install();const save=vi.fn();act(()=>supersetSheet({name:'Old',rest:90},save));const host=renderTop();type(host.querySelector('input')!,'  Finisher  ');act(()=>host.querySelector('input')!.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})));expect(save).toHaveBeenCalledWith({name:'Finisher',rest:90});expect(useUI.getState().sheets).toHaveLength(0);expect(setsLine([{w:60,r:5},{w:60,r:4,f:true}],'kg')).toBe('60 kg × 5, 4 F')
})
it('inert muscle-map and edit comparison edges forward their caller index',()=>{
 // buildCompletedWorkout snapshots every custom entry before the summary, so custom load metadata
 // already wins over the index. editChangesNothing only changes derived topW through the index,
 // and its comparable() deliberately strips topW and volume before comparing. Both keep forwarding.
 const ast=parse(readFileSync('src/sheets-d.tsx','utf8'),{sourceType:'module',plugins:['typescript','jsx']});const calls:any[]=[]
 function visit(n:any){if(!n||typeof n!=='object')return;if(Array.isArray(n)){n.forEach(visit);return}if(n.type==='CallExpression'&&['loadOfWorkouts','editChangesNothing'].includes(n.callee.name))calls.push(n);Object.values(n).forEach(visit)}visit(ast)
 expect(calls).toHaveLength(2);expect(calls.find(c=>c.callee.name==='loadOfWorkouts').arguments[2].name).toBe('index');expect(calls.find(c=>c.callee.name==='editChangesNothing').arguments[1].callee.name).toBe('currentIndex')
})
it('custom assisted rep improvements never produce an estimated max record',()=>{
 install({active:active(assist.id,[{w:40,r:10,done:true}]),workouts:[old(assist.id,[{w:40,r:5,done:true}])]});act(()=>finishWorkout());expect(st().workouts.at(-1).prs).toEqual([]);expect(renderTop().textContent).not.toContain('Best estimated 1RM:')
})
it('custom one-arm bell volume counts one bell even when the meaning is each',()=>{
 const one={...bell,id:'synthetic-one-arm',n:'Synthetic single-arm press'};install({customEx:[one],active:active(one.id,[{w:25,r:5,done:true}],{target:{dbLoad:'each',mode:'reps'}})});act(()=>finishWorkout());expect(st().workouts.at(-1).vol).toBe(125)
})

it('legacy custom exercises without a flag retain their frozen muscle snapshot',()=>{
 const unflagged={id:'synthetic-unflagged',n:'Synthetic historical custom',eq:'machine',bp:'chest'};install({customEx:[unflagged],active:active(unflagged.id,[{w:20,r:5,done:true}])});act(()=>finishWorkout());expect(st().workouts.at(-1).entries[0].muscleSnapshot).toMatchObject({n:unflagged.n,bp:'chest'})
})
it('unchanged custom assistance edits leave without an invented save prompt',()=>{
 const saved={...old(assist.id,[{w:50,r:5,done:true},{w:30,r:5,done:true}]),entries:[{id:assist.id,topW:30,target:null,sets:[{w:50,r:5,done:true},{w:30,r:5,done:true}]}],routineIds:[],routineId:null,bw:null};install({workouts:[saved]});useStore.getState().update(s=>{editCompletedSession(s as any,'old')});const leave=vi.fn();act(()=>exitWorkoutEdit(leave));expect(leave).toHaveBeenCalledOnce();expect(useUI.getState().sheets).toHaveLength(0);expect(st().active).toBeNull()
})

it('backfill accepts a singular routine id the same way as a list',()=>{
 install({routines:[{id:'routine',name:'Solo',ex:[{id:cardio.id,sets:1,min:10,speed:5}]}]});act(()=>logPastWorkoutSheet({iso:'2026-10-12',routineIds:'routine'}));const host=renderTop();expect(host.textContent).toContain('Solo');click(host,'Continue');expect(st().active.routineIds).toEqual(['routine']);expect(st().active.entries[0].sets[0]).toMatchObject({min:10,speed:5})
})

it('failed finish persistence keeps the only durable active session and reports the refusal',async()=>{
 install({active:active(bell.id,[{w:25,r:5,done:true}])});useStore.getState().update(()=>{});const before=workoutSheetPlatform.kv.get('gym_state_v1');expect(before).toBeTruthy();const original=workoutSheetPlatform.kv.set.bind(workoutSheetPlatform.kv);workoutSheetPlatform.kv.set=(key,value)=>{if(key==='gym_state_v1')throw new Error('quota');original(key,value)};await act(async()=>{finishWorkout();await Promise.resolve()});expect(workoutSheetPlatform.kv.get('gym_state_v1')).toBe(before);expect(JSON.parse(before!).active.entries[0].sets[0]).toMatchObject({w:25,r:5,done:true});expect(st().workouts.at(-1).entries[0].sets[0]).toMatchObject({w:25,r:5,done:true});expect(useUI.getState().toastMsg).toMatch(/save|storage/i)
})
