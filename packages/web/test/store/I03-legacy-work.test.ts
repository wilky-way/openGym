// @vitest-environment happy-dom
import {it,expect,vi,afterEach} from 'vitest'
import {initializeStore,useStore,DEF,clone,KEY} from '../../src/store/useStore'
import {initializeSyncEngine} from '../../src/store/sync-engine'
import {createBrowserPlatform} from '../../src/platform/browser'
import {configureClientIO} from '../../src/lib/client-io'
import {configureUI,useUI,restoreWork,WORK_KEY} from '../../src/store/useUI'
let dispose=()=>{}
afterEach(()=>{useUI.getState().stopWork();dispose();vi.useRealTimers()})
it('drops an identity-free guest hold after a replacement without marking its matching new row',()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-13T12:00:00Z'));localStorage.clear()
 const platform=createBrowserPlatform();configureClientIO(platform);initializeStore(platform)
 dispose=initializeSyncEngine({platform,api:async()=>({}),prompts:{toast:()=>{},askAddDeviceData:async()=>false}})
 configureUI({platform,deviceId:()=>undefined,notifyRestOver:async()=>{}})
 const doc={...clone(DEF),active:{id:'same-session',start:100,entries:[{id:'1001',sets:[{sec:45,done:false}]}]}}
 useStore.getState().replaceState(doc,false)
 const legacy=JSON.stringify({total:45,endsAt:Date.now()-1000,label:'Old hold',owner:{idx:0,i:0,id:'1001'}})
 useStore.getState().replaceState(doc,false);platform.kv.set(WORK_KEY,legacy)
 const before=platform.kv.get(KEY)
 expect(restoreWork()).toBe(false);expect(platform.kv.get(WORK_KEY)).toBeNull();expect(platform.kv.get(KEY)).toBe(before);expect(useStore.getState().S.active.entries[0].sets[0].done).toBe(false)
})
