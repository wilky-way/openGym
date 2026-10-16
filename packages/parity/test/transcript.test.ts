import { expect, it, onTestFinished } from 'vitest'
import { access, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { startOracle, syntheticProfile, PINNED_NOW, TranscriptRecorder, replayTranscript, jsonBody, saveTranscript, loadTranscript, fixtureDocs, type Json, type ParityTarget, type Transcript } from '../src'
async function record(): Promise<Transcript> {
  const profile = syntheticProfile(19, { users: 1, workouts: 1 }), oracle = await startOracle(profile)
  try {
    const recorder = new TranscriptRecorder(oracle, 'revision-stamp-reset', profile)
    const session = { uid: 'synthetic_u_1' }, doc = JSON.parse(profile.docs[session.uid]!) as { [key: string]: Json }
    const request = (state: Json, extra: { [key: string]: Json } = {}) => recorder.request({ method: 'PUT', path: '/api/data', session, body: jsonBody({ state, ...extra }) })
    await recorder.request({ method: 'GET', path: '/api/data', session })
    const first = await request({ ...doc, active: { id: 'local-only' } }, { baseRev: 0, stamped: true })
    expect(first.status).toBe(200)
    const wid = (JSON.parse(first.body.data) as { wid: string }).wid
    await request({ workouts: [], routines: [] }, { baseRev: 0, baseWid: wid }) // conflict leaves bytes alone
    const old = { _ts: 2, workouts: [], routines: [], restSec: 120 }
    const corrected = await request(old, { baseRev: 1, baseWid: wid })
    expect(JSON.parse(corrected.body.data).rev).toBe(2)
    const stored = JSON.parse((await oracle.storedDocs())[session.uid]!.toString())
    expect(stored._rev).toBe(3) // kept unknown fields => reply +1 but stored +2
    expect(stored.deleted.workouts.synthetic_w_0_0).toBe(PINNED_NOW)
    expect(stored.futureTop).toEqual(doc.futureTop)
    await recorder.request({ method: 'GET', path: '/api/data/rev', session })
    await recorder.setTime(PINNED_NOW + 60000)
    await request({ _ts: 3, workouts: [], routines: [], resetAt: PINNED_NOW + 60000, resetIds: { workouts: ['synthetic_w_0_0'] } }, { stamped: true })
    await request({ _ts: 4, workouts: [], routines: [] }, { stamped: true }) // monotone reset retained
    await recorder.request({ method: 'GET', path: '/api/data', session })
    await recorder.request({ method: 'PUT', path: '/api/data', session, body: { encoding: 'utf8', data: '{bad json' } })
    return recorder.snapshot()
  } finally { await oracle.stop() }
}
it('three synthetic recordings and fresh-oracle self-replays are 100% identical', async () => {
  const transcripts = []
  for (let i = 0; i < 3; i++) transcripts.push(await record())
  expect(JSON.stringify(transcripts[1])).toBe(JSON.stringify(transcripts[0]))
  expect(JSON.stringify(transcripts[2])).toBe(JSON.stringify(transcripts[0]))
  for (const transcript of transcripts) {
    const oracle = await startOracle(transcript.profile)
    try { expect(await replayTranscript(transcript, oracle)).toEqual({ requests: 9 }) }
    finally { await oracle.stop() }
  }
}, 30000)
it('paired tokens/Set-Cookie are reusable in replay and never persisted as raw credentials', async () => {
  const profile = syntheticProfile(1, { users: 1, workouts: 0 }), oracle = await startOracle(profile)
  onTestFinished(() => oracle.stop())
  const recorder = new TranscriptRecorder(oracle, 'pair-renew', profile, { 'POST /api/pair/create#/code': 'pair-code', 'POST /api/pair/redeem#/code': 'pair-code' })
  const pair = await recorder.request({ method: 'POST', path: '/api/pair/create', session: { uid: 'synthetic_u_1' }, body: jsonBody({}) })
  expect(pair.status).toBe(200)
  const code = JSON.parse(pair.body.data).code as string
  const redeemed = await recorder.request({ method: 'POST', path: '/api/pair/redeem', body: jsonBody({ code }) })
  expect(redeemed.status).toBe(200)
  const token = JSON.parse(redeemed.body.data).token as string
  await recorder.request({ method: 'GET', path: '/api/me', headers: { Authorization: `Bearer ${token}` } })
  await recorder.request({ method: 'POST', path: '/api/logout', session: { uid: 'synthetic_u_1' }, body: jsonBody({}) })
  const transcript = recorder.snapshot(), file = join(oracle.dataDir, 'transcript.json')
  await saveTranscript(file, transcript)
  expect(await loadTranscript(file)).toEqual(transcript)
  expect((await stat(file)).mode & 0o777).toBe(0o600)
  expect(await readFile(file, 'utf8')).not.toContain(token)
  expect(await readFile(file, 'utf8')).not.toContain(code)
  const second = await startOracle(profile)
  try { expect(await replayTranscript(transcript, second)).toEqual({ requests: 4 }) }
  finally { await second.stop() }
})
it('replay fails on altered response headers/status and stored JSON order', async () => {
  const profile = syntheticProfile(1, { users: 1, workouts: 0 }), oracle = await startOracle(profile)
  onTestFinished(() => oracle.stop())
  const recorder = new TranscriptRecorder(oracle, 'negative replay', profile)
  await recorder.request({ method: 'PUT', path: '/api/data', session: { uid: 'synthetic_u_1' }, body: jsonBody({ state: { workouts: [], routines: [] }, stamped: true }) })
  const transcript = recorder.snapshot()
  const target = (override: Partial<ParityTarget>): ParityTarget => ({ request: r => oracle.request(r), storedDocs: () => oracle.storedDocs(), setTime: now => oracle.setTime(now), ...override })
  // A fresh synthetic target separates initial-state failures from response/store failures.
  const fresh = await startOracle(profile)
  try {
    const badStatus: ParityTarget = { storedDocs: () => fresh.storedDocs(), setTime: now => fresh.setTime(now), request: async r => ({ ...await fresh.request(r), status: 201 }) }
    await expect(replayTranscript(transcript, badStatus)).rejects.toThrow('response differs')
  } finally { await fresh.stop() }
  const badInitial = target({ storedDocs: async () => fixtureDocs({ synthetic_u_1: '{}' }) })
  await expect(replayTranscript(transcript, badInitial)).rejects.toThrow('initial docs')
  const order = await startOracle(profile)
  try {
    let reads = 0
    const badOrder: ParityTarget = { request: r => order.request(r), setTime: now => order.setTime(now), storedDocs: async () => {
      const docs = await order.storedDocs()
      if (++reads > 1) for (const uid of Object.keys(docs)) docs[uid] = Buffer.from(JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(docs[uid]!.toString())).reverse())))
      return docs
    } }
    await expect(replayTranscript(transcript, badOrder)).rejects.toThrow('byte')
  } finally { await order.stop() }
})
it('pinned Date constructor/now, clock advance, bearer expiry and cleanup are observable', async () => {
  const profile = syntheticProfile(), oracle = await startOracle(profile), dir = oracle.dataDir
  try {
    expect((await stat(dir)).mode & 0o777).toBe(0o700)
    expect((await stat(join(dir, 'secret'))).mode & 0o777).toBe(0o600)
    const session = { uid: 'synthetic_u_1', bearer: true, expires: PINNED_NOW + 10 }
    expect((await oracle.request({ method: 'GET', path: '/api/data', session })).status).toBe(200)
    const invite = await oracle.request({ method: 'POST', path: '/api/admin/invites/new', session: { uid: session.uid, bearer: true }, body: jsonBody({}) })
    expect(invite.status).toBe(200)
    expect(JSON.parse(invite.body.data).invite.created).toBe(new Date(PINNED_NOW).toISOString())
    await oracle.setTime(PINNED_NOW + 11)
    expect((await oracle.request({ method: 'GET', path: '/api/data', session })).status).toBe(401)
    await expect(oracle.request({ method: 'GET', path: 'https://example.com/' })).rejects.toThrow('origin-relative')
    await expect(startOracle(profile, { env: { DATA_DIR: '/data' } })).rejects.toThrow('Unsafe')
  } finally { await oracle.stop() }
  await expect(access(dir)).rejects.toThrow()
  await oracle.stop()
  await expect(oracle.storedDocs()).rejects.toThrow('stopped')
})
it('records and replays a backup rewind without losing stale-wid conflicts', async () => {
  const profile = syntheticProfile(2, { users: 1, workouts: 0 }), oracle = await startOracle(profile)
  try {
    const recorder = new TranscriptRecorder(oracle, 'wid-rewind', profile), session = { uid: 'synthetic_u_1' }
    const put = (name: string, baseRev: number, baseWid?: string) => recorder.request({ method: 'PUT', path: '/api/data', session, body: jsonBody({ state: { workouts: [{ id: name }], routines: [] }, baseRev, ...(baseWid ? { baseWid } : {}), stamped: true }) })
    const a = JSON.parse((await put('first', 0)).body.data) as { wid: string }
    const backup = await oracle.storedDocs()
    const b = JSON.parse((await put('lost', 1, a.wid)).body.data) as { wid: string }
    await recorder.restoreDocs(backup)
    await put('restored', 1, a.wid)
    expect((await put('stale', 2, b.wid)).status).toBe(409)
    const second = await startOracle(profile)
    try { expect(await replayTranscript(recorder.snapshot(), second)).toEqual({ requests: 4 }) }
    finally { await second.stop() }
  } finally { await oracle.stop() }
})
it('review P2: an unseen synthetic backup identity binds after restore and self-replays', async () => {
  const profile = syntheticProfile(3, { users: 1, workouts: 0 }), oracle = await startOracle(profile)
  try {
    const recorder = new TranscriptRecorder(oracle, 'unseen backup identity', profile)
    await recorder.restoreDocs(fixtureDocs({ synthetic_u_1: '{"workouts":[],"routines":[],"_rev":7,"_wid":"cccccccccccccccc"}' }))
    await recorder.request({ method: 'GET', path: '/api/data/rev', session: { uid: 'synthetic_u_1' } })
    await recorder.request({ method: 'PUT', path: '/api/data', session: { uid: 'synthetic_u_1' }, body: jsonBody({ state: { workouts: [], routines: [] }, baseRev: 7, baseWid: 'cccccccccccccccc', stamped: true }) })
    const replay = await startOracle(profile)
    try { expect(await replayTranscript(recorder.snapshot(), replay)).toEqual({ requests: 2 }) }
    finally { await replay.stop() }
  } finally { await oracle.stop() }
})
it('review P2: corrupt stored JSON returns 503, is preserved after rejected PUT, and self-replays', async () => {
  const profile = syntheticProfile(4, { users: 1, workouts: 0 })
  profile.docs.synthetic_u_1 = '{broken'
  const oracle = await startOracle(profile)
  try {
    const recorder = new TranscriptRecorder(oracle, 'corrupt stored JSON', profile), session = { uid: 'synthetic_u_1' }
    expect((await recorder.request({ method: 'GET', path: '/api/data', session })).status).toBe(503)
    expect((await recorder.request({ method: 'PUT', path: '/api/data', session, body: jsonBody({ state: { workouts: [], routines: [] } }) })).status).toBe(503)
    expect(await oracle.storedDocs()).toEqual(fixtureDocs({ synthetic_u_1: '{broken' }))
    const replay = await startOracle(profile)
    try { expect(await replayTranscript(recorder.snapshot(), replay)).toEqual({ requests: 2 }) }
    finally { await replay.stop() }
  } finally { await oracle.stop() }
})
