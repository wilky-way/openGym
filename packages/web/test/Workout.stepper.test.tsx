// @vitest-environment happy-dom
import './workout-sheet-environment'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import Workout from './regression-harness'
import { clone, DEF, useStore } from '../src/store/useStore'
let root: Root, container: HTMLDivElement
const exercise = (id: string, sets: boolean[], extra = {}) => ({ id, target: { mode: 'reps', reps: 5, weight: 60, bodyweight: false }, sets: sets.map(done => ({ w: 60, r: 5, done })), ...extra })
function mount(entries: any[]) {
  const S = {...clone(DEF), sound: false, active: {id: 'active', name: 'Test workout', start: Date.now(), cur: 0, entries}}
  useStore.setState({S}); container=document.createElement('div');document.body.append(container);root=createRoot(container)
  act(()=>root.render(<Workout/>))
}
function stepperButton(exidx: number, setRow: number, col: number, direction: string) {
  const block = container.querySelector(`[data-exidx="${exidx}"]`)
  expect(block).toBeTruthy()
  const row = block!.querySelectorAll('.setrow')[setRow]
  expect(row).toBeTruthy()
  const cell = row!.querySelectorAll('.stp')[col]
  expect(cell).toBeTruthy()
  return cell!.querySelector<HTMLButtonElement>(`button[aria-label="${direction}"]`)
}
function tap(button: HTMLButtonElement | null) { expect(button).toBeTruthy(); act(()=>button!.click()) }
afterEach(()=>{if(root)act(()=>root.unmount());container?.remove()})
describe('superset stepper — one tap moves one step',()=>{
 it('increments a superset member weight by one step per tap',()=>{mount([exercise('press',[false],{sg:'group'}),exercise('row',[false],{sg:'group'})]);tap(stepperButton(0,0,0,'Increase'));expect(useStore.getState().S.active.entries[0].sets[0].w).toBe(62.5)})
 it('advances reps by exactly one per tap across repeated taps',()=>{mount([exercise('press',[false],{sg:'group'}),exercise('row',[false],{sg:'group'})]);for(let i=0;i<3;i++)tap(stepperButton(0,0,1,'Increase'));expect(useStore.getState().S.active.entries[0].sets[0].r).toBe(8)})
 it('steps the partner exercise correctly after the first member was changed',()=>{mount([exercise('press',[false],{sg:'group'}),exercise('row',[false],{sg:'group'})]);tap(stepperButton(0,0,1,'Increase'));tap(stepperButton(1,0,1,'Increase'));expect(useStore.getState().S.active.entries[0].sets[0].r).toBe(6);expect(useStore.getState().S.active.entries[1].sets[0].r).toBe(6)})
 it('decrements a superset member weight by one step per tap',()=>{mount([exercise('press',[false],{sg:'group'}),exercise('row',[false],{sg:'group'})]);tap(stepperButton(0,0,0,'Decrease'));expect(useStore.getState().S.active.entries[0].sets[0].w).toBe(57.5)})
})
