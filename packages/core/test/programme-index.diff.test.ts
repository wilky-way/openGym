import { expect, it } from 'vitest'
import type { Exercise } from '@opengym/core/exercises'
import { createExerciseIndex } from '@opengym/core/exercises'
import { programmeConformance } from '../src/programme-conformance'
import { improveProgrammeDefinition } from '../src/programme-quality'
import { validateProgrammeDefinition } from '../src/programme-validate'
import { syntheticProgramme, syntheticSlot } from './fixtures/synthetic-programme'

// A custom drawing-id shadows a catalogue alias. Only the caller's index keeps
// this id intact even though the canonical catalogue target remains present.
const custom: Exercise={id:'1019',n:'Synthetic custom lift',eq:'synthetic-machine',custom:true}
const catalogue=[custom]
const index=createExerciseIndex(catalogue)
function definition() {
  const d=syntheticProgramme();syntheticSlot(d).id=custom.id
  return d
}
it('forwards the caller index from validation to canonical exercise lookup',()=>{
  const d=definition()
  expect(()=>validateProgrammeDefinition(d,catalogue)).toThrow('Resolve unknown exercises')
  expect(validateProgrammeDefinition(d,catalogue,index)).toBe(d)
})
it('forwards the caller index through conformance primary validation',()=>{
  const d=definition()
  expect(programmeConformance(d,{catalogue}).level).toBe('Invalid')
  expect(programmeConformance(d,{catalogue},index)).toEqual({level:'Ready',issues:[]})
})
it('forwards the caller index through conformance localized slot validation',()=>{
  const d=definition()
  d.weeks.push(structuredClone(d.weeks[0])) // Global semantic failure, schema-valid.
  const result=programmeConformance(d,{catalogue},index)
  expect(result.level).toBe('Invalid')
  expect(result.issues).toHaveLength(1)
  expect(result.issues[0]?.location).toEqual({path:''})
  expect(result.issues[0]?.fix).toContain('week indexes')
})
it('forwards the caller index through both repair catalogue and slot canonical lookups',()=>{
  const d=definition();delete d.equipment
  // Only one forwarded lookup would give mismatched map keys and lose equipment.
  expect(improveProgrammeDefinition(d,{catalogue}).definition).toMatchObject({equipment:[custom.eq]})
  expect(improveProgrammeDefinition(d,{catalogue},index).definition).toMatchObject({equipment:[custom.eq]})
  expect(d).not.toHaveProperty('equipment')
})
it('uses the catalogue-only default index when omitted',()=>{
  const d=syntheticProgramme()
  expect(validateProgrammeDefinition(d)).toBe(d)
})

it('validates and repairs a custom lift from a native caller-owned index',()=>{
  const customLift: Exercise={id:'synthetic-native',n:'Synthetic native lift',eq:'custom'}
  const native=createExerciseIndex([customLift]), d=syntheticProgramme()
  syntheticSlot(d).id=customLift.id;delete d.equipment
  expect(validateProgrammeDefinition(d,[customLift],native)).toBe(d)
  expect(improveProgrammeDefinition(d,{catalogue:[customLift]},native).definition).toMatchObject({equipment:['custom']})
})
