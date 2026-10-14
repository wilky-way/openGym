import { authoredPrescriptionFields } from '@opengym/core/programme-prescription'
import { capturePlanTarget, updatePlanTarget, validatePlanTarget, occurrenceKeys } from './plan-target'
import { ux } from '../platform/ux'
import { clientPlatform } from '../lib/client-io'
import { ProgrammeCalendar, Programs, ProgrammeRoutines, programmeSkipSheet } from './plan-services'
import { programmeNote } from '@opengym/core/programme-targets'
import { editProgrammeSessions, canScopeProgrammeSessions } from '@opengym/core/programme-edit'
import { useNavigate, useParams } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import { useUI } from '../store/useUI'
import { exOr } from '@opengym/core/exercises'
import { activeProfile, exAvailable } from '@opengym/core/equipment'
import { uid, exerciseNameText } from '@opengym/core/format'
import { t, exerciseNameFor, exerciseNameClass } from '../lib/i18n'
import { supersetUnits, moveRoutineEntry, cleanupSg, exLine, defaultConfig } from '@opengym/core/history'
import { glyphPicker, exercisePicker, exConfigSheet, confirmSheet, supersetSheet, menuSheet } from '../sheets'
import { supersetMeta, setSupersetMeta } from '@opengym/core/superset-meta'
import { fmtRest } from '../lib/duration'
import Icon from '../components/Icon'
import { glyphOf } from '../lib/glyphs'
import { Button, Row, SelectRow, Switch } from '../components/ui'
import SwipeRow from '../components/SwipeRow'
import { workoutControls } from '@opengym/core/workout-controls'
import { copyRoutine, deleteRoutine, replaceSlotExercise } from '@opengym/core/routines'
import { printPlan } from '../sheets-plan-history'
import { markEntryUndone } from '@opengym/core/sync-merge'
import { speedUnitOf } from '@opengym/core/speed'
import { POLICIES_FOR, POLICY_NAME, POLICY_DESC } from '@opengym/core/progression'
import BodyMap from '../components/BodyMap'
import { loadOfRoutine, rankOf, MUSCLE_NAME } from '@opengym/core/muscles'

// Keep opaque keys while allowing the configuration sheet to clear its known fields.
const canonicalConfig = new Set(['id', 'sg', 'sets', 'min', 'speed', 'mode', 'sec', 'weight', 'bodyweight', 'assisted', 'side', 'prog', 'inc',
  'deloadFactor', 'note', 'warmupSets', 'restSec', 'dbLoad', 'lastToFailure', 'reps', 'pyramid', 'pyramidRest', 'pyramidWeight',
  'repsMin', 'setsMax', 'repsMax', 'intensifier', 'backoff', ...authoredPrescriptionFields])
function opaqueConfig(slot: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(slot).filter(([key]) => !canonicalConfig.has(key)))
}

export const ROUTINE_LONG_PRESS_MS: any = 380
export const ROUTINE_DRAG_SLOP: any = 8

const clamp: any = (value: any, low: any, high: any) => Math.max(low, Math.min(high, value))

// Slots are defined after removing the source unit, so a grouped run can never be split.
export function reorderRoutineUnit(exercises: any, sourceIndex: any, targetSlot: any) {
  if (!Array.isArray(exercises) || !exercises.length) return false
  const units: any = supersetUnits(exercises)
  const sourcePosition: any = units.findIndex((unit: any) => unit.includes(sourceIndex))
  if (sourcePosition < 0) return false
  const remaining: any = units.filter((_: any, position: any) => position !== sourcePosition)
  const slot: any = clamp(Number.isFinite(targetSlot) ? Math.trunc(targetSlot) : sourcePosition, 0, remaining.length)
  if (slot === sourcePosition) return false
  const source: any = units[sourcePosition]
  const moved: any = exercises.splice(source[0], source.length)
  const insertAt: any = remaining.slice(0, slot).reduce((count: any, unit: any) => count + unit.length, 0)
  exercises.splice(insertAt, 0, ...moved)
  cleanupSg(exercises)
  return true
}

function unitGeometry(list: any, exercises: any) {
  const rows: any = new Map([...list.querySelectorAll('[data-routine-row]')]
    .map((row: any) => [Number(row.dataset.exIndex), row]))
  const units: any = supersetUnits(exercises)
  const geometry: any = units.map((unit: any, position: any) => {
    const rects: any = unit.map((index: any) => rows.get(index)?.getBoundingClientRect()).filter(Boolean)
    if (rects.length !== unit.length) return null
    const top: any = Math.min(...rects.map((rect: any) => rect.top))
    const bottom: any = Math.max(...rects.map((rect: any) => rect.bottom))
    return { unit, position, top, bottom, center: top + (bottom - top) / 2 }
  })
  return geometry.every(Boolean) ? geometry : null
}

function scrollHostFor(node: any) {
  for (let parent: any = node.parentElement; parent && parent !== ux().document!.body; parent = parent.parentElement) {
    const overflowY: any = ux().window!.getComputedStyle(parent).overflowY
    if (/(auto|scroll)/.test(overflowY) && parent.scrollHeight > parent.clientHeight) return parent
  }
  return ux().window!
}

