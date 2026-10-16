import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// @ts-expect-error Frozen JS oracle has no declarations; differential-only import.
import { drawWorkoutCard as legacyDraw } from '../../../packages/parity/fixtures/oracle/frontend/src/lib/workout-card.js'
import { configureUx, ux } from '../src/platform/ux'
import { drawWorkoutCard } from '../src/lib/workout-card'
import { layoutWorkoutCard } from '../../core/src/workout-card'
import type { WorkoutCardModel } from '../../core/src/workout-card'

class TestPath { constructor(readonly d: string) {} }
beforeEach(() => {
  vi.stubGlobal('Path2D', TestPath) // The frozen legacy drawer still uses the global.
  configureUx({ ...ux(), path2D: path => new TestPath(path) as unknown as Path2D })
})
afterEach(() => vi.unstubAllGlobals())
function recorder() {
  const calls: unknown[][] = []
  const ctx = new Proxy({}, {
    get: (_target, method) => (...args: unknown[]) => { calls.push([method, ...args.map(v => v instanceof TestPath ? v.d : v)]) },
    set: (_target, property, value) => { calls.push(['set', property, value]); return true },
  }) as CanvasRenderingContext2D
  return { ctx, calls }
}
const colors = { bg: '#fff', surface: '#fafafa', tile: '#eee', label: 'rgba(30, 40, 50, 0.8)', label2: '#666', acc: '#84a52a' }
const model: WorkoutCardModel = { title: 'Synthetic workout', date: 'Oct 9, 2026', stats: [{ label: 'Sets', value: '3' }, { label: 'Volume', value: '120 kg' }], records: ['Synthetic Press'], levels: { chest: 4 } }
const measure = (s: string, _weight: number, size: number) => s.length * size / 2
const body = { front: { vb: '10 20 100 200', p: { chest: ['M1 2h3v4Z'], head: ['M2 3h4v5Z'] } }, back: { vb: '0 0 100 200', p: { chest: ['M5 6h7v8Z'] } } }

describe('W13 card drawing supplied by K16', () => {
  for (const rtl of [false, true]) it(`matches legacy drawing operations with maps, swatches and trophies (rtl=${rtl})`, () => {
    const layout = layoutWorkoutCard(model, { measure, map: { aspect: 2 }, rtl })
    const a = recorder(), b = recorder()
    const map = { body, levels: model.levels! }
    drawWorkoutCard(a.ctx, layout, colors, map)
    legacyDraw(b.ctx, layout, colors, map)
    expect(a.calls).toEqual(b.calls)
    expect(a.calls).toContainEqual(['fillText', 'Synthetic workout', rtl ? 992 : 88, 226])
    expect(a.calls).toContainEqual(['translate', -10, -20])
    expect(a.calls).toContainEqual(['fill', 'M1 2h3v4Z'])
    expect(a.calls.filter(c => c[0] === 'stroke')).toHaveLength(2)
  })
  it('draws a card without a map, including fallback colors and an injected font family', () => {
    const layout = layoutWorkoutCard({ ...model, records: [], levels: null }, { measure })
    const a = recorder(), b = recorder()
    const palette = { ...colors, tile: undefined }
    drawWorkoutCard(a.ctx, layout, palette, null, 'Synthetic Sans')
    legacyDraw(b.ctx, layout, palette, null, 'Synthetic Sans')
    expect(a.calls).toEqual(b.calls)
    expect(a.calls).toContainEqual(['set', 'font', '700 76px Synthetic Sans'])
    expect(a.calls.some(c => c[0] === 'stroke')).toBe(false)
  })
})
