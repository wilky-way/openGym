import './FocusView.css'
import { captureWorkoutTarget, captureWorkoutRow, workoutTargetCallback, workoutIdentityKey, staleWorkoutToast } from './workout-target'
import { createExerciseIndex } from '@opengym/core/exercises'
const currentIndex = () => createExerciseIndex(useStore.getState().S.customEx)
import { programmeInstructions } from '@opengym/core/programme-instructions'
import { effortOf as programmeEffortOf } from '@opengym/core/history'
import { targetLabel, programmeNote, effortRangeLabel } from '@opengym/core/programme-targets'
import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import { exOr } from '@opengym/core/exercises'
import { clampIncline, hasIncline, inclineFits, INCLINE_MAX, INCLINE_STEP } from '@opengym/core/incline'
import { exerciseNameFor, t } from '../lib/i18n'
import { fmtDate, fmtNum, fmtPlate } from '@opengym/core/format'
import { EFFORT, effortOf, modeOf } from '@opengym/core/history'
import { lastEntryFor, pinnedNoteFor, setsRepsOf } from '@opengym/core/history'
import { effortColor, rirOf } from '@opengym/core/effort'
import { progressionGuidance } from '@opengym/core/progression-copy'
import {
  addCluster, addDrop, addSideCluster, addSideDrop, clustersOf, dropsOf,
  isFailureSet, isSideSet, isWarmupRow, nextBurstReps, toggleFailure, nextDropWeight, setClusterAt,
  setDropAt, setSideClusterAt, setSideDropAt, setSideField,
} from '@opengym/core/workout-model'
import { weightIncrement, stepWeight } from '@opengym/core/progression'
import { speedUnitOf, toSpeed, fromSpeed } from '@opengym/core/speed'
import { effortPickerSheet, exerciseDetailSheet, exerciseHistorySheet, exerciseNoteSheet, menuSheet, barWeightSheet } from '../sheets'
import { baseWeightFor, inventoryFor, loadKindFor, rowLoad } from '@opengym/core/plates'
import { ownedWeightsFor, stepOwned } from '@opengym/core/dumbbells'
import Icon from '../components/Icon'
import { Button, Stepper } from '../components/ui'


const firstIncomplete = (entry: any ) : any => {
  const index = entry.sets.findIndex((set: any ) : any => !set.done)
  return index < 0 ? Math.max(0, entry.sets.length - 1) : index
}

const clampSet = (entry: any, index: any) : any => Math.min(Math.max(index, 0), Math.max(0, entry.sets.length - 1))

const supersetSequence = (entries: any, unit: any) : any => {
  const rounds = Math.max(0, ...unit.map((index: any ) : any => entries[index]?.sets?.length || 0))
  return Array.from({ length: rounds }, (_: any, setIdx: any) : any =>
    unit.filter((entryIdx: any ) : any => entries[entryIdx]?.sets?.[setIdx]).map((entryIdx: any ) : any => ({ entryIdx, setIdx })),
  ).flat()
}

const toggleWarmup = (row: any ) : any => {
  const next = { ...row }
  if (isWarmupRow(next)) {
    delete next.phase
    delete next.warmup
  } else {
    next.phase = 'warmup'
    // A warm-up is never taken to failure (isFailureSet ignores it anyway); dropping the mark
    // keeps it from coming back if the row is made a work set again.
    delete next.failure
  }
  return next
}

const addDropTo = (row: any, target: any) : any => {
  if (isSideSet(row)) return addSideDrop(row, target?.intensifier?.pct, undefined)
  const drops = dropsOf(row).length ? dropsOf(row) : row.drops || []
  const base = drops.at(-1)?.w ?? row.w ?? 0
  return addDrop(row, { w: nextDropWeight(base, target?.intensifier?.pct, undefined), r: row.r || 0 })
}

const addBurstTo = (row: any, restSec: any) : any => {
  if (isSideSet(row)) return addSideCluster(row, restSec)
  const clusters = clustersOf(row).length ? clustersOf(row) : row.clusters || []
  const reps = nextBurstReps(clusters.at(-1)?.r ?? row.r ?? 0)
  return { ...addCluster(row, { r: reps, restSec }), r: (row.r || 0) + reps }
}

