import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { startOracle, OracleFailure, type Oracle } from '../oracle'
import { syntheticProfile } from '../synthetic'
import { TranscriptRecorder, replayTranscript } from '../transcript'
import { encodeDocs, type ParityRequest, type ParityResponse, type ParityTarget, type Transcript, type TranscriptStep } from '../types'
import type { GoldenScenario } from './helpers'
import { ROUTE_IDENTITY_FIELDS } from './routes'

/** Where failure captures land: `PARITY_ARTIFACT_DIR` if set (tests point it at a temp dir), else `packages/parity/.artifacts`. */
export const artifactDir = (): string => process.env.PARITY_ARTIFACT_DIR ?? fileURLToPath(new URL('../../.artifacts/', import.meta.url))

interface Capture {
  kind: 'recording' | 'replay' | 'determinism'
  run: number
  transcript: string
  error: string
  /** Index into `transcript.steps` of the request that failed, when one was in flight. */
  stepIndex: number | null
  step: TranscriptStep | null
  request: ParityRequest | null
  /** The full actual response, body as received (base64 when not UTF-8 text, so nothing is lost). */
  actual: { status: number; headers: Record<string, string[]>; bodyBase64: string } | null
  oracle: { stdout: string; stderr: string; baseUrl: string; pid: number | null }
  /** Full normalised evidence for a three-recording mismatch. */
  expectedTranscript?: Transcript
  actualTranscript?: Transcript
}

/** Writes a failure capture and returns its path; the path goes into the thrown message so it is never lost. */
async function writeCapture(capture: Capture): Promise<string> {
  const dir = artifactDir()
  await mkdir(dir, { recursive: true })
  const safe = capture.transcript.replace(/[^A-Za-z0-9._-]+/g, '_')
  const path = resolve(join(dir, `${capture.kind}-${safe}-run${capture.run}${capture.stepIndex === null ? '' : `-step${capture.stepIndex}`}-${randomUUID()}.capture.json`))
  await writeFile(path, JSON.stringify(capture, null, 2) + '\n', { mode: 0o600 })
  return path
}

/** Capture I/O is secondary evidence: preserve the original failure even when the disk is unavailable. */
async function capturedError(error: unknown, capture: Capture): Promise<Error> {
  const original = error instanceof Error ? error : new Error(String(error))
  try {
    const path = await writeCapture(capture)
    return new Error(`${original.message}\n${capture.kind} capture: ${path}`, { cause: original })
  } catch (captureError) {
    const failure = captureError instanceof Error ? captureError.message : String(captureError)
    return new Error(`${original.message}\n${capture.kind} capture failed: ${failure}`, { cause: original })
  }
}

function differentStep(expected: Transcript, actual: Transcript): number | null {
  for (let i = 0; i < Math.max(expected.steps.length, actual.steps.length); i++) {
    if (JSON.stringify(expected.steps[i]) !== JSON.stringify(actual.steps[i])) return i
  }
  return null
}

function actualOf(response: ParityResponse): Capture['actual'] {
  return { status: response.status, headers: response.headers, bodyBase64: Buffer.from(response.body.data, response.body.encoding === 'base64' ? 'base64' : 'utf8').toString('base64') }
}

function diagnosticsOf(error: unknown, oracle?: Oracle): Capture['oracle'] {
  return error instanceof OracleFailure ? error.diagnostics : oracle?.diagnostics ?? { stdout: '', stderr: '', baseUrl: '', pid: null }
}

