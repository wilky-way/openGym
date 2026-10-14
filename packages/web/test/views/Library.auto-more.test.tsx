// @vitest-environment happy-dom
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import Library from '../../src/views/Library'
import { DEF, useStore } from '../../src/store/useStore'
import { BODYPARTS, EXDB } from '@opengym/core/exercises'
import { configureUx, createBrowserUx } from '../../src/platform/ux'
const observers: FakeObserver[]=[]
class FakeObserver {
  els=new Set<Element>()
  constructor(public cb: IntersectionObserverCallback) {observers.push(this)}
  observe(el: Element) {this.els.add(el)}
  disconnect() {this.els.clear()}
}
const comeIntoView=()=>act(()=>observers.forEach(o=>o.els.size&&o.cb([...o.els].map(target=>({target,isIntersecting:true}) as IntersectionObserverEntry),{} as IntersectionObserver)))
let host: HTMLDivElement,root: Root
const rows=()=>host.querySelectorAll('.list > .item').length-1
const showMore=()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='Show more')
beforeEach(()=>{
  globalThis.IS_REACT_ACT_ENVIRONMENT=true;observers.length=0
  useStore.setState({S:structuredClone(DEF)})
  configureUx({...createBrowserUx(),observeIntersection:cb=>new FakeObserver(cb) as unknown as IntersectionObserver})
  host=document.createElement('div');document.body.append(host);root=createRoot(host)
})
afterEach(()=>{act(()=>root.unmount());host.remove()})
const render=()=>act(()=>root.render(<Library/>))
describe('lists load their next page as you scroll',()=>{
  it('Library: the button coming into view loads the next 40',()=>{
    render();expect(rows()).toBe(40);comeIntoView();expect(rows()).toBe(80);comeIntoView();expect(rows()).toBe(120)
  })
  it('stops watching once everything is shown',()=>{
    const count=(bp:string)=>EXDB.filter(e=>e.bp===bp).length
    const bp=BODYPARTS.filter(b=>count(b)>40).sort((a,b)=>count(a)-count(b))[0]!
    render();act(()=>[...host.querySelectorAll<HTMLButtonElement>('.chips .chip')].find(c=>c.textContent===bp)!.click())
    for(let i=0;i<10&&showMore();i++)comeIntoView()
    expect(rows()).toBe(count(bp));expect(showMore()).toBeUndefined();expect(observers.every(o=>o.els.size===0)).toBe(true)
  })
  it('without IntersectionObserver the button still loads more, and nothing breaks',()=>{
    configureUx({...createBrowserUx(),observeIntersection:()=>null});render();expect(rows()).toBe(40);act(()=>showMore()!.click());expect(rows()).toBe(80)
  })
})
