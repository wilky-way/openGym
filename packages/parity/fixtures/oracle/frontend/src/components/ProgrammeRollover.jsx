import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { Button } from './ui.jsx'
import { t, exerciseNameFor } from '../lib/i18n.js'
import { exOr } from '../lib/exercises.js'
import { undoMarks, markUndone } from '../lib/sync-merge.js'
import { todayISO } from '../lib/format.js'
import { needsRollover, rolloverProposals, acceptRollover, finishProgrammeBlock } from '../lib/programme-rollover.js'

export function acceptRolloverWithUndo(cycleId,proposals,selected) {
  const st=useStore.getState(),before=structuredClone(st.S)
  st.update(s=>acceptRollover(s,cycleId,proposals,selected))
  const after=useStore.getState().S, marks=undoMarks(before,after)
  const part=s=>JSON.stringify({cycle:s.programmes.cycles.find(c=>c.id===cycleId),routines:s.routines,queue:s.queue,workouts:s.workouts,active:s.active})
  const expected=part(after)
  useUI.getState().toast(t('Progression accepted'),{action:t('Undo'),onAction:()=>{
    const live=useStore.getState()
    if(part(live.S)!==expected){useUI.getState().toast(t('The plan has changed. Undo is no longer available.'));return}
    live.update(s=>{s.routines=structuredClone(before.routines);s.programmes.cycles=s.programmes.cycles.map(c=>c.id===cycleId?structuredClone(before.programmes.cycles.find(x=>x.id===cycleId)):c);markUndone(s,marks)})
  }})
}
export function rolloverSheet(cycleId) {
  useUI.getState().openSheet(close => <Review cycleId={cycleId} close={close} />)
}
const proposalKey=p=>`${p.instanceId}:${p.slotId}`
function Review({cycleId,close}) {
  const S = useStore(s=>s.S), c = S.programmes.cycles.find(c=>c.id===cycleId)
  const proposals = rolloverProposals(S,cycleId)
  const [excluded,setExcluded] = useState([]), [error,setError] = useState('')
  return <><h3>{t('Review week {0}',c?.rollover?.fromWeekIndex)}</h3>
    <p>{t('Loads progress when you start. Review set counts for the next week.')}</p>
    {proposals.map((p,i)=><label className="row" key={p.instanceId+p.slotId} style={{gap:8,marginBlock:12}}><input type="checkbox" checked={!excluded.includes(proposalKey(p))} onChange={()=>setExcluded(excluded.includes(proposalKey(p))?excluded.filter(x=>x!==proposalKey(p)):[...excluded,proposalKey(p)])}/><span>{exerciseNameFor(exOr(p.exerciseId))} · {t('{0} → {1} sets',p.currentSets,p.sets)} · {p.reason==='held'?t('Reps held'):p.reason==='dropped'?t('Reps dropped: hold sets'):t('No data: hold sets')}</span></label>)}
    {!proposals.length && <p>{t('No set changes to propose. The authored next week stays in place.')}</p>}
    {error && <p role="alert">{error}</p>}
    <Button variant="primary" disabled={!!S.active || !needsRollover(c || {})} onClick={()=>{try{acceptRolloverWithUndo(cycleId,proposals,proposals.map((_,i)=>i).filter(i=>!excluded.includes(proposalKey(proposals[i]))));close()}catch(err){setError(t(err.message))}}}>{t('Accept and continue')}</Button>
  </>
}
export default function ProgrammeRollover() {
  const S = useStore(s=>s.S), nav = useNavigate()
  const running = S.programmes?.cycles.find(c=>['active','paused'].includes(c.status))
  const c = running || S.programmes?.cycles.filter(c=>c.status==='finished' && !c.endHandled).at(-1)
  if (!c) return null
  if (needsRollover(c)) return <section className="card"><h3>{t('Week {0} complete',c.rollover.fromWeekIndex)}</h3><Button onClick={()=>rolloverSheet(c.id)}>{t('Review next week')}</Button></section>
  if (c.status !== 'finished' || c.endHandled) return null
  const choose = choice => {
    try {
      useStore.getState().update(s=>finishProgrammeBlock(s,c.id,choice,{today:todayISO()}))
      if (choice==='next') {localStorage.setItem('gym_plan_view','programs');nav('/plan')}
    } catch(err) {useUI.getState().toast(t(err.message))}
  }
  return <section className="card"><h3>{t('Block complete')}</h3><p>{c.snapshot?.name} · {t('Lap {0}',c.lap || 1)}</p><p>{t('Choose what comes next. Repeat keeps your progression history and applies the saved training max increments.')}</p><div className="row" style={{gap:8,flexWrap:'wrap'}}><Button disabled={!!S.active} onClick={()=>choose('next')}>{t('Pick next program')}</Button><Button disabled={!!S.active} variant={c.end==='repeat'?'primary':'secondary'} onClick={()=>choose('repeat')}>{t('Repeat block')}</Button><Button disabled={!!S.active} onClick={()=>choose('stop')}>{t('Stop program')}</Button></div></section>
}
