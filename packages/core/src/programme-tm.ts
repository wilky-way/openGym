import { EXIDX, type ExerciseIndex } from '@opengym/core/exercises'
import type { Config, Profile, Routine } from './progression'
// Percentage prescriptions are resolved on Start in the profile's unit, never auto-progressed.
import { weightIncrement, snapWeight } from './progression'
import type { ProgrammeCycle } from '../../contract/domain/state-doc'
import { evaluate } from './progression-engine/index'
import { todayISO } from './format'
import { convertWeightPrecise } from './progression-engine/units'
import { dropGrid } from './plates'
export function programmeTMConfig<C extends Config>(S: Profile, cfg: C, routine?: Routine | null, index: ExerciseIndex = EXIDX): C & Config {
  const cycle = S.programmes?.cycles?.find(c => c.id === routine?.programme?.cycleId)
  const adjusted = adjustedMaxConfig(S,cfg,routine,cycle as ProgrammeCycle | undefined,index)
  if (adjusted) return adjusted
  if (!cfg.tm) return cfg
  const raw = Number(cycle?.tm?.[cfg.tm.key || cfg.id!])
  let tm = Number.isFinite(raw) ? convertWeightPrecise(raw,cycle?.tmUnit === 'kg' ? 'kg' : cycle?.tmUnit === 'lb' ? 'lb' : S.unit === 'kg' ? 'kg' : 'lb',S.unit === 'kg' ? 'kg' : 'lb') : raw
  const history = (cycle as ProgrammeCycle | undefined)?.maxAdjustments?.filter(e=>e.lift===(cfg.tm!.key || cfg.id!)).sort((a,b)=>a.effectiveOn.localeCompare(b.effectiveOn) || a.recordedAt-b.recordedAt || a.id.localeCompare(b.id))
  if (history?.length) {
    const effective = history.filter(e=>e.effectiveOn<=todayISO()).at(-1)
    const event = effective ?? history[0]!
    const value = effective ? event.value : event.previous
    tm = value == null ? NaN : convertWeightPrecise(value,event.unit,S.unit==='kg' ? 'kg' : 'lb')
  }
  const percentages = cfg.tm.percentages
  if (!Array.isArray(percentages) || percentages.length !== cfg.pyramid?.length || percentages.some(p => !Number.isFinite(p) || p <= 0)) throw new Error('Invalid percentage prescription')
  if (!Number.isFinite(tm) || tm <= 0) return { ...cfg, prog:'off' }
  const grid = dropGrid(S, cfg, index), step = weightIncrement(cfg, S.unit, index)
  const weights = percentages.map(p => typeof grid === 'function' ? grid(tm * p / 100) : snapWeight(tm * p / 100, step!))
  return { ...cfg, prog:'off', weight:weights[0], pyramidWeight:weights }
}
export function missingProgrammeTMs(S: Profile, routine?: Routine | null) {
  const cycle = S.programmes?.cycles?.find(c => c.id === routine?.programme?.cycleId)
  return [...new Set((routine?.ex || []).filter(e => e.tm && !(Number(cycle?.tm?.[e.tm.key || e.id!]) > 0)).map(e => e.tm!.key || e.id))]
}

/** Re-evaluate at materialization, including previously applied configs and merged overrides.
 * Existing active/logged entries are frozen copies and never pass through this path. */
function adjustedMaxConfig<C extends Config>(S: Profile, cfg: C, routine: Routine | null | undefined, cycle: ProgrammeCycle | undefined, index: ExerciseIndex): (C & Config) | undefined {
  if (!cycle?.maxAdjustments?.length || !cycle.snapshot?.progressionRules) return
  const occurrence = cycle.occurrences.find(o=>o.routineId===routine?.id)
  if (!occurrence) return
  const rules = cycle.snapshot.progressionRules as import('../../contract/domain/progression').ProgressionRule[]
  const authored = cycle.snapshot.weeks.find(w=>w.index===occurrence.weekIndex)?.days.find(d=>d.key===occurrence.dayKey)?.sessions.find(s=>(s.sessionTemplateId ?? '')===(occurrence.sessionTemplateId ?? ''))?.routineSnapshot.ex.find(e=>e.slotId===cfg.slotId && e.id===cfg.id)
  const attached = (authored?.progression as {rules?:string[]} | undefined)?.rules ?? []
  if (!rules.some(r=>attached.includes(r.id) && (r.kind==='percentage' && cycle.maxAdjustments!.some(e=>e.lift===r.ref.lift) || r.kind==='rpe-load' && cycle.maxAdjustments!.some(e=>e.lift===r.lift)))) return
  const today=todayISO(), unit=S.unit==='kg' ? 'kg' : 'lb'
  const result=evaluate({definition:cycle.snapshot,cycle,logs:S.workouts ?? [],weeks:[occurrence.weekIndex],asOf:today,now:today,materializationDate:today,profile:{...S,unit,effortScale:S.effort==='rpe' ? 'rpe' : 'rir'}},{},index)
  if (result.error) throw new Error('Could not materialize the adjusted max.')
  const prescribed=result.weeks[0]?.slots.find(p=>p.ref.day===occurrence.dayKey && p.ref.session===(occurrence.sessionTemplateId ?? '') && p.ref.slot===cfg.slotId)
  if (!prescribed) throw new Error('Could not resolve the adjusted max slot.')
  const sets=prescribed.sets
  return {...cfg,enginePrescription:true,prog:'off',sets:sets.length,tm:undefined,
    pyramid:sets.map(s=>s.reps==='amrap' ? 'max' : s.reps),weight:sets[0]?.load ?? undefined,pyramidWeight:sets.map(s=>s.load),
    setTargets:sets.map(s=>({...s.target,...(s.target?.pct !== undefined ? {pct:s.target.pct*100} : {})})),setRepsMin:sets.map(s=>s.repsMin ?? null),
    prescriptionWhy:[...prescribed.why,...sets.flatMap(s=>s.why)]}
}
