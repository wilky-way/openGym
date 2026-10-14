import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseBodyweight } from '../../core/src/import-csv'
import { createExerciseIndex } from '../../core/src/exercises'
import { CSV_IMPORT_MAX_BYTES, HEALTH_IMPORT_MAX_BYTES, readImportExport } from '../src/lib/import-export'
import { configureExportFileReader } from '../src/platform/export-file'

const index = createExerciseIndex()
const weight = (day: string, w: number, unit = 'kg') => `<Record type="HKQuantityTypeIdentifierBodyMass" sourceName="Synthétique" unit="${unit}" value="${w}" startDate="${day} 08:00:00 +0000"/>`
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-28T12:00:00Z')) })
afterEach(() => { configureExportFileReader(); vi.useRealTimers() })

describe('bounded export readers (intentional legacy safety exception)', () => {
  it.each([['history.csv', CSV_IMPORT_MAX_BYTES], ['export.xml', HEALTH_IMPORT_MAX_BYTES]])('refuses oversized %s before any reader', async (name, limit) => {
    const readText = vi.fn(), readChunks = vi.fn()
    configureExportFileReader({ readText, readChunks })
    const file = new File([], name)
    Object.defineProperty(file, 'size', { value: Number(limit) + 1 })
    await expect(readImportExport(file, { unit: 'kg' }, index)).rejects.toThrow(/too large/)
    expect(readText).not.toHaveBeenCalled(); expect(readChunks).not.toHaveBeenCalled()
  })
  it('also refuses a 10 GiB anonymous blob before reading or sniffing', async () => {
    const readText = vi.fn(), readChunks = vi.fn()
    configureExportFileReader({ readText, readChunks })
    const file = new Blob([]); Object.defineProperty(file, 'size', { value: 10 * 1024 ** 3 })
    await expect(readImportExport(file, {}, index)).rejects.toThrow('50 MiB')
    expect(readText).not.toHaveBeenCalled(); expect(readChunks).not.toHaveBeenCalled()
  })
  it('preserves last valid record per day, units, timestamps and split UTF-8/tag boundaries', async () => {
    const xml = `<HealthData>${weight('2026-01-01', 80)}${weight('2026-01-02', 180, 'lb')}${weight('2026-01-01', 81)}${weight('2026-01-01', 0)}${weight('2026-01-03', 82).replace(' unit="kg"', '')}</HealthData>`
    const bytes = new TextEncoder().encode(xml)
    const readText = vi.fn()
    configureExportFileReader({ readText, async *readChunks() { for (let i = 0; i < bytes.length; i += 7) yield bytes.subarray(i, i + 7) } })
    const parsed = await readImportExport(new File([], 'export.xml'), { unit: 'lb' }, index)
    expect(parsed.kind).toBe('bodyweight')
    expect(parsed).toEqual(parseBodyweight(xml, { unit: 'lb' }))
    expect(readText).not.toHaveBeenCalled()
  })
  it('streams a synthetic 1 GiB export within a 64 MiB heap-growth budget, retaining only weigh-ins', async () => {
    const encoder = new TextEncoder()
    const chunk = encoder.encode(`<Record type="HKQuantityTypeIdentifierStepCount" value="${'1'.repeat(64 * 1024 - 65)}"/>`)
    const repeats = Math.ceil(1024 ** 3 / chunk.length)
    const baseline = process.memoryUsage().heapUsed
    let peak = baseline, delivered = 0
    const readText = vi.fn()
    configureExportFileReader({ readText, async *readChunks() {
      yield encoder.encode(`<HealthData>${weight('2026-01-01', 80)}`)
      for (let i = 0; i < repeats; i++) {
        delivered += chunk.length
        if (i % 128 === 0) peak = Math.max(peak, process.memoryUsage().heapUsed)
        yield chunk
      }
      yield encoder.encode(`${weight('2026-01-01', 81)}${weight('2026-01-02', 82)}</HealthData>`)
    } })
    const file = new File([], 'export.xml'); Object.defineProperty(file, 'size', { value: 1024 ** 3 })
    const parsed = await readImportExport(file, { unit: 'kg' }, index)
    expect(delivered).toBeGreaterThanOrEqual(1024 ** 3)
    expect(parsed).toMatchObject({ kind: 'bodyweight', bodyweight: [{ d: '2026-01-01', w: 81 }, { d: '2026-01-02', w: 82 }] })
    expect(peak - baseline).toBeLessThan(64 * 1024 ** 2)
    expect(readText).not.toHaveBeenCalled()
  }, 30_000)
  it('fails closed on an unbounded XML tag and releases the stream', async () => {
    const released = vi.fn()
    configureExportFileReader({ readText: vi.fn(), async *readChunks() {
      try { yield new TextEncoder().encode('<Record ' + 'a'.repeat(128 * 1024)) }
      finally { released() }
    } })
    await expect(readImportExport(new File([], 'export.xml'), {}, index)).rejects.toThrow('record is too large')
    expect(released).toHaveBeenCalledOnce()
  })
  it('uses the actual File.stream capability for XML', async () => {
    const file = new File([`<HealthData>${weight('2026-01-01', 80)}</HealthData>`], 'export.xml')
    const stream = vi.spyOn(file, 'stream')
    const text = vi.fn(); configureExportFileReader({ readText: text })
    expect(await readImportExport(file, {}, index)).toMatchObject({ kind: 'bodyweight', bodyweight: [{ w: 80 }] })
    expect(stream).toHaveBeenCalledOnce(); expect(text).not.toHaveBeenCalled()
  })
})

// Security regression: valid records never authorize a partial/malformed export.
it.each(['<', '<Record', 'trailing garbage', '<Second/>', '<!--', '</Wrong>', '<?broken'])('rejects malformed Health XML trailing input %s', async suffix => {
  configureExportFileReader({readChunks: async function* () {const encoder = new TextEncoder(); yield encoder.encode(`<HealthData>${weight('2026-01-01', 80)}</HealthData>`); yield encoder.encode(suffix)}, readText: async () => ''})
  await expect(readImportExport(new File([], 'export.xml'), {}, index)).rejects.toThrow(/XML/)
})
