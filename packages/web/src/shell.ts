import type { Platform } from '@opengym/contract/platform/adapters'
import { configureClientIO } from './lib/client-io'
import { api, refreshApiCapabilities } from './lib/api'
import { initializeStore, useStore } from './store/useStore'
import { initializeSyncEngine } from './store/sync-engine'
import { initializePublicActions } from './store/public-actions'
import { materializeTmSeed } from '@opengym/core/materialize-tm-seed'
import { initializeUI, useUI } from './store/useUI'
import { bindUI } from './components/ui'
import { browserAuthLock, browserSyncLock } from './platform/auth-lock'
import { configurePlanHistoryPrint, createBrowserPrintHTML, saveBlob } from './platform/plan-history'
import { browserRestNotification } from './platform/timer-alerts'
import { deviceId } from './lib/push'
import { nav } from './lib/nav'
import * as sheets from './sheets'
import { configurePlanViews } from './views/plan-services'
import { bindViewServices } from './views/view-services'
import { configureProgrammeUi } from './lib/programme-ui-services'
import { configureSettingsA } from './views/SettingsA'
import { configureSettingsB } from './views/SettingsB'
import ProgrammeCalendar from './components/ProgrammeCalendar'
import Programs, { ProgrammeRoutines } from './views/Programs'
import { programmeSkipSheet } from './components/ProgrammeSession'
import { configureExerciseSheets } from './sheets/sheets-exercises'
import { sameSettingsTarget } from './lib/settings-target'
import { configureAuthUiServices } from './lib/auth-ui-services'
import { appVersion } from './lib/build'

/** Boot is the sole composition root. Persistence is installed before timer restoration. */
export function configureShell(platform: Platform) {
 configureClientIO(platform)
 refreshApiCapabilities()
 initializeStore(platform)
 const sync = initializeSyncEngine({platform,api,acquireAuthLock:browserAuthLock,acquireSyncLock:browserSyncLock,
  prompts:{askAddDeviceData:sheets.askAddDeviceData,toast:message=>useUI.getState().toast(message),stopTimers:()=>{useUI.getState().stopRest();useUI.getState().abandonWork()}}})
 initializePublicActions({platform,toast:message=>useUI.getState().toast(message),materializeTmSeed})
 initializeUI({platform,deviceId,notifyRestOver:browserRestNotification(platform)})
 bindUI(useUI)
 configurePlanHistoryPrint(createBrowserPrintHTML())
 sheets.configureWorkoutSheets({confirmSheet:sheets.confirmSheet,menuSheet:sheets.menuSheet,bwSheet:sheets.bwSheet})
 configureExerciseSheets({confirmSheet:sheets.confirmSheet})
 configurePlanViews({ProgrammeCalendar,Programs,ProgrammeRoutines,programmeSkipSheet},appVersion())
 configureProgrammeUi({platform,startFlow:sheets.startFlow,confirmSheet:sheets.confirmSheet,workoutDetailSheet:sheets.workoutDetailSheet,dayOverrideSheet:sheets.dayOverrideSheet})
 bindViewServices({...sheets, customExSheet:(id,onSave,name)=>sheets.customExSheet(id?useStore.getState().S.customEx?.find((ex: any)=>ex.id===id):null,ex=>{if(ex)onSave(ex)},name)})
 configureAuthUiServices({askAddDeviceData:sheets.askAddDeviceData,menuSheet:sheets.menuSheet,download:(text,name)=>saveBlob(new Blob([text],{type:'application/json'}),name)})
 configureSettingsA({confirmSheet:sheets.confirmSheet,menuSheet:sheets.menuSheet,
  download:(text,name)=>saveBlob(new Blob([text],{type:'application/json'}),name),
  importFromApp:(file,target)=>sheets.importFromApp(file,undefined,draft=>sameSettingsTarget(target,draft??useStore.getState().S)),
  importFromHevy:target=>sheets.importFromHevy(draft=>sameSettingsTarget(target,draft??useStore.getState().S))})
 configureSettingsB({navigate:nav,starterPlanSheet:sheets.starterPlanSheet,confirmSheet:sheets.confirmSheet,menuSheet:sheets.menuSheet,
  equipmentProfileSheet:profile=>sheets.equipmentProfileSheet(profile??undefined),plateInventorySheet:sheets.plateInventorySheet,dumbbellInventorySheet:sheets.dumbbellInventorySheet})
 return sync
}
