import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import * as measurements from '../src/measurements'
import * as sha from '../src/sha256'
import * as zip from '../src/zip'
import * as balance from '../src/structuralBalanceTemplates'
import * as data from '../src/exercises-data'
import * as hevy from '../src/hevy-id-map'
import { INSTR_LANGS, EXERCISE_NAME_LANGS } from '../src/catalogue-langs'
import instructions from '../src/instr/en'
import descriptions from '../src/exercise-desc/en'
// @ts-expect-error The frozen JS oracle has no TS declarations; differential tests alone import it.
import * as oldMeasurements from '../../../packages/parity/fixtures/oracle/frontend/src/lib/measurements.js'
// @ts-expect-error Frozen JS oracle, permitted only in differential tests.
import * as oldSha from '../../../packages/parity/fixtures/oracle/frontend/src/lib/sha256.js'
// @ts-expect-error Frozen JS oracle, permitted only in differential tests.
import * as oldZip from '../../../packages/parity/fixtures/oracle/frontend/src/lib/zip.js'
// @ts-expect-error Frozen JS oracle, permitted only in differential tests.
import * as oldBalance from '../../../packages/parity/fixtures/oracle/frontend/src/lib/structuralBalanceTemplates.js'
// @ts-expect-error Frozen JS oracle, permitted only in differential tests.
import * as oldData from '../../../packages/parity/fixtures/oracle/frontend/src/lib/exercises-data.js'
// @ts-expect-error Frozen JS oracle, permitted only in differential tests.
import * as oldHevy from '../../../packages/parity/fixtures/oracle/frontend/src/lib/hevy-id-map.js'
// @ts-expect-error Frozen JS oracle, permitted only in differential tests.
import oldInstructions from '../../../packages/parity/fixtures/oracle/frontend/src/instr/en.js'
// @ts-expect-error Frozen JS oracle, permitted only in differential tests.
import oldDescriptions from '../../../packages/parity/fixtures/oracle/frontend/src/exercise-desc/en.js'

const runs = { seed: 101, numRuns: Number(process.env.FC_RUNS || 1000) }
function equal(next: unknown, old: unknown) {
  expect(next).toEqual(old)
  expect(JSON.stringify(next)).toBe(JSON.stringify(old))
}
function result(fn: () => unknown) {
  try { return { value: fn() } } catch (error) {
    return { error: error instanceof Error ? error.name : String(error) }
  }
}

describe('K01 frozen-data parity', () => {
  it('keeps catalogue rows, aliases, Hevy maps and English text byte-identical', () => {
    equal(data.EXDB, oldData.EXDB)
    equal(data.EXALIAS, oldData.EXALIAS)
    equal(hevy.HEVY_ID_MAP, oldHevy.HEVY_ID_MAP)
    equal(hevy.HEVY_TITLE_MAP, oldHevy.HEVY_TITLE_MAP)
    equal(instructions, oldInstructions)
    equal(descriptions, oldDescriptions)
    expect(INSTR_LANGS).toEqual(['en'])
    expect(EXERCISE_NAME_LANGS).toEqual([])
  })

  it('preserves the structural-balance tables and frozen constants', () => {
    for (const key of ['EVALUATION_MODES', 'BALANCE_STATUSES', 'BORDERLINE_BAND_PCT',
      'TEMPLATES', 'TEMPLATE_LIST', 'DEFAULT_TEMPLATE_ID'] as const) equal(balance[key], oldBalance[key])
    expect(Object.isFrozen(balance.EVALUATION_MODES)).toBe(true)
    expect(Object.isFrozen(balance.BALANCE_STATUSES)).toBe(true)
  })
})

