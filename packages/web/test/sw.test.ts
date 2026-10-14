/* frontend/public/sw.js against a stand-in worker environment.
 *
 * The one thing the worker must never do is take the build that is already on the device away
 * without having a working one to put there: its cache is what a home-screen app reopened
 * without a network comes back from. So an install that did not get the shell fails, and the
 * previous build's cache is swept only once this build's shell is in its own. */
import {runInNewContext} from 'node:vm'
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

class FakeCache { [key: string]: any;
  constructor(name: any) { this.name = name; this.m = new Map() }
  async put(req: any, res: any) { this.m.set(String(req.url || req), res) }
  async add(u: any) { const r: any = await (globalThis as any).fetch(u); if (!r.ok) throw new Error('add failed ' + u); this.m.set(String(u), r) }
  async match(req: any) { return this.m.get(String(req.url || req)) }
  keys() { return [...this.m.keys()] }
}
class FakeCaches { [key: string]: any;
  constructor() { this.c = new Map() }
  async open(n: any) { if (!this.c.has(n)) this.c.set(n, new FakeCache(n)); return this.c.get(n) }
  async keys() { return [...this.c.keys()] }
  async delete(n: any) { return this.c.delete(n) }
  async match(req: any) { for (const c of this.c.values()) { const hit: any = await c.match(req); if (hit) return hit } return undefined }
}

const CACHE: any = 'opengym-rt-__BUILD__'   // the placeholder the build rewrites (vite.config.js swStamp)
const handlers: any = {}
let skipWaiting: any = 0

// A fresh copy of the worker each time: it registers its listeners at import, so the module
// cache has to be stepped around with a query string.
async function loadSW(scope = 'https://gym.test/', sharedCaches?: FakeCaches) {
  for (const k of Object.keys(handlers)) delete handlers[k]
  skipWaiting = 0
  ;(globalThis as any).self = {
    addEventListener: (type: any, fn: any) => { handlers[type] = fn },
    skipWaiting: () => { skipWaiting++ },
    clients: { claim: async () => {}, matchAll: async () => [], openWindow: async () => {} },
    registration: { scope, getNotifications: async () => [], showNotification: async () => {}, pushManager: {} }
  }
  ;(globalThis as any).location = { origin: 'https://gym.test' }
  ;(globalThis as any).caches = sharedCaches ?? new FakeCaches()
  runInNewContext(readFileSync(process.cwd()+'/public/sw.js','utf8'), {self:(globalThis as any).self,location:(globalThis as any).location,caches:(globalThis as any).caches,fetch:(...args:any[])=>(globalThis as any).fetch(...args),URL,Response,Request,Headers,console,setTimeout,clearTimeout})
}
// What waitUntil was handed is what the browser judges the install by, so it is awaited (and its
// rejection is the install failing).
const fire: any = async (type: any, ev: any = {}) => {
  const e: any = { ...ev, waitUntil: (p: any) => { e._done = p }, respondWith: (p: any) => { e._res = p } }
  handlers[type](e)
  if (e._done) await e._done
  return e
}
const previousBuild: any = async () => {
  const old: any = await (globalThis as any).caches.open('opengym-rt-oldbuild')
  await old.put('index.html', { ok: true, body: 'the shell already on this device' })
  return old
}
const shellHtml: any = '<html><head><script src="./assets/index-new.js"></script></head></html>'

beforeEach(() => { delete (globalThis as any).self })

