import { buildDemoState } from './fixtures/demoSeed'
import { describe, expect, it, vi } from 'vitest'
import { createExerciseIndex, EXIDX } from '../src/exercises'
import { anchorsByWorkout, resolveSetRir, fatigueOf, strengthOf, fatiguedMuscles, detrainedMuscles } from '../src/recovery'
import { primaryMuscleOf, strengthExerciseRows, strengthExerciseRowsForMuscle } from '../src/strength-exercises'
import { computeBalance, resolveCurrent, resolveCurrentReps, type BalanceTemplate } from '../src/structuralBalance'
import type { AnalyticsWorkout } from '../src/analytics-types'
const NOW = Date.UTC(2026, 7, 8, 12)
const customs = [
  { id: 'ix-assisted', n: 'Custom assistance', assisted: true, eq: 'leverage machine', muscleWeights: { chest: 1 } },
  { id: 'ix-bw', n: 'Custom bodyweight', eq: 'body weight', muscleWeights: { chest: 1 } },
  { id: 'ix-belt', n: 'Custom weighted pull-up', eq: 'weighted', muscleWeights: { biceps: 1 } },
  { id: 'ix-load', n: 'Custom loaded lift', eq: 'barbell', muscleWeights: { quadriceps: 1 } },
]
const index = createExerciseIndex(customs)
const w: AnalyticsWorkout = { start: NOW, bw: 80, entries: [{ id: 'ix-assisted', sets: [{ done: true, w: 20, r: 5 }] }, { id: 'ix-load', sets: Array.from({ length: 8 }, () => ({ done: true, w: 100, r: 5 })) }] }