function autoScrollStep(host: any, clientY: any) {
  const edge: any = 64
  const maxStep: any = 14
  let top: any, bottom: any, scrollTop: any, maxScroll: any
  if (host === ux().window!) {
    const root: any = ux().document!.scrollingElement || ux().document!.documentElement
    top = ux().window!.visualViewport?.offsetTop || 0
    bottom = top + (ux().window!.visualViewport?.height || ux().window!.innerHeight || root.clientHeight)
    scrollTop = ux().window!.scrollY || root.scrollTop || 0
    maxScroll = Math.max(root.scrollHeight, ux().document!.body?.scrollHeight || 0) - (bottom - top)
  } else {
    const rect: any = host.getBoundingClientRect()
    top = rect.top; bottom = rect.bottom
    scrollTop = host.scrollTop; maxScroll = host.scrollHeight - host.clientHeight
  }
  if (clientY < top + edge && scrollTop > 0) return -Math.ceil(maxStep * clamp((top + edge - clientY) / edge, 0, 1))
  if (clientY > bottom - edge && scrollTop < maxScroll) return Math.ceil(maxStep * clamp((clientY - bottom + edge) / edge, 0, 1))
  return 0
}

function useRoutineReorder(routineIdentity: any, exercises: any, onDrop: any) {
  const listRef: any = useRef<any>(null)
  const gestureRef: any = useRef<any>(null)
  const exercisesRef: any = useRef<any>(exercises)
  const routineIdentityRef: any = useRef<any>(routineIdentity)
  const onDropRef: any = useRef<any>(onDrop)
  const suppressClickRef: any = useRef<any>(false)
  const suppressTimerRef: any = useRef<any>(null)
  const [drag, setDrag] = useState<any>(null)
  exercisesRef.current = exercises
  routineIdentityRef.current = routineIdentity
  onDropRef.current = onDrop
  const hasRows: any = exercises.length > 0

  useEffect(() => () => {
    suppressClickRef.current = false
    ux().window!.clearTimeout(suppressTimerRef.current)
  }, [])

  useEffect(() => {
    const list: any = listRef.current
    if (!list) return undefined
    let frame: any = null
    setDrag((current: any) => current ? null : current)

    const clearFrame: any = () => {
      if (frame != null) ux().window!.cancelAnimationFrame(frame)
      frame = null
    }
    const clearTimer: any = (gesture: any) => {
      if (gesture?.timer != null) ux().window!.clearTimeout(gesture.timer)
      if (gesture) gesture.timer = null
    }
    const matchesSnapshot: any = (gesture: any) => routineIdentityRef.current === gesture.routineIdentity
      && exercisesRef.current === gesture.listIdentity
      && JSON.stringify(exercisesRef.current) === gesture.snapshot
    const releaseCapture: any = (gesture: any) => {
      const target: any = gesture?.captureTarget
      if (!target?.releasePointerCapture) return
      try { target.releasePointerCapture(gesture.pointerId) } catch { /* already released */ }
    }
    const finish: any = (gesture: any, commit: any, x: any = gesture?.lastX, y: any = gesture?.lastY) => {
      if (!gesture || gestureRef.current !== gesture) return
      clearTimer(gesture)
      clearFrame()
      gestureRef.current = null
      if (!gesture.active) return
      releaseCapture(gesture)
      suppressClickRef.current = true
      ux().window!.clearTimeout(suppressTimerRef.current)
      // The compatibility click lands synchronously after pointerup; anything
      // later is a real tap, so the guard only needs to outlive that one event.
      suppressTimerRef.current = ux().window!.setTimeout(() => { suppressClickRef.current = false }, 150)
      setDrag(null)
      const rect: any = list.getBoundingClientRect()
      const inside: any = x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
      const geometry: any = unitGeometry(list, exercisesRef.current)
      if (commit && inside && geometry && matchesSnapshot(gesture) && gesture.targetSlot !== gesture.sourcePosition) {
        onDropRef.current(gesture.sourceIndex, gesture.targetSlot)
      }
    }
    const indicatorTop: any = (geometry: any, gesture: any, slot: any, listRect: any) => {
      if (slot === gesture.sourcePosition) return clamp(gesture.sourceTop - listRect.top, 0, listRect.height)
      const remaining: any = geometry.filter((unit: any) => unit.position !== gesture.sourcePosition)
      let top: any
      if (slot <= 0) top = remaining[0]?.top ?? gesture.sourceTop
      else if (slot >= remaining.length) top = remaining.at(-1)?.bottom ?? gesture.sourceBottom
      else top = (remaining[slot - 1].bottom + remaining[slot].top) / 2
      return clamp(top - listRect.top, 0, listRect.height)
    }
    const updateDrag: any = (gesture: any, x: any, y: any, schedule: any = true) => {
      if (gestureRef.current !== gesture || !gesture.active || !matchesSnapshot(gesture)) {
        if (gestureRef.current === gesture) finish(gesture, false)
        return
      }
      const geometry: any = unitGeometry(list, exercisesRef.current)
      if (!geometry) { finish(gesture, false); return }
      const listRect: any = list.getBoundingClientRect()
      const remaining: any = geometry.filter((unit: any) => unit.position !== gesture.sourcePosition)
      const probeY: any = clamp(y, listRect.top, listRect.bottom)
      const moved: any = Math.hypot(x - gesture.startX, y - gesture.startY) > ROUTINE_DRAG_SLOP
      const slot: any = moved ? remaining.reduce((count: any, unit: any) => count + (probeY > unit.center ? 1 : 0), 0) : gesture.sourcePosition
      const rawDelta: any = y - gesture.grabOffset - gesture.sourceTop
      const deltaY: any = clamp(rawDelta, listRect.top - gesture.sourceTop, listRect.bottom - gesture.sourceBottom)
      gesture.lastX = x; gesture.lastY = y; gesture.targetSlot = slot
      setDrag({ first: gesture.sourceUnit[0], last: gesture.sourceUnit.at(-1), deltaY, indicatorTop: indicatorTop(geometry, gesture, slot, listRect) })
      if (schedule && frame == null) frame = ux().window!.requestAnimationFrame(runAutoScroll)
    }
    function runAutoScroll() {
      frame = null
      const gesture: any = gestureRef.current
      if (!gesture?.active) return
      const step: any = autoScrollStep(gesture.scrollHost, gesture.lastY)
      if (!step) return
      if (gesture.scrollHost === ux().window!) ux().window!.scrollBy(0, step)
      else gesture.scrollHost.scrollTop += step
      updateDrag(gesture, gesture.lastX, gesture.lastY, false)
      if (gestureRef.current === gesture) frame = ux().window!.requestAnimationFrame(runAutoScroll)
    }
    const lift: any = (gesture: any) => {
      if (gestureRef.current !== gesture) return
      if (!matchesSnapshot(gesture)) { finish(gesture, false); return }
      const geometry: any = unitGeometry(list, exercisesRef.current)
      const source: any = geometry?.find((unit: any) => unit.unit.includes(gesture.sourceIndex))
      if (!source) { finish(gesture, false); return }
      gesture.active = true; gesture.timer = null
      gesture.sourcePosition = source.position; gesture.sourceUnit = source.unit
      gesture.sourceTop = source.top; gesture.sourceBottom = source.bottom
      gesture.grabOffset = gesture.lastY - source.top; gesture.targetSlot = source.position
      gesture.scrollHost = scrollHostFor(list)
      gesture.captureTarget = gesture.downTarget
      try { gesture.captureTarget.setPointerCapture?.(gesture.pointerId) } catch { /* unsupported */ }
      suppressClickRef.current = true
      ux().window!.clearTimeout(suppressTimerRef.current)
      updateDrag(gesture, gesture.lastX, gesture.lastY)
    }
    const onPointerDown: any = (event: any) => {
      // a new touch is intentional — never let the post-drop guard eat its click
      suppressClickRef.current = false
      ux().window!.clearTimeout(suppressTimerRef.current)
      const current: any = gestureRef.current
      if (current) {
        if (event.pointerId !== current.pointerId) finish(current, false)
        return
      }
      if (event.isPrimary === false || (event.pointerType === 'mouse' && event.button !== 0)) return
      const target: any = event.target
      if (!target?.closest || target.closest('button:not([data-row-open]),a,input,textarea,select,[data-nodrag]')) return
      const row: any = target.closest('[data-routine-row]')
      if (!row || !list.contains(row)) return
      const sourceIndex: any = Number(row.dataset.exIndex)
      if (!Number.isInteger(sourceIndex)) return
      const gesture: any = {
        pointerId: event.pointerId, sourceIndex, downTarget: target,
        startX: event.clientX, startY: event.clientY, lastX: event.clientX, lastY: event.clientY,
        routineIdentity: routineIdentityRef.current,
        listIdentity: exercisesRef.current,
        snapshot: JSON.stringify(exercisesRef.current), active: false, timer: null,
      }
      gestureRef.current = gesture
      // The grip, pressed with a mouse, picks the row up at once (#277): the hold exists so a
      // finger can still scroll the list, and a mouse scrolls with its wheel. preventDefault
      // keeps the press from starting a text selection or the row's swipe-to-delete, which
      // listen to the mouse events a pointerdown would otherwise go on to fire.
      if (event.pointerType === 'mouse' && target.closest('[data-drag-handle]')) {
        event.preventDefault()
        lift(gesture)
        return
      }
      gesture.timer = ux().window!.setTimeout(() => lift(gesture), ROUTINE_LONG_PRESS_MS)
    }
    const onPointerMove: any = (event: any) => {
      const gesture: any = gestureRef.current
      if (!gesture || event.pointerId !== gesture.pointerId) return
      if (!gesture.active) {
        if (Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) > ROUTINE_DRAG_SLOP) {
          clearTimer(gesture); gestureRef.current = null
        } else { gesture.lastX = event.clientX; gesture.lastY = event.clientY }
        return
      }
      event.preventDefault()
      updateDrag(gesture, event.clientX, event.clientY)
    }
    const onPointerUp: any = (event: any) => {
      const gesture: any = gestureRef.current
      if (!gesture || event.pointerId !== gesture.pointerId) return
      if (gesture.active) event.preventDefault()
      finish(gesture, gesture.active, event.clientX, event.clientY)
    }
    const onPointerCancel: any = (event: any) => {
      const gesture: any = gestureRef.current
      if (gesture && event.pointerId === gesture.pointerId) finish(gesture, false)
    }
    const onLostCapture: any = (event: any) => {
      const gesture: any = gestureRef.current
      if (gesture && event.pointerId === gesture.pointerId) finish(gesture, false)
    }
    const cancelActive: any = () => finish(gestureRef.current, false)
    const onKeyDown: any = (event: any) => {
      if (event.key !== 'Escape' || !gestureRef.current) return
      event.preventDefault(); cancelActive()
    }
    const onVisibility: any = () => { if (ux().document!.visibilityState === 'hidden') cancelActive() }
    const onContextMenu: any = (event: any) => { if (gestureRef.current?.active && event.target.closest?.('[data-routine-row]')) event.preventDefault() }
    const onDragStart: any = (event: any) => { if (event.target.closest?.('[data-routine-row]')) event.preventDefault() }

    // Touch: the rows keep `touch-action: pan-y` so the list still scrolls with a finger, but once
    // a long-press has lifted a row the browser must not claim the vertical drag as a pan — it
    // would fire pointercancel and scroll instead. preventDefault on a pointer event cannot stop
    // that; only a non-passive touchmove listener can, and only while a drag is actually active.
    const onTouchMove: any = (event: any) => { if (gestureRef.current?.active) event.preventDefault() }

    ux().document!.addEventListener('pointerdown', onPointerDown)
    ux().document!.addEventListener('touchmove', onTouchMove, { passive: false })
    ux().document!.addEventListener('pointermove', onPointerMove, { passive: false })
    ux().document!.addEventListener('pointerup', onPointerUp, { passive: false })
    ux().document!.addEventListener('pointercancel', onPointerCancel)
    ux().document!.addEventListener('lostpointercapture', onLostCapture)
    ux().document!.addEventListener('keydown', onKeyDown)
    ux().document!.addEventListener('visibilitychange', onVisibility)
    list.addEventListener('contextmenu', onContextMenu)
    list.addEventListener('dragstart', onDragStart)
    ux().window!.addEventListener('blur', cancelActive)
    return () => {
      const gesture: any = gestureRef.current
      clearTimer(gesture); clearFrame(); gestureRef.current = null
      releaseCapture(gesture)
      ux().document!.removeEventListener('pointerdown', onPointerDown)
      ux().document!.removeEventListener('touchmove', onTouchMove)
      ux().document!.removeEventListener('pointermove', onPointerMove)
      ux().document!.removeEventListener('pointerup', onPointerUp)
      ux().document!.removeEventListener('pointercancel', onPointerCancel)
      ux().document!.removeEventListener('lostpointercapture', onLostCapture)
      ux().document!.removeEventListener('keydown', onKeyDown)
      ux().document!.removeEventListener('visibilitychange', onVisibility)
      list.removeEventListener('contextmenu', onContextMenu)
      list.removeEventListener('dragstart', onDragStart)
      ux().window!.removeEventListener('blur', cancelActive)
    }
  }, [hasRows, routineIdentity, exercises])

  const onClickCapture: any = (event: any) => {
    if (!suppressClickRef.current) return
    suppressClickRef.current = false
    ux().window!.clearTimeout(suppressTimerRef.current)
    event.preventDefault(); event.stopPropagation()
  }
  // Whether a long press has picked a row up: the row's swipe stays out of the way while it has.
  const lifted: any = () => !!gestureRef.current?.active
  return { listRef, drag, onClickCapture, lifted }
}

