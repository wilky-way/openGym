import { test, expect } from 'bun:test'
import { GOLDEN_SCENARIOS, recordScenario } from '../../parity/src/golden'
import { replayTranscript } from '../../parity/src/transcript'
import { dataParityTarget } from './data-parity-target'
import type { Transcript } from '../../parity/src/types'

// S11 adds nginx's edge headers to the standalone API. Compare their exact values
// as well as every original header/body/doc byte; no response headers are ignored.
function withEdgeHeaders(transcript: Transcript): Transcript {
  for (const step of transcript.steps) if (step.kind === 'request') Object.assign(step.response.headers, {
    'x-frame-options': ['DENY'], 'x-content-type-options': ['nosniff'],
    'referrer-policy': ['same-origin'], 'content-security-policy': ["frame-ancestors 'none'"],
  })
  return transcript
}

const routes = new Set(['GET /api/data', 'GET /api/data/rev', 'PUT /api/data'])
for (const scenario of GOLDEN_SCENARIOS.filter(s => s.routes.every(r => routes.has(r)) && s.id !== 'data-offload-bearer')) {
  test(`F3 stored-doc byte replay: ${scenario.id}`, async () => {
    const transcript = withEdgeHeaders(await recordScenario(scenario))
    const target = dataParityTarget(transcript.profile)
    try { expect((await replayTranscript(transcript, target)).requests).toBeGreaterThan(0) }
    finally { target.close() }
  }, 60000)
}
test('F3 named OFFLOAD exception: legacy retained the definition alongside its marker', async () => {
  const scenario = GOLDEN_SCENARIOS.find(s => s.id === 'data-offload-bearer')!
  const transcript = withEdgeHeaders(await recordScenario(scenario))
  const target = dataParityTarget(transcript.profile)
  try {
    // This transcript must still record on the frozen legacy oracle. The one
    // approved semantic difference is asserted by the endpoint's new-rule tests.
    await expect(replayTranscript(transcript, target)).rejects.toThrow('differs at byte')
  } finally { target.close() }
}, 60000)
