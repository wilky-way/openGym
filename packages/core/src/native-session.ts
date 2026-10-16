import type { Config, State, Routine, Row } from './session-types'
import type { ProgrammeCycle } from '../../contract/domain/state-doc'
import type { ProgrammeState } from './programme-engine-types'
import { EXIDX, type ExerciseIndex } from './exercises'
import { effectiveProgrammeMax, programmeMaxBasis } from './programme-max'
import { todayISO } from './format'
import { dropGrid } from './plates'
import type { Profile } from './progression'
import { snapWeight, weightIncrement } from './progression'
import { nativeRowIdentity } from './native-prescription'
import { hasNativeRelativeLoad } from './native-relative-load'
import { validateNativeSlot, validateNativeBasis } from './native-authority'
/** No legacy history/default/endpoint fill is allowed to supply a native actual entry. */
export function buildNativeEntry(S:State,cfg:Config,routine:Routine|null|undefined,index:ExerciseIndex=EXIDX) {
  const prescription=validateNativeSlot(cfg,index)
  const cycle=S.programmes?.cycles?.find(c=>c.id===routine?.programme?.cycleId) as ProgrammeCycle|undefined
  if(cycle)validateNativeBasis(prescription,cycle.snapshot.maxBasis)
  const sets:Row[]=prescription.sets.map((target,i)=>{
    const row:Row={done:false,nativeTarget:structuredClone(target)}
    if(hasNativeRelativeLoad(prescription))row.nativeRowIdentity=nativeRowIdentity(prescription,i+1)
    if(target.reps.kind==='fixed')row.r=target.reps.min
    const pct=target.percentage
    if(pct?.role==='prescribed') {
      if(cycle && programmeMaxBasis(cycle.snapshot)!==pct.basis)throw new Error('Native percentage basis is unavailable or inconsistent')
      const reference=cycle?effectiveProgrammeMax(S as ProgrammeState,cycle,pct.key,todayISO(),S.unit==='kg'?'kg':'lb',index):null
      if(reference==null)row.nativeLoadReason=`Set ${pct.basis==='1rm'?'1RM':pct.basis==='e1rm'?'e1RM':'TM'} for this exact variant`
      else {
        const raw=reference*pct.min/100,grid=dropGrid(S as unknown as Profile,cfg,index),step=weightIncrement(cfg,S.unit,index)
        row.w=typeof grid==='function'?grid(raw):snapWeight(raw,step)
      }
    } else if(target.relativeLoad)row.nativeLoadReason=`Pending: complete anchor set ${target.relativeLoad.anchor.rowOrdinal}`
    else row.nativeLoadReason=pct?.role==='guide'?'Percentage is guidance; enter actual load':'Enter actual load'
    return row
  })
  return {target:structuredClone(cfg),planned:structuredClone(cfg),plan:{policy:'off',kind:'off'},sets,
    ...(routine?.programme?.series?{series:routine.programme.series,occurrenceId:routine.programme.instanceId,weekIndex:routine.programme.weekIndex}:{})}
}
