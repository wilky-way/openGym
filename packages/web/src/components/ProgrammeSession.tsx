// Persisted programme records retain legacy unknown fields; core validates mutations.
import { createExerciseIndex } from '@opengym/core/exercises'
import { ProgrammeSheet, programmeOwner, programmeTarget, updateProgramme, type ProgrammeTarget } from '../lib/programme-ui-services'
import { programmeInstructions } from '@opengym/core/programme-instructions'
import { effortOf as programmeEffortOf } from '@opengym/core/history'
import { programmeTMConfig } from '@opengym/core/programme-tm'
import { setTargetAt, targetLabel, programmeNote } from '@opengym/core/programme-targets'
import { loggedProgrammeWorkout } from '@opengym/core/programme-ui'
import { useStore } from '../store/useStore'
import { useUI } from '../store/useUI'
import { Button } from './ui'
import { t } from '../lib/i18n'
import { fmtDate, todayISO } from '@opengym/core/format'
import { projectCycle } from '@opengym/core/programme-calendar'
import { skip } from '@opengym/core/programme'
import { startFlow, confirmSheet, workoutDetailSheet } from '../lib/programme-ui-services'
import { exOr } from '@opengym/core/exercises'
import { exerciseNameFor } from '../lib/i18n'

export function programmeSkipSheet(routine: import("@opengym/core/programme-engine-types").Routine) {
  confirmSheet({ title: t('Skip this session?'), message: t('The session stays in your program as skipped. Later sessions move earlier.'),
    confirmText: t('Skip this session'), onConfirm: valid => {
      try { updateProgramme((s: any) => skip(s, routine.programme!.cycleId, routine.programme!.instanceId), valid) }
      catch (err: any) { useUI.getState().toast(t(err.message)) }
    } }, (draft = useStore.getState().S) => {
      const live = draft.routines.find((r:any)=>r.id===routine.id)
      return live?.programme?.cycleId===routine.programme!.cycleId && live?.programme?.instanceId===routine.programme!.instanceId
    })
}

export function programmeSessionSheet(occurrence: import("@opengym/core/programme-engine-types").ProjectedProgrammeOccurrence) {
  const owner = programmeOwner()
  const S = useStore.getState().S
  const cycleId = S.routines.find((r: any) => r.id === occurrence.routineId)?.programme?.cycleId
  const valid = programmeTarget(owner, (draft = useStore.getState().S) => {
    const routine = draft.routines.find((r: any) => r.id === occurrence.routineId)
    const cycle = draft.programmes.cycles.find((c: any) => c.id === cycleId)
    const live = cycle && projectCycle(cycle, draft.workouts, todayISO(), draft.queue).occurrences.find(o => o.instanceId === occurrence.instanceId)
    return routine?.programme?.cycleId === cycleId && routine?.programme?.instanceId === occurrence.instanceId && !!cycle && live?.status === 'pending'
  })
  const logged = loggedProgrammeWorkout(S.workouts, occurrence)
  if (occurrence.status === 'done' && logged) return workoutDetailSheet(logged)
  useUI.getState().openSheet((close) => <ProgrammeSheet owner={owner} close={close} render={() => <Session occurrence={occurrence} valid={valid} close={close} />} />)
}
function Session({ occurrence: o, close, valid }: {valid:ProgrammeTarget;occurrence: import("@opengym/core/programme-engine-types").ProjectedProgrammeOccurrence; close: () => void}) {
  const S = useStore((s) => s.S)
  const r = S.routines.find((r: any) => r.id === o.routineId)
  return <>
    <h3>{r?.name || o.routineName}</h3>
    <p style={{color:"var(--label)"}}> {o.date && fmtDate(o.date, true)} · {o.status === 'skipped' ? t('Skipped') : o.status === 'done' ? t('Done') : t('Projected session')}</p>
    <div className="list">{r?.ex.map((e: any, i: any) => {
      const cfg=programmeTMConfig(S,e,r,createExerciseIndex(S.customEx))
      const tmSet=e.tm && Number(S.programmes?.cycles?.find((c: any) =>c.id===r.programme?.cycleId)?.tm?.[e.tm.key || e.id])>0
      return <div className="item" key={i}><div className="grow">
        <div className="tt">{e.open && !e.id ? e.label || t('Choose exercise') : exerciseNameFor(exOr(e.id,createExerciseIndex(S.customEx)))}</div>
        <div className="ss">{e.sets} × {e.repsMin && e.repsMin!==e.reps ? `${e.repsMin}–` : ''}{e.reps}
          {Array.from({length:e.pyramid?.length || e.sets},(_: any, n: any) =><div key={n}>{t('Set {0}',n+1)} · {(e.setRepsMin?.[n] ?? e.repsMin) != null ? `${e.setRepsMin?.[n] ?? e.repsMin}–` : ''}{e.pyramid?.[n] ?? e.reps}{setTargetAt(e,n) && ' · '+targetLabel(setTargetAt(e,n),t,programmeEffortOf(S))}{tmSet && ` · ${cfg.pyramidWeight[n]} ${S.unit}`}</div>)}
        </div>{e.note && <div className="exnote">{programmeNote(S,e,r)}</div>}{e.instructions && <p className="programme-instructions">{programmeInstructions(S,e)}</p>}
      </div></div>
    })}</div>
    {o.status === 'pending' && r && <Button variant="primary" onClick={() => {
      close()
      if (!valid()) return
      if (useStore.getState().S.active) useUI.getState().toast(t('A workout is already in progress.'))
      else startFlow([r.id])
    }}>{t('Start')}</Button>}
  </>
}
