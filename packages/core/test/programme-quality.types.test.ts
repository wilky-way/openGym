import { it, expect } from 'vitest'
import { improveProgrammeDefinition, type ProgrammeSourceRaw } from '../src/programme-quality'

it('accepts authored source ranges and widens metadata overwritten by decisions',()=>{
  const sourceRaw: ProgrammeSourceRaw = {weeks:[{n:1,days:[{n:1,exercises:[{
    slot:'bench',sets:[{count:2,reps:5,rpe:[7,8],rir:[0,2],pct:[65,70]}]
  }]}]}]}
  const input={weeks:[],goal:'Strength' as const}
  const result=improveProgrammeDefinition(input,{sourceRaw,decisions:{goal:'Hypertrophy'}})
  // @ts-expect-error Repairs can overwrite authored literal metadata; callers must inspect the returned value.
  const untruthfulLiteral: 'Strength'=result.definition.goal
  void untruthfulLiteral
  expect(result.definition).toMatchObject({goal:'Hypertrophy'})
  expect(input.goal).toBe('Strength')
})

// These probes are compiled by the strict gate but never execute unsafe operations.
function rejectsUncheckedRepairs() {
  const wrongGoal=improveProgrammeDefinition({weeks:[],goal:42})
  // @ts-expect-error Repair preserves non-string goals; narrowing is required.
  wrongGoal.definition.goal?.trim()
  const missingIndex=improveProgrammeDefinition({weeks:[{days:[]}]})
  // @ts-expect-error Repair does not establish nested week indexes.
  missingIndex.definition.weeks?.[0].index.toFixed()
  const patched=improveProgrammeDefinition({weeks:[{days:[{sessions:[{routineSnapshot:{ex:[{sets:1,reps:5}]}}]}]}]},
    {decisions:{slots:{'/weeks/0/days/0/sessions/0/slots/0':{setTargets:42}}}})
  // @ts-expect-error Slot patches are unchecked and can replace an array with a number.
  patched.definition.weeks[0].days[0].sessions[0].routineSnapshot.ex[0].setTargets.map(String)
  if (wrongGoal.definition && typeof wrongGoal.definition==='object' && 'goal' in wrongGoal.definition) {
    // @ts-expect-error Narrowing the root still leaves goal unknown, not string.
    wrongGoal.definition.goal?.trim()
    if (typeof wrongGoal.definition.goal==='string') wrongGoal.definition.goal.trim()
  }
}
void rejectsUncheckedRepairs

it('retains malformed authored values and unchecked slot patches without promising their types',()=>{
  const input={weeks:[{days:[{sessions:[{routineSnapshot:{ex:[{sets:1,reps:5}]}}]}]}],goal:42}
  const result=improveProgrammeDefinition(input,{decisions:{slots:{'/weeks/0/days/0/sessions/0/slots/0':{setTargets:42}}}})
  expect(result.definition).toMatchObject({goal:42,weeks:[{days:[{sessions:[{routineSnapshot:{ex:[{setTargets:42}]}}]}]}]})
  expect(input.weeks[0]?.days[0]?.sessions[0]?.routineSnapshot.ex[0]).not.toHaveProperty('setTargets')
  expect(improveProgrammeDefinition('unchecked primitive').definition).toBe('unchecked primitive')
})
