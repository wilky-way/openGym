import { createXMLValidator } from './xml-validator.js'
import { parseBodyweight, parseImport, type BodyweightImport, type ImportOptions } from '../../../core/src/import-csv'
import type { ExerciseIndex } from '../../../core/src/exercises'
import { readExportChunks, readExportText } from '../platform/export-file'

// Deliberate legacy safety exceptions: workout CSVs <=50 MiB; multi-year Health
// export.xml <=4 GiB. Never decode a complete Health export into a string.
export const CSV_IMPORT_MAX_BYTES = 50 * 1024 * 1024
export const HEALTH_IMPORT_MAX_BYTES = 4 * 1024 * 1024 * 1024
const CHUNK_BYTES = 64 * 1024
const MAX_TAG_CHARS = 64 * 1024
const MAX_WEIGHT_DAYS = 50_000 // >136 years; bounds retained output as well as input.
export class ImportFileError extends Error {}

/** Keep only the final valid body-mass record per day, using the core's conversion
 * and validation. Input buffers are <=64 KiB plus one <=64K-character tag; no
 * unrelated Health records or XML text survive a chunk. */
async function readHealth(file: Blob, opts: ImportOptions) {
  const days = new Map<string, { entry: BodyweightImport['bodyweight'][number]; unit: string; raw: number }>()
  const decoder = new TextDecoder()
  let pending = '', bytes = 0
  const xml = createXMLValidator()

  const consume = (text: string) => {
    let offset = 0
    while (offset < text.length) {
      if (!pending) {
        const start = text.indexOf('<', offset)
        if (start < 0) return
        offset = start
      }
      const end = text.indexOf('>', offset)
      const part = text.slice(offset, end < 0 ? text.length : end + 1)
      if (pending.length + part.length > MAX_TAG_CHARS) throw new ImportFileError('That Health XML record is too large (64 KiB limit)')
      pending += part
      if (end < 0) return
      if (/^<Record\b/.test(pending) && pending.includes('type="HKQuantityTypeIdentifierBodyMass"')) {
        const parsed = parseBodyweight(pending, opts)
        if (!parsed.error) {
          const entry = parsed.bodyweight[0]!
          days.set(entry.d, { entry, unit: parsed.fileUnit, raw: parseFloat(/value="([\d.]+)"/.exec(pending)![1]!) })
          if (days.size > MAX_WEIGHT_DAYS) throw new ImportFileError('That Health XML has too many weigh-in days (50,000 limit)')
        }
      }
      pending = ''
      offset = end + 1
    }
  }
  for await (const chunk of readExportChunks(file)) {
    bytes += chunk.byteLength
    if (bytes > HEALTH_IMPORT_MAX_BYTES) throw new ImportFileError('Health XML is too large. The limit is 4 GiB.')
    for (let offset = 0; offset < chunk.byteLength; offset += CHUNK_BYTES) {
      const decoded = decoder.decode(chunk.subarray(offset, offset + CHUNK_BYTES), { stream: true })
      consume(decoded)
      try { xml.write(decoded) } catch { throw new ImportFileError('Malformed Health XML') }
      // Bound long XML text/CDATA as well as tags. Health data never needs retained text.
      if (xml.bufferLength() > MAX_TAG_CHARS) throw new ImportFileError('Health XML text is too large (64 KiB limit)')
    }
  }
  const tail = decoder.decode(); consume(tail); xml.write(tail)
  if (!bytes) return { error: 'empty' as const }
  try { xml.close() } catch { throw new ImportFileError('Malformed Health XML') }
  if (!days.size) return { error: 'unrecognised' as const }
  const values = [...days.values()].sort((a, b) => a.entry.d.localeCompare(b.entry.d))
  const units = [...new Set(values.map(v => v.unit).filter(Boolean))].sort()
  const fileUnit = units.join(' / '), unit = opts.unit ?? 'kg'
  // Preserve the core parser's fallback for unlabeled records, including mixed
  // files. Convert the raw value once; per-record validation already ran above.
  const converted = (raw: number, source: string) => Math.round((source && source !== unit ? (source === 'lb' ? raw * 0.45359237 : raw / 0.45359237) : raw) * 10) / 10
  return {
    kind: 'bodyweight' as const, source: 'Apple Health', bodyweight: values.map(v => ({ ...v.entry, w: converted(v.raw, v.unit || fileUnit) })),
    fileUnit, converted: units.some(source => source !== unit), from: values[0]!.entry.d, to: values.at(-1)!.entry.d,
  }
}

export async function readImportExport(file: Blob, opts: ImportOptions, index: ExerciseIndex) {
  const namedXml = 'name' in file && typeof file.name === 'string' && /\.xml$/i.test(file.name)
  // Check size BEFORE any reader, including format sniffing. Large exports must
  // identify as .xml; anonymous/non-XML blobs obey the conservative CSV cap.
  if (file.size > (namedXml ? HEALTH_IMPORT_MAX_BYTES : CSV_IMPORT_MAX_BYTES)) {
    throw new ImportFileError(namedXml ? 'Health XML is too large. The limit is 4 GiB.' : 'CSV is too large. The limit is 50 MiB. For Apple Health, choose export.xml.')
  }
  if (namedXml) return readHealth(file, opts)
  const prefix = await readExportText(file.slice(0, 4096))
  if (/^\s*</.test(prefix)) return readHealth(file, opts)
  return parseImport(await readExportText(file), opts, index)
}