function Prescription({ entry, setIdx, unit, fallbackRest, kind, children }: any) : any {
  const target = entry.target || {}
  const reps = target.repsMin > 0 ? `${target.repsMin}–${target.reps}` : target.reps > 0 ? String(target.reps) : ''
  const load = target.weight > 0
    ? `@ ${fmtNum(target.weight)}${target.weightMax > target.weight ? `–${fmtNum(target.weightMax)}` : ''} ${unit}`
    : ''
  const rpe = target.rpeMin > 0
    ? effortRangeLabel('rpe',target.rpeMin,target.rpeMax,kind)
    : ''
  const rest = target.restSec > 0 ? `Rest ${target.restSec}s` : fallbackRest > 0 ? `Rest ${fallbackRest}s` : ''
  const badges = [reps && `${reps} Reps`, load, rpe, rest, target.tempo].filter(Boolean)

  return <div className="focus-prescription">
    <span className="focus-badge focus-progress">{setIdx + 1}/{entry.sets.length}</span>
    {badges.map((label: any ) : any => <span className="focus-badge" key={label}>{label}</span>)}
    {children}
  </div>
}

function PlanBadge({ entry, mode }: any) : any {
  const planned = entry.planned && mode !== 'cardio' ? entry.planned : null
  if (!planned) return null
  const today = entry.target || {}
  const todaySets = today.sets || planned.sets || 1
  const inPlan = mode === 'time'
    ? today.sec == null || today.sec === planned.sec
    : today.reps == null || (planned.repsMin > 0 ? today.reps >= planned.repsMin && today.reps <= planned.reps : today.reps === planned.reps)
  if (todaySets === (planned.sets || 1) && inPlan)
    return entry.carried ? <span className="focus-badge plan">{t('reps from your last session')}</span> : null
  return <span className="focus-badge plan">{t('Plan: {0}', setsRepsOf({ ...planned, mode }, currentIndex()))}</span>
}

function PlateBadge({ S, entry, set }: any) : any {
  if (modeOf({ ...(entry.target || {}), id: entry.id }, currentIndex()) !== 'reps') return null
  const load = rowLoad(loadKindFor(S, { ...(entry.target || {}), id: entry.id }, currentIndex()), set.w, baseWeightFor(S, entry.id, currentIndex()), inventoryFor(S))
  if (!load) return null
  const stack = load.plates.map(fmtPlate).join(' + ')
  const text = load.barOnly ? t('Bar only')
    : load.kind === 'pairs' ? t('{0} per side', stack || '–') : t('Load {0}', stack || '–')
  return <span className="focus-badge plate"><Icon name="plate" />{text}{load.missing > 0 && <> · <span className="short">{t('{0} short', fmtPlate(load.missing) + ' ' + S.unit)}</span></>}</span>
}

