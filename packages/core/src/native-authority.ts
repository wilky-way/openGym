import type { NativePrescription } from '../../contract/domain/native-prescription'
import { CATALOGUE, EXIDX, canonicalExId, isAssisted, isCardio, type ExerciseIndex, type Exercise } from './exercises'
import { validateNativePrescription } from './native-prescription'

const builtins=new Map(CATALOGUE.map(ex=>[ex.id,ex]))
const normalized=(value:unknown)=>String(value ?? '').trim().toLowerCase()
const sameIdentity=(a:Exercise,b:Exercise)=>['n','eq','bp'].every(key=>normalized(a[key])===normalized(b[key])) && isAssisted(a)===isAssisted(b)
/** A native key must never select different catalogue and caller-owned movements. */
export function validateNativeIndexExercise(id:string,index:ExerciseIndex=EXIDX,candidates:readonly Exercise[]=[]):Exercise {
  const selected=index[id],builtin=builtins.get(id)
  if(!selected)throw new Error('Native prescription pending: choose the exact catalogue or custom exercise')
  if(builtin && !sameIdentity(builtin,selected) || candidates.some(ex=>ex.id===id && !sameIdentity(ex,selected)))throw new Error('Native exercise identity conflicts with caller catalogue')
  return selected
}

/** A source variant key cannot survive rebinding its effective selected exercise or label. */
export function validateNativeExercise(cfg:Record<string,unknown>,index:ExerciseIndex=EXIDX):NativePrescription {
  validateNativePrescription(cfg.nativePrescription)
  const prescription=cfg.nativePrescription
  const id=typeof cfg.id==='string'?canonicalExId(cfg.id,index):undefined
  if(id)validateNativeIndexExercise(id,index)
  const label=typeof cfg.label==='string'?cfg.label.trim().toLowerCase():''
  const parts=prescription.variantKey.split(':')
  let equipment=''
  try {equipment=encodeURIComponent(decodeURIComponent(parts[3] ?? '').trim().toLowerCase())}catch {throw new Error('Invalid native variant identity')}
  if(!id || !index[id] || !label || parts.length!==4 || parts[0]!=='source-variant' || parts[1]!==encodeURIComponent(id) || parts[2]!==encodeURIComponent(label) || parts[3]!==equipment)throw new Error('Native variant identity conflicts with the selected exercise or source label')
  return prescription
}
/** Full slot admission shared by import, pre-mutation lifecycle and direct Start. */
export function validateNativeSlot(cfg:Record<string,unknown>,index:ExerciseIndex=EXIDX):NativePrescription {
  if(isCardio(typeof cfg.id==='string'?cfg.id:undefined,index) || cfg.mode && cfg.mode!=='reps')throw new Error('Native prescription supports repetition movements only')
  const prescription=validateNativeExercise(cfg,index)
  if(!Number.isSafeInteger(cfg.sets) || Number(cfg.sets)<1 || Number(cfg.sets)>100 || cfg.sets!==prescription.sets.length)throw new Error('Native row count changed without source review')
  if(cfg.prog && cfg.prog!=='off' || cfg.progression || cfg.tm || cfg.pyramid || cfg.pyramidWeight || cfg.target || cfg.setTargets || cfg.setRepsMin || cfg.reps!==undefined || cfg.weight!==undefined || cfg.repsMin!==undefined || cfg.restSec!==prescription.restSeconds || cfg.side || cfg.intensifier || cfg.repsMax!==undefined || cfg.sec!==undefined || cfg.min!==undefined || cfg.speed!==undefined || cfg.pyramidRest || cfg.rowReps || cfg.lastToFailure || cfg.warmupSets || ['generatedRules','authoredInstructions','instructions'].some(key=>cfg[key]!==undefined))throw new Error('Conflicting native/legacy prescription')
  if((isAssisted(cfg.id as string,index) || cfg.assisted===true) && prescription.sets.some(row=>row.percentage || row.relativeLoad))throw new Error('Native assisted calculated load has no defined policy')
  return prescription
}
export function validateNativeBasis(prescription:NativePrescription,basis:unknown):void {
  if(prescription.sets.some(row=>row.percentage?.role==='prescribed' && row.percentage.basis!==basis))throw new Error('Native percentage basis conflicts with the governing definition')
}
interface NativeDefinitionAuthority {
  maxBasis?:unknown; rulesSupported?:unknown; needsReview?:unknown
  weeks:readonly {rir?:unknown;mode?:unknown;deload?:unknown;days:readonly {sessions:readonly {routineSnapshot:{ex:readonly Record<string,unknown>[]}}[]}[]}[]
}
/** Native authority is checked before activation mutates even normalization/queue state. */
export function validateNativeDefinition(definition:NativeDefinitionAuthority,index:ExerciseIndex=EXIDX):void {
  for(const week of definition.weeks)for(const day of Array.isArray(week.days)?week.days:[])for(const session of Array.isArray(day.sessions)?day.sessions:[])for(const cfg of Array.isArray(session.routineSnapshot?.ex)?session.routineSnapshot.ex:[]) {
    if(cfg.nativePrescription===undefined)continue
    if(definition.rulesSupported!==true || definition.needsReview!=null && (!Array.isArray(definition.needsReview) || definition.needsReview.length))throw new Error('Native source review is pending')
    if(week.rir!=null || week.mode==='deload' || week.deload!=null)throw new Error('Native week overlay requires source review')
    const prescription=validateNativeSlot(cfg,index)
    validateNativeBasis(prescription,definition.maxBasis)
  }
}
