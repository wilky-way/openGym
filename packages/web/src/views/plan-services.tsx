import type { ComponentType } from 'react'
import { confirmSheet, menuSheet, bwSheet } from '../sheets-a'
import { configureWorkoutSheets, repeatWorkout, logPastWorkoutSheet } from '../sheets-d'
import { configurePlanHistorySheets } from '../sheets-plan-history'
import { exerciseHistorySheet } from '../sheets/sheets-exercises'
/** The shell binds programme panels when composing the application. */
export interface PlanViewServices {
  ProgrammeCalendar: ComponentType
  Programs: ComponentType
  ProgrammeRoutines: ComponentType<{ S: any; nav: (path: string) => void }>
  programmeSkipSheet(routine: any): unknown
}
const missing = (): never => { throw new Error('Programme plan services are not configured') }
let services: PlanViewServices = {
  ProgrammeCalendar: () => null, Programs: missing, ProgrammeRoutines: () => null,
  programmeSkipSheet: missing,
}
export function configurePlanSheetBindings(version: string): void {
  configureWorkoutSheets({ confirmSheet, menuSheet, bwSheet })
  configurePlanHistorySheets({ exerciseHistorySheet, logPastWorkoutSheet, repeatWorkout, version })
}
export function configurePlanViews(next: PlanViewServices, version = '0.0.0'): void {
  services = next
  configurePlanSheetBindings(version)
}
export const ProgrammeCalendar = () => <services.ProgrammeCalendar />
export const Programs = () => <services.Programs />
export const ProgrammeRoutines = (props: { S: any; nav: (path: string) => void }) => <services.ProgrammeRoutines {...props} />
export const programmeSkipSheet = (routine: any) => services.programmeSkipSheet(routine)
