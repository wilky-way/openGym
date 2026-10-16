import { DEF } from '../src/store/useStore'
import { activate } from '@opengym/core/programme'
import { syntheticProgramme, syntheticSlot } from '../../core/test/fixtures/synthetic-programme'
export function p7Fixture(rules = true): any {
  const d = syntheticProgramme(); d.lengthWeeks = 2; d.name = 'Synthetic display block'
  d.weeks.push({...structuredClone(d.weeks[0]), index: 2})
  d.tmSeeds = {bench: {value: 100, unit: 'lb'}}
  if (rules) d.progressionRules = [{id:'pct', kind:'percentage', ref:{lift:'bench',basis:'tm'},
    rounding:{increment:5,mode:'nearest',usePlates:false}, weeks:{'1':[{pct:.8,reps:5},{pct:.9,reps:5}], '2':[{pct:.85,reps:6},{pct:.95,reps:6}]}}]
  for (const w of d.weeks) {
    const slot = syntheticSlot({weeks:[w]}); slot.weight = 40; slot.prog = 'off'
    if (rules) slot.progression.rules = ['pct']
    w.days[0].sessions[0].routineSnapshot.name = 'Synthetic session'
  }
  const S = structuredClone(DEF); S.unit = 'lb'; S.effort = 'rir'; S.unknownP7 = {preserve:['order',0,null]}
  activate(S, d, {cycleId:'c', today:'2026-10-12', tm:{bench:100}})
  S.programmes.cycles[0].tmSeed = {bench:100}
  return S
}
