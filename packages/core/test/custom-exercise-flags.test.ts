import { expect, test } from 'vitest'
import { createExerciseIndex, isBodyweightEq, isAssisted } from '../src/exercises'
import { isBw } from '../src/history'

test('custom bodyweight flag overrides equipment, with routine overrides and isolated caller indexes',()=>{
  const a=createExerciseIndex([{id:'custom-flags',n:'Synthetic',eq:'dumbbell',bodyweight:true}])
  const b=createExerciseIndex([{id:'custom-flags',n:'Synthetic',eq:'body weight',bodyweight:false,assisted:true}])
  expect(isBodyweightEq('custom-flags',a)).toBe(true)
  expect(isBodyweightEq('custom-flags',b)).toBe(false)
  expect(isBw({id:'custom-flags'},a)).toBe(true)
  expect(isBw({id:'custom-flags',bodyweight:false},a)).toBe(false)
  expect(isAssisted('custom-flags',b)).toBe(true)
  expect(isAssisted('custom-flags',a)).toBe(false)
})
