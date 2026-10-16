import { programmeInstructions } from '../lib/programme-instructions.js'
import { effortOf as programmeEffortOf } from '../lib/history.js'
import { programmeTMConfig } from '../lib/programme-tm.js'
import { setTargetAt, targetLabel, programmeNote } from '../lib/programme-targets.js'
import { loggedProgrammeWorkout } from '../lib/programme-ui.js'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { Button } from './ui.jsx'
import { t } from '../lib/i18n.js'
import { fmtDate } from '../lib/format.js'
import { skip } from '../lib/programme.js'
import { startFlow, confirmSheet, workoutDetailSheet } from '../sheets.jsx'
import { exOr } from '../lib/exercises.js'
import { exerciseNameFor } from '../lib/i18n.js'

export function programmeSkipSheet(routine) {
  confirmSheet({ title: t('Skip this session?'), message: t('The session stays in your program as skipped. Later sessions move earlier.'),
    confirmText: t('Skip this session'), onConfirm: () => {
      try { useStore.getState().update(s => skip(s, routine.programme.cycleId, routine.programme.instanceId)) }
      catch (err) { useUI.getState().toast(t(err.message)) }
    } })
}

export function programmeSessionSheet(occurrence) {
  const S = useStore.getState().S
  const logged = loggedProgrammeWorkout(S.workouts, occurrence)
  if (occurrence.status === 'done' && logged) return workoutDetailSheet(logged)
  useUI.getState().openSheet(close => <Session occurrence={occurrence} close={close} />)
}
function Session({ occurrence: o, close }) {
  const S = useStore(s => s.S)
  const r = S.routines.find(r => r.id === o.routineId)
  return <>
    <h3>{r?.name || o.routineName}</h3>
    <p style={{color:"var(--label)"}}> {o.date && fmtDate(o.date, true)} · {o.status === 'skipped' ? t('Skipped') : o.status === 'done' ? t('Done') : t('Projected session')}</p>
    <div className="list">{r?.ex.map((e, i) => {
      const cfg=programmeTMConfig(S,e,r)
      const tmSet=e.tm && Number(S.programmes?.cycles?.find(c=>c.id===r.programme?.cycleId)?.tm?.[e.tm.key || e.id])>0
      return <div className="item" key={i}><div className="grow">
        <div className="tt">{e.open && !e.id ? e.label || t('Choose exercise') : exerciseNameFor(exOr(e.id))}</div>
        <div className="ss">{e.sets} × {e.repsMin && e.repsMin!==e.reps ? `${e.repsMin}–` : ''}{e.reps}
          {Array.from({length:e.pyramid?.length || e.sets},(_,n)=><div key={n}>{t('Set {0}',n+1)} · {(e.setRepsMin?.[n] ?? e.repsMin) != null ? `${e.setRepsMin?.[n] ?? e.repsMin}–` : ''}{e.pyramid?.[n] ?? e.reps}{setTargetAt(e,n) && ' · '+targetLabel(setTargetAt(e,n),t,programmeEffortOf(S))}{tmSet && ` · ${cfg.pyramidWeight[n]} ${S.unit}`}</div>)}
        </div>{e.note && <div className="exnote">{programmeNote(S,e,r)}</div>}{e.instructions && <p className="programme-instructions">{programmeInstructions(S,e)}</p>}
      </div></div>
    })}</div>
    {o.status === 'pending' && r && <Button variant="primary" onClick={() => { close(); if (S.active) useUI.getState().toast(t('A workout is already in progress.')); else startFlow([r.id]) }}>{t('Start')}</Button>}
  </>
}