describe('sw.js install and activate', () => {
  it('an old tab keeps its previous complete build and lazy chunks until it reloads', async () => {
    await loadSW()
    const old = await previousBuild()
    await old.put('/assets/old-qr.js', new Response('old QR'))
    await (await (globalThis as any).caches.open(CACHE)).put('index.html', new Response('new'))
    const client = { id: 'old-page', postMessage: (_data: any) => {} }
    ;(globalThis as any).self.clients.matchAll = async () => [client]
    await fire('activate')
    expect(await (globalThis as any).caches.keys()).toContain('opengym-rt-oldbuild')
    expect(await (await old.match('/assets/old-qr.js')).text()).toBe('old QR')
    client.postMessage = (data: any) => { handlers.message({ data: { type: 'OPENGYM_BUILD_REPLY', nonce: data.nonce, buildSha: '__APP_SHA__', assets: [] }, source: { id: 'old-page' } }) }
    await fire('message', { data: { type: 'OPENGYM_BUILD_READY' } })
    expect(await (globalThis as any).caches.keys()).not.toContain('opengym-rt-oldbuild')
  })

  it('successive upgrades keep at most current and the last complete generation', async () => {
    await loadSW()
    await previousBuild()
    await (await (globalThis as any).caches.open('opengym-rt-previous')).put('index.html', new Response('previous'))
    await (globalThis as any).caches.open('opengym-rt-incomplete')
    await (await (globalThis as any).caches.open(CACHE)).put('index.html', new Response('new'))
    ;(globalThis as any).self.clients.matchAll = async () => [{ id: 'legacy', postMessage() {} }]
    await fire('activate')
    expect((await (globalThis as any).caches.keys()).filter((k: string) => k.startsWith('opengym-rt-'))).toEqual(['opengym-rt-previous', CACHE])
  })

  it('a wrong nonce, artifact, or source cannot authorize deleting the old cache', async () => {
    await loadSW(); await previousBuild()
    await (await (globalThis as any).caches.open(CACHE)).put('index.html', new Response('new'))
    ;(globalThis as any).self.clients.matchAll = async () => [{ id: 'old', postMessage(data: any) {
      for (const [nonce, buildSha, id] of [[data.nonce + 1, '__APP_SHA__', 'old'], [data.nonce, 'old-build', 'old'], [data.nonce, '__APP_SHA__', 'other']]) handlers.message({ data: { type: 'OPENGYM_BUILD_REPLY', nonce, buildSha, assets: buildSha==='__APP_SHA__'?[]:['old.js'] }, source: { id } })
    } }]
    await fire('activate')
    expect(await (globalThis as any).caches.keys()).toContain('opengym-rt-oldbuild')
  })

  it('a page reload during a pending query requests another pruning handshake', async () => {
    await loadSW(); await previousBuild()
    await (await (globalThis as any).caches.open(CACHE)).put('index.html', new Response('new'))
    let queries = 0
    ;(globalThis as any).self.clients.matchAll = async () => [{ id: 'page', postMessage(data: any) {
      queries++
      if (queries === 1) handlers.message({ data: { type: 'OPENGYM_BUILD_READY' }, waitUntil() {} })
      handlers.message({ data: { type: 'OPENGYM_BUILD_REPLY', nonce: data.nonce, buildSha: 'same-revision', assets: queries === 1 ? ['old.js'] : [] }, source: { id: 'page' } })
    } }]
    await fire('activate')
    expect(queries).toBe(2)
    expect(await (globalThis as any).caches.keys()).not.toContain('opengym-rt-oldbuild')
  })

  it('distinct artifacts sharing a source revision keep the old cache until the page loads the current assets', async () => {
    await loadSW(); await previousBuild()
    await (await (globalThis as any).caches.open(CACHE)).put('index.html',new Response('<script src="./assets/new.js"></script><link href="./assets/new.css">'))
    let assets=['https://gym.test/assets/old.js']
    ;(globalThis as any).self.clients.matchAll=async()=>[{id:'page',postMessage(data:any){handlers.message({data:{type:'OPENGYM_BUILD_REPLY',nonce:data.nonce,buildSha:'same-source',assets},source:{id:'page'}})}}]
    await fire('activate')
    expect(await (globalThis as any).caches.keys()).toContain('opengym-rt-oldbuild')
    assets=['https://gym.test/assets/new.css','https://gym.test/assets/new.js']
    await fire('message',{data:{type:'OPENGYM_BUILD_READY'}})
    expect(await (globalThis as any).caches.keys()).not.toContain('opengym-rt-oldbuild')
  })

  it('activation preserves unrelated same-origin caches and their bytes', async () => {
    await loadSW()
    await previousBuild()
    const unrelated = await (globalThis as any).caches.open('other-app-offline')
    await unrelated.put('/other-app/logo.png', new Response('other app'))
    await (await (globalThis as any).caches.open(CACHE)).put('index.html', new Response('gym'))
    await fire('activate')
    expect(await (globalThis as any).caches.keys()).toContain('other-app-offline')
    expect(await (await unrelated.match('/other-app/logo.png')).text()).toBe('other app')
    expect(await (globalThis as any).caches.keys()).not.toContain('opengym-rt-oldbuild')
  })

  it('a precache that cannot reach the server fails the install and keeps the build on the device', async () => {
    await loadSW()
    const old: any = await previousBuild()
    ;(globalThis as any).fetch = async () => { throw new Error('network down') }

    await expect(fire('install')).rejects.toThrow()
    expect(skipWaiting).toBe(0)

    await fire('activate')   // an activate that happens anyway must still leave the old cache alone
    expect(await (globalThis as any).caches.keys()).toContain('opengym-rt-oldbuild')
    expect(await old.match('index.html')).toBeTruthy()
  })

  it('a redirect to a login page is never cached as the shell', async () => {
    await loadSW()
    await previousBuild()
    ;(globalThis as any).fetch = async () => ({ ok: true, status: 200, redirected: true, text: async () => '<html>sign in</html>' })

    await expect(fire('install')).rejects.toThrow()
    expect(skipWaiting).toBe(0)
    expect((await (globalThis as any).caches.open(CACHE)).keys()).not.toContain('index.html')
    expect(await (globalThis as any).caches.keys()).toContain('opengym-rt-oldbuild')
  })

  it('a server that is restarting fails the install rather than cache its error page', async () => {
    await loadSW()
    await previousBuild()
    ;(globalThis as any).fetch = async () => ({ ok: false, status: 502, redirected: false, text: async () => 'Bad Gateway' })

    await expect(fire('install')).rejects.toThrow()
    expect(await (globalThis as any).caches.keys()).toContain('opengym-rt-oldbuild')
  })

  it('a chunk that will not cache fails the install, so the build on the device stays', async () => {
    await loadSW()
    const old: any = await previousBuild()
    ;(globalThis as any).fetch = async (u: any) => (String(u) === 'index.html'
      ? { ok: true, status: 200, redirected: false, text: async () => shellHtml }
      : { ok: false, status: 404 })

    await expect(fire('install')).rejects.toThrow(/index-new\.js/)
    expect(skipWaiting).toBe(0)
    // The shell is written after its code, so a half-filled cache cannot read as this build.
    expect((await (globalThis as any).caches.open(CACHE)).keys()).not.toContain('index.html')

    await fire('activate')
    expect(await (globalThis as any).caches.keys()).toContain('opengym-rt-oldbuild')
    expect(await old.match('index.html')).toBeTruthy()
  })

  it('a chunk answered by a redirect to a login page fails the install too', async () => {
    // An auth proxy in front answers every request with its login page — 200, and `cache.add`
    // would have stored that HTML under the main bundle's URL.
    await loadSW()
    const old: any = await previousBuild()
    ;(globalThis as any).fetch = async (u: any) => (String(u) === 'index.html'
      ? { ok: true, status: 200, redirected: false, text: async () => shellHtml }
      : { ok: true, status: 200, redirected: true, text: async () => '<html>sign in</html>' })

    await expect(fire('install')).rejects.toThrow(/index-new\.js.*redirected/)
    expect(skipWaiting).toBe(0)
    expect((await (globalThis as any).caches.open(CACHE)).keys()).toEqual([])

    await fire('activate')
    expect(await (globalThis as any).caches.keys()).toContain('opengym-rt-oldbuild')
    expect(await old.match('index.html')).toBeTruthy()
  })

  it('an icon that will not cache is not worth failing an install over', async () => {
    await loadSW()
    await previousBuild()
    const withIcon: any = '<html><head><script src="./assets/index-new.js"></script>'
      + '<link rel="stylesheet" href="./assets/index-new.css"><link rel="icon" href="./icon-512.png"></head></html>'
    ;(globalThis as any).fetch = async (u: any) => (String(u) === 'index.html'
      ? { ok: true, status: 200, redirected: false, text: async () => withIcon }
      : String(u).endsWith('.png') ? { ok: false, status: 404 } : { ok: true, status: 200, headers: {get: () => String(u).endsWith('.css') ? 'text/css' : 'text/javascript'}, clone: () => ({}) })

    await fire('install')
    expect(skipWaiting).toBe(1)
    await fire('activate')

    expect(await (globalThis as any).caches.keys()).toEqual([CACHE])
    const c: any = await (globalThis as any).caches.open(CACHE)
    expect(c.keys()).toEqual(expect.arrayContaining(['./assets/index-new.js', './assets/index-new.css', 'index.html']))
  })

  it('an install that got the shell takes over and drops the previous build', async () => {
    await loadSW()
    await previousBuild()
    ;(globalThis as any).fetch = async (u: any) => (String(u) === 'index.html'
      ? { ok: true, status: 200, redirected: false, text: async () => shellHtml }
      : { ok: true, status: 200, headers: {get: () => String(u).endsWith('.css') ? 'text/css' : 'text/javascript'}, clone: () => ({}) })

    await fire('install')
    expect(skipWaiting).toBe(1)
    await fire('activate')

    expect(await (globalThis as any).caches.keys()).toEqual([CACHE])
    expect((await (globalThis as any).caches.open(CACHE)).keys()).toContain('index.html')
  })
})

