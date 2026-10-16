import React from 'react'
import { captureProgrammeTarget, programmeIdentity, type ProgrammeTarget } from './programme-target'
export { updateProgramme, type ProgrammeTarget } from './programme-target'
import { useStore } from '../store/useStore'
import type { Platform } from '@opengym/contract/platform/adapters'
import { useUI } from '../store/useUI'
import type { Workout } from '@opengym/contract/domain/state-doc'
/** W20/W23 bind these to the W11/W13/W14 sheet modules after integration. */
export interface ProgrammeUiServices {
  platform: Platform
  initialProgramId?(): string | null
  startFlow(ids: string[]): unknown
  confirmSheet(options: {title: string; message?: string; confirmText?: string; onConfirm(): unknown}): unknown
  workoutDetailSheet(workout: Workout): unknown
  dayOverrideSheet(date: string): unknown
}
let services: ProgrammeUiServices | undefined
export function configureProgrammeUi(next: ProgrammeUiServices): void { services = next }
export function programmeUi(): ProgrammeUiServices {
  if (!services) throw new Error('Programme UI services are not configured.')
  return services
}
export const startFlow = (ids: string[]) => programmeUi().startFlow(ids)
export const programmeTarget = (owner = programmeOwner(), target?: ProgrammeTarget) => captureProgrammeTarget(programmeUi().platform, useStore.getState, owner, target)
export const confirmSheet = (options: Omit<Parameters<ProgrammeUiServices['confirmSheet']>[0], 'onConfirm'> & { onConfirm(valid: ProgrammeTarget): unknown }, target?: ProgrammeTarget, opened = programmeTarget()) => {
  const targetValid = programmeTarget(programmeOwner(), target)
  const valid: ProgrammeTarget = draft => opened(draft) && targetValid(draft)
  return programmeUi().confirmSheet({...options,onConfirm:()=>{
    if (valid()) return options.onConfirm(valid)
  }})
}
export const workoutDetailSheet = (workout: Workout) => programmeUi().workoutDetailSheet(workout)
export const dayOverrideSheet = (date: string) => programmeUi().dayOverrideSheet(date)

export function setProgrammePreference(key: string, value: string): void {
  try { programmeUi().platform.kv.set(key,value) }
  catch { useUI.getState().toast('Could not save this preference. The previous value was kept.') }
}

/** Captured programme data may only render or dispatch within its original account/server. */
export function programmeOwner(): string {
  return programmeIdentity(programmeUi().platform)
}
export function ProgrammeSheet({owner,close,render}: {owner:string;close():void;render():React.ReactNode}): React.ReactNode {
  useStore(s=>s.user)
  useStore(s=>s.S)
  return owner === programmeOwner() ? render() : React.createElement(React.Fragment,null,
    React.createElement('h3',null,'Account changed'),React.createElement('button',{onClick:close},'Close'))
}
