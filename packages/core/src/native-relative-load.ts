import type { NativeLoadEvaluation, NativeLoadValue, NativePrescription } from '../../contract/domain/native-prescription'
import type { Entry, Row, State } from './session-types'
import { EXIDX, type ExerciseIndex } from './exercises'
import { validateNativeSlot } from './native-authority'
import { canCompleteNativeSet, nativeRowIdentity, sameNativeRow } from './native-prescription'
import { dropGrid } from './plates'
import { snapWeight, weightIncrement, type Profile } from './progression'
import { convertWeightPrecise } from './progression-engine/units'
import { convertWeight } from './units'

export type NativeRelativeResult = {status:'pending';reason:string} | {status:'resolved';evaluation:NativeLoadEvaluation}
const pending=(reason:string):NativeRelativeResult=>({status:'pending',reason})
const load=(v:unknown):v is number=>typeof v==='number' && Number.isFinite(v) && v>=0
const unitOf=(S:State):'kg'|'lb'|null=>S.unit==='kg'||S.unit==='lb'?S.unit:null
export const hasNativeRelativeLoad=(p:NativePrescription)=>p.sets.some(row=>row.relativeLoad)

/** The guarded producer supplies a fresh ID; copying never copies authored authority. */
export function nativeExtraRow(source:Row,id:string):Row {
  if(typeof id!=='string' || !id.trim() || id.length>1000)throw new Error('Invalid native extra identity')
  const row=structuredClone(source)
  for(const key of ['nativeTarget','nativeRowIdentity','nativeExtraIdentity','nativeLoadEvaluation','nativeActualLoad','nativeLoadReason','max','repTarget','target','at','planSec','weightOrigin','type','drops','clusters'])delete row[key]
  return {...row,done:false,nativeExtraIdentity:{kind:'athlete-extra',id}}
}

function extraId(row:Row):string {
  const identity=row.nativeExtraIdentity
  if(!identity || typeof identity!=='object' || Array.isArray(identity) || identity.kind!=='athlete-extra' || typeof identity.id!=='string' || !identity.id.trim() || identity.id.length>1000 || Object.keys(identity).some(k=>k!=='kind' && k!=='id') || ['nativeTarget','nativeRowIdentity','nativeLoadEvaluation','nativeActualLoad','nativeLoadReason'].some(k=>Object.hasOwn(row,k)))throw new Error('Invalid native extra identity')
  return identity.id
}

/** Pure read: the only search is within this exact entry's row instances. */
export function evaluateNativeRelativeLoad(S:State,entry:Entry,row:Row,index:ExerciseIndex=EXIDX):NativeRelativeResult {
  const relation=row.nativeTarget?.relativeLoad
  if(!relation)return pending('No authored relative load')
  if(Object.hasOwn(row,'nativeExtraIdentity'))return pending('Relative load pending: row identity changed or ambiguous')
  let p:NativePrescription
  try {p=validateNativeSlot({...entry.target,id:entry.id},index)}catch {return pending('Relative load pending: invalid entry prescription')}
  const identity=row.nativeRowIdentity
  const ordinal=identity?.rowOrdinal
  const at=entry.sets?.indexOf(row) ?? -1
  if(!ordinal || !p.sets[ordinal-1] || !sameNativeRow(identity,nativeRowIdentity(p,ordinal)) || at<0 || entry.sets?.filter(r=>sameNativeRow(r.nativeRowIdentity,identity)).length!==1 || JSON.stringify(row.nativeTarget)!==JSON.stringify(p.sets[ordinal-1]))return pending('Relative load pending: row identity changed or ambiguous')
  const matches=(entry.sets || []).filter(r=>sameNativeRow(r.nativeRowIdentity,relation.anchor))
  const anchor=matches[0]
  if(matches.length!==1 || !anchor || Object.hasOwn(anchor,'nativeExtraIdentity') || (entry.sets?.indexOf(anchor) ?? at)>=at || !sameNativeRow(anchor.nativeRowIdentity,nativeRowIdentity(p,relation.anchor.rowOrdinal)))return pending('Relative load pending: exact earlier anchor missing or ambiguous')
  if(JSON.stringify(anchor.nativeTarget)!==JSON.stringify(p.sets[relation.anchor.rowOrdinal-1]))return pending('Relative load pending: anchor identity changed')
  if(!anchor.done)return pending(`Pending: complete anchor set ${relation.anchor.rowOrdinal}`)
  if(!load(anchor.w))return pending('Pending: anchor actual load is unknown or invalid')
  const unit=unitOf(S)
  if(!unit)return pending('Pending: actual load unit is unknown')
  let actual:NativeLoadValue={value:anchor.w,unit}
  if(anchor.nativeActualLoad) {
    const stamped=anchor.nativeActualLoad
    if(!load(stamped.value) || !['kg','lb'].includes(stamped.unit))return pending('Pending: anchor actual load is invalid')
    // Profile conversion rounds actual inputs; retain the exact originally recorded value
    // when that conversion explains the displayed actual. Manual edits use their new value.
    if(convertWeight(stamped.value,stamped.unit,unit)===anchor.w)actual=structuredClone(stamped)
  }
  let raw:number
  try {raw=convertWeightPrecise(actual.value,actual.unit,unit)*(1-relation.reductionPercent/100)}
  catch {return pending('Pending: calculated load is invalid')}
  const cfg={...entry.target,id:entry.id},grid=dropGrid(S as unknown as Profile,cfg,index)
  // Explicit zero remains zero even when equipment has a positive empty-bar floor.
  const value=raw===0?0:typeof grid==='function'?grid(raw):snapWeight(raw,weightIncrement(cfg,unit,index))
  if(!load(raw) || !load(value))return pending('Pending: calculated load is invalid')
  return {status:'resolved',evaluation:{version:1,relation:structuredClone(relation),anchor:{identity:structuredClone(relation.anchor),actualLoad:actual},plannedLoad:{value,unit}}}
}