describe('K01 utility differential properties', () => {
  it('ZIP-CRC32 oracle exception rejects parseable corruption accepted by legacy', async () => {
    const name = 'opengym-backup.json'
    const backup = '{"workouts":[{"sets":[{"w":100}]}]}'
    const now = new Date('2026-08-11T12:34:56Z')
    const archive = await oldZip.zipStore([{ name, blob: new Blob([backup]) }], { now })
    const bytes = new Uint8Array(await archive.arrayBuffer())
    const start = 30 + new TextEncoder().encode(name).length
    bytes[start + backup.indexOf('100')] = '9'.charCodeAt(0)
    const corrupt = new Blob([bytes])
    const legacyEntries = await oldZip.readZip(corrupt)
    expect(JSON.parse(await legacyEntries[0].blob.text())).toEqual({ workouts: [{ sets: [{ w: 900 }] }] })
    await expect(zip.readZip(corrupt)).rejects.toMatchObject({ code: 'crc-mismatch' })
    const entries = await zip.readZip(archive)
    const valid = await oldZip.zipStore(entries, { now })
    const roundTrip = await zip.zipStore(await zip.readZip(valid), { now })
    expect(new Uint8Array(await roundTrip.arrayBuffer())).toEqual(new Uint8Array(await valid.arrayBuffer()))
  })

  it('preserves measurement coercion, mutations, selectors, and JSON key order', () => {
    const custom = fc.array(fc.record({ id: fc.string(), name: fc.string(), enabled: fc.boolean() }), { maxLength: 5 })
    const row = fc.dictionary(fc.constantFrom('d', 't', 'waist', 'neck', 'bodyFat', 'other'), fc.jsonValue())
    fc.assert(fc.property(row, custom, fc.jsonValue(), fc.constantFrom('lb', 'kg', ''), (raw, fields, value, unit) => {
      const nextInput = structuredClone(raw) as measurements.MeasurementInput
      const oldInput = structuredClone(raw)
      equal(result(() => measurements.normalizeMeasurementEntry(nextInput, fields)),
        result(() => oldMeasurements.normalizeMeasurementEntry(oldInput, fields)))
      equal(result(() => measurements.fromMeasurementDisplay(value, unit)), result(() => oldMeasurements.fromMeasurementDisplay(value, unit)))
      equal(measurements.measurementUnit(unit), oldMeasurements.measurementUnit(unit))
      const input = { unit, customMeasurements: fields,
        measurements: [{ d: '2026-08-11', t: 100, waist: value }, { d: '2026-08-11', t: 200, bodyFat: value },
          { d: '2026-08-12', t: 300, neck: value }], measurementEnabled: ['waist', 'neck', 'unknown', 'waist'] }
      const evaluate = (api: typeof measurements) => {
        const copy = structuredClone(input), state = api.normalizeMeasurementsState(copy)
        return { state, sameReference: state === copy, fields: api.enabledMeasurementFields(state),
          selectors: ['waist', 'bodyFat', 'other:missing', 'neck', 'unknown'].map(key => ({
            series: api.measurementSeries(state, key, 7, Date.UTC(2026, 7, 15)), latest: api.latestMeasurement(state, key),
            label: api.measurementLabel(key, fields), hasValues: state.measurements.map(api.measurementEntryHasValues),
          })) }
      }
      equal(result(() => evaluate(measurements)), result(() => evaluate(oldMeasurements)))
    }), runs)
  })

  it('preserves SHA bytes, sliced buffers, incremental boundaries and CRC continuation', async () => {
    await fc.assert(fc.asyncProperty(fc.uint8Array({ maxLength: 4096 }), fc.nat(4096), async (bytes, at) => {
      const split = Math.min(bytes.length, at)
      equal(sha.sha256HexJs(bytes), oldSha.sha256HexJs(bytes))
      equal(sha.createSha256().update(bytes.subarray(0, split)).update(bytes.subarray(split)).hex(),
        oldSha.createSha256().update(bytes.subarray(0, split)).update(bytes.subarray(split)).hex())
      equal(await sha.sha256Hex(bytes.buffer, { subtle: null }), await oldSha.sha256Hex(bytes.buffer, { subtle: null }))
      equal(zip.crc32(bytes.subarray(split), zip.crc32(bytes.subarray(0, split))),
        oldZip.crc32(bytes.subarray(split), oldZip.crc32(bytes.subarray(0, split))))
    }), runs)
  })

  it('writes identical ZIP bytes and reads identical payloads with a fixed clock', async () => {
    await fc.assert(fc.asyncProperty(fc.array(fc.record({ name: fc.string({ maxLength: 20 }),
      bytes: fc.uint8Array({ maxLength: 128 }) }), { maxLength: 4 }), async rows => {
      const entries = rows.map((row, i) => ({ name: `media/${i}-${encodeURIComponent(row.name)}`, blob: new Blob([row.bytes]) }))
      const now = new Date('2026-08-11T12:34:56Z')
      const next = await zip.zipStore(entries, { now }), old = await oldZip.zipStore(entries, { now })
      equal(new Uint8Array(await next.arrayBuffer()), new Uint8Array(await old.arrayBuffer()))
      const nextRows = await zip.readZip(next), oldRows = await oldZip.readZip(old)
      equal(nextRows.map(({ name, size }) => ({ name, size })), oldRows.map(({ name, size }: { name: string; size: number }) => ({ name, size })))
      for (let i = 0; i < nextRows.length; i++) equal(new Uint8Array(await nextRows[i]!.blob.arrayBuffer()),
        new Uint8Array(await oldRows[i].blob.arrayBuffer()))
    }), runs)
  })
})