// The push service rotates a subscription (expiry, a key change) and the worker re-registers it,
// usually with no page open. It sent no device id, so the server's row lost it and the rest-timer
// alert for that account went to every device until a page next booted. The page leaves the id
// in a cache the worker can read (lib/push.js shareDeviceId).
describe('sw.js re-registers a rotated push subscription with the page\'s device id', () => {
  const rotated: any = {
    endpoint: 'https://push.example/e2',
    options: { applicationServerKey: new Uint8Array([1, 2, 3]).buffer },
    toJSON: () => ({ endpoint: 'https://push.example/e2', keys: { p256dh: 'p2', auth: 'a2' } })
  }
  const rotate: any = async () => {
    const sent: any = []
    ;(globalThis as any).fetch = async (url: any, init: any) => { sent.push([String(url), JSON.parse(init.body)]); return { ok: true, status: 200 } }
    await fire('pushsubscriptionchange', { oldSubscription: { endpoint: 'https://push.example/e1', options: rotated.options }, newSubscription: rotated })
    return sent
  }
  // The same cache name and key on both sides, read out of the two files, so the page and the
  // worker cannot drift apart without this failing.
  const constant: any = (src: any, name: any) => src.match(new RegExp('const ' + name + " = '([^']+)'"))?.[1]
  const pageSrc: any = readFileSync(new URL('../src/platform/client.ts', import.meta.url), 'utf8')
  const swSrc: any = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8')
  const DEVICE_CACHE: any = constant(pageSrc, 'DEVICE_CACHE')
  const DEVICE_URL: any = constant(pageSrc, 'DEVICE_URL')

  it('the page and the worker look in the same place', () => {
    expect(DEVICE_CACHE).toBeTruthy()
    expect(DEVICE_URL).toBeTruthy()
    expect(constant(swSrc, 'DEVICE_CACHE')).toBe(DEVICE_CACHE)
    expect(constant(swSrc, 'DEVICE_URL')).toBe(DEVICE_URL)
  })

  it('sends the device id the page left', async () => {
    await loadSW()
    await (await (globalThis as any).caches.open(DEVICE_CACHE)).put(DEVICE_URL, new Response('dev1234abcd'))
    expect(await rotate()).toEqual([['api/push/subscribe', {
      subscription: { endpoint: 'https://push.example/e2', keys: { p256dh: 'p2', auth: 'a2' } },
      deviceId: 'dev1234abcd'
    }]])
  })

  it('with nothing left there, sends the subscription alone, as before', async () => {
    await loadSW()
    const sent: any = await rotate()
    expect(sent).toHaveLength(1)
    expect(sent[0][1]).toEqual({ subscription: { endpoint: 'https://push.example/e2', keys: { p256dh: 'p2', auth: 'a2' } } })
  })

  it('a new build\'s activate sweeps the old build\'s cache and keeps the device id', async () => {
    await loadSW()
    await previousBuild()
    await (await (globalThis as any).caches.open(DEVICE_CACHE)).put(DEVICE_URL, new Response('dev1234abcd'))
    ;(globalThis as any).fetch = async (u: any) => (String(u) === 'index.html'
      ? { ok: true, status: 200, redirected: false, text: async () => shellHtml }
      : { ok: true, status: 200, headers: {get: () => String(u).endsWith('.css') ? 'text/css' : 'text/javascript'}, clone: () => ({}) })
    await fire('install')
    await fire('activate')
    expect((await (globalThis as any).caches.keys()).sort()).toEqual([CACHE, DEVICE_CACHE].sort())
    expect(await (await (await (globalThis as any).caches.open(DEVICE_CACHE)).match(DEVICE_URL)).text()).toBe('dev1234abcd')
  })
})