/** Completion/undo only: caller owns the guarded synchronous draft and exact row target. */
export function prepareNativeCompletion(S:State,entry:Entry,row:Row,complete:boolean,index:ExerciseIndex=EXIDX):void {
  const p=entry.target?.nativePrescription as NativePrescription|undefined
  if(!p || !hasNativeRelativeLoad(p))return
  validateNativeSlot({...entry.target,id:entry.id},index)
  validateNativeRelativeRows(entry,index)
  if(Object.hasOwn(row,'nativeExtraIdentity')) {extraId(row);return}
  if(!complete) {delete row.nativeLoadEvaluation;delete row.nativeActualLoad;return}
  if(!canCompleteNativeSet({...row,done:false}) || !unitOf(S))throw new Error('Enter actual reps and load before completing this set.')
  const ordinal=row.nativeRowIdentity?.rowOrdinal
  if(!ordinal || !p.sets[ordinal-1] || !sameNativeRow(row.nativeRowIdentity,nativeRowIdentity(p,ordinal)) || entry.sets?.filter(r=>sameNativeRow(r.nativeRowIdentity,row.nativeRowIdentity)).length!==1 || JSON.stringify(row.nativeTarget)!==JSON.stringify(p.sets[ordinal-1]))throw new Error('Native row identity changed or ambiguous')
  if(row.nativeTarget?.relativeLoad) {
    const evaluated=evaluateNativeRelativeLoad(S,entry,row,index)
    if(evaluated.status==='pending')throw new Error(evaluated.reason)
    row.nativeLoadEvaluation=structuredClone(evaluated.evaluation)
  }
  row.nativeActualLoad={value:row.w!,unit:unitOf(S)!}
}

/** Finish never derives a target again: a completed dependency must carry its own receipt. */
export function validNativeEvaluation(row:Row):boolean {
  const relation=row.nativeTarget?.relativeLoad,e=row.nativeLoadEvaluation
  if(!relation)return true
  return !!e && e.version===1 && JSON.stringify(e.relation)===JSON.stringify(relation) && sameNativeRow(e.anchor?.identity,relation.anchor) &&
    !!e.anchor?.actualLoad && load(e.anchor.actualLoad.value) && ['kg','lb'].includes(e.anchor.actualLoad.unit) &&
    !!e.plannedLoad && load(e.plannedLoad.value) && ['kg','lb'].includes(e.plannedLoad.unit)
}

/** Structural edits may remove rows, but cannot duplicate/rebind authored row instances. */
export function validateNativeRelativeRows(entry:Entry,index:ExerciseIndex=EXIDX):void {
  const p=entry.target?.nativePrescription as NativePrescription|undefined
  if(!p || !hasNativeRelativeLoad(p))return
  validateNativeSlot({...entry.target,id:entry.id},index)
  const seen=new Set<number>()
  const extras=new Set<string>()
  for(const row of entry.sets || []) {
    if(Object.hasOwn(row,'nativeExtraIdentity')) {
      const id=extraId(row)
      if(extras.has(id))throw new Error('Duplicate native extra identity')
      extras.add(id);continue
    }
    const ordinal=row.nativeRowIdentity?.rowOrdinal
    if(!ordinal || !p.sets[ordinal-1] || seen.has(ordinal) || !sameNativeRow(row.nativeRowIdentity,nativeRowIdentity(p,ordinal)) || JSON.stringify(row.nativeTarget)!==JSON.stringify(p.sets[ordinal-1]))throw new Error('Native row identity changed or ambiguous')
    seen.add(ordinal)
  }
}
