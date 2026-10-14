import type { ComponentProps, ComponentType } from 'react'
import type { Exercise } from '@opengym/core/exercises'
import type { StoreDocument } from '../store/useStore'

/** The shell binds statistics/library views and shared sheet/row services at boot. */
export interface ViewServices {
  bwSheet(): unknown
  goalSheet(): unknown
  calendarSheet(iso: string): unknown
  dayOverrideSheet(iso: string): unknown
  workoutDetailSheet(workout: StoreDocument): unknown
  exerciseHistorySheet(id: string): unknown
  weighInsSheet(): unknown
  exerciseDetailSheet(exercise: Exercise): unknown
  addToRoutineSheet(exercise: Exercise): unknown
  customExSheet(id: string | null, onSave: (exercise: Exercise) => unknown, name: string): unknown
  exercisePicker(onPick: (exercise: Exercise) => void, options: { title: string }): { close(): void }
  confirmSheet(options: { title: string; message: string; confirmText: string; danger: boolean; onConfirm(): void }): unknown
  logPastWorkoutSheet(): unknown
  bwDeltaColor(delta: number, weight: number): string
  WorkoutRow: ComponentType<{ w: StoreDocument; onClick(): void }>
  DayNoteRow: ComponentType<{ iso: string; note: StoreDocument }>
}
let services: ViewServices | undefined
export function bindViewServices(next: ViewServices): void { services = next }
function current(): ViewServices {
  if (!services) throw new Error('view services must be bound by the shell before rendering stats/library views')
  return services
}
export const bwSheet = () => current().bwSheet()
export const goalSheet = () => current().goalSheet()
export const calendarSheet = (iso: string) => current().calendarSheet(iso)
export const dayOverrideSheet = (iso: string) => current().dayOverrideSheet(iso)
export const workoutDetailSheet = (w: StoreDocument) => current().workoutDetailSheet(w)
export const exerciseHistorySheet = (id: string) => current().exerciseHistorySheet(id)
export const weighInsSheet = () => current().weighInsSheet()
export const exerciseDetailSheet = (ex: Exercise) => current().exerciseDetailSheet(ex)
export const addToRoutineSheet = (ex: Exercise) => current().addToRoutineSheet(ex)
export const customExSheet = (id: string | null, onSave: (ex: Exercise) => unknown, name: string) => current().customExSheet(id, onSave, name)
export const exercisePicker = (onPick: (ex: Exercise) => void, options: { title: string }) => current().exercisePicker(onPick, options)
export const confirmSheet = (options: Parameters<ViewServices['confirmSheet']>[0]) => current().confirmSheet(options)
export const logPastWorkoutSheet = () => current().logPastWorkoutSheet()
export const bwDeltaColor = (delta: number, weight: number) => current().bwDeltaColor(delta, weight)
export const WorkoutRow = (props: ComponentProps<ViewServices['WorkoutRow']>) => {
  const Row = current().WorkoutRow
  return <Row {...props} />
}
export const DayNoteRow = (props: ComponentProps<ViewServices['DayNoteRow']>) => {
  const Row = current().DayNoteRow
  return <Row {...props} />
}
