import { nativeMaxLabel } from '@opengym/core/native-prescription'
import { useState } from 'react'
import type { ProgrammeCycle } from '@opengym/contract/domain/state-doc'
import { effectiveProgrammeMax, maxBasisLabel, programmeMaxKeys, setTrainingMax } from '@opengym/core/programme-max'
import { createExerciseIndex } from '@opengym/core/exercises'
import { buildSessionEntries } from '@opengym/core/session-start'
import { resolveOccurrences } from '@opengym/core/programme-sync'
import { todayISO } from '@opengym/core/format'
import { programmeOwner, programmeTarget, ProgrammeSheet, type ProgrammeTarget } from '../lib/programme-ui-services'
import { useStore } from '../store/useStore'
import { useUI } from '../store/useUI'
import { Button } from './ui'

export function adjustProgrammeMaxSheet(cycleId: string, opened: ProgrammeTarget = programmeTarget()) {
  if (!opened()) return
  const S = useStore.getState().S, owner = programmeOwner()
  const cycle = S.programmes?.cycles.find((c: ProgrammeCycle)=>c.id===cycleId)
  if (!cycle || !['active','paused'].includes(cycle.status)) {useUI.getState().toast('The program changed. Open it again.');return}
  const fingerprint = JSON.stringify(cycle)
  const valid = programmeTarget(owner,draft=>opened(draft) && JSON.stringify((draft ?? useStore.getState().S).programmes?.cycles.find((c: ProgrammeCycle)=>c.id===cycleId))===fingerprint)
  useUI.getState().openSheet(close=><ProgrammeSheet owner={owner} close={close} render={()=><MaxEditor cycle={cycle} valid={valid} close={close}/>}/>)
}
function MaxEditor({cycle,valid,close}: {cycle:ProgrammeCycle;valid:ProgrammeTarget;close():void}) {
  const S = useStore(s=>s.S), unit = S.unit === 'kg' ? 'kg' : 'lb', today = todayISO()
  const [lift,setLift] = useState(programmeMaxKeys(cycle.snapshot,cycle)[0] ?? '')
  const index = createExerciseIndex(S.customEx)
  const current = effectiveProgrammeMax(S as any,cycle,lift,today,unit,index)
  const [value,setValue] = useState(current == null ? '' : String(Math.round(current*100)/100))
  const [reason,setReason] = useState(''), [error,setError] = useState('')
  const numeric = value.trim() ? Number(value) : NaN
  const okay = Number.isFinite(numeric) && numeric > 0
  let preview = ''
  if (okay) {
    try {
      const draft = structuredClone(S)
      setTrainingMax(draft as any,cycle.id,{lift,value:numeric,unit,today,reason},index)
      const activeIds = new Set(S.active?.routineIds ?? [])
      const pending = resolveOccurrences(cycle,draft.workouts).filter(o=>o.status==='pending' && !activeIds.has(o.routineId))
      const routine = draft.routines.find((r: any)=>pending.some(o=>o.routineId===r.id))
      const entries = routine ? buildSessionEntries(draft,routine,index) : []
      if (entries.length) preview = `${routine.name || 'Next session'}: ${entries.map((e:{sets:{w?:number}[]})=>e.sets.map(s=>s.w).join(' / ')).join(' · ')} ${unit}`
    } catch (err) { preview = err instanceof Error ? err.message : 'Preview unavailable' }
  }
  return <><h3>Adjust {maxBasisLabel(cycle.snapshot)}</h3>
    <p>Changes apply to future sessions. Your running workout and completed logs keep their prescribed values.</p>
    <label style={{display:'block',marginBottom:12}}>Lift<select className="field" aria-label="Lift" value={lift} onChange={e=>{const key=e.target.value;setLift(key);const n=effectiveProgrammeMax(S as any,cycle,key,today,unit,index);setValue(n == null ? '' : String(Math.round(n*100)/100))}}>{programmeMaxKeys(cycle.snapshot,cycle).map(key=><option key={key} value={key}>{nativeMaxLabel(cycle.snapshot,key)}</option>)}</select></label>
    <p>Current: {current == null ? 'Unavailable' : `${Math.round(current*100)/100} ${unit}`} · Effective {today}</p>
    <label style={{display:'block',marginBottom:12}}>New max ({unit})<input className="field" aria-label={`New max (${unit})`} type="number" min="0" step="any" value={value} onChange={e=>setValue(e.target.value)}/></label>
    <label style={{display:'block',marginBottom:12}}>Reason (optional)<input className="field" aria-label="Reason (optional)" maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)}/></label>
    {preview && <p aria-label="Future prescription preview">{preview}</p>}
    {!okay && <p role="alert">Enter a positive finite max.</p>}
    {error && <p role="alert">{error}</p>}
    <Button variant="primary" disabled={!okay} onClick={()=>{try{useStore.getState().setTrainingMax(cycle.id,{lift,value:numeric,unit,today,reason},valid);close()}catch(err){setError(err instanceof Error ? err.message : 'Could not save max.')}}}>Save max</Button>
    <Button onClick={close}>Cancel</Button>
  </>
}
