import type { NativePrescription, NativeSetTarget, NativeRowIdentity } from '../../contract/domain/native-prescription'
import type { WorkoutSet, ProgrammeDefinition } from '../../contract/domain/state-doc'
const object = (v:unknown): v is Record<string,unknown> => !!v && typeof v==='object' && !Array.isArray(v)
const finite = (v:unknown): v is number => typeof v==='number' && Number.isFinite(v)
const positive = (v:unknown): v is number => finite(v) && v>0
const text = (v:unknown): v is string => typeof v==='string' && v.length>0 && v.length<=1000
function keys(v:Record<string,unknown>, allowed:string[]) {if(Object.keys(v).some(k=>!allowed.includes(k)))throw new Error('Unknown native prescription field')}
export function validateNativePrescription(value:unknown): asserts value is NativePrescription {
  if(!object(value))throw new Error('Invalid native prescription')
  keys(value,['version','variantKey','source','sets','restSeconds'])
  const {source,sets}=value
  if(value.version!==1 || !text(value.variantKey) || !object(source) || !Array.isArray(sets) || !sets.length || sets.length>100)throw new Error('Invalid native prescription')
  keys(source,['slotId','workbookSha256','sheet','cell'])
  if(!text(source.slotId) || !text(source.sheet) || !text(source.cell) || typeof source.workbookSha256!=='string' || !/^[a-f0-9]{64}$/.test(source.workbookSha256))throw new Error('Invalid native source provenance')
  if(value.restSeconds!==undefined && (!finite(value.restSeconds) || value.restSeconds<=0))throw new Error('Invalid native rest')
  for(const [ordinal,row] of sets.entries()) {
    if(!object(row) || !object(row.reps) || !text(row.sourceTemplateId))throw new Error('Invalid native row')
    keys(row,['reps','effort','percentage','relativeLoad','sourceTemplateId']);keys(row.reps,['kind','min','max'])
    const reps=row.reps
    if(!['fixed','range','amrap'].includes(String(reps.kind)) || !positive(reps.min) || !Number.isSafeInteger(reps.min))throw new Error('Invalid native reps')
    if(reps.kind==='amrap' ? reps.max!==undefined : !positive(reps.max) || !Number.isSafeInteger(reps.max) || reps.max<reps.min || reps.kind==='fixed' && reps.max!==reps.min)throw new Error('Invalid native rep bounds')
    if(row.effort!==undefined) {
      if(!object(row.effort))throw new Error('Invalid native effort')
      const e=row.effort;keys(e,['scale','min','max','maxExclusive'])
      if(!['rpe','rir'].includes(String(e.scale)) || e.min===undefined && e.max===undefined || [e.min,e.max].some(n=>n!==undefined && (!finite(n) || n<0 || n>10)) || e.min!==undefined && e.max!==undefined && Number(e.min)>Number(e.max) || e.maxExclusive!==undefined && (typeof e.maxExclusive!=='boolean' || e.max===undefined || e.maxExclusive && (e.min===e.max || e.max===0)))throw new Error('Invalid native effort bounds')
    }
    if(row.relativeLoad!==undefined) {
      const rel=row.relativeLoad
      if(!object(rel) || !object(rel.anchor))throw new Error('Invalid native relative load')
      keys(rel,['kind','anchor','reductionPercent']);keys(rel.anchor,['variantKey','source','sourceTemplateId','rowOrdinal'])
      const a=rel.anchor
      if(rel.kind!=='same-entry-reduction' || !positive(rel.reductionPercent) || rel.reductionPercent>=100 || row.reps.kind!=='fixed' || row.percentage!==undefined)throw new Error('Unsupported native relative load')
      if(!object(a.source))throw new Error('Invalid native anchor source')
      keys(a.source,['slotId','workbookSha256','sheet','cell'])
      if(a.variantKey!==value.variantKey || !sameNativeSource(a.source,source) || !text(a.sourceTemplateId) || !Number.isSafeInteger(a.rowOrdinal) || Number(a.rowOrdinal)<1 || Number(a.rowOrdinal)>ordinal || !object(sets[Number(a.rowOrdinal)-1]) || sets[Number(a.rowOrdinal)-1].sourceTemplateId!==a.sourceTemplateId)throw new Error('Native relative anchor must identify one exact earlier row in the same entry')
    }
    if(row.percentage!==undefined) {
      if(!object(row.percentage))throw new Error('Invalid native percentage')
      const p=row.percentage;keys(p,['min','max','role','basis','key'])
      if(!positive(p.min) || !positive(p.max) || p.max<p.min || !['prescribed','guide'].includes(String(p.role)) || !['1rm','tm','e1rm'].includes(String(p.basis)) || p.key!==value.variantKey || p.role==='prescribed' && p.min!==p.max)throw new Error('Invalid or unsupported native percentage')
    }
  }
}
export function sameNativeSource(a:Record<string,unknown>,b:Record<string,unknown>):boolean {
  return ['slotId','workbookSha256','sheet','cell'].every(k=>a[k]===b[k])
}
export function nativeRowIdentity(p:NativePrescription,rowOrdinal:number):NativeRowIdentity {
  return {variantKey:p.variantKey,source:structuredClone(p.source),sourceTemplateId:p.sets[rowOrdinal-1]!.sourceTemplateId,rowOrdinal}
}
export function sameNativeRow(a:NativeRowIdentity|undefined,b:NativeRowIdentity|undefined):boolean {
  return !!a && !!b && a.variantKey===b.variantKey && a.sourceTemplateId===b.sourceTemplateId && a.rowOrdinal===b.rowOrdinal && sameNativeSource({...a.source},{...b.source})
}
export function nativeTargetLabel(target:NativeSetTarget):string {
  const r=target.reps
  const parts=[r.kind==='amrap'?`AMRAP ≥${r.min}`:r.kind==='range'?`${r.min}–${r.max} reps`:`${r.min} reps`]
  const e=target.effort
  if(e) {
    const bounds=e.min===undefined?`${e.maxExclusive?'<':'≤'}${e.max}`:e.max===undefined?`≥${e.min}`:e.min===e.max?`${e.min}`:`${e.min}–${e.maxExclusive?'<':''}${e.max}`
    parts.push(`${e.scale.toUpperCase()} ${bounds}`)
  }
  const p=target.percentage
  if(p)parts.push(`${p.min}${p.min!==p.max?`–${p.max}`:''}% ${p.basis==='1rm'?'1RM':p.basis==='e1rm'?'e1RM':'TM'}${p.role==='guide'?' guidance':''}`)
  if(target.relativeLoad)parts.push(`${target.relativeLoad.reductionPercent}% below set ${target.relativeLoad.anchor.rowOrdinal} actual load`)
  return parts.join(' · ')
}
/** Missing ratings stay unknown; actual values outside the goal are still valid logs. */
export function assessNativeSet(row:WorkoutSet,target:NativeSetTarget):{reps:'unknown'|'within'|'below'|'above';effort:'unknown'|'within'|'below'|'above'} {
  const r=target.reps
  const reps=!finite(row.r)?'unknown':row.r<r.min?'below':r.max!==undefined && row.r>r.max?'above':'within'
  const e=target.effort
  const actual=e ? finite(row[e.scale])?row[e.scale]:finite(row[e.scale==='rpe'?'rir':'rpe'])?10-Number(row[e.scale==='rpe'?'rir':'rpe']):undefined : undefined
  const effort=!e || !finite(actual)?'unknown':e.min!==undefined && actual<e.min?'below':e.max!==undefined && (e.maxExclusive?actual>=e.max:actual>e.max)?'above':'within'
  return {reps,effort}
}
export function canCompleteNativeSet(row:WorkoutSet):boolean {
  return !row.nativeTarget || finite(row.r) && Number.isSafeInteger(row.r) && row.r>0 && finite(row.w) && row.w>=0
}

/** Display the authored variant without exposing its storage key in max editors. */
export function nativeMaxLabel(definition:ProgrammeDefinition,key:string):string {
  for(const week of definition.weeks)for(const day of week.days)for(const session of day.sessions)for(const exercise of session.routineSnapshot.ex) {
    if(exercise.nativePrescription?.variantKey===key && exercise.label)return exercise.label
  }
  return key
}
