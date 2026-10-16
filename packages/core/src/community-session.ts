import { EXIDX, type ExerciseIndex } from './exercises'
import { todayISO } from './format'
import { evaluate, authoredSlots, type EngineInput } from './progression-engine'
import { continuityKey } from './progression-engine/continuity'
import { list, record } from './progression-engine/replay'
import { programmeSchemaIssues } from './programme-model-schema'
import type { Config, Routine, State } from './session-types'
import type { OpenGymProgrammeDefinition } from '../../contract/domain/programme-model.generated'

/** Resolve opt-in community loads at Start; existing active-entry targets stay frozen. */
export function programmeCommunityConfig<C extends Config>(state: State, cfg: C, routine?: Routine|null, index:ExerciseIndex=EXIDX): C {
  // Copies and terminal routines keep authored configs but no longer own a cycle.
  if (routine?.programme==null) return cfg
  if (!record(record(cfg.progression).parameters).continuityKey || cfg.communityPrescription===true || routine?.excludeFromProgression) return cfg
  const link=routine?.programme, cycles=state.programmes?.cycles ?? []
  const matches=cycles.filter(c=>c.id===link?.cycleId)
  if (matches.length!==1 || programmeSchemaIssues(matches[0]!.snapshot).length) throw new Error('Community progression needs its frozen programme cycle.')
  const cycle=matches[0]!, definition=cycle.snapshot as OpenGymProgrammeDefinition
  const occurrence=list(cycle.occurrences).map(record).filter(o=>o.instanceId===link?.instanceId && o.routineId===routine?.id)
  if (occurrence.length!==1) throw new Error('Community progression needs a unique programme occurrence.')
  const o=occurrence[0]!, slots=authoredSlots(definition).filter(a=>a.ref.week===o.weekIndex && a.ref.day===o.dayKey && a.ref.session===(o.sessionTemplateId ?? '') && a.ref.slot===cfg.slotId && a.slot.id===cfg.id && continuityKey(a))
  if (slots.length!==1) throw new Error('Community progression needs its stable source slot and exercise.')
  const result=evaluate({definition,cycle:cycle as unknown as EngineInput['cycle'],historyCycles:cycles,logs:state.workouts ?? [],weeks:[slots[0]!.ref.week],asOf:todayISO(),
    profile:{...state,unit:state.unit==='kg'?'kg':'lb',effortScale:state.effort==='rpe' || state.effortScale==='rpe'?'rpe':'rir'}}, {},index)
  const p=result.weeks.flatMap(w=>w.slots).find(p=>p.ref.day===o.dayKey && p.ref.session===(o.sessionTemplateId ?? '') && p.ref.slot===cfg.slotId)
  if (result.error || !p || !p.sets.length) throw new Error('Community progression could not prescribe this slot; review its rules.')
  const sets=p.sets
  // enginePrescription's row builder understands null as an authoritative athlete-picked load.
  return {...cfg,enginePrescription:true,communityPrescription:true,prog:'off',sets:sets.length,
    reps:sets[0]!.reps==='amrap'?'max':sets[0]!.reps,pyramid:sets.map(s=>s.reps==='amrap'?'max':s.reps),
    weight:sets[0]!.load,pyramidWeight:sets.map(s=>s.load),setRepsMin:sets.map(s=>s.repsMin ?? null),
    prescriptionWhy:sets.flatMap(s=>s.why),
  } as unknown as C
}
