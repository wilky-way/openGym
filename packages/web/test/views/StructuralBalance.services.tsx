import { bindViewServices, type ViewServices } from '../../src/views/view-services'
import { useUI } from '../../src/store/useUI'
import type { Exercise } from '@opengym/core/exercises'
/** Controlled picker UI belongs to sheets; the view test drives its callback. */
export function bindTestViewServices() {
  const services: ViewServices = {
    bwSheet() { return useUI.getState().openSheet(() => null) }, goalSheet() {}, calendarSheet() {}, dayOverrideSheet() {}, workoutDetailSheet() {},
    exerciseHistorySheet() {}, weighInsSheet() {}, exerciseDetailSheet() {}, addToRoutineSheet() {},
    customExSheet() {}, confirmSheet() {}, logPastWorkoutSheet() {}, bwDeltaColor: () => 'inherit',
    WorkoutRow: () => null, DayNoteRow: () => null,
    exercisePicker(onPick, { title }) {
      const Picker = (_: { title: string; onPick(ex: Exercise): void }) => null
      return useUI.getState().openSheet(() => <Picker title={title} onPick={onPick} />)
    },
  }
  bindViewServices(services)
}
