// Loose fixture calls preserve legacy malformed-input and partial-state cases; production exports are strict.
import { beforeEach as freezeEach, afterEach as thawEach, vi as clock } from 'vitest'
freezeEach(() => { clock.useFakeTimers({ toFake: ['Date'] }); clock.setSystemTime(new Date('2026-10-13T12:00:00Z')) })
thawEach(() => clock.useRealTimers())
import { describe, expect, it } from 'vitest'
import { parseBodyweight as typed_parseBodyweight } from '../src/import-csv'
const parseBodyweight = typed_parseBodyweight as (...args: any[]) => any

const record = (day: any, value: any, unit: any) => `<Record type="HKQuantityTypeIdentifierBodyMass" unit="${unit}" value="${value}" startDate="2026-09-${day} 08:00:00 +0000"/>`

describe('Apple Health body-weight units', () => {
  it.each([
    ['kg', [80, 81.6]],
    ['lb', [176.4, 180]],
  ])('converts each record into %s independently', (unit: any, expected: any) => {
    const parsed = parseBodyweight(record('01', 80, 'kg') + record('02', 180, 'lb'), { unit })
    expect(parsed.bodyweight.map((b: any) => b.w)).toEqual(expected)
    expect(parsed.converted).toBe(true)
    expect(parsed.fileUnit).toBe('kg / lb')
  })

  it('does not let record order change another day’s weight', () => {
    const kg = record('01', 80, 'kg'), lb = record('02', 180, 'lb')
    expect(parseBodyweight(kg + lb).bodyweight).toEqual(parseBodyweight(lb + kg).bodyweight)
  })

  it('preserves conversion for single-unit XML and CSV exports', () => {
    expect(parseBodyweight(record('01', 180, 'lb')).bodyweight[0]!.w).toBe(81.6)
    expect(parseBodyweight('Date,Weight (lbs)\n2026-09-01,180').bodyweight[0]!.w).toBe(81.6)
    expect(parseBodyweight(record('01', 80, 'kg')).converted).toBe(false)
  })
})
