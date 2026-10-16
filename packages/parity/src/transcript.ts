import { readFile, writeFile } from 'node:fs/promises'
import { isDeepStrictEqual } from 'node:util'
import { IdentityNormaliser, assertStoredDocBytes } from './normalise'
import { fixtureDocs, encodeDocs, decodeDocs, type StoredDocs, type ParityRequest, type ParityResponse, type ParityTarget, type SyntheticProfile, type Transcript } from './types'
/** A recorder owns a sequential scenario. Returned responses retain runtime IDs for the caller. */
export class TranscriptRecorder {
  readonly transcript: Transcript
  private readonly normaliser: IdentityNormaliser
  constructor(private readonly target: ParityTarget, name: string, profile: SyntheticProfile, identityFields: Record<string, string> = {}) {
    this.normaliser = new IdentityNormaliser(identityFields)
    this.normaliser.docs(fixtureDocs(profile.docs)) // establish initial identity positions before any response
    this.transcript = { version: 2, name, profile: structuredClone(profile), identityFields: structuredClone(identityFields), steps: [] }
  }
  async request(request: ParityRequest): Promise<ParityResponse> {
    const normalisedRequest = this.normaliser.request(request)
    const response = await this.target.request(request)
    const step: Transcript['steps'][number] = { kind: 'request', request: normalisedRequest, response: this.normaliser.response(response, `${request.method.toUpperCase()} ${request.path.split('?')[0]}`) }
    // Every attempted write, including errors/conflicts/deletes, asserts no accidental mutation.
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method.toUpperCase())) step.docs = encodeDocs(this.normaliser.docs(await this.target.storedDocs()))
    this.transcript.steps.push(step)
    return response
  }
  async setTime(now: number): Promise<void> { await this.target.setTime(now); this.transcript.steps.push({ kind: 'clock', now }) }
  async restoreDocs(docs: StoredDocs): Promise<void> {
    if (!this.target.restoreDocs) throw new Error('Target does not support fixture restore')
    const normalised = this.normaliser.docs(docs, false)
    await this.target.restoreDocs(docs)
    this.transcript.steps.push({ kind: 'restore', docs: encodeDocs(normalised) })
    this.normaliser.docs(docs)
  }
  snapshot(): Transcript { return structuredClone(this.transcript) }
}
/** The caller seeds the target from transcript.profile; the target can be legacy or new. */
export async function replayTranscript(transcript: Transcript, target: ParityTarget, onStep?: (index: number) => void): Promise<{ requests: number }> {
  if (transcript.version !== 2) throw new Error('Unsupported transcript version')
  const normaliser = new IdentityNormaliser(transcript.identityFields)
  const expectedInitial = normaliser.docs(fixtureDocs(transcript.profile.docs))
  assertStoredDocBytes(expectedInitial, normaliser.docs(await target.storedDocs()), `${transcript.name}: initial docs`)
  await target.setTime(transcript.profile.now)
  let requests = 0
  for (const [index, step] of transcript.steps.entries()) {
    onStep?.(index)
    if (step.kind === 'clock') { await target.setTime(step.now); continue }
    if (step.kind === 'restore') {
      if (!target.restoreDocs) throw new Error('Target does not support fixture restore')
      const docs = normaliser.materialiseDocs(decodeDocs(step.docs))
      await target.restoreDocs(docs)
      const restored = await target.storedDocs()
      assertStoredDocBytes(decodeDocs(step.docs), normaliser.docs(restored, false), `${transcript.name}: restore ${index}`)
      normaliser.docs(restored)
      continue
    }
    const response = normaliser.response(await target.request(normaliser.materialiseRequest(step.request)), `${step.request.method.toUpperCase()} ${step.request.path.split('?')[0]}`)
    if (!isDeepStrictEqual(step.response, response)) throw new Error(`${transcript.name}: response differs at step ${index} (${step.request.method} ${step.request.path})\nexpected ${JSON.stringify(step.response)}\nactual ${JSON.stringify(response)}`)
    if (step.docs) assertStoredDocBytes(decodeDocs(step.docs), normaliser.docs(await target.storedDocs()), `${transcript.name}: step ${index}`)
    requests++
  }
  return { requests }
}
export async function saveTranscript(path: string, transcript: Transcript): Promise<void> {
  // Serialise only the already-normalised transcript, never the raw responses.
  await writeFile(path, JSON.stringify(transcript, null, 2) + '\n', { mode: 0o600 })
}
export async function loadTranscript(path: string): Promise<Transcript> {
  const transcript = JSON.parse(await readFile(path, 'utf8')) as Transcript
  if (transcript.version !== 2 || !Array.isArray(transcript.steps) || !transcript.profile || typeof transcript.name !== 'string') throw new Error('Invalid transcript')
  return transcript
}
