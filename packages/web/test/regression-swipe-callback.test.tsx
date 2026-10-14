// @vitest-environment happy-dom
import './workout-sheet-environment'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import Workout from './regression-harness'
import { useStore } from '../src/store/useStore'
import { useUI } from '../src/store/useUI'
import { workoutSheetPlatform } from './workout-sheet-environment'
let root: Root, host: HTMLDivElement
function pointer(el: HTMLElement, type: string, x: number) { const event = new Event(type, {bubbles:true});Object.assign(event,{pointerId:7,pointerType:'touch',clientX:x,clientY:300});act(()=>el.dispatchEvent(event)) }
beforeEach(()=>{
 vi.useFakeTimers(); vi.spyOn(HTMLElement.prototype,'clientWidth','get').mockReturnValue(360)
 vi.spyOn(HTMLElement.prototype,'animate').mockImplementation(()=>{
  let timer: ReturnType<typeof setTimeout>; const animation = {cancel(){clearTimeout(timer)}, set onfinish(fn: () => void) {timer=setTimeout(fn,180)}}
  return animation as unknown as Animation
 })
 useStore.getState().update(s=>{s.active={id:'same-id',start:100,cur:0,entries:[{id:'0043',target:{sets:2,reps:5},sets:[{w:40,r:5,done:false},{w:60,r:5,done:false}]}]}})
 host=document.createElement('div');document.body.append(host);root=createRoot(host);act(()=>root.render(<Workout/>))
})
afterEach(()=>{act(()=>root.unmount());host.remove();vi.restoreAllMocks();vi.useRealTimers()})
it.each(['copy','delete'].flatMap(kind=>['account','profile','session','row'].map(owner=>[kind,owner])))('a delayed %s animation cannot dispatch a replacement %s callback',(kind,owner)=>{
 const row=host.querySelector<HTMLElement>('.swrow')!
 pointer(row,'pointerdown',kind==='copy'?100:330);pointer(row,'pointermove',kind==='copy'?330:60);pointer(row,'pointerup',kind==='copy'?330:60)
 act(()=>{if(owner==='account')useStore.setState({user:{id:'account-B'}});useStore.getState().update(s=>{s.savedBy='B';if(owner==='profile')s.activeEquipId='B';if(owner==='session')s.active.start=200;s.active.entries[0].sets[0].w=99})})
 const before=workoutSheetPlatform.kv.get('gym_state_v1')!, published=JSON.stringify(useStore.getState().S)
 act(()=>vi.advanceTimersByTime(800))
 expect(workoutSheetPlatform.kv.get('gym_state_v1')).toBe(before)
 expect(JSON.stringify(useStore.getState().S)).toBe(published)
 expect(useStore.getState().S.active.entries[0].sets).toHaveLength(2)
 expect(host.querySelector('.swfront')?.getAttribute('style')).not.toContain('translateX')
})

it.each(['copy','delete'])('a delayed %s succeeds on its originating row',kind=>{
 const row=host.querySelector<HTMLElement>('.swrow')!;pointer(row,'pointerdown',kind==='copy'?100:330);pointer(row,'pointermove',kind==='copy'?330:60);pointer(row,'pointerup',kind==='copy'?330:60);act(()=>vi.advanceTimersByTime(800));expect(useStore.getState().S.active.entries[0].sets).toHaveLength(kind==='copy'?3:1);expect(useStore.getState().S.active.entries[0].sets[0].w).toBe(kind==='copy'?40:60)
})
