/** Additive source-authored goals. These are never the athlete's actual logged values. */
export interface NativeSource {
  slotId:string; workbookSha256:string; sheet:string; cell:string
}
/** One-based ordinal in the expanded authored entry, never an exercise/history lookup. */
export interface NativeRowIdentity {
  variantKey:string
  source:NativeSource
  sourceTemplateId:string
  rowOrdinal:number
}
/** Athlete-created row instance, outside the authored prescription and anchor namespace. */
export interface NativeExtraIdentity { kind:'athlete-extra'; id:string }
export interface NativeRelativeLoad {
  kind:'same-entry-reduction'
  anchor:NativeRowIdentity
  /** One exact finite reduction, strictly between 0 and 100 percent. */
  reductionPercent:number
}
export interface NativeLoadValue { value:number; unit:'kg'|'lb' }
export interface NativeLoadEvaluation {
  version:1
  relation:NativeRelativeLoad
  anchor:{identity:NativeRowIdentity; actualLoad:NativeLoadValue}
  plannedLoad:NativeLoadValue
}
export interface NativeSetTarget {
  reps: {kind:'fixed'|'range'|'amrap'; min:number; max?:number}
  effort?: {scale:'rpe'|'rir'; min?:number; max?:number; maxExclusive?:boolean}
  percentage?: {min:number; max:number; role:'prescribed'|'guide'; basis:'1rm'|'tm'|'e1rm'; key:string}
  relativeLoad?: NativeRelativeLoad
  sourceTemplateId: string
}
export interface NativePrescription {
  version: 1
  variantKey: string
  source: NativeSource
  sets: NativeSetTarget[]
  restSeconds?: number
}
