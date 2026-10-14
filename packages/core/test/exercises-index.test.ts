import { describe, expect, it } from 'vitest'
import { createExerciseIndex, canonicalExId, registerCustom, EXIDX, CATALOGUE, exOr, isCustomEx, isAssisted, betterWeight, beatsWeight, isCardio, defaultIncrement } from '../src/exercises'
import { buildStarterPlan, substituteFor } from '../src/starter'

describe('caller-owned exercise indexes', () => {
  it('lets custom ids shadow hidden aliases without changing other lookups or profiles', () => {
    const custom = { id: '1019', n: 'Synthetic custom lift', bp: 'back', eq: 'custom', assisted: true }
    expect(Object.getOwnPropertyDescriptor(EXIDX, custom.id)?.enumerable).toBe(false)
    const first = { ...custom, n: 'First custom lift' }
    const index = createExerciseIndex([first, custom])
    expect(index[custom.id]).toBe(custom)
    expect(exOr(custom.id, index)).toBe(custom)
    expect(isCustomEx(custom, index)).toBe(true)
    expect(isAssisted(custom.id, index)).toBe(true)
    expect(Object.values(index)).toContain(custom)
    expect(Object.isFrozen(index)).toBe(true)
    for (const id of Object.getOwnPropertyNames(EXIDX)) {
      if (id === custom.id) continue
      expect(index[id]).toBe(EXIDX[id])
      expect(Object.getOwnPropertyDescriptor(index, id)?.enumerable)
        .toBe(Object.getOwnPropertyDescriptor(EXIDX, id)?.enumerable)
    }
    expect(registerCustom([custom])[custom.id]).toBe(custom)
    expect(createExerciseIndex()[custom.id]).toBe(EXIDX[custom.id])
    expect(EXIDX[custom.id]).not.toBe(custom)
  })
  it('isolates two simultaneous profiles and restores shadows without edits to the catalogue', () => {
    const custom = { id: '0025', n: 'Custom bench', bp: 'cardio', eq: 'leverage machine', assisted: true }
    const a = createExerciseIndex([custom])
    const b = registerCustom([{ id: 'own', n: 'My squat', bp: 'upper legs' }])
    expect(a['0025']).toBe(custom)
    expect(b['0025']).toBe(EXIDX['0025'])
    expect(EXIDX['0025']?.n).toBe('barbell bench press')
    expect(isCustomEx({ ...custom }, a)).toBe(true)
    expect(isCustomEx({ ...custom }, b)).toBe(false)
    expect(isCustomEx(CATALOGUE.find(e => e.id === '0025'), a)).toBe(false)
    expect(isAssisted('0025', a)).toBe(true)
    expect(isAssisted('0025', b)).toBe(false)
    expect(beatsWeight('0025', 20, 30, a)).toBe(true)
    expect(betterWeight('0025', 30, 20, a)).toBe(20)
    expect(isCardio('0025', a)).toBe(true)
    expect(defaultIncrement('own', 'lb', b)).toBe(10)
    expect(exOr('own', a)).toMatchObject({ id: 'own', missing: true })
    expect(registerCustom([])['0025']).toBe(EXIDX['0025'])
    expect(a['0025']).toBe(custom)
    expect(Object.isFrozen(EXIDX)).toBe(true)
  })
  it('fits starter plans using the same explicit index as the caller', () => {
    const a = createExerciseIndex([{ id: '0025', n: 'Custom bench', bp: 'chest', eq: 'custom' }])
    const p = buildStarterPlan('ppl', [], a)!
    expect(p.routines[0]?.ex.some(e => e.id === '0025')).toBe(true)
    const custom = { id: 'own', n: 'barbell bench press', bp: 'chest', eq: 'custom', tg: 'pectorals' }
    const index = createExerciseIndex([custom])
    expect(substituteFor(EXIDX['0025']!, ['custom'], new Set(), index)).toBe(custom)
    expect(buildStarterPlan('ppl', ['custom'], index)?.routines[0]?.ex[0]?.id).toBe('own')
  })
  it('retains last duplicate, skips absent ids and accepts non-array resets', () => {
    const last = { id: 'own', n: 'Last' }
    const index = registerCustom([null, {}, { id: 'own', n: 'First' }, last])
    expect(index.own).toBe(last)
    expect(isCustomEx(last, index)).toBe(true)
    expect(registerCustom(undefined)).toEqual(EXIDX)
  })
})


it('canonical lookup preserves a caller-owned custom alias shadow', () => {
  const custom = { id: '1019', n: 'Custom alias lift', eq: 'custom' }
  const index = createExerciseIndex([custom])
  expect(canonicalExId('1019', index)).toBe('1019')
  expect(index[canonicalExId('1019', index)]).toBe(custom)
  expect(canonicalExId('1019')).toBe('3841')
  expect(canonicalExId('1019', createExerciseIndex())).toBe('3841')
})
