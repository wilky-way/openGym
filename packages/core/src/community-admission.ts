import type {SlotRef,ProgressionRule} from '../../contract/domain/progression'
import type {Slot,OpenGymProgrammeDefinition} from '../../contract/domain/programme-model.generated'
import type {CommunitySource,CommunityBinding,CommunityExercise} from './community-conversion'
import {canonicalExId,type ExerciseIndex} from './exercises'
import {record} from './progression-engine/replay'

type BoundSource={exercise:CommunityExercise;position:number;total:number;key:string}
const metadata=['notes','note','instructions','source','provenance','extension','extensions']
const plain=(x:unknown):x is Record<string,unknown>=>!!x && typeof x==='object' && !Array.isArray(x)
const only=(x:Record<string,unknown>,keys:string[])=>Object.keys(x).every(k=>keys.includes(k))
const prose=(x:Record<string,unknown>)=>['note','notes','instructions'].every(k=>x[k]==null || typeof x[k]==='string' || k==='notes' && Array.isArray(x[k]) && x[k].every(v=>typeof v==='string'))
const norm=(x:unknown)=>String(x??'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()
const sameEffort=(a:unknown,b:unknown)=>a===b || typeof a==='number' && typeof b==='number' && Math.abs(a-b)<1e-9
const positiveRep=(x:unknown):x is number=>typeof x==='number' && Number.isInteger(x) && x>=1 && x<=100

/** A positional override selects a location; it cannot contradict retained source anchors. */
export function bindCommunitySource(d:OpenGymProgrammeDefinition,source:CommunitySource,ref:SlotRef,bindings?:CommunityBinding[]):BoundSource|undefined {
 const explicit=bindings?.filter(b=>b.ref.week===ref.week && b.ref.day===ref.day && b.ref.session===ref.session && b.ref.slot===ref.slot)
 if(explicit && explicit.length>1)return
 const binding=explicit?.[0],nativeWeek=d.weeks.find(w=>w.index===ref.week)
 const sourceWeek=String(nativeWeek?.sourceWeek??ref.week)
 if(binding && (binding.sourceWeek!==sourceWeek || binding.sourceDay!==ref.day.replace(/^d/,'') || !Number.isInteger(binding.sourcePosition) || binding.sourcePosition<1))return
 const weeks=source.weeks.filter(w=>String(w.n)===sourceWeek && w.repeat_of==null)
 if(weeks.length!==1)return
 const kind=ref.session.split(':').slice(1).join(':')||'lift'
 if(binding?.sourceKind!==undefined && binding.sourceKind!==kind)return
 const days=weeks[0]!.days.filter(day=>String(day.n)===(binding?.sourceDay??ref.day.replace(/^d/,'')) && (day.kind||'lift')===kind)
 if(days.length!==1)return
 const exercises=days[0]!.exercises,match=/:slot:(.*?)(?::part:(\d+))?$/.exec(ref.slot)
 if(!match || match[2] && match[2]!=='1')return
 const positional=/^source-(\d+)$/.exec(match[1]!)
 const matches=exercises.map((e,i)=>({e,i})).filter(({e,i})=>positional ? i+1===Number(positional[1]) : String(e.slot??i+1)===match[1])
 if(matches.length!==1 || binding && binding.sourcePosition!==matches[0]!.i+1)return
 const {e,i}=matches[0]!
 return {exercise:e,position:i+1,total:exercises.length,key:JSON.stringify([sourceWeek,days[0]!.n,kind])}
}

/** Strict scalar effort only; no dropped percentage, range or competing coordinate. */
function effort(x:unknown):{ok:boolean;rir?:number} {
 if(x==null)return {ok:true}
 if(!plain(x) || !only(x,['rpe','rir']) || x.rpe!==undefined && x.rir!==undefined)return {ok:false}
 if(x.rpe!==undefined)return typeof x.rpe==='number' && Number.isFinite(x.rpe) && x.rpe>=1 && x.rpe<=10 ? {ok:true,rir:10-x.rpe}:{ok:false}
 if(x.rir!==undefined)return typeof x.rir==='number' && Number.isFinite(x.rir) && x.rir>=0 && x.rir<=10 ? {ok:true,rir:x.rir}:{ok:false}
 return {ok:true}
}
/** Validate source independently of native flags, then compare each executable row.
 * Sample absolute weights are compared only for a uniform shape, never personalized. */
export function communityAdmissionProblem(slot:Slot,e:CommunityExercise,rule:ProgressionRule,index:ExerciseIndex):string|undefined {
 if(!prose(e))return 'Source notes/instructions are not freeform text; structured prescriptions require review.'
 if(e.role!=null && !['main','supplement','accessory','gpp'].includes(String(e.role)))return 'Source exercise role requires separate prescription review.'
 if(!only(e,['id','opengym_id','name','equipment','slot','label','sets','rules','target','rest','role','category','open',...metadata]) || e.open!==undefined && e.open!==false)
  return 'Source exercise has unsupported or ambiguous prescription fields.'
 const declared=[e.id,e.opengym_id].filter(x=>x!==undefined)
 if(declared.some(x=>typeof x!=='string' || !x))return 'Source exercise identity is invalid.'
 const known=[...new Set(declared.map(x=>canonicalExId(x,index)).filter((x):x is string=>typeof x==='string' && Object.hasOwn(index,x)))]
 if(known.length>1 || known.length===1 && known[0]!==canonicalExId(slot.id,index))return 'Source exercise identity contradicts the native exercise.'
 if(known.length===0){
  const matches=Object.values(index).filter(ex=>norm(ex.n)===norm(e.name) && (!e.equipment || norm(ex.eq)===norm(e.equipment)))
  if(matches.length!==1 || matches[0]!.id!==canonicalExId(slot.id,index))return 'Source exercise identity cannot be resolved uniquely with the caller catalogue.'
 }
 if(e.equipment && norm(index[String(canonicalExId(slot.id,index))]?.eq)!==norm(e.equipment))return 'Source exercise equipment contradicts the native exercise.'
 if(e.rest!==undefined && (typeof e.rest!=='string' || !/^\d+(?:s)?$/.test(e.rest) || parseInt(e.rest,10)!==slot.restSec))return 'Source rest must match an exact native scalar rest prescription.'
 if(['rowReps','enginePrescription','communityPrescription','intensifier','sg','sgName','sgRest','min','sec'].some(k=>slot[k]!=null))return 'Native slot has additional owned row semantics requiring separate review.'
 const global=effort(e.target)
 if(!global.ok || !effort(slot.target).ok)return 'Source/native effort or percentage basis is unsupported or ambiguous.'
 if(!Array.isArray(e.sets) || !e.sets.length || e.sets.some(r=>!plain(r)))return 'Source needs explicit ordinary work rows.'
 const rows:Record<string,unknown>[]=[]
 for(const row of e.sets as Record<string,unknown>[]){
  if(!prose(row))return 'Source row instructions contain unreviewed structured prescriptions.'
  if(!only(row,['count','reps','reps_min','reps_max','weight','kind','amrap','rpe','rir','target',...metadata]) || row.kind!==undefined && !['work','straight','amrap'].includes(String(row.kind)))return 'Source row has unsupported conditional, percentage, generated, timed or variation semantics.'
  if(row.amrap!==undefined && typeof row.amrap!=='boolean')return 'Source AMRAP flag is ambiguous.'
  const amrap=row.amrap===true || row.kind==='amrap' || row.reps==='max' || row.reps==='amrap'
  if(amrap && (row.amrap===false || row.kind==='straight' || row.reps_max!==undefined))return 'Source AMRAP flags or capped row semantics are ambiguous.'
  if(!positiveRep(row.count??1) || !amrap && !positiveRep(row.reps) || amrap && !(positiveRep(row.reps) || row.reps==='max' || row.reps==='amrap'))return 'Source needs bounded scalar work counts and reps.'
  if(amrap ? !positiveRep(row.reps_min??row.reps) : row.reps_min!=null && row.reps_min!==row.reps || row.reps_max!=null && row.reps_max!==row.reps)return 'Source rep ranges or missing AMRAP success minima require separate review.'
  const target=record(row.target),direct={...(row.rpe!==undefined?{rpe:row.rpe}:{}),...(row.rir!==undefined?{rir:row.rir}:{})}
  if(!effort(row.target).ok || !effort(direct).ok || Object.keys(direct).length && Object.keys(target).length && !sameEffort(effort(target).rir,effort(direct).rir))return 'Source row effort is unsupported or contradictory.'
  const local=Object.keys(direct).length ? effort(direct) : Object.keys(target).length ? effort(target) : global
  if(row.weight!=null && !((typeof row.weight==='number' || typeof row.weight==='string' && row.weight.trim()!=='') && Number.isFinite(Number(row.weight)) && Number(row.weight)>=0))return 'Source load is not an ordinary absolute example weight.'
  for(let i=0;i<Number(row.count??1);i++)rows.push({...row,_amrap:amrap,_rir:local.rir})
  if(rows.length>100)return 'Source work count exceeds the admitted bound.'
 }
 if(rule.kind==='double' && rows.every(r=>!r._amrap) && rows.some(r=>r.reps!==rule.repsLow))return 'Double progression needs uniform source reps at its lower endpoint; varying or different initial reps require separate review.'
 if(new Set(rows.map(r=>Number(r.weight??0))).size>1)return 'Source varying loads require separate review.'
 if(rows.length!==slot.sets || rows.length!==(slot.pyramid?.length??slot.sets) || slot.setTargets && slot.setTargets.length!==rows.length || slot.setRepsMin && slot.setRepsMin.length!==rows.length)return 'Source/native row counts disagree.'
 const reps=(value:unknown)=>value==='amrap'?'max':value
 for(const [i,row] of rows.entries()){
  const expected=row._amrap?'max':row.reps,native=reps(slot.pyramid?.[i]??slot.reps)
  if(expected!==native || i===0 && reps(slot.reps)!==expected)return 'Source/native row order or reps disagree; native edits require separate correspondence review.'
  const target=effort(slot.setTargets?.[i]??slot.target)
  if(!target.ok || !sameEffort(target.rir,row._rir))return 'Source/native per-row effort disagrees.'
  if(!row._amrap && [slot.setRepsMin?.[i],slot.repsMin].some(n=>n!=null && n!==row.reps))return 'Source/native straight rep minima disagree.'
 }
}
