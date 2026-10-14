// Regression test for issue #274: on iOS, a cold-launch of the installed PWA with no network
// left the app on a black/white screen forever. The reporter traced it to the service worker's
// network-first fetch handler — a dead radio does not reject fetch() quickly, it just never
// settles, so the .catch() that falls back to the cached shell never runs.
//
// The first fix aborted every request after 3 s. An abort that fires once the headers are in
// errors the body the page is still reading, so on a slow connection a locale pack or a chunk
// that was on its way failed outright; and AbortSignal.timeout does not exist before iOS 16,
// where the handler threw before it answered at all. The worker now answers from the cache once
// the network has kept a request waiting 3 s, and aborts nothing.
//
// This loads the real production file (public/sw.js) into a sandboxed context and drives its
// actual 'fetch' listener, rather than re-implementing the logic here — the thing under test is
// the shipped worker, not a description of it. Time is a clock the test moves by hand; the
// sandbox's AbortSignal.timeout runs on it too, and the network stub errors a body it is still
// sending when its request is aborted, the way fetch does.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const swSource: any = readFileSync(fileURLToPath(new URL('../public/sw.js', import.meta.url)), 'utf8')

const settle: any = () => new Promise((r: any) => setImmediate(r))

function manualClock() {
  let now: any = 0
  let id: any = 0
  const timers: any = new Map()
  return {
    setTimeout: (fn: any, ms: any) => { timers.set(++id, { at: now + (ms || 0), fn }); return id },
    clearTimeout: (t: any) => { timers.delete(t) },
    async advance(ms: any) {
      now += ms
      for (const [k, t] of [...timers].sort((a: any, b: any) => a[1].at - b[1].at)) {
        if (t.at <= now && timers.has(k)) { timers.delete(k); t.fn() }
      }
      await settle()
    },
  }
}

/** Run the real sw.js source in a sandbox and hand back what it registered. */
function loadServiceWorker({ fetchImpl, abortSignal = true }: any) {
  const listeners: any = {}
  const cacheStore: any = new Map()
  const cache: any = {
    match: (req: any) => Promise.resolve(cacheStore.get(typeof req === 'string' ? req : req.url)),
    put: (req: any, res: any) => { cacheStore.set(typeof req === 'string' ? req : req.url, res); return Promise.resolve() },
    add: () => Promise.resolve()
  }
  const self: any = {
    addEventListener: (type: any, cb: any) => { listeners[type] = cb },
    skipWaiting: () => {},
    clients: { claim: () => Promise.resolve() },
    registration: {}
  }
  const clock: any = manualClock()
  const namedCaches = new Map<string, typeof cache>([['opengym-rt-__BUILD__',cache]])
  const open = async (name: string) => {
    if (!namedCaches.has(name)) {
      const values=new Map<string,Response>()
      namedCaches.set(name,{match:(r:any)=>Promise.resolve(values.get(typeof r==='string'?r:r.url)),put:(r:any,v:Response)=>{values.set(typeof r==='string'?r:r.url,v);return Promise.resolve()},add:()=>Promise.resolve()})
    }
    return namedCaches.get(name)!
  }
  const context: any = {
    self,
    caches: { open, keys: () => Promise.resolve([...namedCaches.keys()]), delete: () => Promise.resolve(true), match: async (req: any) => {for (const cache of namedCaches.values()) {const hit = await cache.match(req); if (hit) return hit} return undefined} },
    fetch: fetchImpl,
    location: { origin: 'https://gym.example' },
    URL,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    console
  }
  // iOS before 16 has AbortSignal but not AbortSignal.timeout.
  context.AbortSignal = !abortSignal ? {} : {
    timeout: (ms: any) => {
      const c: any = new AbortController()
      clock.setTimeout(() => c.abort(new DOMException('The operation was aborted due to timeout', 'TimeoutError')), ms)
      return c.signal
    }
  }
  vm.createContext(context)
  vm.runInContext(swSource, context)
  return { listeners, cache, clock, open }
}

function makeFetchEvent(url: any, mode: any = 'navigate') {
  let response: any
  return {
    request: { url, method: 'GET', mode },
    respondWith: (p: any) => { response = p },
    get response() { return response }
  }
}

// A dead radio: the request never resolves or rejects on its own — only an abort ends it.
const deadRadio: any = (req: any, opts: any) => new Promise((resolve: any, reject: any) => {
  opts?.signal?.addEventListener('abort', () => reject(opts.signal.reason))
})

// Headers at once, the body in two parts: the second when the test calls `finish()`. An abort
// before then errors the body, as fetch does.
function slowBody(first: any, rest: any) {
  const enc: any = new TextEncoder()
  const net: any = {}
  net.fetch = (req: any, opts: any) => {
    const body: any = new ReadableStream({ start(c: any) { net.stream = c; c.enqueue(enc.encode(first)) } })
    opts?.signal?.addEventListener('abort', () => net.stream.error(opts.signal.reason))
    return Promise.resolve(new Response(body, { status: 200, headers: { 'content-type': 'text/javascript' } }))
  }
  net.finish = () => { net.stream.enqueue(enc.encode(rest)); net.stream.close() }
  return net
}

// A server that takes its time before it answers at all: the test hands the answer over.
function lateAnswer() {
  const net: any = {}
  net.fetch = (req: any, opts: any) => new Promise((resolve: any, reject: any) => {
    net.answer = (body: any) => resolve(new Response(body, { status: 200 }))
    opts?.signal?.addEventListener('abort', () => reject(opts.signal.reason))
  })
  return net
}

