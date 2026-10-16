import { it, expect } from 'vitest'
import { makeWarmupAt } from '../src/history'
import { preserveWarmupMetadata } from '../src/workout-model'
it('preserves unknown metadata while clearing work-only data without mutating input', () => {
 const source = {w: 60, r: 5, done: true, at: 7, mode: 'reps', rpe: 9, note: 'work only', weightOrigin: {history: 1}, extension: {future: true}}
 const warm = makeWarmupAt([source], 0)[0], before = JSON.stringify(source)
 expect(preserveWarmupMetadata(source, warm)).toEqual({w: 60, r: 5, done: true, at: 7, phase: 'warmup', warmup: true, extension: {future: true}})
 expect(JSON.stringify(source)).toBe(before)
})
