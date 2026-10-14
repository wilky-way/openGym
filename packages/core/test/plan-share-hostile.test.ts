import { afterEach, describe, expect, it, vi } from 'vitest'
import { mergePlan, parsePlan } from '../src/plan-share'
import type { ExportPlan } from '../src/export-types'

const plan = () => ({ opengym_plan: 1, name: 'Synthetic plan', routines: [
  { id: 'r', name: 'Strength', ex: [{ id: '0025', sets: 3, reps: 5 }] },
], customEx: [], week: { 1: ['r'] } })
const target = (): ExportPlan => ({ routines: [], customEx: [], week: { 6: ['old'] } })
afterEach(() => vi.restoreAllMocks())

describe('hostile shared-plan safety exceptions', () => {
  it('copies only own weekday keys and keeps ordinary prototypes through parse and merge', () => {
    const raw = JSON.stringify(plan()).replace('"week":{"1":["r"]}', '"week":{"1":["r"],"__proto__":["r"],"constructor":["r"],"7":["r"]}')
    const parsed = parsePlan(raw)
    expect(parsed.week).toEqual({ 1: ['r'] })
    expect(Object.getPrototypeOf(parsed.week)).toBe(Object.prototype)
    const s = target()
    const oldWeek = s.week
    mergePlan(s, parsed, { schedule: true })
    expect(s.week).toEqual({ 1: [s.routines[0]!.id] })
    expect(s.week).not.toBe(oldWeek)
    expect(Object.getPrototypeOf(s.week)).toBe(Object.prototype)
    expect(s.week[0]).toBeUndefined()
    // Direct merge must be safe even when parsePlan is bypassed.
    const direct = target()
    mergePlan(direct, JSON.parse(raw), { schedule: true })
    expect(direct.week).toEqual({ 1: [direct.routines[0]!.id] })
    expect(Object.getPrototypeOf(direct.week)).toBe(Object.prototype)
    expect(Object.hasOwn(Object.prototype, '0')).toBe(false)
  })

  it('ignores inherited weekday entries and invalid schedule values', () => {
    const raw = { ...plan(), week: Object.assign(Object.create({ 2: ['r'] }), {
      1: ['r', 3, null, {}, ['r']], 3: 42, 4: { id: 'r' }, 5: null, 6: [],
    }) }
    const parsed = parsePlan(raw)
    expect(parsed.week).toEqual({ 1: ['r'], 5: null, 6: [] })
    expect(parsed.scheduledDays).toBe(1)
    const s = target()
    mergePlan(s, parsed, { schedule: true })
    expect(s.week).toEqual({ 1: [s.routines[0]!.id] })
  })

  it('drops inherited index ids and nonstring ids without coercing them', () => {
    const raw = { ...plan(), customEx: [{ id: 12 }, { id: ['0025'] }, { id: {} }], routines: [
      { id: 'r', ex: ['constructor', 'toString', '__proto__', 25, ['0025'], {}, null, '0025'].map(id => ({ id })) },
      { id: 7, ex: [{ id: '0025' }] },
    ], week: { 1: ['constructor', 'toString', '__proto__', 'r'] } }
    const parsed = parsePlan(raw)
    expect(parsed.customEx).toEqual([])
    expect(parsed.routines).toHaveLength(1)
    expect(parsed.routines[0]!.ex).toEqual([{ id: '0025' }])
    expect(parsed.dropped).toBe(7)
    const s = target()
    mergePlan(s, parsed, { schedule: true })
    expect(s.routines[0]!.ex[0]!.id).toBe('0025')
    expect(s.week).toEqual({ 1: [s.routines[0]!.id] })
    const direct = target()
    mergePlan(direct, raw as unknown as ExportPlan, { schedule: true })
    expect(direct.routines[0]!.ex).toEqual([{ id: '0025' }])
    expect(direct.week).toEqual({ 1: [direct.routines[0]!.id] })
  })

  it('uses an own index entry, never one inherited from a caller index', () => {
    const inherited = Object.create({ ghost: { id: 'ghost', n: 'Ghost', bp: 'chest' } })
    const own = Object.assign(Object.create(null), { ghost: { id: 'ghost', n: 'Ghost', bp: 'chest' } })
    const raw = { ...plan(), routines: [{ id: 'r', ex: [{ id: 'ghost' }] }] }
    expect(parsePlan(raw, 'kg', inherited).dropped).toBe(1)
    expect(parsePlan(raw, 'kg', own).routines[0]!.ex[0]!.id).toBe('ghost')
  })

  it('never canonicalizes an own alias to an inherited index target', () => {
    const index = Object.assign(Object.create({ '0025': { id: '0025', bp: 'chest' } }), {
      '2440': { id: '2440', bp: 'chest' },
    })
    const raw = { ...plan(), routines: [{ id: 'r', ex: [{ id: '2440' }] }] }
    const parsed = parsePlan(raw, 'kg', index)
    expect(parsed.routines[0]!.ex[0]!.id).toBe('2440')
    const s = target()
    mergePlan(s, raw, {}, index)
    expect(s.routines[0]!.ex[0]!.id).toBe('2440')
    expect(Object.hasOwn(index, s.routines[0]!.ex[0]!.id!)).toBe(true)
  })

  it('keeps validated string ids when direct objects make them nonenumerable', () => {
    const exercise = Object.defineProperty({ sets: 3 }, 'id', { value: '0025' })
    const routine = Object.defineProperty({ ex: [exercise] }, 'id', { value: 'r' })
    const parsed = parsePlan({ ...plan(), routines: [routine] })
    expect(parsed.routines[0]!.id).toBe('r')
    expect(parsed.routines[0]!.ex[0]!.id).toBe('0025')
    const s = target()
    mergePlan(s, parsed, { schedule: true })
    expect(s.week[1]).toEqual([s.routines[0]!.id])
    expect(s.routines[0]!.ex[0]!.id).toBe('0025')
  })

  it('safely remaps explicitly declared prototype-named ids to real imported string ids', () => {
    const ids = ['constructor', 'toString', '__proto__']
    const raw = { ...plan(), customEx: ids.map(id => ({ id, n: `Synthetic ${id}`, bp: 'chest' })),
      routines: ids.map(id => ({ id, name: id, ex: [{ id, sets: 3 }] })),
      week: { 1: ids, 2: ['undeclared'] },
    }
    const s = target()
    mergePlan(s, parsePlan(JSON.stringify(raw)), { schedule: true })
    expect(s.customEx).toHaveLength(3)
    expect(s.routines).toHaveLength(3)
    expect(s.week[1]).toEqual(s.routines.map(r => r.id))
    expect(s.week[2]).toBeUndefined()
    s.routines.forEach((r, i) => {
      expect(typeof r.id).toBe('string')
      expect(typeof r.ex[0]!.id).toBe('string')
      expect(r.ex[0]!.id).toBe(s.customEx![i]!.id)
      expect(r.id).not.toBe(ids[i])
    })
    expect(Object.getPrototypeOf(s.week)).toBe(Object.prototype)
  })
})

