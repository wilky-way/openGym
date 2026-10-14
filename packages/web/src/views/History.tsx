import { useStore, type StoreDocument } from '../store/useStore'
import { t, tn } from '../lib/i18n'
import { nav } from '../lib/nav'
import { WorkoutRow, DayNoteRow, workoutDetailSheet, logPastWorkoutSheet } from './view-services'
import { Button } from '../components/ui'
import Icon from '../components/Icon'
import { dayNoteOf } from '@opengym/core/day-notes'
import { captureWorkoutTarget, workoutTargetCallback } from './workout-target'

interface HistoryRow { d: string; w?: StoreDocument; note?: ReturnType<typeof dayNoteOf> }
/** Stable newest-first order, including untrained days with notes. */
export function historyRows(S: StoreDocument): HistoryRow[] {
  const workouts: StoreDocument[] = S.workouts || []
  const trained = new Set(workouts.map(w => w?.d))
  const notes = Object.keys(S.dayNotes || {}).filter(d => !trained.has(d)).map(d => ({ d, note: dayNoteOf(S, d) })).filter(x => x.note)
  const rows: HistoryRow[] = [...workouts.map(w => ({ d: w.d, w })), ...notes]
  return rows.map((row, at) => ({ row, at })).sort((a, b) => a.row.d < b.row.d ? 1 : a.row.d > b.row.d ? -1 : b.at - a.at).map(({row}) => row)
}

export default function History() {
  const S = useStore(s => s.S), rows = historyRows(S)
  const target = captureWorkoutTarget()
  return <>
    <div className="hdr"><button className="iconbtn" onClick={() => nav('/stats')} aria-label={t('Stats')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginInlineStart: 12 }}><h1>{t('History')}</h1><div className="sub">{tn('{0} workout', '{0} workouts', S.workouts.length)}</div></div></div>
    <Button icon="plus" onClick={workoutTargetCallback(target, () => logPastWorkoutSheet())} style={{ marginBottom: 12 }}>{t('Log a past workout')}</Button>
    {rows.length ? <div className="list">{rows.map(r => r.w
      ? <WorkoutRow key={r.w.id} w={r.w} onClick={workoutTargetCallback(target, () => workoutDetailSheet(r.w!))} />
      : <DayNoteRow key={'note-' + r.d} iso={r.d} note={r.note!} />)}</div>
      : <div className="empty"><div className="ico"><Icon name="history" /></div>{t('No workouts yet. Your first one will land here.')}</div>}
  </>
}
