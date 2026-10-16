import * as transport from '../src/http-transport'
import { expect, it, vi } from 'vitest'
import { spawn } from 'node:child_process'
import { readdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { IdentityNormaliser, assertStoredDocBytes, startOracle, syntheticProfile, TranscriptRecorder, replayTranscript, saveTranscript, loadTranscript, decodeBytes } from '../src'
vi.mock('node:child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return { ...actual, spawn: vi.fn(actual.spawn) }
})
it('fix round: stored reads, normalized spans and saved replay distinguish invalid UTF-8 bytes', async () => {
  const profile = syntheticProfile(91, { users: 1, workouts: 0 }), oracle = await startOracle(profile)
  const uid = 'synthetic_u_1', file = join(oracle.dataDir, `state-${uid}.json`)
  const doc = (bad: number, wid: string) => Buffer.concat([Buffer.from('{"note":"é 🏋 '), Buffer.from([bad]), Buffer.from(`","_wid":"${wid}","_wids":["${wid}"]}`)])
  const left = doc(0xff, '1111111111111111'), right = doc(0xfe, '2222222222222222')
  const recorder = new TranscriptRecorder(oracle, 'invalid bytes', profile)
  try {
    await writeFile(file, left)
    const stored = await oracle.storedDocs()
    const normalized = new IdentityNormaliser().docs(stored)
    await writeFile(file, right)
    const rightStored = await oracle.storedDocs()
    expect(() => assertStoredDocBytes(normalized, new IdentityNormaliser().docs(rightStored))).toThrow('byte')
    expect(Buffer.isBuffer(stored[uid])).toBe(true)
    expect(stored[uid]).toEqual(left)
    expect(normalized[uid]).toEqual(Buffer.concat([Buffer.from('{"note":"é 🏋 '), Buffer.from([0xff]), Buffer.from('","_wid":"@parity:wid:1@","_wids":["@parity:wid:1@"]}')]))
    // The invalid byte remains significant after a fixture restore, recording and disk serialization.
    await recorder.restoreDocs({ [uid]: left })
    await recorder.request({ method: 'PUT', path: '/api/data', session: { uid }, body: { encoding: 'utf8', data: '{bad' } })
    const saved = join(oracle.dataDir, 'bytes-transcript.json')
    await saveTranscript(saved, recorder.snapshot())
    const transcript = await loadTranscript(saved)
    const restore = transcript.steps[0]!
    if (restore.kind !== 'restore') throw new Error('Missing restore step')
    expect(decodeBytes(restore.docs[uid]!)).toEqual(left)
    const replay = await startOracle(profile)
    try {
      expect(await replayTranscript(transcript, replay)).toEqual({ requests: 1 })
      let reads = 0
      const changed = { request: r => replay.request(r), setTime: n => replay.setTime(n), restoreDocs: d => replay.restoreDocs(d), storedDocs: async () => {
        const docs = await replay.storedDocs()
        reads++
        for (const raw of Object.values(docs)) if (reads >= 3 && Buffer.isBuffer(raw)) { const at = raw.indexOf(0xff); if (at >= 0) raw[at] = 0xfe }
        return docs
      } } satisfies import('../src').ParityTarget
      // A new oracle supplies the correct initial fixtures for the tampered replay.
      await replay.restoreDocs(Object.fromEntries(Object.entries(profile.docs).map(([k, v]) => [k, Buffer.from(v)])))
      await expect(replayTranscript(transcript, changed)).rejects.toThrow('byte')
    } finally { await replay.stop() }
  } finally { await oracle.stop() }
})
const applicationHeaders = ['x-powered-by', 'strict-transport-security', 'referrer-policy', 'www-authenticate', 'content-length', 'x-future-header']
it.each(applicationHeaders)('fix round: captures and rejects added/deleted or changed %s on either side', async name => {
  const profile = syntheticProfile(92, { users: 1, workouts: 0 }), oracle = await startOracle(profile)
  const owned = await transport.directRequest(Number(new URL(oracle.baseUrl).port), { method: 'GET', path: '/api/health' })
  const nonce = owned.headers['x-parity-oracle-nonce']![0]!
  const response = (headers: Record<string, string> = {}) => ({ status: 200, headers: Object.fromEntries(Object.entries({ ...headers, 'x-parity-oracle-nonce': nonce }).map(([k, v]) => [k, [v]])), body: { encoding: 'utf8' as const, data: 'body' } })
  const mock = vi.spyOn(transport, 'directRequest')
  try {
    const recorder = new TranscriptRecorder(oracle, name, profile)
    mock.mockResolvedValue(response({ [name]: '4' }))
    expect((await recorder.request({ method: 'GET', path: '/api/health' })).headers[name]).toEqual(['4'])
    const target = { storedDocs: () => oracle.storedDocs(), setTime: n => oracle.setTime(n), request: r => oracle.request(r) } satisfies import('../src').ParityTarget
    mock.mockResolvedValue(response())
    await expect(replayTranscript(recorder.snapshot(), target)).rejects.toThrow('response differs')
    mock.mockResolvedValue(response({ [name]: '5' }))
    await expect(replayTranscript(recorder.snapshot(), target)).rejects.toThrow('response differs')
    const without = new TranscriptRecorder(oracle, name, profile)
    mock.mockResolvedValue(response())
    await without.request({ method: 'GET', path: '/api/health' })
    mock.mockResolvedValue(response({ [name]: '4' }))
    await expect(replayTranscript(without.snapshot(), target)).rejects.toThrow('response differs')
    // Only the documented transport ignore-list is tolerated during replay.
    mock.mockResolvedValue(response({ date: 'yesterday', connection: 'close', 'keep-alive': 'timeout=3', 'transfer-encoding': 'chunked' }))
    expect(await replayTranscript(without.snapshot(), target)).toEqual({ requests: 1 })
  } finally { mock.mockRestore(); await oracle.stop() }
})
it('fix round: malformed introduced tokens cannot disappear into identity placeholders', () => {
  const response = (token: string) => ({ status: 200, headers: {}, body: { encoding: 'utf8' as const, data: JSON.stringify({ token }) } })
  for (const token of ['not-a-token', 'payload.bad!', 'u:123:0.short', `u:123:0.${'A'.repeat(42)}B`, '@parity:token:1@', '']) {
    expect(() => new IdentityNormaliser().response(response(token))).toThrow('token')
    if (token) expect(() => new IdentityNormaliser().response({ ...response('not-json'), body: { encoding: 'utf8', data: 'ok' }, headers: { 'set-cookie': [`gymsid=${token}; HttpOnly`] } })).toThrow('token')
  }
  expect(() => new IdentityNormaliser().response({ status: 200, body: { encoding: 'utf8', data: 'ok' }, headers: { 'set-cookie': ['gymsid=; Max-Age=0'] } })).not.toThrow()
})
it('fix round: oracle Node process receives an empty temporary HOME', async () => {
  const oracle = await startOracle(syntheticProfile())
  try {
    const call = vi.mocked(spawn).mock.calls.findLast(args => args[2]?.env?.DATA_DIR === oracle.dataDir)
    expect(call?.[2]?.env?.HOME).toBe(join(oracle.dataDir, 'home'))
    expect(await readdir(join(oracle.dataDir, 'home'))).toEqual([])
    expect((await stat(join(oracle.dataDir, 'home'))).mode & 0o777).toBe(0o700)
    expect(oracle.child.spawnfile).not.toBe('mise')
  } finally { await oracle.stop() }
})
