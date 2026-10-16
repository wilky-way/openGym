// @vitest-environment happy-dom

// A configurable connection uses its own base URL and per-device token.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, beacon, setRemoteAuth, configureApiConnection } from './api.js'

afterEach(() => { vi.unstubAllGlobals(); setRemoteAuth('', null) })

describe('configured API connection', () => {

  it('uses the configured base URL and bearer token', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ rev: 3 }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetch)
    setRemoteAuth('https://gym.example.com', 'TOKEN')
    await expect(api('/api/data/rev')).resolves.toEqual({ rev: 3 })
    expect(fetch.mock.calls[0][0]).toBe('https://gym.example.com/api/data/rev')
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer TOKEN')
  })
  it('uses an injected transport with a subpath and resets to browser fetch', async () => {
    const transport = vi.fn(async () => new Response('{"rev":7}', { status: 200 }))
    const browserFetch = vi.fn(async () => new Response('{"rev":8}', { status: 200 }))
    vi.stubGlobal('fetch', browserFetch)
    configureApiConnection({ baseUrl: 'https://gym.example/gym/', fetch: transport })
    await expect(api('/api/data/rev')).resolves.toEqual({ rev: 7 })
    expect(transport.mock.calls[0][0]).toBe('https://gym.example/gym/api/data/rev')
    expect(browserFetch).not.toHaveBeenCalled()
    configureApiConnection()
    await expect(api('/api/data/rev')).resolves.toEqual({ rev: 8 })
    expect(browserFetch.mock.calls[0][0]).toBe('/api/data/rev')
  })
  it('refuses a beacon that would lose configured authentication', () => {
    const sendBeacon = vi.fn()
    vi.stubGlobal('navigator', { sendBeacon })
    configureApiConnection({ baseUrl: 'https://gym.example', token: 'TOKEN' })
    expect(beacon('/api/activity', { left: true })).toBe(false)
    expect(sendBeacon).not.toHaveBeenCalled()
  })
})