describe('plan import resource limits', () => {
  const rejectedBeforeDecode = (raw: string) => {
    const decode = vi.spyOn(JSON, 'parse')
    expect(() => parsePlan(raw)).toThrowError(expect.objectContaining({ code: 'plan-limit' }))
    expect(decode).not.toHaveBeenCalled()
    decode.mockRestore()
  }

  it('rejects 2 MiB strings before decode and in already decoded metadata', () => {
    const note = 'x'.repeat(2 * 1024 * 1024)
    const raw = { ...plan(), routines: [{ id: 'r', ex: [{ id: '0025', note }] }] }
    rejectedBeforeDecode(JSON.stringify(raw))
    expect(() => parsePlan(raw)).toThrowError(expect.objectContaining({ code: 'plan-limit' }))
    expect(() => mergePlan(target(), raw)).toThrowError(expect.objectContaining({ code: 'plan-limit' }))
  })

  it('counts UTF-8 bytes, even when the input has fewer than 1 MiB code units', () => {
    const metadata = Array.from({ length: 64 }, () => '界'.repeat(8192))
    const raw = JSON.stringify({ ...plan(), metadata })
    expect(raw.length).toBeLessThan(1024 * 1024)
    rejectedBeforeDecode(raw)
  })

  it('rejects 10,000-deep nesting before decode and without overflowing on object input', () => {
    rejectedBeforeDecode('{"opengym_plan":1,"routines":[],"metadata":' + '['.repeat(10_000) + '0' + ']'.repeat(10_000) + '}')
    let metadata: unknown = 0
    for (let i = 0; i < 10_000; i++) metadata = [metadata]
    expect(() => parsePlan({ ...plan(), metadata })).toThrowError(expect.objectContaining({ code: 'plan-limit' }))
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(() => parsePlan({ ...plan(), metadata: cyclic })).toThrowError(expect.objectContaining({ code: 'plan-limit' }))
  })

  it('bounds named array properties retained by direct-object exercise spreads', () => {
    const exercise = Object.assign([], { id: '0025', note: 'x'.repeat(2 * 1024 * 1024) })
    const raw = { ...plan(), routines: [{ id: 'r', ex: [exercise] }] }
    expect(() => parsePlan(raw)).toThrowError(expect.objectContaining({ code: 'plan-limit' }))
    const s = target(), before = JSON.stringify(s)
    expect(() => mergePlan(s, raw as unknown as ExportPlan)).toThrowError(expect.objectContaining({ code: 'plan-limit' }))
    expect(JSON.stringify(s)).toBe(before)
    let metadata: unknown = 0
    for (let i = 0; i < 10_000; i++) metadata = [metadata]
    const deep = { ...plan(), routines: [{ id: 'r', ex: [Object.assign([], { id: '0025', metadata })] }] }
    expect(() => parsePlan(deep)).toThrowError(expect.objectContaining({ code: 'plan-limit' }))
    expect(() => mergePlan(target(), deep as unknown as ExportPlan)).toThrowError(expect.objectContaining({ code: 'plan-limit' }))
    const many = { ...plan(), routines: [{ id: 'r', ex: [Object.assign([], { id: '0025' },
      Object.fromEntries(Array.from({ length: 256 }, (_, i) => [`k${i}`, 0]))) ] }] }
    expect(() => parsePlan(many)).toThrowError(expect.objectContaining({ code: 'plan-limit' }))
    const valid = { ...plan(), routines: [{ id: 'r', ex: [Object.assign([], { id: '0025', note: 'small' })] }] }
    expect(parsePlan(valid).routines[0]!.ex[0]!.note).toBe('small')
  })

  it('bounds nonenumerable and inherited custom fields consumed by merge', () => {
    for (const custom of [
      Object.defineProperty({ id: 'c', n: 'Synthetic', bp: 'chest' }, 'desc', { value: 'x'.repeat(2 * 1024 * 1024) }),
      Object.assign(Object.create({ desc: 'x'.repeat(2 * 1024 * 1024) }), { id: 'c', n: 'Synthetic', bp: 'chest' }),
    ]) {
      const raw = { ...plan(), customEx: [custom] }
      expect(() => parsePlan(raw)).toThrowError(expect.objectContaining({ code: 'plan-limit' }))
      const s = target(), before = JSON.stringify(s)
      expect(() => mergePlan(s, raw)).toThrowError(expect.objectContaining({ code: 'plan-limit' }))
      expect(JSON.stringify(s)).toBe(before)
    }
    const metadata = Object.defineProperties({}, Object.fromEntries(Array.from({ length: 257 }, (_, i) => [`k${i}`, { value: 0 }])))
    expect(() => parsePlan({ ...plan(), metadata })).toThrowError(expect.objectContaining({ code: 'plan-limit' }))
  })

  it('enforces 32 container levels and treats quoted/escaped delimiters as string data', () => {
    const nested = (depth: number) => '{"opengym_plan":1,"routines":[],"metadata":' + '['.repeat(depth) + '0' + ']'.repeat(depth) + '}'
    expect(parsePlan(nested(31)).routineCount).toBe(0)
    rejectedBeforeDecode(nested(32))
    const note = '[{,}]:"\\'.repeat(1000)
    expect(parsePlan(JSON.stringify({ ...plan(), routines: [{ id: 'r', ex: [{ id: '0025', note }] }] })).routines[0]!.ex[0]!.note).toBe(note)
  })

  it('bounds decoded strings and keys at 16,384 code units, including unicode escapes', () => {
    const raw = (note: string) => JSON.stringify({ ...plan(), note })
    expect(parsePlan(raw('x'.repeat(16_384))).routineCount).toBe(1)
    rejectedBeforeDecode(raw('x'.repeat(16_385)))
    rejectedBeforeDecode(raw('x'.repeat(16_385)).replace(/x/g, '\\u0078'))
    rejectedBeforeDecode(JSON.stringify({ ...plan(), ['k'.repeat(16_385)]: 0 }))
    expect(() => parsePlan({ ...plan(), note: 'x'.repeat(16_385) })).toThrowError(expect.objectContaining({ code: 'plan-limit' }))
  })

  it('bounds arbitrary arrays, object properties and total nodes before decode', () => {
    rejectedBeforeDecode(JSON.stringify({ ...plan(), metadata: Array(4097).fill(0) }))
    rejectedBeforeDecode(JSON.stringify({ ...plan(), metadata: Object.fromEntries(Array.from({ length: 257 }, (_, i) => [`k${i}`, 0])) }))
    rejectedBeforeDecode(JSON.stringify({ ...plan(), metadata: Array.from({ length: 25 }, () => Array(4096).fill(0)) }))
    expect(() => parsePlan({ ...plan(), metadata: Array(4097).fill(0) })).toThrowError(expect.objectContaining({ code: 'plan-limit' }))
    expect(() => parsePlan({ ...plan(), metadata: Object.fromEntries(Array.from({ length: 257 }, (_, i) => [`k${i}`, 0])) })).toThrowError(expect.objectContaining({ code: 'plan-limit' }))
    expect(() => parsePlan({ ...plan(), metadata: Array.from({ length: 25 }, () => Array(4096).fill(0)) })).toThrowError(expect.objectContaining({ code: 'plan-limit' }))
  })

  it.each([
    ['routines', { ...plan(), routines: Array(257).fill({ id: 'r', ex: [] }) }],
    ['customs', { ...plan(), customEx: Array(2049).fill({ id: 'c' }) }],
    ['exercises per routine', { ...plan(), routines: [{ id: 'r', ex: Array(129).fill({ id: '0025' }) }] }],
    ['total exercises', { ...plan(), routines: Array(65).fill({ id: 'r', ex: Array(128).fill({ id: '0025' }) }) }],
    ['routines per weekday', { ...plan(), week: { 1: Array(257).fill('r') } }],
  ])('bounds %s before normalizing or mutating the recipient', (_label, raw) => {
    expect(() => parsePlan(JSON.stringify(raw))).toThrowError(expect.objectContaining({ code: 'plan-limit' }))
    expect(() => parsePlan(raw)).toThrowError(expect.objectContaining({ code: 'plan-limit' }))
    const s = target(), before = JSON.stringify(s)
    expect(() => mergePlan(s, raw)).toThrowError(expect.objectContaining({ code: 'plan-limit' }))
    expect(JSON.stringify(s)).toBe(before)
  })
})