/**
 * Takes exercise `i` out of routine `routineId` with an Undo (v1.3.11: the row's swipe and the
 * exercise sheet's Remove). While the routine's exercises are still what the removal left, Undo
 * puts the list back as it was, superset links included (a partner left alone loses its link,
 * cleanupSg). Once something else changed them, the exercise goes back in at its old place.
 */
export function removeRoutineExercise(routineId: any, i: any, target?: ReturnType<typeof capturePlanTarget>) {
  const st: any = useStore.getState()
  const routine: any = st.S.routines.find((x: any) => x.id === routineId)
  const slot: any = routine?.ex?.[i]
  if (!slot) return false
  const owner = capturePlanTarget(s => s.routines.some((r: any) => r.id === routineId))
  const before: any = structuredClone(routine.ex)
  const base: any = Number(routine._f?.ex) || 0
  if (!updatePlanTarget(target ?? owner, s => {
    const ex: any = s.routines.find((x: any) => x.id === routineId)?.ex
    if (!ex) return
    ex.splice(i, 1); cleanupSg(ex)
  })) return false
  const now: any = useStore.getState().S.routines.find((x: any) => x.id === routineId)
  const after: any = JSON.stringify(now?.ex)
  const del: any = Number(now?._f?.ex) || 0
  useUI.getState().toast(t('“{0}” left the routine.', exerciseNameText(exOr(slot.id, st.index))),
    { action: t('Undo'), onAction: () => undoRemoveRoutineExercise({ routineId, i, before, after, base, del, owner }) })
  return true
}
export function undoRemoveRoutineExercise({ routineId, i, before, after, base, del, owner = capturePlanTarget() }: any) {
  if (!useStore.getState().S.routines.some((x: any) => x.id === routineId)) {
    useUI.getState().toast(t('Too late, that one’s gone'))
    return false
  }
  if (!updatePlanTarget(owner, s => {
    const routine: any = s.routines.find((x: any) => x.id === routineId)
    // Put back exactly, so a change another device made to these exercises before it saw the
    // removal still wins (lib/sync-merge.js, "Undo").
    if (JSON.stringify(routine.ex) === after) { routine.ex = structuredClone(before); if (del) markEntryUndone(routine, 'ex', base, del); return }
    routine.ex.splice(Math.min(i, routine.ex.length), 0, structuredClone(before[i]))
    cleanupSg(routine.ex)
  })) return false
  return true
}

