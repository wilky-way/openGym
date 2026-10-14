import React from 'react'
import { beforeEach, afterEach, vi } from 'vitest'
import { createBrowserPlatform } from '../src/platform/browser'
import { configureProgrammeUi } from '../src/lib/programme-ui-services'
import { initializeSyncEngine } from '../src/store/sync-engine'
import { initializePublicActions } from '../src/store/public-actions'
import { useUI, configureUI } from '../src/store/useUI'
import { useStore } from '../src/store/useStore'
import { configureUx, createBrowserUx } from '../src/platform/ux'
import { setNav } from '../src/lib/nav'
export const workoutDetailSheet = vi.fn()
export const dayOverrideSheet = vi.fn()
export const startFlow = vi.fn()
export const navigate = vi.fn()
export let testPlatform: ReturnType<typeof createBrowserPlatform>
let dispose: (() => void) | undefined
export function setupProgrammeUi() {
  dispose?.()
  testPlatform = createBrowserPlatform()
  configureUx(createBrowserUx())
  configureUI({platform:testPlatform,deviceId:()=>undefined,notifyRestOver:async()=>{}})
  configureProgrammeUi({platform:testPlatform,startFlow,workoutDetailSheet,dayOverrideSheet,
    confirmSheet({title,message,confirmText,onConfirm}) {
      return useUI.getState().openSheet(close=><><h3>{title}</h3><p>{message}</p><button onClick={()=>{close();onConfirm()}}>{confirmText || 'Confirm'}</button><button onClick={close}>Cancel</button></>)
    }})
  setNav(navigate)
  dispose = initializeSyncEngine({platform:testPlatform,api:vi.fn().mockResolvedValue({rev:1}),prompts:{askAddDeviceData:async()=>false,toast:message=>useUI.getState().toast(message)}})
  initializePublicActions({platform:testPlatform,toast:message=>useUI.getState().toast(message)})
}
beforeEach(()=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-12T12:00:00'));localStorage.clear();setupProgrammeUi();vi.clearAllMocks()})
afterEach(()=>{dispose?.();dispose=undefined;vi.useRealTimers()})
