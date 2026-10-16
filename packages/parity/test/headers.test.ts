import * as transport from '../src/http-transport'
import { expect, it, vi } from 'vitest'
import { startOracle, syntheticProfile } from '../src'
it('review P2: captures PNA, preflight cache and media security headers without hiding deletion', async () => {
  const oracle = await startOracle(syntheticProfile())
  const owned = await transport.directRequest(Number(new URL(oracle.baseUrl).port), { method: 'GET', path: '/api/health' })
  const nonce = owned.headers['x-parity-oracle-nonce']![0]!
  const headers = { 'access-control-allow-private-network': 'true', 'access-control-max-age': '600', 'access-control-expose-headers': 'Content-Length', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox", 'cross-origin-resource-policy': 'same-origin', 'x-robots-tag': 'noindex' }
  const fetchMock = vi.spyOn(transport, 'directRequest').mockResolvedValue({ status: 204, headers: Object.fromEntries(Object.entries({ ...headers, 'x-parity-oracle-nonce': nonce }).map(([k, v]) => [k, [v]])), body: { encoding: 'utf8', data: '' } })
  try {
    const response = await oracle.request({ method: 'OPTIONS', path: '/api/data' })
    expect(response.headers).toEqual(Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, [v]])))
  } finally { fetchMock.mockRestore(); await oracle.stop() }
})
