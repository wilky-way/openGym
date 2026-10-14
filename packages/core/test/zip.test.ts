import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { zipStore, readZip, looksLikeZip, crc32, ZipError, MAX_ENTRIES, MAX_TOTAL } from '../src/zip'

const text = async (blob: Blob) => new TextDecoder().decode(new Uint8Array(await blob.arrayBuffer()))
const u8 = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer())

// A zip laid out by hand: one local header and central record per entry, for the refusals.
function handZip(entries: { name: string; data: Uint8Array<ArrayBuffer> }[], { method = 0, flags = 0x0800, count }: { method?: number; flags?: number; count?: number } = {}) {
  const enc = new TextEncoder()
  const parts: Uint8Array<ArrayBuffer>[] = [], cd: Uint8Array<ArrayBuffer>[] = []
  let off = 0
  for (const { name, data } of entries) {
    const n = enc.encode(name)
    const crc = crc32(data)
    const lh = new DataView(new ArrayBuffer(30))
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(6, flags, true); lh.setUint16(8, method, true)
    lh.setUint32(14, crc, true)
    lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, n.length, true)
    parts.push(new Uint8Array(lh.buffer), n, data)
    const c = new DataView(new ArrayBuffer(46))
    c.setUint32(0, 0x02014b50, true); c.setUint16(8, flags, true); c.setUint16(10, method, true)
    c.setUint32(16, crc, true)
    c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, n.length, true); c.setUint32(42, off, true)
    cd.push(new Uint8Array(c.buffer), n)
    off += 30 + n.length + data.length
  }
  const cdSize = cd.reduce((s, p) => s + p.length, 0)
  const e = new DataView(new ArrayBuffer(22))
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, count ?? entries.length, true); e.setUint16(10, count ?? entries.length, true)
  e.setUint32(12, cdSize, true); e.setUint32(16, off, true)
  return new Blob([...parts, ...cd, new Uint8Array(e.buffer)])
}
const refusal = async (blob: Blob) => { try { await readZip(blob); return null } catch (e) { return e instanceof ZipError ? e.code : 'other' } }

describe('zip', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-08-11T12:34:56Z')) })
  afterEach(() => vi.useRealTimers())
  it('the CRC of "abc" is 0x352441C2', () => {
    expect(crc32(new TextEncoder().encode('abc'))).toBe(0x352441c2)
  })

  it('round-trips names (UTF-8 included) and bytes, and says it is a zip', async () => {
    const bin = new Uint8Array(70000).map((_, i) => i & 0xff)
    const z = await zipStore([
      { name: 'opengym-backup.json', blob: new Blob(['{"workouts":[]}']) },
      { name: 'media/übung.bin', blob: new Blob([bin]) },
      { name: 'empty.txt', blob: new Blob([]) }
    ])
    expect(z.type).toBe('application/zip')
    expect(await looksLikeZip(z)).toBe(true)
    expect(await looksLikeZip(new Blob(['{"a":1}']))).toBe(false)
    const back = await readZip(z)
    expect(back.map(e => [e.name, e.size])).toEqual([['opengym-backup.json', 15], ['media/übung.bin', 70000], ['empty.txt', 0]])
    expect(await text(back[0]!.blob)).toBe('{"workouts":[]}')
    expect(await u8(back[1]!.blob)).toEqual(bin)
    expect(await u8(await zipStore(back))).toEqual(await u8(z))
  })

  it.each(['first', 'middle', 'last', 'folder/'])('validates CRC-32 for the %s entry', async name => {
    const entries = ['first', 'middle', 'last', 'folder/'].map(name => ({ name, blob: new Blob(['abc']) }))
    const z = await zipStore(entries)
    const bytes = await u8(z)
    let offset = 0
    for (const entry of entries) {
      const start = offset + 30 + new TextEncoder().encode(entry.name).length
      if (entry.name === name) bytes[start] = 0x78 // abc -> xbc, preserving size and headers
      offset = start + entry.blob.size
    }
    expect(await refusal(new Blob([bytes]))).toBe('crc-mismatch')
  })

  it('checks empty entries and still omits valid directory entries', async () => {
    const z = await zipStore([{ name: 'folder/', blob: new Blob([]) }, { name: 'empty', blob: new Blob([]) }])
    expect((await readZip(z)).map(e => e.name)).toEqual(['empty'])
    const bytes = await u8(z)
    const view = new DataView(bytes.buffer)
    const cdOffset = view.getUint32(bytes.length - 6, true)
    view.setUint32(cdOffset + 16, 1, true) // empty directory CRC must be zero
    expect(await refusal(new Blob([bytes]))).toBe('crc-mismatch')
    view.setUint32(cdOffset + 16, 0, true)
    view.setUint32(cdOffset + 46 + 'folder/'.length + 16, 1, true) // empty regular file too
    expect(await refusal(new Blob([bytes]))).toBe('crc-mismatch')
  })

  it('checks corruption past the 4 MiB CRC chunk boundary', async () => {
    const data = new Uint8Array(4 * 1024 * 1024 + 1)
    const z = await zipStore([{ name: 'a', blob: new Blob([data]) }])
    expect((await readZip(z))[0]!.size).toBe(data.length)
    const bytes = await u8(z)
    bytes[31 + data.length - 1] = 1
    expect(await refusal(new Blob([bytes]))).toBe('crc-mismatch')
  })

  it('refuses a compressed entry, an encrypted one, a name that climbs out, and too many entries', async () => {
    const data = new Uint8Array([1, 2, 3])
    expect(await refusal(handZip([{ name: 'a.txt', data }], { method: 8 }))).toBe('compressed')
    expect(await refusal(handZip([{ name: 'a.txt', data }], { flags: 0x0801 }))).toBe('encrypted')
    expect(await refusal(handZip([{ name: '../../evil.sh', data }]))).toBe('bad-name')
    expect(await refusal(handZip([{ name: 'media/../x', data }]))).toBe('bad-name')
    expect(await refusal(handZip([{ name: '/etc/passwd', data }]))).toBe('bad-name')
    expect(await refusal(handZip([{ name: 'a.txt', data }], { count: MAX_ENTRIES + 1 }))).toBe('too-many')
    expect(await refusal(new Blob(['not a zip at all']))).toBe('not-zip')
  })

  it('refuses an export above the import size limit before reading the file', async () => {
    const blob = { size: MAX_TOTAL + 1, slice: () => { throw new Error('read past the size guard') } } as unknown as Blob // Synthetic oversize Blob: no allocation, guard must run before slicing.
    await expect(zipStore([{ name: 'media/large.mp4', blob }])).rejects.toMatchObject({ code: 'too-large' })
  })
})