describe('service worker offline cold-launch (issue #274)', () => {
  it('offline navigation prefers the current canonical shell over older and unrelated caches', async()=>{
    const {listeners,cache,open}=loadServiceWorker({fetchImpl:()=>Promise.reject(new TypeError('offline'))})
    await cache.put('index.html',new Response('CURRENT'))
    await (await open('other-app')).put('https://gym.example/',new Response('OTHER'))
    await (await open('opengym-rt-previous')).put('index.html',new Response('PREVIOUS'))
    await (await open('opengym-rt-previous')).put('https://gym.example/', new Response('POISONED NAVIGATION'))
    const e=makeFetchEvent('https://gym.example/');listeners.fetch(e)
    expect(await(await e.response).text()).toBe('CURRENT')
  })
  it('old assets fall back only to this app generations, never unrelated origin caches',async()=>{
    const {listeners,open}=loadServiceWorker({fetchImpl:()=>Promise.resolve(new Response('gone',{status:404}))})
    const url='https://gym.example/assets/old.js'
    await (await open('other-app')).put(url,new Response('OTHER'))
    await (await open('opengym-rt-previous')).put(url,new Response('PREVIOUS ASSET', {headers: {'content-type': 'text/javascript'}}))
    const e=makeFetchEvent(url,'cors');listeners.fetch(e)
    expect(await(await e.response).text()).toBe('PREVIOUS ASSET')
  })
  it('an online 404 for an old immutable chunk falls back to the retained generation', async () => {
    const { listeners, cache } = loadServiceWorker({ fetchImpl: () => Promise.resolve(new Response('not found', { status: 404 })) })
    const url='https://gym.example/assets/old-qr.js'
    await cache.put(url,new Response('old QR', {headers: {'content-type': 'text/javascript'}}))
    const e=makeFetchEvent(url,'cors');listeners.fetch(e)
    expect(await (await e.response).text()).toBe('old QR')
    const missing=makeFetchEvent('https://gym.example/assets/uncached.js','cors');listeners.fetch(missing)
    expect((await missing.response).status).toBe(404)
  })
  it.each(['redirected', 'opaque', 'opaqueredirect'])('a %s answer never overwrites the working offline shell', async kind => {
    const answer = { ok: true, redirected: kind === 'redirected', type: kind === 'redirected' ? 'basic' : kind, clone: () => new Response('proxy-login') }
    let online = true
    const { listeners, cache } = loadServiceWorker({ fetchImpl: () => online ? Promise.resolve(answer) : Promise.reject(new TypeError('offline')) })
    const url = 'https://gym.example/'
    await cache.put(url, new Response('working-shell'))
    const network = makeFetchEvent(url)
    listeners.fetch(network)
    expect(await network.response).toBe(answer)
    await settle()
    expect(await (await cache.match(url)).clone().text()).toBe('working-shell')
    online = false
    const reopen = makeFetchEvent(url)
    listeners.fetch(reopen)
    expect(await (await reopen.response).text()).toBe('working-shell')
  })

  it('a navigation the network never answers is answered from the cached shell after 3 s, not before', async () => {
    const { listeners, cache, clock }: any = loadServiceWorker({ fetchImpl: deadRadio })
    await cache.put('index.html', new Response('cached-shell'))

    const e: any = makeFetchEvent('https://gym.example/')
    listeners.fetch(e)
    await clock.advance(2999)
    const early: any = await Promise.race([e.response.then(() => 'settled'), settle().then(() => 'still-pending')])
    expect(early).toBe('still-pending')

    await clock.advance(1)
    const res: any = await e.response
    expect(await res.text()).toBe('cached-shell')
  })

  it('a script whose body is still arriving after 3 s reaches the page whole, and is cached', async () => {
    const net: any = slowBody('export const pack = {', ' hello: "Hallo" }')
    const { listeners, cache, clock }: any = loadServiceWorker({ fetchImpl: net.fetch })
    await cache.put('https://gym.example/assets/de-abc.js', new Response('the copy from the last build'))

    const e: any = makeFetchEvent('https://gym.example/assets/de-abc.js', 'cors')
    listeners.fetch(e)
    const res: any = await e.response
    await clock.advance(3000)
    net.finish()

    expect(await res.text()).toBe('export const pack = { hello: "Hallo" }')
    await settle()
    expect(await (await cache.match('https://gym.example/assets/de-abc.js')).text()).toBe('export const pack = { hello: "Hallo" }')
  })

  it('a request the cache cannot answer waits for a slow network past 3 s instead of failing', async () => {
    const net: any = lateAnswer()
    const { listeners, clock }: any = loadServiceWorker({ fetchImpl: net.fetch })

    const e: any = makeFetchEvent('https://gym.example/assets/hi-new.js', 'cors')
    listeners.fetch(e)
    await clock.advance(10000)
    net.answer('export default {}')

    const res: any = await e.response
    expect(res).toBeTruthy()
    expect(await res.text()).toBe('export default {}')
  })

  it('a network that fails outright falls back to the cache at once', async () => {
    const { listeners, cache }: any = loadServiceWorker({ fetchImpl: () => Promise.reject(new TypeError('Failed to fetch')) })
    await cache.put('index.html', new Response('cached-shell'))

    const e: any = makeFetchEvent('https://gym.example/')
    listeners.fetch(e)
    expect(await (await e.response).text()).toBe('cached-shell')
  })

  it('works where AbortSignal.timeout does not exist (iOS before 16)', async () => {
    const { listeners, cache, clock }: any = loadServiceWorker({ fetchImpl: deadRadio, abortSignal: false })
    await cache.put('index.html', new Response('cached-shell'))

    const e: any = makeFetchEvent('https://gym.example/')
    expect(() => listeners.fetch(e)).not.toThrow()
    expect(e.response).toBeTruthy()
    await clock.advance(3000)
    expect(await (await e.response).text()).toBe('cached-shell')
  })
})
