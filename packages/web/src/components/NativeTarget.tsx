import {assessNativeSet,nativeTargetLabel,sameNativeRow} from '@opengym/core/native-prescription'
import {evaluateNativeRelativeLoad} from '@opengym/core/native-relative-load'
import {createExerciseIndex} from '@opengym/core/exercises'
import type {Entry} from '@opengym/core/session-types'
import {isWarmupRow} from '@opengym/core/workout-model'
import {setNumberAt} from '../lib/set-number'
import {useStore} from '../store/useStore'
import type {WorkoutSet} from '../../../contract/domain/state-doc'
/** Locate by authored identity first; positions only supply the displayed number. */
function anchorReference(row:WorkoutSet,entry?:Entry) {
  const identity=row.nativeTarget!.relativeLoad!.anchor
  const sets=entry?.sets || []
  const matches=sets.filter(candidate=>sameNativeRow(candidate.nativeRowIdentity,identity))
  if(matches.length!==1 || Object.hasOwn(matches[0]!, 'nativeExtraIdentity'))return {set:`original set ${identity.rowOrdinal}`,phase:''}
  const anchor=matches[0]!
  return {set:`set ${setNumberAt(sets,sets.indexOf(anchor))}`,phase:isWarmupRow(anchor)?' (warm-up)':' (working)'}
}
export function NativeTarget({row,entry}:{row:WorkoutSet;entry?:Entry}) {
  const S=useStore(s=>s.S)
  if(!row.nativeTarget)return null
  const relative=row.nativeTarget.relativeLoad
  const reference=relative?anchorReference(row,entry):null
  const label=relative?`${nativeTargetLabel({...row.nativeTarget,relativeLoad:undefined})} · ${relative.reductionPercent}% below ${reference!.set} actual load${reference!.phase}`:nativeTargetLabel(row.nativeTarget)
  const result=relative && !row.done && entry?evaluateNativeRelativeLoad(S,entry,row,createExerciseIndex(S.customEx)):null
  const evaluation=row.done?row.nativeLoadEvaluation:result?.status==='resolved'?result.evaluation:null
  const pendingReason=result?.status==='pending'?result.reason:row.nativeLoadReason || 'Anchor pending'
  const reason=relative && pendingReason===`Pending: complete anchor set ${relative.anchor.rowOrdinal}`?`Pending: complete anchor ${reference!.set}${reference!.phase}`:pendingReason
  const status=assessNativeSet(row,row.nativeTarget)
  return <span className="set-target" data-testid="native-target">
    {label}
    {relative && <span role="status"> · {evaluation?`Planned ${evaluation.plannedLoad.value} ${evaluation.plannedLoad.unit}${row.done?' (at completion)':''}`:row.done?'Completed target unavailable':reason}</span>}
    {row.w==null && <span role="status"> · {(relative?'Enter actual load':row.nativeLoadReason) || 'Enter actual load'}</span>}
    {status.reps==='unknown' && <span> · Enter actual reps</span>}
    {status.reps!=='unknown' && status.reps!=='within' && <span role="status"> · Reps {status.reps} target</span>}
    {row.nativeTarget.effort && <span role="status"> · {status.effort==='unknown'?'Effort not logged':`Effort ${status.effort} target`}</span>}
  </span>
}
