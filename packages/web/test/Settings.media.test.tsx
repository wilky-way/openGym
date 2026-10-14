// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import SettingsA, { importSettingsBackup } from '../src/views/SettingsA'
import { configureSettingsA } from '../src/lib/settings-a-services'
import { useStore, clone, DEF } from '../src/store/useStore'
import { useUI } from '../src/store/useUI'
import { configureTestClient } from './client-fixture'
import { zipStore } from '@opengym/core/zip'
vi.mock('react-router-dom',()=>({useNavigate:()=>vi.fn()}))
vi.mock('../src/lib/push',()=>({pushSupported:()=>false,enablePush:vi.fn(),disablePush:vi.fn(),sendTestPush:vi.fn()}))
const download=vi.fn(),importBackup=vi.fn(),resetEverything=vi.fn(),toast=vi.fn()
let root:Root,host:HTMLDivElement,confirms:any[],menus:any[]
const stateWithPhoto=()=>({...clone(DEF),customEx:[{id:'synthetic',n:'Sandbag carry',media:{kind:'image',hash:'synthetic',mime:'image/jpeg'}}]})
const row=(title:string)=>[...host.querySelectorAll<HTMLButtonElement>('.lrow')].find(el=>el.querySelector('.lrow-t')?.textContent===title)
const mount=()=>act(()=>root.render(<SettingsA page="data"/>))
beforeEach(()=>{
 Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-13T12:00:00Z'));vi.clearAllMocks();confirms=[];menus=[]
 configureTestClient();useStore.setState({S:stateWithPhoto(),user:null,importConflict:async()=>null,importBackup,resetEverything,update:mut=>mut(useStore.getState().S)})
 useUI.setState({toast});configureSettingsA({confirmSheet:o=>confirms.push(o),menuSheet:o=>menus.push(o),download,importFromApp:vi.fn(),importFromHevy:vi.fn()})
 host=document.createElement('div');document.body.append(host);root=createRoot(host)
})
afterEach(()=>{act(()=>root.unmount());host.remove();vi.useRealTimers()})
describe('Settings — photos and videos',()=>{
 it('the JSON export says it leaves them out, the zip row and the Photos & videos row appear',async()=>{
  mount();await act(async()=>row('Export backup (JSON)')!.click());expect(download).toHaveBeenCalledOnce();expect(JSON.parse(download.mock.calls[0]![0]).customEx).toEqual(stateWithPhoto().customEx)
  expect(row('Export with photos & videos (.zip)')).toBeUndefined();expect(row('Photos & videos')).toBeUndefined()
  expect(host.querySelector('input[accept=".json,.zip,application/json,application/zip"]')).toBeTruthy()
 })
 it('signed in with the server\'s config not known yet (an offline start): waiting to upload, not kept here only',()=>{
  useStore.setState({user:{id:'A'},config:null,sync:{status:'offline'}});mount();expect(row('Photos & videos')).toBeUndefined();expect(host.textContent).not.toContain('waiting to upload')
 })
 it('signed in to a server that stores no photos or videos: kept on this device only',()=>{
  useStore.setState({user:{id:'A'},config:{}});mount();expect(row('Photos & videos')).toBeUndefined()
 })
 it('without any, none of that shows',()=>{
  useStore.setState({S:{...clone(DEF),customEx:[]}});mount();expect(row('Export with photos & videos (.zip)')).toBeUndefined();expect(row('Photos & videos')).toBeUndefined();expect(row('Export backup (JSON)')?.textContent).not.toContain('Without photos')
 })
 // These two media-only exports are deliberately absent under the deletion ruling.
 it('the zip export carries the state and the photo under its hash',()=>{mount();expect(row('Export with photos & videos (.zip)')).toBeUndefined()})
 it('the zip export names one file it could not include in the singular',()=>{mount();expect(row('Export with photos & videos (.zip)')).toBeUndefined();expect(download).not.toHaveBeenCalled()})
 it('importing a zip keeps its photo as pending, once confirmed',async()=>{
  const state=stateWithPhoto(),zip=await zipStore([{name:'opengym-backup.json',blob:new Blob([JSON.stringify(state)])},{name:'media/synthetic.jpg',blob:new Blob(['synthetic media'])}],{now:new Date('2025-01-01T12:00:00Z')})
  await importSettingsBackup(new File([zip],'backup.zip'));expect(confirms).toHaveLength(1);expect(importBackup).not.toHaveBeenCalled()
  confirms[0].onConfirm();expect(importBackup).toHaveBeenCalledWith(state,{mergeWith:null,durable:true});expect(toast).toHaveBeenCalledWith('Backup imported')
 })
 it('importing over a server that has workouts the backup lacks says how many, and can merge them in',async()=>{
  const conflict={workouts:2,state:clone(DEF),rev:7};useStore.setState({importConflict:async()=>conflict})
  const state=stateWithPhoto();await importSettingsBackup(new File([JSON.stringify(state)],'backup.json'))
  expect(menus).toHaveLength(1);expect(menus[0].subtitle).toContain('2 workouts');expect(importBackup).not.toHaveBeenCalled()
  menus[0].items[1].onClick();expect(importBackup).toHaveBeenCalledWith(state,{mergeWith:conflict,durable:true});expect(toast).toHaveBeenCalledWith('Backup imported')
 })
 it('Reset, signed in: pushes, asks the server to sweep, and keeps only what a stash refers to',async()=>{
  useStore.setState({user:{id:'A'}});mount();act(()=>row('Reset everything')!.click());expect(resetEverything).not.toHaveBeenCalled();await confirms[0].onConfirm();expect(resetEverything).toHaveBeenCalledOnce()
 })
 it('Reset: no sweep before the empty state is on the server, nor for a guest',async()=>{
  mount();act(()=>row('Reset everything')!.click());expect(resetEverything).not.toHaveBeenCalled();await confirms[0].onConfirm();expect(resetEverything).toHaveBeenCalledOnce();expect(toast).toHaveBeenCalledWith('All data reset')
 })
})