export default function FocusView({
  entryIdx, unit, onToggle, onToggleSide, onField, onMutateSet, onStartTimed,
  onAddWarmup, onRemoveSetAt, onProgressionSettings, onSwap, onRemoveExercise,
  onNoProg, busy, onSelectEntry, onAdvanceUnit, onPairPrev, onPairNext, onUnpair, pointerEpoch,
}: any) : any {
  const S = useStore((state: any ) : any => state.S)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const owner = captureWorkoutTarget(() => mounted.current)
  let actionTarget: import('./workout-target').WorkoutTarget | undefined
  const scopedCallback = (valid: import('./workout-target').WorkoutTarget, callback: (...args: any[]) => any) => {
    const combined: import('./workout-target').WorkoutTarget = S => owner(S) && valid(S)
    return workoutTargetCallback(combined, (...args: any[]) => {
      actionTarget = combined
      try { return callback(...args) } finally { actionTarget = undefined }
    })
  }
  const callbacks = { onToggle, onToggleSide, onField, onMutateSet, onStartTimed, onAddWarmup, onRemoveSetAt, onProgressionSettings, onSwap, onRemoveExercise, onNoProg, onSelectEntry, onAdvanceUnit, onPairPrev, onPairNext, onUnpair }
  for (const key of Object.keys(callbacks) as (keyof typeof callbacks)[]) if (callbacks[key]) { const cb = callbacks[key]; callbacks[key] = (...args: any[]) => workoutTargetCallback(actionTarget ?? owner, cb)(...args) }
  ;({ onToggle, onToggleSide, onField, onMutateSet, onStartTimed, onAddWarmup, onRemoveSetAt, onProgressionSettings, onSwap, onRemoveExercise, onNoProg, onSelectEntry, onAdvanceUnit, onPairPrev, onPairNext, onUnpair } = callbacks)
  const speedUnit = speedUnitOf(S)
  const entry = S.active.entries[entryIdx]
  const ex = exOr(entry.id, currentIndex())
  const last = lastEntryFor(S, entry.id)
  const pinnedNote = pinnedNoteFor(S, entry.id)
  const guidance = progressionGuidance(entry.plan)
  // Exercise operations use indexes, so their local-only epoch discards stale pointers instead
  // of letting a moved, removed, or newly inserted entry inherit one.
  const [pointerState, setPointerState] = useState(() : any => ({ epoch: pointerEpoch, pointers: new Map() }))
  const pointers = pointerState.epoch === pointerEpoch ? pointerState.pointers : new Map()
  const stored = pointers.get(entryIdx)
  const setIdx = clampSet(entry, Number.isInteger(stored) ? stored : firstIncomplete(entry))
  const set = entry.sets[setIdx]
  const holdProps = {
    holdKey: JSON.stringify([workoutIdentityKey(), entryIdx, setIdx]),
    captureHold(change: (value: number) => void) {
      // Keep the press-start owner. Only our own successful synchronous step advances the row snapshot.
      const pressedOwner = captureWorkoutTarget()
      let row = captureWorkoutRow(entryIdx, setIdx)
      const valid: import('./workout-target').WorkoutTarget = S => pressedOwner(S) && row(S)
      return { valid, cancel: staleWorkoutToast, set(value: number) {
        const applied: unknown = scopedCallback(valid, change)(value)
        if (applied === false) return false
        row = captureWorkoutRow(entryIdx, setIdx)
        return true
      } }
    },
  }
  const firstOpenSet = firstIncomplete(entry)
  const locked = !set.done && setIdx > firstOpenSet
  const readOnly = set.done || locked
  const mode = modeOf({ ...(entry.target || {}), id: entry.id }, currentIndex())
  const effort = effortOf(S)
  const effortField = EFFORT[effort as 'rir' | 'rpe']?.f
  const effortValue = effortField ? set[effortField] ?? null : null
  const effortTint = effortValue == null ? null : effortColor(rirOf({ [effortField]: effortValue }))
  const loadStep = weightIncrement({ ...(entry.target || {}), id: entry.id }, S.unit, currentIndex())
  // Bell to bell over the dumbbells you own, when the profile lists them (issue #376).
  const owned = mode === 'reps' ? ownedWeightsFor(S, { ...(entry.target || {}), id: entry.id }, currentIndex()) : null
  const stepLoad = owned ? (v: any, _step: any, dir: any) : any => stepOwned(owned, v, dir) : stepWeight
  const selectSet = (index: any ) : any => setPointerState((current: any ) : any => {
    const next = new Map(current.epoch === pointerEpoch ? current.pointers : [])
    next.set(entryIdx, clampSet(entry, index))
    return { epoch: pointerEpoch, pointers: next }
  })
  const sequence = unit.length > 1 ? supersetSequence(S.active.entries, unit) : []
  const sequenceIdx = sequence.findIndex((item: any ) : any => item.entryIdx === entryIdx && item.setIdx === setIdx)
  const clearPointer = (index: any ) : any => setPointerState((current: any ) : any => {
    if (current.epoch !== pointerEpoch) return { epoch: pointerEpoch, pointers: new Map() }
    if (!current.pointers.has(index)) return current
    const next = new Map(current.pointers)
    next.delete(index)
    return { epoch: pointerEpoch, pointers: next }
  })
  const selectSequence = (index: any ) : any => {
    const item = sequence[index]
    if (!item) return
    setPointerState((current: any ) : any => {
      const next = new Map(current.epoch === pointerEpoch ? current.pointers : [])
      next.set(item.entryIdx, item.setIdx)
      return { epoch: pointerEpoch, pointers: next }
    })
    onSelectEntry(item.entryIdx)
  }
  const drops = dropsOf(set).length ? dropsOf(set) : Array.isArray(set.drops) ? set.drops : []
  const bursts = clustersOf(set).length ? clustersOf(set) : Array.isArray(set.clusters) ? set.clusters : []

  const sideFields = (side: any ) : any => {
    const sideSet = set.sides[side]
    const change = (field: any, value: any) : any => onMutateSet(setIdx, (row: any ) : any => setSideField(row, side, field, value))
    const sideDrops = dropsOf(sideSet).length ? dropsOf(sideSet) : Array.isArray(sideSet.drops) ? sideSet.drops : []
    const sideBursts = clustersOf(sideSet).length ? clustersOf(sideSet) : Array.isArray(sideSet.clusters) ? sideSet.clusters : []
    return <section className="focus-side" data-focus-side={side}>
      <div className="focus-side-header">
        <strong>{side === 'L' ? t('Left') : t('Right')}</strong>
        <button aria-label={side === 'L' ? t('Complete left side') : t('Complete right side')}
          className={'focus-side-check' + (sideSet.done ? ' done' : '')}
          onClick={() : any => onToggleSide(setIdx, side,
            !sideSet.done && (set.sides.L.done || set.sides.R.done) ? onProgress : undefined)}><Icon name="check" /></button>
      </div>
      <Stepper {...holdProps} label={t('Load ({0})', S.unit)} ariaLabel="load" value={sideSet.w || 0} step={loadStep} onStep={stepLoad} disabled={readOnly || sideSet.done}
        onChange={(value: any ) : any => change('w', value)} />
      <Stepper {...holdProps} label={t('Reps')} ariaLabel="reps" value={sideSet.r || 0} step={1} decimal={false} disabled={readOnly || sideSet.done}
        onChange={(value: any ) : any => change('r', value)} />
      <div className="focus-extras">
        {sideDrops.map((drop: any, index: any) : any => <div className="focus-extra" key={`drop-${index}`}>
          <span>{t('Drop {0}', index + 1)}</span>
          <Stepper {...holdProps} label={t('Load')} ariaLabel="load" value={drop.w || 0} step={loadStep} onStep={stepLoad} disabled={readOnly || sideSet.done}
            onChange={(value: any ) : any => onMutateSet(setIdx, (row: any ) : any => setSideDropAt(row, side, index, { w: value }))} />
          <Stepper {...holdProps} label={t('Reps')} ariaLabel="reps" value={drop.r || 0} step={1} decimal={false} disabled={readOnly || sideSet.done}
            onChange={(value: any ) : any => onMutateSet(setIdx, (row: any ) : any => setSideDropAt(row, side, index, { r: value }))} />
        </div>)}
        {sideBursts.map((burst: any, index: any) : any => <div className="focus-extra" key={`burst-${index}`}>
          <span>{t('Burst {0}', index + 1)}</span>
          <Stepper {...holdProps} label={t('Reps')} ariaLabel="reps" value={burst.r || 0} step={1} decimal={false} disabled={readOnly || sideSet.done}
            onChange={(value: any ) : any => onMutateSet(setIdx, (row: any ) : any => setSideClusterAt(row, side, index, value))} />
          <span className="dim small">{burst.restSec}s</span>
        </div>)}
      </div>
    </section>
  }

  const onProgress = ({ unitDone }: any) : any => {
    const active = useStore.getState().S.active
    if (!active) return
    if (unitDone) {
      onAdvanceUnit()
      const nextEntryIdx = useStore.getState().S.active?.cur
      if (nextEntryIdx !== entryIdx) clearPointer(nextEntryIdx)
    }
    else if (unit.length === 1) selectSet(setIdx + 1)
    else clearPointer(active.cur)
  }

  const complete = () : any => {
    if (!isSideSet(set)) return onToggle(setIdx, onProgress)
    const sides = set.done ? ['L', 'R'] : ['L', 'R'].filter((side: any ) : any => !set.sides[side].done)
    sides.forEach((side: any, index: any) : any => onToggleSide(setIdx, side, index === sides.length - 1 ? onProgress : undefined))
  }

  const openEffort = () : any => effortPickerSheet(effort, effortValue, scopedCallback(captureWorkoutRow(entryIdx, setIdx), (value: any) => onField(setIdx, effortField, value)))

  const guardedMenu = (valid: import('./workout-target').WorkoutTarget, options: import('../sheets-a').MenuOptions) => menuSheet({ ...options, items: options.items?.map((item: any) => item && ({ ...item, onClick: item.onClick && scopedCallback(valid, item.onClick) })) })
  const openExerciseMenu = () : any => guardedMenu(captureWorkoutRow(entryIdx), {
    title: exerciseNameFor(exOr(entry.id, currentIndex())),
    items: [
      { icon: 'pencil', label: entry.note ? t('Edit note') : t('Add note'), onClick: () : any => exerciseNoteSheet(entryIdx) },
      { icon: 'info', label: t('Details'), onClick: () : any => exerciseDetailSheet(exOr(entry.id, currentIndex())) },
      { icon: 'history', label: t('History'), onClick: () : any => exerciseHistorySheet(entry.id) },
      { icon: 'chartLine', label: t('Progression settings'), onClick: onProgressionSettings },
      onNoProg && { icon: 'pause', label: t('Don’t count for progression'), sub: t('This exercise, this session only'), on: entry.noProg === true, onClick: () : any => onNoProg(entry.noProg !== true) },
      mode === 'reps' && { icon: 'plate', label: t('Plate loading'), onClick: () : any => barWeightSheet(entry.id, { ...(entry.target || {}), id: entry.id }) },
      onPairPrev && { icon: 'link', label: t('Make superset with previous'), onClick: onPairPrev },
      onPairNext && { icon: 'link', label: t('Make superset with next'), onClick: onPairNext },
      { icon: 'shuffle', label: t('Swap exercise'), onClick: onSwap, disabled: busy },
      { icon: 'trash', label: t('Remove exercise'), onClick: onRemoveExercise, danger: true, disabled: busy },
    ],
  })

  const openSetMenu = () : any => guardedMenu(captureWorkoutRow(entryIdx, setIdx), {
    title: t('Set {0}', setIdx + 1),
    items: [
      { icon: 'flame', label: isWarmupRow(set) ? t('Mark as work set') : t('Mark as warm-up'), onClick: () : any => onMutateSet(setIdx, toggleWarmup) },
      { icon: 'arrowDown', label: t('Add drop set'), onClick: () : any => onMutateSet(setIdx, (row: any ) : any => addDropTo(row, entry.target)) },
      { icon: 'bolt', label: t('Add burst'), onClick: () : any => onMutateSet(setIdx, (row: any ) : any => addBurstTo(row, entry.target?.intensifier?.type === 'restpause' ? entry.target.intensifier.restSec : (S.restPauseSec || 15))) },
      !isWarmupRow(set) && mode !== 'cardio' && { icon: 'gauge', label: t('Taken to failure'), sub: t('Nothing left in the tank'), on: isFailureSet(set), onClick: () : any => onMutateSet(setIdx, toggleFailure) },
      { icon: 'trash', label: t('Delete set'), danger: true, disabled: entry.sets.length <= 1, onClick: () : any => onRemoveSetAt(setIdx) },
    ],
  })

  return <div className="focus-view" data-testid="focus-view">
    <div className="focus-card">
      {unit.length > 1 && <div className="focus-superset-inline">
        <Icon name="reset" />
        <strong>{t('Superset:')} {unit.map((index: any ) : any => exerciseNameFor(exOr(S.active.entries[index].id, currentIndex()))).join(' + ')}</strong>
        <span>{t('Round {0}', setIdx + 1)} · {t('Exercise {0} of {1}', unit.indexOf(entryIdx) + 1, unit.length)}</span>
        <Button size="xs" variant="ghost" icon="link" aria-label={t('Unpair')} onClick={onUnpair}>{t('Unpair')}</Button>
        <div className="focus-superset-nav">
          <button aria-label={t('Previous superset set')} disabled={sequenceIdx <= 0} onClick={() : any => selectSequence(sequenceIdx - 1)}><Icon name="chevronLeft" /></button>
          <button aria-label={t('Next superset set')} disabled={sequenceIdx < 0 || sequenceIdx >= sequence.length - 1} onClick={() : any => selectSequence(sequenceIdx + 1)}><Icon name="chevronRight" /></button>
        </div>
      </div>}
      <header className="focus-card-header">
        <h2>{exerciseNameFor(ex)}</h2>
        <button className="iconbtn" aria-label={t('Details')} onClick={() : any => exerciseDetailSheet(ex)}><Icon name="info" /></button>
        {isWarmupRow(set) && <span className="focus-warmup" aria-label={t('Warm-up')}>🔥</span>}
        {isFailureSet(set) && <span className="focus-failure" role="img" aria-label={t('Taken to failure')}>{t('F')}</span>}
        <button className="iconbtn" aria-label={t('More')} onClick={openExerciseMenu}><Icon name="more" /></button>
      </header>

      <div className="focus-context">
        <div className="focus-tags">
          {mode === 'cardio' && <span className="tag acc">{t('Cardio')}</span>}
          {isSideSet(set) && <span className="tag acc">{t('Per side')}</span>}
          {(ex.tg || ex.bp) && <span className="tag">{t(ex.tg || ex.bp)}</span>}
          {ex.eq && <span className="tag">{t(ex.eq)}</span>}
        </div>
        {entry.target?.instructions && <p className="programme-instructions">{programmeInstructions(S,entry.target)}</p>}
        {entry.target?.note && <div className="focus-note">{programmeNote(S,entry.target,S.routines.find((r: any ): any =>r.id===entry.rid))}</div>}
        {pinnedNote && <div className="focus-note pinned"><Icon name="flag" />{t('From {0}:', fmtDate(pinnedNote.d, true))} {pinnedNote.note}</div>}
        {entry.note && <div className="focus-note">{entry.note}</div>}
        {last && <div className="focus-last">{t('Last time')} · {fmtDate(last.d, undefined)}</div>}
        {guidance && <button className="focus-guidance" onClick={onProgressionSettings}><Icon name="lightbulb" />{t(guidance.policyLabel)}</button>}
      </div>
      <Prescription entry={entry} setIdx={setIdx} unit={S.unit} fallbackRest={S.restSec} kind={programmeEffortOf(S)}>
        {(set.target || set.repTarget) && <span className="focus-badge set-target">{set.repTarget && `${set.repTarget.min}–${set.repTarget.max} · `}{targetLabel(set.target,t,programmeEffortOf(S))}</span>}
        <PlanBadge entry={entry} mode={mode} />
        <PlateBadge S={S} entry={entry} set={set} />
        {entry.noProg === true && <span className="focus-badge warning"><Icon name="pause" />{t('Not counted for progression')}{onNoProg && <button type="button" className="focus-badge-action" onClick={() : any => onNoProg(false)}>{t('Undo')}</button>}</span>}
      </Prescription>
      {locked && <p className="focus-lock-note" role="status">{t('Complete set {0} to edit this one.', firstOpenSet + 1)}</p>}

      <div data-testid="focus-set" className={(set.done ? 'complete ' : '') + (locked ? 'locked' : '')}>
        {isSideSet(set) ? <div className="focus-sides">{sideFields('L')}{sideFields('R')}</div> : <>
          {mode === 'cardio' ? <>
            <Stepper {...holdProps} label={t('Duration (min)')} ariaLabel="duration" value={set.min || 0} step={1} decimal={false} disabled={readOnly}
              onChange={(value: any ) : any => onField(setIdx, 'min', value)} />
            {/* Stored in km/h, shown and typed in the profile's speed unit, as on every other
                cardio input (lib/speed.js). */}
            <Stepper {...holdProps} label={speedUnit === 'mph' ? t('Speed (mph)') : t('Speed (km/h)')} ariaLabel="speed" value={toSpeed(set.speed || 0, speedUnit)} step={0.5} disabled={readOnly}
              onChange={(value: any ) : any => onField(setIdx, 'speed', fromSpeed(value, speedUnit))} />
            {/* The treadmill's grade, where the exercise has one (lib/incline.js). */}
            {(inclineFits(ex, currentIndex()) || entry.sets.some(hasIncline)) && <Stepper {...holdProps} label={t('Incline (%)')} ariaLabel="incline" value={set.incline || 0} step={INCLINE_STEP} max={INCLINE_MAX} disabled={readOnly}
              onChange={(value: any ) : any => onField(setIdx, 'incline', clampIncline(value))} />}
          </> : <>
            <Stepper {...holdProps} label={t('Load ({0})', S.unit)} ariaLabel="load" value={set.w || 0} step={loadStep} onStep={stepLoad} disabled={readOnly}
              onChange={(value: any ) : any => onField(setIdx, 'w', value)} />
          {mode === 'time' ? <div className="focus-timed">
            <strong>{t('{0}s hold', set.sec || entry.target?.sec || 45)}</strong>
            <Button icon="play" aria-label={t('Start set')} disabled={readOnly || busy}
              onClick={() : any => onStartTimed(setIdx, onProgress)}>{t('Start')}</Button>
          </div> : <Stepper {...holdProps} label={t('Reps')} ariaLabel="reps" value={set.r || 0} step={1} decimal={false} disabled={readOnly}
            onChange={(value: any ) : any => onField(setIdx, 'r', value)} />}</>}
        </>}
        <div className="focus-extras">
          {drops.map((drop: any, index: any) : any => <div className="focus-extra" key={`drop-${index}`}>
            <span>{t('Drop {0}', index + 1)}</span>
            <Stepper {...holdProps} label={t('Load')} ariaLabel="load" value={drop.w || 0} step={loadStep} onStep={stepLoad} disabled={readOnly}
              onChange={(value: any ) : any => onMutateSet(setIdx, (row: any ) : any => setDropAt(row, index, { w: value }))} />
            <Stepper {...holdProps} label={t('Reps')} ariaLabel="reps" value={drop.r || 0} step={1} decimal={false} disabled={readOnly}
              onChange={(value: any ) : any => onMutateSet(setIdx, (row: any ) : any => setDropAt(row, index, { r: value }))} />
          </div>)}
          {bursts.map((burst: any, index: any) : any => <div className="focus-extra" key={`burst-${index}`}>
            <span>{t('Burst {0}', index + 1)}</span>
            <Stepper {...holdProps} label={t('Reps')} ariaLabel="reps" value={burst.r || 0} step={1} decimal={false} disabled={readOnly}
              onChange={(value: any ) : any => onMutateSet(setIdx, (row: any ) : any => {
                const delta = (Number(value) || 0) - (clustersOf(row)[index]?.r ?? row.clusters?.[index]?.r ?? 0)
                return { ...setClusterAt(row, index, { r: value }), r: Math.max(0, (row.r || 0) + delta) }
              })} />
            <span className="dim small">{burst.restSec}s</span>
          </div>)}
        </div>
        {mode === 'reps' && effortField && <button className={'effcell focus-effort' + (effortValue == null ? ' is-empty' : '')}
          style={effortTint ? { color: effortTint, borderColor: effortTint, background: `color-mix(in srgb, ${effortTint} 20%, var(--surface-2))` } : undefined}
          aria-label={t(EFFORT[effort as 'rir' | 'rpe'].hd)} disabled={readOnly} onClick={openEffort}>{effortValue == null ? t(EFFORT[effort as 'rir' | 'rpe'].hd) : fmtNum(effortValue)}</button>}
      </div>
      <Button variant="primary" icon="check" aria-label={t('Complete set')} onClick={complete}>{set.done ? t('Completed') : t('Complete')}</Button>
      <div className="focus-secondary">
        <button className="focus-skip" aria-label={t('Skip set')} disabled={setIdx >= entry.sets.length - 1} onClick={() : any => selectSet(setIdx + 1)}>
          <Icon name="play" />{t('Skip')}
        </button>
        <button className="iconbtn" aria-label={t('Set menu')} onClick={openSetMenu}><Icon name="more" /></button>
      </div>
    </div>

    <footer className="focus-pager">
      <button aria-label={t('Previous set')} disabled={setIdx === 0} onClick={() : any => selectSet(setIdx - 1)}><Icon name="chevronLeft" /></button>
      <div className="focus-dots">
        {entry.sets.map((row: any, index: any) : any => <button key={index} aria-label={t('Set {0}', index + 1)}
          className={(index === setIdx ? 'active ' : '') + (row.done ? 'done' : '')}
          onClick={() : any => selectSet(index)} />)}
      </div>
      <button aria-label={t('Next set')} disabled={setIdx === entry.sets.length - 1} onClick={() : any => selectSet(setIdx + 1)}><Icon name="chevronRight" /></button>
    </footer>
  </div>
}
