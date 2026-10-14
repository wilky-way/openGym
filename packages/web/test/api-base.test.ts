// @vitest-environment happy-dom
// Issue #238: openGym behind a reverse proxy that serves it under a subpath. The assets were
// already relative; the API call was not, so it went to the proxy's own root where nothing
// answers it. The base is read from where the app is being served.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { appBase, beacon, setRemoteAuth } from '../src/lib/api'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const at: any = (pathname: any) => appBase({ pathname })

describe('the app knows where it is served from', () => {
  it('is the site root for an ordinary deployment', () => {
    expect(at('/')).toBe('/')
    expect(at('/index.html')).toBe('/')
  })

  it('keeps the proxy prefix of a subpath deployment', () => {
    expect(at('/myGym/')).toBe('/myGym/')
    expect(at('/myGym/index.html')).toBe('/myGym/')
    expect(at('/a/b/c/')).toBe('/a/b/c/')
  })

  it('drops a stale deep path rather than inventing a base from it', () => {
    // nginx sends these back to the app root before React boots; this is the belt and braces.
    expect(at('/myGym/plan/r/x')).toBe('/myGym/plan/r/')
    expect(at('/plan')).toBe('/')
  })

  it('survives a missing or odd location', () => {
    expect(appBase(null)).toBe('/')
    expect(at('')).toBe('/')
  })
})

describe('the "left" beacon of the web app', () => {
  afterEach(() => { vi.unstubAllGlobals(); history.replaceState(null, '', '/') })

  it('goes to the API of the copy it was served from, as JSON', async () => {
    history.replaceState(null, '', '/myGym/')
    const sendBeacon: any = vi.fn(async () => new Response('{"ok":true}'))
    vi.stubGlobal('fetch', sendBeacon)
    expect(beacon('/api/activity', { active: false })).toBe(true)
    await Promise.resolve(); await Promise.resolve()
    const [url, init] = sendBeacon.mock.calls[0]
    const blob: any = new Blob([init.body], {type: init.headers.get('content-type')})
    expect(url).toBe('http://localhost:3000/myGym/api/activity')
    expect(blob.type).toBe('application/json')
    expect(JSON.parse(await blob.text())).toEqual({ active: false })
  })

  it('a browser without sendBeacon just skips it', () => {
    setRemoteAuth('https://remote.example', 'TOKEN')
    expect(beacon('/api/activity', { active: false })).toBe(false)
  })
})


import {beforeEach} from 'vitest'
import {configureTestClient} from './client-fixture'
beforeEach(()=>configureTestClient())
