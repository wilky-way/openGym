// Isolated component fixture. Full ActiveWorkout tests cover composition and timers.
import React from 'react'
import { useStore } from '../src/store/useStore'
import { captureWorkoutTarget, workoutTargetUpdate, workoutCallbackTarget, type WorkoutTarget } from '../src/views/workout-target'
import { ExerciseBlock, StartChooser, deleteActiveSet, copyActiveSet } from '../src/views/Workout'
import FocusView from '../src/views/FocusView'
import { toggleSide } from '@opengym/core/workout-model'
import { setEntryNoProg } from '@opengym/core/session-noprog'
export default function WorkoutBlocks({callbacks = {}}: {callbacks?: any} = {}) {
  const S = useStore(s => s.S)
  if (!S.active) return <StartChooser />
  const owner = captureWorkoutTarget()
  const props = (idx: number) => ({ entryIdx: idx, dense: (S.active.workoutView || S.workoutView) === 'compact', editing: !!S.active.editingWorkoutId, unit: [idx], pointerEpoch: S.active.id,
    onField(i: number, f: string, value: unknown, target: WorkoutTarget = owner) { workoutTargetUpdate(target, s => { if(value==null)delete s.active.entries[idx].sets[i][f];else s.active.entries[idx].sets[i][f] = value }) },
    onMutateSet(i: number, fn: (row: any) => any, target: WorkoutTarget = owner) { workoutTargetUpdate(target, s => { s.active.entries[idx].sets[i] = fn(s.active.entries[idx].sets[i]) }) },
    onToggle(i: number, ...args: unknown[]) { const target = workoutCallbackTarget(args, owner); workoutTargetUpdate(target, s => { s.active.entries[idx].sets[i].done = !s.active.entries[idx].sets[i].done }) },
    onToggleSide(i: number, side: string, ...args: unknown[]) { const target = workoutCallbackTarget(args, owner); workoutTargetUpdate(target, s => { s.active.entries[idx].sets[i] = toggleSide(s.active.entries[idx].sets[i], side as 'L' | 'R') }) },
    onRemoveSetAt(i: number, target: WorkoutTarget = owner) { deleteActiveSet(idx, i, { target, editing: !!S.active.editingWorkoutId }) },
    onCopySetAt(i: number, target: WorkoutTarget = owner) { copyActiveSet(idx, i, target) },
    onNoProg: S.routines.find((r:any)=>r.id===S.active.entries[idx].rid)?.excludeFromProgression ? undefined : (value: boolean, target: WorkoutTarget = owner) => { workoutTargetUpdate(target, s => { setEntryNoProg(s.active, idx, value) }) },
    onSelectEntry(value: number, target: WorkoutTarget = owner) { workoutTargetUpdate(target, s => { s.active.cur = value }) },
    onAdvanceUnit() {}, onAddSet() {}, onAddWarmup() {}, onRemoveSet() {}, onStartTimed() {}, onProgressionSettings() {}, busy: false, ...callbacks,
  })
  return S.active.workoutView === 'focus' ? <FocusView {...props(S.active.cur)} /> : <>{S.active.entries.map((entry: any, idx: number) => (S.active.workoutView === 'cards' && idx !== S.active.cur) ? null : <div key={idx} data-exidx={idx}><ExerciseBlock {...props(idx)} /></div>)}</>
}
