import type { ProgressionIssue, ProgressionIssueCode, ProgressionValidateResult, SlotRef } from '../../contract/domain/progression'
import { programmeSchemaIssues } from './programme-model-schema'
import { progressionRuleSchemas, progressionDefinitionFields } from './progression-rule-schema'
import { EXIDX, exOr, type ExerciseIndex } from '@opengym/core/exercises'
import { MUSCLES, musclesOf } from '@opengym/core/muscles'

type Row = Record<string, unknown>
const row = (v: unknown): Row => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Row : {}
const list = (v: unknown): unknown[] => Array.isArray(v) ? v : []
const own = (v: Row, k: string) => Object.hasOwn(v,k)
const text = (v: unknown): v is string => typeof v === 'string' && v.length > 0
const loads = new Set(['percentage','rpe-load','linear','double'])
interface Slot { ref: SlotRef; value: Row; path: string; count: number; rules: Row[] }
const key = (ref: SlotRef) => JSON.stringify([ref.week,ref.day,ref.session,ref.slot])

/** Total, pure authoring validation; no conversion, coercion, mutation or rule execution. */
export function validateProgression(definition: unknown, index: ExerciseIndex = EXIDX): ProgressionValidateResult {
  const def=row(definition), issues: ProgressionIssue[]=[]
  const add = (code: ProgressionIssueCode,path: string,fix: string,ruleId?: string,ref?: Partial<SlotRef>) => {
    issues.push({code,...(ruleId===undefined?{}:{ruleId}),...(ref===undefined?{}:{ref}),path,fix})
  }
  const shape = (value: unknown,schema: Parameters<typeof programmeSchemaIssues>[1],path: string,ruleId?: string) => {
    const found=programmeSchemaIssues(value,schema)
    for(const issue of found) {
      const code=issue.message==='Unknown field.'?'rule.extra-field':issue.path==='/rounding' && issue.message==='A required field is missing.'?'rule.missing-rounding':'rule.range'
      add(code,path+issue.path,issue.message,ruleId)
    }
    return found.length===0
  }
  if(own(def,'progressionRules') && !Array.isArray(def.progressionRules))add('rule.range','/progressionRules','Use a list of closed progression rules.')
  if(list(def.progressionRules).length>100)add('rule.range','/progressionRules','Use at most 100 progression rules.')
  const rules = new Map<string,Row>(), paths = new Map<Row,string>(), ids = new Set<string>()
  for(const [i,input] of list(def.progressionRules).entries()) {
    const r=row(input), path=`/progressionRules/${i}`, id=text(r.id)?r.id:undefined
    paths.set(r,path)
    const duplicate=id!==undefined && ids.has(id)
    if(id) {if(duplicate)add('rule.duplicate-id',path+'/id','Choose a unique rule id.',id);ids.add(id)}
    if(!text(r.kind) || !Object.hasOwn(progressionRuleSchemas,r.kind))add('rule.unknown-kind',path+'/kind','Choose one of the eight supported rule kinds.',id)
    else if(shape(input,progressionRuleSchemas[r.kind],path,id) && id && !duplicate)rules.set(id,r)
  }
  if(own(def,'tmSeeds'))shape(def.tmSeeds,progressionDefinitionFields.tmSeeds,'/tmSeeds')
  const weeks=new Set<number>(), lifts=new Set<string>(Object.keys(row(def.tmSeeds))), slots: Slot[]=[]
  for(const [wi,wInput] of list(def.weeks).entries()) {
    const w=row(wInput);if(typeof w.index!=='number')continue;weeks.add(w.index)
    for(const [di,dInput] of list(w.days).entries()) {
      const d=row(dInput)
      for(const [si,sInput] of list(d.sessions).entries()) {
        const s=row(sInput)
        for(const [ei,eInput] of list(row(s.routineSnapshot).ex).entries()) {
          const e=row(eInput), tm=row(e.tm)
          if(text(tm.key))lifts.add(tm.key)
          const ref={week:w.index,day:typeof d.key==='string'?d.key:'',session:typeof s.sessionTemplateId==='string'?s.sessionTemplateId:'',slot:typeof e.slotId==='string'?e.slotId:''}
          slots.push({ref,value:e,path:`/weeks/${wi}/days/${di}/sessions/${si}/routineSnapshot/ex/${ei}`,count:Array.isArray(e.pyramid)?e.pyramid.length:typeof e.sets==='number'?e.sets:0,rules:[]})
        }
      }
    }
  }
  const byRef = new Map<string,Slot[]>()
  for(const slot of slots) {
    if(!slot.ref.day || !slot.ref.session || !slot.ref.slot)continue
    const k=key(slot.ref);byRef.set(k,[...byRef.get(k)||[],slot])
  }
  const resolve = (input: unknown,path: string,id?: string): Slot | undefined => {
    const r=row(input)
    if(typeof r.week==='number' && !weeks.has(r.week))add('rule.unknown-week',path+'/week','Reference an authored week index.',id)
    const ref={week:r.week,day:r.day,session:r.session,slot:r.slot} as SlotRef
    const found=byRef.get(key(ref))
    if(!found || found.length!==1) {add('rule.unknown-slot',path,'Reference one existing slot by stable sessionTemplateId and slotId.',id);return}
    return found[0]
  }
  for(const slot of slots) {
    const p=row(slot.value.progression)
    const validRefs=!own(p,'rules') || shape(p.rules,{type:'array',items:{type:'string',pattern:'^[a-z0-9][a-z0-9-]{0,63}$'},maxItems:100,uniqueItems:true},slot.path+'/progression/rules')
    for(const [i,input] of (validRefs?list(p.rules):[]).entries()) {
      const r=typeof input==='string'?rules.get(input):undefined
      if(!r)add('rule.unknown-ref',slot.path+`/progression/rules/${i}`,'Attach an existing rule id.',typeof input==='string'?input:undefined,slot.ref)
      else {slot.rules.push(r);if(r.kind==='stall')add('rule.unknown-ref',slot.path+`/progression/rules/${i}`,'Attach stall rules through onStall.',input as string,slot.ref)}
    }
    if((slot.rules.length || own(p,'onStall')) && byRef.get(key(slot.ref))?.length!==1)add('rule.unknown-slot',slot.path+'/progression','Give rule-driven slots unique stable sessionTemplateId and slotId.',undefined,slot.ref)
    if(slot.rules.filter(r=>loads.has(r.kind as string)).length>1)add('rule.two-load-rules',slot.path+'/progression/rules','Attach at most one load-producing rule.',undefined,slot.ref)
    if(slot.rules.length || own(p,'onStall')) {
      const double=slot.rules.some(r=>r.kind==='double')
      const supported=(v: unknown)=>v==='max' || v==='amrap' ||
        (typeof v==='number' || typeof v==='string' && v.trim()!=='') && Number.isInteger(Number(v)) && Number(v)>0 && Number(v)<=100 ||
        double && typeof v==='string' && /^\d+\s*-\s*\d+$/.test(v) && v.split('-').every(n=>Number(n)>0 && Number(n)<=100) && Number(v.split('-')[0])<=Number(v.split('-')[1])
      const reps=Array.isArray(slot.value.pyramid)?Array.from(slot.value.pyramid):[slot.value.reps]
      if(!reps.length || reps.some(v=>!supported(v)))add('rule.reps-unsupported',slot.path+'/progression','Use numeric, max or amrap reps; ranges require double progression.',undefined,slot.ref)
      for(const [path,floor] of [[slot.path+'/repsMin',slot.value.repsMin],...list(slot.value.setRepsMin).map((v,i)=>[slot.path+`/setRepsMin/${i}`,v])] as [string,unknown][]) {
        if(floor!=null && !((typeof floor==='number' || typeof floor==='string' && floor.trim()!=='') && Number.isInteger(Number(floor)) && Number(floor)>=1 && Number(floor)<=100))add('rule.range',path,'Use a numeric rep floor between 1 and 100.',undefined,slot.ref)
      }
    }
    if(own(p,'onStall')) {
      const r=typeof p.onStall==='string'?rules.get(p.onStall):undefined
      if(!r || r.kind!=='stall' || !slot.rules.some(r=>loads.has(r.kind as string)))add('rule.unknown-ref',slot.path+'/progression/onStall','Reference a stall rule on a slot with a load rule.',typeof p.onStall==='string'?p.onStall:undefined,slot.ref)
      else if(r.appliesTo==='tm' && !text(row(slot.value.tm).key))add('rule.tm-stall-without-key',slot.path+'/progression/onStall','Give a TM stall slot an explicit tm.key.',p.onStall as string,slot.ref)
    }
  }
  const knownWeek = (w: unknown,path: string,id?: string) => {
    if(typeof w==='number' && Number.isInteger(w) && !weeks.has(w))add('rule.unknown-week',path,'Reference an authored week index.',id)
  }
  const scheduled: {rule: Row; slot: Slot; weeks: number[]}[]=[]
  const ramps: {rule: Row; slots: Slot[]; weeks: number[]}[]=[]
  const amrapLifts = new Set<string>()
  for(const r of rules.values()) {
    const path=paths.get(r)!, id=String(r.id), kind=r.kind
    const lift=kind==='percentage'?row(r.ref).lift:r.lift
    if(lift!==undefined && (!text(lift) || !lifts.has(lift)))add('rule.unknown-lift',path+(kind==='percentage'?'/ref/lift':'/lift'),'Declare this lift with slot.tm.key or tmSeeds.',id)
    if(own(r,'unit') && r.unit!==def.unit)add('rule.unit-mismatch',path+'/unit','Use the definition unit; profile conversion happens at evaluation.',id)
    if(kind==='percentage' || kind==='rpe-load') {
      const prescriptions=row(r.weeks)
      for(const [w,values] of Object.entries(prescriptions)) {
        if(w!=='*')knownWeek(Number(w),path+`/weeks/${w}`,id)
        for(const [i,v] of list(values).entries()) {
          const set=row(v)
          if(kind==='percentage' && typeof set.repsMin==='number' && typeof set.reps==='number' && set.repsMin>set.reps)add('rule.range',path+`/weeks/${w}/${i}/repsMin`,'A rep floor cannot exceed fixed reps.',id)
        }
        for(const slot of slots.filter(s=>s.rules.includes(r) && (w==='*'? !own(prescriptions,String(s.ref.week)):s.ref.week===Number(w)))) {
          if(Array.isArray(values) && values.length!==slot.count)add('rule.unknown-set',path+`/weeks/${w}`,'Prescribe exactly the attached slot’s working sets.',id,slot.ref)
        }
      }
    }
    if(kind==='double' && typeof r.repsLow==='number' && typeof r.repsHigh==='number' && r.repsLow>r.repsHigh)add('rule.range',path+'/repsHigh','Keep repsHigh at least repsLow.',id)
    if(kind==='amrap-tm') {
      if(amrapLifts.has(r.lift as string))add('rule.multiple-amrap-bumps',path+'/lift','Use at most one AMRAP bump rule per lift.',id)
      amrapLifts.add(r.lift as string)
      const source=row(r.source),slot=resolve(source.slot,path+'/source/slot',id)
      if(slot && (!Number.isInteger(source.set) || Number(source.set)<0 || Number(source.set)>=slot.count))add('rule.unknown-set',path+'/source/set','Reference an existing zero-based working set.',id,slot.ref)
      else if(slot) {
        const set=source.set as number,load=slot.rules.find(r=>loads.has(r.kind as string))
        const prescriptions=row(load?.weeks),rows=prescriptions[String(slot.ref.week)] ?? prescriptions['*']
        const authored=Array.isArray(slot.value.pyramid)?slot.value.pyramid[set]:slot.value.reps
        const reps=load?.kind==='double'?load.repsLow:Array.isArray(rows)?row(rows[set]).reps:authored
        if(reps!=='max' && reps!=='amrap')add('rule.amrap-source-not-amrap',path+'/source/set','Reference an authored or rule-prescribed AMRAP set.',id,slot.ref)
      }
      const bands=list(r.bands).map(row)
      if(bands.some((b,i)=>i>0 && Number(b.minRepsOver)>=Number(bands[i-1]!.minRepsOver)))add('rule.range',path+'/bands','Order AMRAP bands by strictly decreasing minRepsOver.',id)
    }
    if(kind==='scheduled-deload' || kind==='volume-ramp')list(r.weeks).forEach((w,i)=>knownWeek(w,path+`/weeks/${i}`,id))
    if(kind==='scheduled-deload') {
      const covered=list(r.weeks).filter((w): w is number=>typeof w==='number')
      for(const slot of slots.filter(s=>s.rules.includes(r) && covered.includes(s.ref.week)))scheduled.push({rule:r,slot,weeks:covered})
    }
    if(kind==='volume-ramp') {
      const rampWeeks=list(r.weeks).filter((w): w is number=>typeof w==='number'), scope=row(r.scope)
      if(rampWeeks.some((w,i)=>i>0 && w<=rampWeeks[i-1]!))add('rule.ramp-order',path+'/weeks','Order ramp weeks strictly ascending.',id)
      if(typeof r.startSets==='number' && typeof r.maxSets==='number' && r.maxSets<r.startSets)add('rule.range',path+'/maxSets','Keep maxSets at least startSets.',id)
      const affected: Slot[]=[]
      if(Array.isArray(scope.slots))for(const [i,input] of scope.slots.entries()) {const s=resolve(input,path+`/scope/slots/${i}`,id);if(s)affected.push(s)}
      if(Array.isArray(scope.muscles)) {
        const muscles=scope.muscles.filter((m): m is string=>typeof m==='string')
        if(muscles.some(m=>!MUSCLES.includes(m)))add('rule.range',path+'/scope/muscles','Use canonical muscle ids.',id)
        for(const s of slots) {
          const found=typeof s.value.id==='string'?exOr(s.value.id,index):undefined
          const exercise=found && !found.missing?found:s.value
          try {
            const weights: Record<string,unknown>=musclesOf(exercise)
            if(muscles.some(m=>Number(weights[m])>0))affected.push(s)
          } catch {
            add('rule.range',s.path,'Use valid exercise muscle metadata for the ramp scope.',id,s.ref)
          }
        }
      }
      ramps.push({rule:r,slots:slots.filter(s=>s.rules.includes(r) && affected.some(a=>key(a.ref)===key(s.ref))),weeks:rampWeeks})
    }
  }
  // Stable slot identity repeats across explicit weeks; overlap is evaluated only
  // where both rules cover the same authored occurrence of that identity.
  const sameSlot = (a: Slot,b: Slot) => key(a.ref)===key(b.ref)
  for(const [i,a] of ramps.entries())for(const b of ramps.slice(i+1)) {
    const aScope=row(a.rule.scope),bScope=row(b.rule.scope)
    const sharedMuscle=list(aScope.muscles).some(m=>list(bScope.muscles).includes(m))
    const sharedRef=list(aScope.slots).some(ref=>list(bScope.slots).some(other=>key(ref as SlotRef)===key(other as SlotRef)))
    if(sharedMuscle || sharedRef || a.slots.some(s=>b.slots.some(t=>sameSlot(s,t))))add('rule.two-volume-ramps',paths.get(b.rule)!+'/scope','Use only one volume ramp per scope.',b.rule.id as string)
  }
  for(const [i,a] of scheduled.entries()) {
    for(const b of scheduled.slice(i+1))if(a.rule!==b.rule && key(a.slot.ref)===key(b.slot.ref))add('rule.deload-overlap',paths.get(b.rule)!+'/weeks','Attach only one scheduled deload per slot/week.',String(b.rule.id),a.slot.ref)
    for(const ramp of ramps)if(ramp.slots.some(s=>sameSlot(s,a.slot)) && ramp.weeks.includes(a.slot.ref.week) && a.weeks.includes(a.slot.ref.week))add('rule.deload-overlap',paths.get(ramp.rule)!+'/weeks','Keep ramp and scheduled deload weeks disjoint for affected slots.',String(ramp.rule.id),a.slot.ref)
  }
  for(const [lift,seedInput] of Object.entries(row(def.tmSeeds))) {
    const seed=row(seedInput)
    if(own(seed,'unit') && seed.unit!==def.unit)add('rule.unit-mismatch',`/tmSeeds/${lift}/unit`,'Use the definition unit for the TM seed.')
  }
  return {ok:!issues.length,issues}
}