/** Records one scenario on a fresh legacy oracle. The profile is the scenario's own seed. */
export async function recordScenario(scenario: GoldenScenario, options: { run?: number; expected?: Transcript } = {}): Promise<Transcript> {
  const profile = syntheticProfile(scenario.seed)
  let oracle: Oracle | undefined
  // Track the last exchange so a failing expectation leaves the status, headers and body behind.
  let last = null as { request: ParityRequest; response: ParityResponse } | null
  let activeRequest: ParityRequest | null = null
  let stepIndex: number | null = null
  let step: TranscriptStep | null = null
  let mismatch: Transcript | undefined
  try {
    oracle = await startOracle(profile, { env: { MEDIA_UPLOADS: '0' } })
    const rec = new TranscriptRecorder(oracle, scenario.id, profile, ROUTE_IDENTITY_FIELDS)
    const request = rec.request.bind(rec)
    rec.request = async (req: ParityRequest) => {
      stepIndex = rec.transcript.steps.length; step = null; last = null; activeRequest = req
      const response = await request(req)
      last = { request: req, response }; step = rec.transcript.steps[stepIndex] ?? null
      return response
    }
    const restore = rec.restoreDocs.bind(rec), clock = rec.setTime.bind(rec)
    rec.restoreDocs = async docs => {
      stepIndex = rec.transcript.steps.length; step = { kind: 'restore', docs: encodeDocs(docs) }; last = null; activeRequest = null
      await restore(docs)
      step = rec.transcript.steps[stepIndex] ?? step
    }
    rec.setTime = async now => {
      stepIndex = rec.transcript.steps.length; step = { kind: 'clock', now }; last = null; activeRequest = null
      await clock(now)
      step = rec.transcript.steps[stepIndex] ?? step
    }
    await scenario.run({ rec, target: oracle, uid: profile.db.users[0]!.id, profile })
    const transcript = rec.snapshot()
    if (options.expected && JSON.stringify(options.expected) !== JSON.stringify(transcript)) {
      mismatch = transcript
      stepIndex = differentStep(options.expected, transcript)
      step = stepIndex === null ? null : transcript.steps[stepIndex] ?? null
      throw new Error(`${scenario.id}: recordings differ on run ${options.run ?? 1} at step ${stepIndex ?? 'metadata'}`)
    }
    return transcript
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw await capturedError(error, {
      kind: mismatch ? 'determinism' : 'recording', run: options.run ?? 1, transcript: scenario.id, error: message, stepIndex, step,
      request: mismatch ? null : error instanceof OracleFailure ? error.request : activeRequest, actual: mismatch ? null : error instanceof OracleFailure && error.response ? actualOf(error.response) : last ? actualOf(last.response) : null, oracle: diagnosticsOf(error, oracle),
      ...(mismatch ? { expectedTranscript: options.expected, actualTranscript: mismatch } : {})
    })
  } finally { await oracle?.stop() }
}

/** Replays a transcript against a fresh oracle seeded from the transcript's own profile. A mismatch writes a capture
 * (the transcript step, the full actual response and the oracle's output tails) and names its path in the error. */
export async function replayOnFreshOracle(transcript: Transcript, run = 1): Promise<{ requests: number }> {
  let oracle: Oracle | undefined
  let stepIndex: number | null = null
  let last: { request: ParityRequest; response: ParityResponse } | null = null
  try {
    const started = await startOracle(transcript.profile, { env: { MEDIA_UPLOADS: '0' } })
    oracle = started
    const target: ParityTarget = {
      request: async (request: ParityRequest) => { const response = await started.request(request); last = { request, response }; return response },
      storedDocs: () => started.storedDocs(),
      setTime: now => started.setTime(now),
      restoreDocs: docs => started.restoreDocs(docs)
    }
    return await replayTranscript(transcript, target, index => { stepIndex = index; last = null })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const failed = last as { request: ParityRequest; response: ParityResponse } | null
    throw await capturedError(error, {
      kind: 'replay', run, transcript: transcript.name, error: message, stepIndex,
      step: stepIndex === null ? null : transcript.steps[stepIndex] ?? null,
      request: error instanceof OracleFailure ? error.request : failed?.request ?? null, actual: error instanceof OracleFailure && error.response ? actualOf(error.response) : failed ? actualOf(failed.response) : null, oracle: diagnosticsOf(error, oracle)
    })
  } finally { await oracle?.stop() }
}
