// @vitest-environment happy-dom

// A configurable connection uses its own base URL and per-device token.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, beacon, setRemoteAuth, configureApiConnection } from '../src/lib/api'

afterEach(() => { vi.unstubAllGlobals(); setRemoteAuth('', null) })

describe('configured API connection', () => {

  it('uses the configured base URL and bearer token', async () => {
    const fetch: any = vi.fn(async () => new Response(JSON.stringify({ rev: 3 }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetch)
    setRemoteAuth('https://gym.example.com', 'TOKEN')
    await expect(api('/api/data/rev')).resolves.toEqual({ rev: 3 })
    expect((fetch as any).mock.calls[0][0]).toBe('https://gym.example.com/api/data/rev')
    expect((fetch as any).mock.calls[0][1].headers.get('Authorization')).toBe('Bearer TOKEN')
  })
  it('uses an injected transport with a subpath and resets to browser fetch', async () => {
    const transport: any = vi.fn(async () => new Response('{"rev":7}', {status:200}))
    const platform: any = createBrowserPlatform()
    configureClientIO({...platform, transport: {fetch: transport}})
    await expect(api('/api/data/rev')).resolves.toEqual({rev:7})
    expect(transport.mock.calls[0][0]).toBe('/api/data/rev')
    expect(platform.server.baseUrl()).toBe('')
    configureTestClient()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"rev":8}', {status:200})))
    await expect(api('/api/data/rev')).resolves.toEqual({rev:8})
    expect((fetch as any).mock.calls[0][0]).toBe('http://localhost:3000/api/data/rev')
  })
  it('refuses a beacon that would lose configured authentication', () => {
    const sendBeacon: any = vi.fn()
    vi.stubGlobal('navigator', { sendBeacon })
    configureApiConnection({ baseUrl: 'https://gym.example', token: 'TOKEN' })
    expect(beacon('/api/activity', { left: true })).toBe(false)
    expect(sendBeacon).not.toHaveBeenCalled()
  })
})

import {beforeEach} from 'vitest'
import {configureTestClient} from './client-fixture'
import {createBrowserPlatform} from '../src/platform/browser'
import {configureClientIO} from '../src/lib/client-io'
beforeEach(()=>configureTestClient())
