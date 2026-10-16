import * as transport from '../src/http-transport'
// A replay mismatch leaves evidence on disk and names it in the error; so does a failing recording.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GOLDEN_SCENARIOS, recordScenario, replayOnFreshOracle, type GoldenScenario } from '../src/golden'

let dir = ''
let previous: string | undefined
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'parity-capture-')); previous = process.env.PARITY_ARTIFACT_DIR; process.env.PARITY_ARTIFACT_DIR = dir })
afterEach(async () => { if (previous === undefined) delete process.env.PARITY_ARTIFACT_DIR; else process.env.PARITY_ARTIFACT_DIR = previous; await rm(dir, { recursive: true, force: true }) })

test('a forced replay mismatch writes a capture with the step, the actual response and oracle output', { timeout: 120_000 }, async () => {
  const scenario = GOLDEN_SCENARIOS.find(s => s.id === 'data-rev-conditional')!
  const transcript = await recordScenario(scenario)
  const index = transcript.steps.findIndex(step => step.kind === 'request' && step.response.status === 200)
  const step = transcript.steps[index]!
  if (step.kind !== 'request') throw new Error('fixture has no 200 request')
  step.response.status = 418 // the recorded expectation no longer matches the legacy server

  const failure = await replayOnFreshOracle(transcript).then(() => null, (error: Error) => error)
  expect(failure).not.toBeNull()
  const match = /replay capture: (.+\.capture\.json)/.exec(failure!.message)
  expect(match, 'the error names the capture path').not.toBeNull()
  const path = match![1]!
  expect((await stat(path)).isFile()).toBe(true)
  const capture = JSON.parse(await readFile(path, 'utf8'))
  expect(capture.kind).toBe('replay')
  expect(capture.stepIndex).toBe(index)
  expect(transcript.steps[capture.stepIndex]?.kind).toBe('request')
  expect(capture.actual.status).toBe(200)
  expect(Buffer.from(capture.actual.bodyBase64, 'base64').length).toBeGreaterThan(0)
  expect(typeof capture.oracle.stdout).toBe('string')
  expect(typeof capture.oracle.stderr).toBe('string')
  expect(capture.oracle.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
  expect(capture.oracle.pid).toBeGreaterThan(0)
})

test('a failing recording writes a capture and names it', { timeout: 120_000 }, async () => {
  const failing: GoldenScenario = {
    id: 'capture-probe', routes: [], invs: [], seed: 20261099,
    async run(ctx) {
      await ctx.rec.restoreDocs({})
      const { call, jsonOf } = await import('../src/golden/helpers')
      const r = await call(ctx, 'GET', '/api/health', { anonymous: true })
      jsonOf(r)
      throw new Error('deliberate probe failure')
    }
  }
  const failure = await recordScenario(failing).then(() => null, (error: Error) => error)
  expect(failure?.message).toContain('deliberate probe failure')
  const match = /recording capture: (.+\.capture\.json)/.exec(failure!.message)
  expect(match).not.toBeNull()
  const capture = JSON.parse(await readFile(match![1]!, 'utf8'))
  expect(capture.kind).toBe('recording')
  expect(capture.stepIndex).toBe(1)
  expect(capture.step.kind).toBe('request')
  expect(capture.actual.status).toBe(200)
})

const health: GoldenScenario = {
  id: 'health-capture', seed: 20261099, routes: ['GET /api/health'], invs: [],
  async run(ctx) { await ctx.rec.request({ method: 'GET', path: '/api/health' }) }
}

test('capture-write failures preserve both the recording failure and replay mismatch', async () => {
  const transcript = await recordScenario(health)
  const blocker = join(dir, 'not-a-directory')
  await writeFile(blocker, '')
  process.env.PARITY_ARTIFACT_DIR = blocker
  const original = new Error('original expectation')
  const recordingError = await recordScenario({ ...health, async run(ctx) { await health.run(ctx); throw original } }).catch((error: Error) => error)
  expect(recordingError).toBeInstanceOf(Error)
  if (!(recordingError instanceof Error)) throw new Error('expected recording error')
  expect(recordingError.message).toContain('original expectation')
  expect(recordingError.message).toContain('recording capture failed:')
  expect(recordingError.cause).toBe(original)
  const step = transcript.steps[0]!
  if (step.kind !== 'request') throw new Error('expected health request')
  step.response.status = 418
  const replayError = await replayOnFreshOracle(transcript).catch((error: Error) => error)
  if (!(replayError instanceof Error)) throw new Error('expected replay error')
  expect(replayError.message).toContain('response differs at step 0')
  expect(replayError.message).toContain('replay capture failed:')
  expect((replayError.cause as Error).message).toContain('response differs at step 0')
})

test('restore failures identify the restore step rather than the preceding exchange', async () => {
  const transcript = await recordScenario({ ...health, async run(ctx) { await health.run(ctx); await ctx.rec.restoreDocs({}) } })
  const restore = transcript.steps[1]!
  if (restore.kind !== 'restore') throw new Error('expected restore step')
  restore.docs = { 'invalid/uid': { encoding: 'utf8', data: '{}' } }
  const failure = await replayOnFreshOracle(transcript).catch((error: Error) => error)
  if (!(failure instanceof Error)) throw new Error('expected restore error')
  const path = /replay capture: (.+\.capture\.json)/.exec(failure.message)![1]!
  const capture = JSON.parse(await readFile(path, 'utf8'))
  expect(capture.stepIndex).toBe(1)
  expect(capture.step.kind).toBe('restore')
  expect(capture.request).toBeNull()
  expect(capture.actual).toBeNull()
})

test('a failed recording restore captures the pending step and original document bytes', async () => {
  const docs = { 'invalid/uid': Buffer.from([0x7b, 0xff, 0x7d]) }
  const failure = await recordScenario({ ...health, async run(ctx) { await health.run(ctx); await ctx.rec.restoreDocs(docs) } }).catch((error: Error) => error)
  if (!(failure instanceof Error)) throw new Error('expected recording restore error')
  expect(failure.message).toContain('Invalid fixture identity')
  const path = /recording capture: (.+\.capture\.json)/.exec(failure.message)![1]!
  const capture = JSON.parse(await readFile(path, 'utf8'))
  expect(capture.stepIndex).toBe(1)
  expect(capture.step.kind).toBe('restore')
  expect(capture.step.docs['invalid/uid']).toEqual({ encoding: 'base64', data: docs['invalid/uid'].toString('base64') })
  expect(capture.request).toBeNull()
  expect(capture.actual).toBeNull()
})

test('determinism mismatches capture both recordings and preserve distinct run evidence', async () => {
  const expected = await recordScenario(health)
  const step = expected.steps[0]!
  if (step.kind !== 'request') throw new Error('expected health request')
  step.response.status = 418
  const paths: string[] = []
  for (const run of [2, 3, 3]) {
    const failure = await recordScenario(health, { run, expected }).catch((error: Error) => error)
    if (!(failure instanceof Error)) throw new Error('expected determinism error')
    const path = /determinism capture: (.+\.capture\.json)/.exec(failure.message)![1]!
    paths.push(path)
    expect(path).toContain(`-run${run}-`)
    const capture = JSON.parse(await readFile(path, 'utf8'))
    expect(capture.stepIndex).toBe(0)
    expect(capture.run).toBe(run)
    expect(capture.expectedTranscript.steps[0].response.status).toBe(418)
    expect(capture.actualTranscript.steps[0].response.status).toBe(200)
    expect(typeof capture.oracle.stderr).toBe('string')
    expect((await stat(path)).mode & 0o777).toBe(0o600)
  }
  expect(new Set(paths).size).toBe(3)
})

const foreignResponse = { status: 401, headers: { 'tailscale-version': ['synthetic-foreign'], 'x-evidence': ['retained'] }, body: { encoding: 'base64' as const, data: Buffer.from([0xff, 0x00, 0xfe]).toString('base64') } }

async function rejectedCapture(action: () => Promise<unknown>, kind: 'recording' | 'replay') {
  const error = await action().catch((error: Error) => error)
  if (!(error instanceof Error)) throw new Error('expected identity failure')
  expect(error.message).toContain('rejected foreign Tailscale listener')
  const path = new RegExp(`${kind} capture: (.+\\.capture\\.json)`).exec(error.message)![1]!
  const capture = JSON.parse(await readFile(path, 'utf8'))
  expect(capture.actual).toEqual({ status: 401, headers: foreignResponse.headers, bodyBase64: foreignResponse.body.data })
  expect(capture.request).toEqual({ method: 'GET', path: '/api/health' })
  expect(capture.oracle.pid).toBeGreaterThan(0)
  expect(capture.oracle.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
  expect(capture.oracle.stdout).toContain('gym-api on :')
  expect((await stat(path)).mode & 0o777).toBe(0o600)
  return capture
}

test('startup identity failures are captured during both recording and replay, including rejected response bytes', async () => {
  const transcript = await recordScenario(health)
  const spy = vi.spyOn(transport, 'directRequest').mockResolvedValue(foreignResponse)
  try {
    for (const [kind, action] of [
      ['recording', () => recordScenario(health)], ['replay', () => replayOnFreshOracle(transcript)]
    ] as const) {
      const capture = await rejectedCapture(action, kind)
      expect(capture.stepIndex).toBeNull()
      expect(capture.step).toBeNull()
    }
  } finally { spy.mockRestore() }
})

test('identity-rejected exchanges retain status, headers and binary body during both recording and replay', async () => {
  const transcript = await recordScenario(health)
  const direct = transport.directRequest
  for (const [kind, action] of [
    ['recording', () => recordScenario(health)], ['replay', () => replayOnFreshOracle(transcript)]
  ] as const) {
    const spy = vi.spyOn(transport, 'directRequest').mockImplementationOnce(direct).mockResolvedValue(foreignResponse)
    try {
      const capture = await rejectedCapture(action, kind)
      expect(capture.stepIndex).toBe(0)
      expect(spy).toHaveBeenCalledTimes(2)
    } finally { spy.mockRestore() }
  }
})
