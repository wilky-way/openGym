import React from 'react'
import type { Platform } from '@opengym/contract/platform/adapters'
export let workoutSheetPlatform: Platform
import { beforeEach, afterEach, vi } from 'vitest'
import { configureUx, createBrowserUx } from '../src/platform/ux'
import { createBrowserPlatform } from '../src/platform/browser'
import { configureUI, useUI } from '../src/store/useUI'
import { clone, DEF, initializeStore, useStore } from '../src/store/useStore'
import { configureClientIO } from '../src/lib/client-io'
import { initializeSyncEngine } from '../src/store/sync-engine'
import { configureWorkoutSheets } from '../src/sheets-d'
let dispose: (() => void) | undefined
const originalToast = useUI.getState().toast
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  configureUx(createBrowserUx())
  localStorage.clear()
  const platform = createBrowserPlatform(); workoutSheetPlatform = platform
  configureClientIO(platform)
  initializeStore(platform)
  configureUI({platform, deviceId: () => 'synthetic', notifyRestOver: async () => {}})
  dispose = initializeSyncEngine({platform, api: vi.fn().mockResolvedValue({rev: 1}), prompts: {askAddDeviceData: async () => false, toast: m => useUI.getState().toast(m)}})
  useStore.setState({S: {...clone(DEF), sound: false}, user: null})
  useUI.setState({sheets: [], toast: originalToast, toastMsg: ''})
  vi.useFakeTimers({toFake: ['Date']}); vi.setSystemTime(new Date('2026-10-13T20:00:00Z'))
  configureWorkoutSheets({
    confirmSheet: opts => { useUI.getState().openSheet(close => <><h3>{opts.title}</h3><p>{opts.message}</p><button className={opts.danger ? 'danger' : undefined} onClick={() => {close(); opts.onConfirm?.()}}>{opts.confirmText || 'Confirm'}</button><button onClick={() => {close();opts.onCancel?.()}}>{opts.cancelText || 'Cancel'}</button></>, {kind:'center',locked:opts.locked}) },
    menuSheet: opts => { useUI.getState().openSheet(close => <><h3>{opts.title}</h3><p>{opts.subtitle}</p>{opts.sections.flatMap(s => s.items.filter(Boolean)).map((item: any, i) => <div key={i} className={'menu-item '+(item.danger?'danger':'')} onClick={() => {close();item.onClick?.()}}><span className="tt">{item.label}</span></div>)}</>) },
    bwSheet: opts => { useUI.getState().openSheet(close => <button onClick={() => {close();opts.onDone(null)}}>Start without weighing in</button>, {locked: true}) },
  })
})
afterEach(() => {dispose?.();useUI.getState().stopWork();useUI.getState().stopRest();vi.useRealTimers()})