export default function RoutineEdit() {
  const nav: any = useNavigate()
  const { id } = useParams()
  const S: any = useStore((s: any) => s.S)
  const index = useStore(s => s.index)
  const toast: any = useUI((s: any) => s.toast)
  const r: any = S.routines.find((x: any) => x.id === id)
  useEffect(() => { if (!r) nav('/plan') }, [!!r])

  const editor = useRef<{ key: string; token: symbol; mounted: boolean } | null>(null)
  const editorKey = JSON.stringify([id, useStore.getState().user?.id, S.profileId, S.activeEquipId])
  if (!editor.current || editor.current.key !== editorKey) editor.current = { key: editorKey, token: Symbol('routine editor'), mounted: true }
  const instance = editor.current
  useEffect(() => { instance.mounted = true; return () => { instance.mounted = false } }, [instance])
  let opened = JSON.stringify(r)
  const target = capturePlanTarget(s => JSON.stringify(s.routines.find((x: any) => x.id === id)) === opened,
    () => instance.mounted && editor.current === instance)
  const update = (fn: (s: any) => void) => {
    const ok = updatePlanTarget(target, fn)
    if (ok) opened = JSON.stringify(useStore.getState().S.routines.find((x: any) => x.id === id))
    return ok
  }
  const edit = (fn: (ex: any[]) => void) => {
    if (!r?.programme) return update((s: any) => editProgrammeSessions(s, id!, fn))
    if (!validatePlanTarget(target)) return false
    menuSheet({ title: t('Edit program session'), items: [
      { label: t('This session only'), onClick: () => update((s: any) => editProgrammeSessions(s, id!, fn)) },
      { label: t('This and later weeks of this day'), onClick: () => { const limited: any = !canScopeProgrammeSessions(useStore.getState().S, id!); const ok = update((s: any) => editProgrammeSessions(s, id!, fn, true)); if (ok && limited) toast(t('Repeated lifts have no shared slot identity. This edit applies to this session only.')) } },
    ] })
  }
  const reorder: any = useRoutineReorder(r, r?.ex || [], (sourceIndex: any, targetSlot: any) => {
    edit((exercises: any) => { reorderRoutineUnit(exercises, sourceIndex, targetSlot) })
  })
  if (!r) return null
  const gestureKey = JSON.stringify([editorKey, target.epoch, target.owner, target.endpoint, r])
  const rowKeys = occurrenceKeys(r.ex)
  // The arrows move one exercise (#377): inside its superset, out of it at the edge, and past a
  // whole neighbouring unit otherwise (lib/history.js moveRoutineEntry). Drag moves supersets whole.
  const move: any = (i: any, dir: any) => {
    // Guard before update so a stale/boundary activation cannot trigger persistence or cleanup.
    if (!moveRoutineEntry(r.ex, i, dir)) return
    edit((ex: any) => {
      const reordered: any = moveRoutineEntry(ex, i, dir)
      if (!reordered) return
      ex.splice(0, ex.length, ...reordered)
      cleanupSg(ex)
    })
  }
  // Replace (#110): the picker chooses what goes into slot `i`, and the slot keeps its sets, reps,
  // weight and the rest (lib/routines.js replaceSlotExercise). "+" on a picker row replaces at
  // once; tapping the row opens the new exercise's settings at those numbers first, the way the
  // add flow does. One pick and the picker closes — it is a chooser here, not a stack you keep
  // adding from. A slot that is no longer the exercise the sheet was opened on is left alone.
  const replace: any = (i: any) => {
    const openedOn: any = r.ex[i]?.id
    const commit: any = (ex: any, fn: any) => {
      picker.close()
      let done: any = false
      edit((x: any) => { if (x[i] && x[i].id === openedOn) { x[i] = { ...fn(x[i]), ...(x[i].slotId ? { slotId: x[i].slotId } : {}) }; done = true } })
      if (done) toast(t('Replaced with “{0}”', exerciseNameText(ex)))
    }
    const picker: any = exercisePicker((ex: any, quick: any) => {
      // The slot and the history as they are now, not as this render saw them: a sync can land
      // while the picker is open, and the new exercise's weight comes from its own sessions.
      const live: any = useStore.getState().S
      const slot: any = live.routines.find((x: any) => x.id === id)?.ex[i]
      if (!slot || slot.id !== openedOn) { picker.close(); return }
      // "+" on the exercise that is already in the slot: nothing to replace, and no toast that
      // says something was.
      if (quick && ex.id === openedOn) { picker.close(); return }
      if (quick) { commit(ex, (current: any) => ({ ...opaqueConfig(current), ...replaceSlotExercise(current, ex.id, live, id, useStore.getState().index) })); return }
      const next: any = replaceSlotExercise(slot, ex.id, live, id, useStore.getState().index)
      exConfigSheet(ex, next, (cfg: any) => commit(ex, (current: any) => ({ ...opaqueConfig(current), id: ex.id, sg: current.sg, ...cfg })), null, r, null, null, t('Replace'))
    }, { title: t('Replace exercise'), like: openedOn })
  }
  const printRoutine: any = () => {
    const owner: any = useStore.getState().user?.name || ''
    // Android's print manager refuses a job without a name. The editor never leaves a name blank,
    // but a routine that arrived from an import or another client may have none.
    printPlan(S, owner, { routineId: id }, index)
  }
  const toggleLink: any = (i: any) => edit((ex: any) => {
    if (i < 1) return
    const cur: any = ex[i], prev: any = ex[i - 1]
    if (cur.sg && prev.sg && cur.sg === prev.sg) delete cur.sg
    else { const gid: any = prev.sg || ('sg' + uid()); prev.sg = gid; cur.sg = gid }
    cleanupSg(ex)
  })

  const addExercise: any = () => exercisePicker((ex: any, quick: any) => {
    if (quick) {
      if (edit((x: any) => x.push({ id: ex.id, ...defaultConfig(ex.id, undefined, useStore.getState().index) })) === false) return
      toast(t('“{0}” added to {1}', exerciseNameText(ex), r.name))
    } else {
      exConfigSheet(ex, null, (cfg: any) => edit((x: any) => { x.push({ id: ex.id, ...cfg }) }), null, r)
    }
  })

  const units: any = supersetUnits(r.ex)
  const unitFirst: any = new Set(units.filter((u: any) => u.length > 1).map((u: any) => u[0]))
  // Each superset gets a letter and each member its place in the round (A1, A2, B1…), so the
  // order you do them in reads off the list (#293).
  const ssPos: any = new Map()
  units.filter((u: any) => u.length > 1).forEach((u: any, k: any) => u.forEach((idx: any, n: any) => ssPos.set(idx, String.fromCharCode(65 + (k % 26)) + (n + 1))))
  const unitOf: any = new Map(units.flatMap((u: any) => u.map((idx: any) => [idx, u])))
  const editSuperset: any = (i: any) => {
    const sg: any = r.ex[i]?.sg
    if (!sg) return
    supersetSheet(supersetMeta(r.ex, unitOf.get(i)), (meta: any) => edit((ex: any) => { setSupersetMeta(ex, sg, meta) }))
  }
  const inSS: any = new Set(units.filter((u: any) => u.length > 1).flat())
  const profile: any = activeProfile(S)
  const missingCount: any = profile ? r.ex.filter((e: any) => !exAvailable(S, exOr(e.id, index))).length : 0
  const swipe: any = workoutControls(S).swipeSets

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/plan')} aria-label={t('Plan')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, margin: '0 12px' }}>
        <input className="input" defaultValue={r.name} style={{ fontWeight: 600, fontSize: 20, letterSpacing: '-.021em' }}
          onChange={(e: any) => update((s: any) => { s.routines.find((x: any) => x.id === id).name = e.target.value.trim() || t('Routine') })} />
      </div>
      <button className="iconbtn" aria-label={t('Pick an icon')} onClick={() => glyphPicker(r.emoji, (g: any) => update((s: any) => { s.routines.find((x: any) => x.id === id).emoji = g }))}><Icon name={glyphOf(r.emoji)} /></button>
    </div>

    <div className="sect-b" style={{ marginBottom: 16 }}>
      <SelectRow icon="chartLine" title={t('Progression')} sheetTitle={t('Progression')}
        value={r.prog || 'linear'} onChange={(v: any) => update((s: any) => { s.routines.find((x: any) => x.id === id).prog = v })}
        options={POLICIES_FOR.reps.map((p: any) => ({ value: p, label: t((POLICY_NAME as Record<string, string>)[p]), subtitle: t((POLICY_DESC as Record<string, string>)[p]) }))} />
      {/* Two controls that read alike and are not (issue #294). Progression picks how this
          routine's own targets move, and "No automatic progression" keeps them where they are.
          This switch decides whether the routine's workouts count at all: a deload routine's
          sessions open at its own numbers and are never the baseline the next regular session
          progresses from (session-start.js, history.js entryExcluded). */}
      <Row icon="chartLineSlash" iconTint="var(--orange)" title={t('Deload routine')}
        subtitle={t('Its workouts do not count toward progression. They still show in history and statistics.')}>
        <Switch checked={r.excludeFromProgression === true} onChange={(v: any) => update((s: any) => {
          const routine: any = s.routines.find((x: any) => x.id === id)
          if (v) routine.excludeFromProgression = true
          else delete routine.excludeFromProgression
        })} />
      </Row>
    </div>
    <div className="small dim" style={{ margin: '-10px 2px 16px' }}>
      {r.excludeFromProgression
        ? t('A deload routine opens at the numbers set here, so the progression above does not apply to it.') + ' ' + t('The next regular target continues from the last included workout.')
        : t((POLICY_DESC as Record<string, string>)[r.prog || 'linear'] || POLICY_DESC.linear) + ' ' + t('Applies to every exercise in this routine that does not set its own rule.')}
    </div>

    {missingCount > 0 && <div className="card" style={{ marginBottom: 16, borderColor: 'var(--orange)' }}>
      <div className="row" style={{ gap: 8, alignItems: 'center' }}>
        <Icon name="warning" style={{ color: 'var(--orange)' }} />
        <div className="small">{t('{0} of {1} exercises need equipment outside "{2}"', missingCount, r.ex.length, profile.name)}</div>
      </div>
    </div>}

    {/* "Add exercise" heads the list (v1.3.11): with it under the last exercise, a long routine
        had to be scrolled to the bottom before anything could be added. */}
    <div className="row between plan-sec-h routine-ex-h">
      <h4 className="sec">{t('Exercises')}</h4>
      <Button size="sm" variant="tinted" icon="plus" onClick={addExercise}>{t('Add exercise')}</Button>
    </div>
    {r.ex.length ? <div ref={reorder.listRef} onClickCapture={reorder.onClickCapture}
      className={'list routine-list' + (reorder.drag ? ' is-reordering' : '')}>{r.ex.map((e: any, i: any) => {
      // An unresolvable id is shown rather than skipped — hiding it left an entry you
      // could neither see nor delete, but that still turned up in the workout.
      const ex: any = exOr(e.id, index)
      const noEquip: any = profile && !exAvailable(S, ex)
      const linkedPrev: any = i > 0 && e.sg && r.ex[i - 1].sg === e.sg
      // At a superset's edge an arrow takes the exercise out of it rather than past a neighbour.
      const leavesUp: any = inSS.has(i) && !linkedPrev
      const leavesDown: any = inSS.has(i) && r.ex[i + 1]?.sg !== e.sg
      const isDragging: any = reorder.drag && i >= reorder.drag.first && i <= reorder.drag.last
      const removeHere: any = () => r.programme ? edit((x: any) => { x.splice(i, 1); cleanupSg(x) }) : removeRoutineExercise(id, i, target)
      // A tap anywhere on the row opens the exercise's sheet; its Remove is the keyboard's way
      // to take it out. The row itself is no button (it holds the link and Move buttons, which a
      // screen reader would lose inside one): the name is, a real <button> a click bubbles up
      // from. The long press treats it as the row (data-row-open, useRoutineReorder).
      const item: any = <div className={'item' + (inSS.has(i) ? ' in-ss' : '')} onClick={() => {
          exConfigSheet(ex, e, (cfg: any) => edit((x: any) => { x[i] = { ...opaqueConfig(x[i]), id: x[i].id, ...(x[i].slotId ? { slotId: x[i].slotId } : {}), sg: x[i].sg, ...(x[i].sg ? { sgName: x[i].sgName, sgRest: x[i].sgRest } : {}), ...cfg }; cleanupSg(x) }), removeHere, r, null, () => replace(i))
        }}>
          {/* Shown on pointer devices only (index.css .routine-grip); the Move buttons and the
              long press stay the way in for a keyboard and a finger. */}
          <span className="routine-grip" data-drag-handle aria-hidden="true" title={t('Reorder exercises')}><Icon name="grip" /></span>
          {ssPos.has(i) && <span className="ss-pos" aria-label={t('Superset position {0}', ssPos.get(i))}>{ssPos.get(i)}</span>}
          
          <button type="button" className="grow item-open" data-row-open><span className={`tt ${exerciseNameClass(ex)}`}>{exerciseNameFor(ex)}</span><span className="ss">{exLine(e, S.unit, speedUnitOf(S), index)}</span>
            {e.note && <span className="small dim" style={{ marginTop: 2 }}>{programmeNote(S,e,r)}</span>}</button>
          {noEquip && <span className="tag" style={{ color: 'var(--orange)', borderColor: 'var(--orange)' }} title={t('Needs {0}, which isn’t in your active profile', t(ex.eq))}><Icon name="warning" /></span>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 'none', alignItems: 'center' }}>
            {i > 0 && <button className={'iconbtn' + (linkedPrev ? ' on-ss' : '')} title={t('Superset with exercise above')} style={{ width: 32, height: 28, borderRadius: 8, fontSize: 15 }} onClick={(ev: any) => { ev.stopPropagation(); toggleLink(i) }}><Icon name="link" /></button>}
            <div style={{ display: 'flex', gap: 2 }}>
              <button className="iconbtn" aria-label={t('Move up')} title={leavesUp ? t('Move out of the superset') : t('Move up')} disabled={!moveRoutineEntry(r.ex, i, -1)} style={{ width: 28, height: 24, borderRadius: 7, fontSize: 12 }} onClick={(ev: any) => { ev.stopPropagation(); move(i, -1) }}><Icon name="chevronUp" /></button>
              <button className="iconbtn" aria-label={t('Move down')} title={leavesDown ? t('Move out of the superset') : t('Move down')} disabled={!moveRoutineEntry(r.ex, i, 1)} style={{ width: 28, height: 24, borderRadius: 7, fontSize: 12 }} onClick={(ev: any) => { ev.stopPropagation(); move(i, 1) }}><Icon name="chevronDown" /></button>
            </div>
          </div>
        </div>
      return <div key={rowKeys[i]} data-routine-row data-ex-index={i}
        className={'routine-drag-row' + (isDragging ? ' is-dragging' : '')}
        style={isDragging ? { transform: `translate3d(0, ${reorder.drag.deltaY}px, 0)` } : undefined}>
        {unitFirst.has(i) && (() => {
          const meta: any = supersetMeta(r.ex, unitOf.get(i))
          return <button type="button" className="ss-label ss-label-btn" onClick={() => editSuperset(i)} title={t('Name and rest of this superset')}>
            <Icon name="link" /><span className="ss-label-name">{meta.name || t('Superset')}</span>
            {meta.rest > 0 && <span className="dim">· {t('{0} rest after each round', fmtRest(meta.rest))}</span>}
            <Icon name="pencil" />
          </button>
        })()}
        {/* Swipe (v1.3.11, Settings → Swipe actions): toward the start takes the exercise out,
            with an Undo; nothing on the other side. The long press still picks the row up to
            reorder it (a press that has lifted keeps the swipe out), and the row's sheet keeps
            Remove for a keyboard. Occurrence keys and the owner/list close key cancel stale swipes. */}
        {swipe
          ? <SwipeRow className="swrow-item" deleteLabel={t('Remove')} deleteIcon="minus" closeKey={gestureKey}
            canSwipe={() => !reorder.lifted()} onDelete={removeHere}>{item}</SwipeRow>
          : item}
      </div>
    })}{reorder.drag && <div className="routine-drop-indicator" data-testid="routine-drop-indicator"
      aria-hidden="true" style={{ top: `${reorder.drag.indicatorTop}px` }} />}</div> : <div className="empty"><div className="ico"><Icon name="dumbbell" /></div>{t('No exercises yet. Add your first one!')}</div>}

    {/* Coverage of the routine as planned, so a gap shows up while you're building it
        rather than after a month of training around it. */}
    {r.ex.length > 0 && (() => {
      const load: any = loadOfRoutine(r, {}, index)
      const { worked } = rankOf(load)
      return <div className="card" style={{ marginTop: 12 }}>
        <h2>{t('What this session hits')}</h2>
        <BodyMap load={load} body={S.body} />
        <div className="mchips">
          {worked.slice(0, 6).map((m: any) => <span key={m} className="mchip">{t((MUSCLE_NAME as Record<string, string>)[m])}</span>)}
        </div>
      </div>
    })()}

    <div className="small dim row" style={{ margin: '10px 2px', gap: 5 }}><Icon name="link" style={{ fontSize: 13 }} />{t('Tap the link button on an exercise to superset it with the one above. You’ll do them back-to-back.')}</div>
    <Button onClick={() => {
      const copy: any = copyRoutine(r, t('Copy'))
      if (!update((s: any) => { s.routines.push(copy) })) return
      nav('/plan/r/' + copy.id)
    }}>{t('Copy routine')}</Button>
    <div style={{ height: 10 }} />
    <Button disabled={!r.ex.length} onClick={printRoutine}>{t('Print / Save as PDF')}</Button>
    <div style={{ height: 10 }} />
    <Button variant="danger" onClick={() => { if (!validatePlanTarget(target)) return; return r.programme ? programmeSkipSheet(r) : confirmSheet({
      title: t('Delete routine?'), message: t('“{0}” and its exercises will be removed.', r.name), confirmText: t('Delete'), danger: true,
      onConfirm: () => {
        if (!update((s: any) => { deleteRoutine(s, id) })) return
        nav('/plan')
      }
    }) }}>{t('Delete routine')}</Button>
  </div>
}
