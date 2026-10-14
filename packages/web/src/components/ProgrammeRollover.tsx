// Persisted programme records retain legacy unknown fields; core validates mutations.
import { createExerciseIndex } from '@opengym/core/exercises'
import { useState } from 'react'
import { nav } from '../lib/nav'
import { ProgrammeSheet, programmeOwner, setProgrammePreference, programmeTarget, updateProgramme, type ProgrammeTarget } from '../lib/programme-ui-services'
import { useStore } from '../store/useStore'
import { useUI } from '../store/useUI'
import { Button } from './ui'
import { t, exerciseNameFor } from '../lib/i18n'
import { exOr } from '@opengym/core/exercises'
import { undoMarks, markUndone } from '@opengym/core/sync-merge'
import { todayISO } from '@opengym/core/format'
import { needsRollover, rolloverProposals, acceptRollover } from '@opengym/core/programme-rollover'

export function acceptRolloverWithUndo(cycleId: string,proposals: ReturnType<typeof rolloverProposals>,selected: number[], valid: ProgrammeTarget = programmeTarget()) {
  const owner=programmeOwner(),st=useStore.getState(),before=structuredClone(st.S)
  if (!updateProgramme((s: any) =>acceptRollover(s,cycleId,proposals,selected,createExerciseIndex(s.customEx)), valid)) return false
  const after=useStore.getState().S, marks=undoMarks(before,after)
  const part=(s: any) =>JSON.stringify({cycle:s.programmes.cycles.find((c: any) =>c.id===cycleId),routines:s.routines,queue:s.queue,workouts:s.workouts,active:s.active})
  const expected=part(after), undoTarget=programmeTarget(owner,draft=>part(draft ?? useStore.getState().S)===expected)
  useUI.getState().toast(t('Progression accepted'),{action:t('Undo'),onAction:()=>{
    const live=useStore.getState()
    if(owner!==programmeOwner()){useUI.getState().toast(t('Account changed. Undo is no longer available.'));return}
    if(part(live.S)!==expected){useUI.getState().toast(t('The plan has changed. Undo is no longer available.'));return}
    updateProgramme((s: any) =>{s.routines=structuredClone(before.routines);s.programmes.cycles=s.programmes.cycles.map((c: any) =>c.id===cycleId?structuredClone(before.programmes.cycles.find((x: any) =>x.id===cycleId)):c);markUndone(s,marks)},undoTarget)
  }})
  return true
}
export function rolloverSheet(cycleId: string) {
  const owner = programmeOwner(), stage = JSON.stringify(useStore.getState().S.programmes.cycles.find((c: any) => c.id === cycleId)?.rollover)
  const valid = programmeTarget(owner, (draft = useStore.getState().S) => !draft.active && JSON.stringify(draft.programmes.cycles.find((c: any) => c.id === cycleId)?.rollover) === stage)
  useUI.getState().openSheet((close) => <ProgrammeSheet owner={owner} close={close} render={() => <Review cycleId={cycleId} valid={valid} close={close} />} />)
}
const proposalKey=(p: any) =>`${p.instanceId}:${p.slotId}`
function Review({cycleId,close,valid}: {valid:ProgrammeTarget;cycleId: string; close: () => void}) {
  const S = useStore((s) =>s.S), c = S.programmes.cycles.find((c: any) =>c.id===cycleId)
  const proposals = rolloverProposals(S,cycleId,createExerciseIndex(S.customEx))
  const [excluded,setExcluded] = useState<string[]>([]), [error,setError] = useState('')
  return <><h3>{t('Review week {0}',c?.rollover?.fromWeekIndex)}</h3>
    <p>{t('Loads progress when you start. Review set counts for the next week.')}</p>
    {proposals.map((p: any, i: any) =><label className="row" key={p.instanceId+p.slotId} style={{gap:8,marginBlock:12}}><input type="checkbox" checked={!excluded.includes(proposalKey(p))} onChange={()=>setExcluded(excluded.includes(proposalKey(p))?excluded.filter((x: any) =>x!==proposalKey(p)):[...excluded,proposalKey(p)])}/><span>{exerciseNameFor(exOr(p.exerciseId,createExerciseIndex(S.customEx)))} · {t('{0} → {1} sets',p.currentSets,p.sets)} · {p.reason==='held'?t('Reps held'):p.reason==='dropped'?t('Reps dropped: hold sets'):t('No data: hold sets')}</span></label>)}
    {!proposals.length && <p>{t('No set changes to propose. The authored next week stays in place.')}</p>}
    {error && <p role="alert">{error}</p>}
    <Button variant="primary" disabled={!!S.active || !needsRollover(c || {})} onClick={()=>{try{if(acceptRolloverWithUndo(cycleId,proposals,proposals.map((_: any, i: any) =>i).filter((i: any) =>!excluded.includes(proposalKey(proposals[i]))),valid))close()}catch(err: any){setError(t(err.message))}}}>{t('Accept and continue')}</Button>
  </>
}
export default function ProgrammeRollover() {
  const S = useStore((s) =>s.S), owner = programmeOwner()
  const running = S.programmes?.cycles.find((c: any) =>['active','paused'].includes(c.status))
  const c = running || S.programmes?.cycles.filter((c: any) =>c.status==='finished' && !c.endHandled).at(-1)
  if (!c) return null
  if (needsRollover(c)) return <section className="card"><h3>{t('Week {0} complete',c.rollover.fromWeekIndex)}</h3><Button onClick={()=>rolloverSheet(c.id)}>{t('Review next week')}</Button></section>
  if (c.status !== 'finished' || c.endHandled) return null
  const choiceTarget = programmeTarget(owner,(draft = useStore.getState().S)=>!draft.active && draft.programmes.cycles.some((x:any)=>x.id===c.id && x.status==='finished' && !x.endHandled))
  const choose = (choice: any) => {
    try {
      useStore.getState().finishProgrammeBlock(c.id,choice,{today:todayISO()},choiceTarget)
      if (choice==='next') {setProgrammePreference('gym_plan_view','programs');nav('/plan')}
    } catch(err: any) {useUI.getState().toast(t(err.message))}
  }
  return <section className="card"><h3>{t('Block complete')}</h3><p>{c.snapshot?.name} · {t('Lap {0}',c.lap || 1)}</p><p>{t('Choose what comes next. Repeat keeps your progression history and applies the saved training max increments.')}</p><div className="row" style={{gap:8,flexWrap:'wrap'}}><Button disabled={!!S.active} onClick={()=>choose('next')}>{t('Pick next program')}</Button><Button disabled={!!S.active} variant={c.end==='repeat'?'primary':'secondary'} onClick={()=>choose('repeat')}>{t('Repeat block')}</Button><Button disabled={!!S.active} onClick={()=>choose('stop')}>{t('Stop program')}</Button></div></section>
}
