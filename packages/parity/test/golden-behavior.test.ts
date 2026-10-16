import { expect, test } from 'vitest'
import { GOLDEN_SCENARIOS, recordScenario } from '../src/golden'
import { mintSession, startOracle } from '../src/oracle'
import { replayTranscript } from '../src/transcript'
import { jsonBody, type Json, type ParityTarget } from '../src/types'

test('pairing replay rejects a wrong-owner token and an invalid HMAC after identity normalisation', async () => {
  const scenario = GOLDEN_SCENARIOS.find(s => s.id === 'routes-pairing')!
  const transcript = await recordScenario(scenario)
  for (const mutation of ['wrong-owner', 'invalid-hmac']) {
    const oracle = await startOracle(transcript.profile, { env: { MEDIA_UPLOADS: '0' } })
    const target: ParityTarget = {
      storedDocs: () => oracle.storedDocs(), setTime: now => oracle.setTime(now), restoreDocs: docs => oracle.restoreDocs(docs),
      async request(request) {
        const response = await oracle.request(request)
        if (request.path !== '/api/pair/redeem' || response.status !== 200) return response
        const body = JSON.parse(response.body.data) as { token: string }
        const [payload, signature] = body.token.split('.') as [string, string]
        if (mutation === 'wrong-owner') {
          const [, expiry, sv] = payload.split(':')
          body.token = mintSession(transcript.profile.db.users[1]!.id, transcript.profile.now, Number(sv), Number(expiry))
        } else body.token = `${payload}.${signature[0] === 'A' ? 'B' : 'A'}${signature.slice(1)}`
        return { ...response, body: jsonBody(body as unknown as Json) }
      }
    }
    try { await expect(replayTranscript(transcript, target)).rejects.toThrow('(GET /api/me)') }
    finally { await oracle.stop() }
  }
})