it('runtime pruning isolates two mounts and the root mount on one origin', async () => {
 await loadSW('https://gym.test/a/')
 const caches = (globalThis as any).caches as FakeCaches
 const a = CACHE + '--scope-' + encodeURIComponent('/a/'), b = CACHE + '--scope-' + encodeURIComponent('/b/')
 const bOld = 'opengym-rt-old--scope-' + encodeURIComponent('/b/'), aOld = 'opengym-rt-old--scope-' + encodeURIComponent('/a/')
 for (const name of [a, b, bOld, aOld, CACHE]) await (await caches.open(name)).put('index.html', new Response(name))
 await fire('activate')
 expect(await caches.keys()).toContain(a); expect(await caches.keys()).not.toContain(aOld)
 expect(await caches.keys()).toContain(b); expect(await caches.keys()).toContain(bOld); expect(await caches.keys()).toContain(CACHE)
 await loadSW('https://gym.test/', caches); await fire('activate')
 expect(await caches.keys()).toContain(a); expect(await caches.keys()).toContain(b); expect(await caches.keys()).toContain(bOld)
})
it.each(['js', 'css', 'JS', 'CSS', '%2Ejs', '%2Ecss'])('a non-redirected HTML response never poisons a runtime %s URL', async ext => {
 await loadSW(); const url = `https://gym.test/assets/lazy${ext.startsWith('%') ? '' : '.'}${ext}`
 ;(globalThis as any).fetch = async () => new Response('<h1>proxy login</h1>', {headers: {'content-type': 'text/html'}})
 const event = await fire('fetch', {request: {url, method: 'GET', mode: 'cors'}})
 expect((await event._res).status).toBe(200)
 expect(await (await (globalThis as any).caches.open(CACHE)).match(url)).toBeUndefined()
 ;(globalThis as any).fetch = async () => new Response('valid code', {headers: {'content-type': ext.toLowerCase().endsWith('css') ? 'text/css; charset=utf-8' : 'application/javascript'}})
 const valid = await fire('fetch', {request: {url, method: 'GET', mode: 'cors'}}); await valid._res
 await vi.waitFor(async () => expect(await (await (globalThis as any).caches.open(CACHE)).match(url)).toBeTruthy())
})
it('a 200 HTML response for the mandatory app bundle fails install and preserves the old generation', async () => {
 await loadSW(); await previousBuild()
 ;(globalThis as any).fetch = async (url: string) => new Response(url === 'index.html' ? shellHtml : '<h1>login</h1>', {headers: {'content-type': 'text/html'}})
 await expect(fire('install')).rejects.toThrow('precache: ./assets/index-new.js')
 expect(await (globalThis as any).caches.keys()).toContain('opengym-rt-oldbuild')
 expect(await (await (globalThis as any).caches.open(CACHE)).match('index.html')).toBeUndefined()
})

it('offline code refuses a poisoned HTML entry retained from an older worker', async () => {
 await loadSW(); const url = 'https://gym.test/assets/old.js'
 await (await (globalThis as any).caches.open(CACHE)).put(url, new Response('<h1>old poison</h1>', {headers: {'content-type': 'text/html'}}))
 await (await (globalThis as any).caches.open('opengym-rt-previous')).put(url, new Response('<h1>older poison</h1>', {headers: {'content-type': 'text/html'}}))
 ;(globalThis as any).fetch = async () => {throw new Error('offline')}
 const event = await fire('fetch', {request: {url, method: 'GET', mode: 'cors'}})
 expect(await event._res).toBeUndefined()
})