describe('caller-owned exercise indexes', () => {
  it('forwards custom assistance into session anchors and custom metadata into both recovery scans', () => {
    const anchors = anchorsByWorkout([w], {}, index).get(w)!
    expect(anchors.has('ix-assisted')).toBe(false)
    expect(anchors.has('ix-load')).toBe(true)
    expect(fatigueOf([w], NOW, {}, index).chest).toBeGreaterThan(0)
    expect(strengthOf([w], NOW, {}, index).quadriceps).toBe(1)
    expect(fatiguedMuscles([w], NOW, {}, index)).toContain('quadriceps')
    expect(detrainedMuscles([w], NOW, {}, index)).not.toContain('quadriceps')
    expect(fatigueOf([w], NOW).chest).toBe(0)
    expect(EXIDX['ix-assisted']).toBeUndefined()
  })
  it('keeps custom bodyweight scoring at full credit through both anchor and effort forwarding', () => {
    const history = [{ start: NOW, bw: 80, entries: [{ id: 'ix-bw', sets: Array.from({ length: 8 }, () => ({ done: true, w: 20, r: 5 })) }] }]
    expect(fatigueOf(history, NOW, {}, index).chest).toBeCloseTo(1 - Math.exp(-2), 12)
  })
  it('uses the caller index when building older bodyweight capacity anchors for fatigue', () => {
    const prior = { start: NOW - 86400000, bw: 80, entries: [{ id: 'ix-bw', sets: [{ done: true, w: 80, r: 5 }] }] }
    const current = { start: NOW, bw: 80, entries: [{ id: 'ix-bw', sets: Array.from({ length: 8 }, () => ({ done: true, w: 20, r: 5 })) }] }
    const oldStimulus = (1 / 8) * (5 / 4.25) * 0.5 ** (24 / 30)
    const currentStimulus = (2.4 / 8) * (7.4 / 4.85)
    expect(fatigueOf([prior, current], NOW, {}, index).chest).toBeCloseTo(1 - Math.exp(-(oldStimulus + currentStimulus)), 12)
  })
  it('uses the custom bodyweight load for estimated effort and lets logged effort win', () => {
    const entry = { id: 'ix-bw', sets: [] }
    const row = { w: 0, r: 5, done: true }
    const anchors = new Map([['ix-bw', 100]])
    expect(resolveSetRir(row, row, entry, { bw: 80 }, anchors, {}, index)?.rir).toBeCloseTo(2.5)
    expect(resolveSetRir({ ...row, rir: 1 }, row, entry, { bw: 80 }, anchors, {}, index)).toEqual({ rir: 1, source: 'logged' })
  })
  it('uses custom catalogue metadata for primary muscle, canonical names and muscle filters', () => {
    const state = { workouts: [w] }
    expect(primaryMuscleOf({ id: 'ix-load' }, index)).toEqual({ slug: 'quadriceps', weight: 1 })
    expect(strengthExerciseRows(state, NOW, index).find(r => r.id === 'ix-load')).toMatchObject({ name: 'Custom loaded lift', primary: 'quadriceps' })
    expect(strengthExerciseRowsForMuscle(state, NOW, 'quadriceps', index).map(r => r.id)).toEqual(['ix-load'])
    expect(strengthExerciseRowsForMuscle(state, NOW, 'quadriceps', index)[0]).toMatchObject({ name: 'Custom loaded lift', primary: 'quadriceps' })
  })
  it('forwards custom assistance into both structural current selectors and computeBalance', () => {
    const state = { unit: 'kg', bodyweight: [{ w: 80 }], workouts: [w] }
    expect(resolveCurrent(state, ['ix-assisted'], 80, null, index)?.estKg).toBe(70)
    expect(resolveCurrentReps(state, ['ix-assisted'], index)).toBeNull()
    const template: BalanceTemplate = { id: 'synthetic', roles: [{ id: 'help', exerciseIds: ['ix-assisted'], evaluationMode: 'bodyweight-ratio', targetPct: 100 }] }
    expect(computeBalance(state, template, index)[0]?.actualPct).toBe(87.5)
    const loadRatio = { ...template, roles: template.roles.map(role => ({ ...role, evaluationMode: 'load-ratio' })) }
    expect(computeBalance({ workouts: [w] }, loadRatio, index)[0]?.needsBodyweight).toBe(false)
    expect(computeBalance({ workouts: [{ ...w, bw: undefined }] }, loadRatio, index)[0]?.needsBodyweight).toBe(true)
  })
  it('marks unweighed custom bodyweight work and leaves zero-help assistance unscored', () => {
    const template: BalanceTemplate = { id: 'needs-bw', roles: [{ id: 'lift', exerciseIds: ['ix-bw'], evaluationMode: 'load-ratio', targetPct: 100 }] }
    const state = { workouts: [{ entries: [{ id: 'ix-bw', sets: [{ done: true, w: 0, r: 5 }] }] }] }
    expect(computeBalance(state, template, index)[0]?.needsBodyweight).toBe(true)
    expect(computeBalance(state, template)[0]?.needsBodyweight).toBe(false)
    const assisted = { ...template, roles: [{ ...template.roles[0]!, exerciseIds: ['ix-assisted'] }] }
    expect(computeBalance({ workouts: [{ entries: [{ id: 'ix-assisted', sets: [{ done: true, w: 0, r: 5 }] }] }] }, assisted, index)[0]?.needsBodyweight).toBe(false)
  })
  it('forwards custom assistance through computeBalance rep-count resolution', () => {
    const template: BalanceTemplate = { id: 'rep-help', roles: [{ id: 'rep', exerciseIds: ['ix-assisted'], evaluationMode: 'rep-count', repsTarget: 5 }] }
    expect(computeBalance({ workouts: [w] }, template, index)[0]?.status).toBe('no-data')
    expect(computeBalance({ workouts: [w] }, template)[0]?.status).toBe('balanced')
  })
  it('excludes real custom-assisted estimates through best1RM and both strength row consumers', () => {
    const state = { workouts: [w] }
    expect(strengthExerciseRows(state, NOW, index).map(r => r.id)).toEqual(['ix-load'])
    expect(strengthExerciseRows(state, NOW).map(r => r.id)).toContain('ix-assisted')
    expect(strengthExerciseRowsForMuscle(state, NOW, 'chest', index)).toEqual([])
    // Saved muscle snapshot lets the outer filter run even if its rows dependency loses index.
    const saved = { workouts: [{ ...w, entries: [{ ...w.entries![0]!, muscleWeights: { chest: 1 } }] }] }
    expect(strengthExerciseRowsForMuscle(saved, NOW, 'chest', index)).toEqual([])
    expect(strengthExerciseRowsForMuscle(saved, NOW, 'chest').map(r => r.id)).toEqual(['ix-assisted'])
  })
  it('forwards the fixture index into history.modeOf for each seeded exercise', () => {
    const fixtureIndex = createExerciseIndex([{ id: '0025', n: 'Custom cardio bench', bp: 'cardio', eq: 'custom' }])
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
    try {
      const fixture = buildDemoState(fixtureIndex)
      const customSets = fixture.workouts.flatMap(w => w.entries.filter(e => e.id === '0025').flatMap(e => e.sets))
      const normal = buildDemoState().workouts.flatMap(w => w.entries.filter(e => e.id === '0025').flatMap(e => e.sets))
      expect(customSets.length).toBeGreaterThan(20)
      expect(customSets.every(s => s.rir == null && s.rpe == null)).toBe(true)
      expect(normal.some(s => s.rir != null || s.rpe != null)).toBe(true)
    } finally { vi.useRealTimers() }
  })
  it('resolves a custom weighted belt movement from the supplied index', () => {
    const state = { unit: 'kg', workouts: [{ start: NOW, bw: 80, entries: [{ id: 'ix-belt', sets: [{ done: true, w: 20, r: 1 }] }] }] }
    expect(resolveCurrent(state, ['ix-belt'], 80, null, index)?.estKg).toBe(100)
  })
})
