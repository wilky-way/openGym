
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'
import { lazyAssets, stampSw } from '../scripts/sw-stamp'

const source: any = readFileSync(fileURLToPath(new URL('../public/sw.js', import.meta.url)), 'utf8')
const shell: any = '<html><head><script src="./assets/index-new.js"></script></head></html>'

function install(sw: any, fetchImpl: any) {
  const listeners: any = {}
  const caches: any = new Map()
  const open: any = async (n: any) => { if (!caches.has(n)) caches.set(n, new Map()); const m: any = caches.get(n); return { put: async (k: any, v: any) => { m.set(String(k), v) }, add: async () => {}, match: async (k: any) => m.get(String(k)), keys: async () => [...m.keys()] } }
  const context: any = {
    self: { addEventListener: (t: any, f: any) => { listeners[t] = f }, skipWaiting: () => {}, clients: { claim: async () => {} }, registration: {} },
    caches: { open, keys: async () => [...caches.keys()], delete: async (n: any) => caches.delete(n), match: async () => undefined },
    fetch: fetchImpl, location: { origin: 'https://gym.example' }, URL, setTimeout, clearTimeout, console, Response,
  }
  vm.runInNewContext(sw, context)
  let done: any
  listeners.install({ waitUntil: (p: any) => { done = p } })
  return done.then(() => [...caches.values()][0])
}

const ok: any = (body: any) => ({ ok: true, status: 200, redirected: false, headers: {get: () => 'text/javascript'}, text: async () => body })

describe('the worker keeps the on-demand code too', () => {
  it('fetches every listed chunk at install', async () => {
    const sw: any = stampSw(source, { stamp: 'abc', lazy: ['./assets/index-new.js', './assets/media-ingest-x.js', './assets/jsQR-y.js'] })
    const asked: any = []
    const cache: any = await install(sw, async (u: any) => { asked.push(String(u)); return String(u) === 'index.html' ? ok(shell) : ok('') })
    expect(asked.filter((u: any) => u === './assets/index-new.js')).toHaveLength(1)
    expect([...cache.keys()]).toEqual(expect.arrayContaining(['./assets/media-ingest-x.js', './assets/jsQR-y.js', 'index.html']))
  })

  it('a chunk that will not come is no reason to fail the install', async () => {
    const sw: any = stampSw(source, { stamp: 'abc', lazy: ['./assets/media-ingest-x.js', './assets/gone.js'] })
    const cache: any = await install(sw, async (u: any) => {
      if (String(u) === 'index.html') return ok(shell)
      if (String(u).includes('gone')) throw new TypeError('network down')
      if (String(u).includes('media-ingest')) return { ok: true, status: 200, redirected: true }
      return ok('')
    })
    expect([...cache.keys()]).toContain('index.html')
    expect([...cache.keys()]).not.toContain('./assets/media-ingest-x.js')   // a login page is not the ingest
  })

  it('caches every bundled font before committing the new offline shell', async () => {
    const sw: any = stampSw(source, { stamp: 'abc', lazy: ['./assets/newsreader.woff2'] })
    const asked: any = []
    const cache: any = await install(sw, async (u: any) => {
      asked.push(String(u)); return String(u) === 'index.html' ? ok(shell) : ok('font')
    })
    expect(asked.filter((u: any) => u === './assets/newsreader.woff2')).toHaveLength(1)
    expect([...cache.keys()].indexOf('./assets/newsreader.woff2')).toBeLessThan([...cache.keys()].indexOf('index.html'))
  })

  it.each(['missing', 'redirect'])('keeps the previous offline shell when a font is %s', async (failure: any) => {
    const sw: any = stampSw(source, { stamp: 'abc', lazy: ['./assets/newsreader.woff2'] })
    await expect(install(sw, async (u: any) => {
      if (String(u) === 'index.html') return ok(shell)
      if (String(u).endsWith('.woff2')) return { ok: failure !== 'missing', status: failure === 'missing' ? 404 : 200, redirected: failure === 'redirect' }
      return ok('')
    })).rejects.toThrow('precache: ./assets/newsreader.woff2')
  })

  it('an unstamped worker (dev, tests) has nothing extra to fetch', async () => {
    const asked: any = []
    await install(source, async (u: any) => { asked.push(String(u)); return String(u) === 'index.html' ? ok(shell) : ok('') })
    expect(asked).toEqual(['index.html', './assets/index-new.js'])
  })

  it('the build lists code and styles, not the language packs (but the English steps)', () => {
    const chunk: any = (...moduleIds: any) => ({ type: 'chunk', moduleIds })
    const bundle: any = {
      'assets/index-a.js': chunk('/app/frontend/src/main.jsx'),
      'assets/media-ingest-b.js': chunk('/app/frontend/src/lib/media-ingest.js'),
      'assets/de-c.js': chunk('/app/frontend/src/locales/de.js'),
      'assets/de-d.js': chunk('/app/frontend/src/instr/de.js'),
      'assets/ru-e.js': chunk('/app/frontend/src/exercise-names/ru.js'),
      'assets/index-f.css': { type: 'asset' },
      'icon-512.png': { type: 'asset' },
      'assets/newsreader-a.woff2': { type: 'asset' },
      // the English steps and descriptions every language falls back to: offline as well
      'assets/en-g.js': chunk('/app/frontend/src/instr/en.js'),
      'assets/en-h.js': chunk('/app/frontend/src/exercise-desc/en.js'),
      'assets/de-i.js': chunk('/app/frontend/src/exercise-desc/de.js'),
    }
    expect(lazyAssets(bundle)).toEqual(['./assets/de-i.js', './assets/en-g.js', './assets/en-h.js', './assets/index-a.js', './assets/index-f.css', './assets/media-ingest-b.js', './assets/newsreader-a.woff2'])
  })

  it('the build stamps the worker with both', () => {
    const vite: any = readFileSync(fileURLToPath(new URL('../vite.config.ts', import.meta.url)), 'utf8')
    expect(vite).toMatch(/generateBundle\([^)]*bundle[^)]*\) \{ lazy = lazyAssets\(bundle\) \}/)
    expect(vite).toMatch(/stampSw\(readFileSync\(sw, 'utf8'\), \{ stamp, lazy, buildSha:sha \}\)/)
    const sw: any = stampSw(source, { stamp: 'abc', lazy: ["./assets/it's.js"] })
    expect(sw).toContain("const CACHE = 'opengym-rt-abc'")
    expect(sw).not.toContain('__LAZY__')
  })
})

// Native TS graph: the English steps moved from en.js to en.ts.
it('precaches the native English instructions and descriptions before first offline use',()=>{
 const chunk=(id:string)=>({type:'chunk',moduleIds:[id]})
 expect(lazyAssets({'assets/instructions.js':chunk('/app/packages/core/src/instr/en.ts'),'assets/descriptions.js':chunk('/app/packages/core/src/exercise-desc/en.ts')})).toEqual(['./assets/descriptions.js','./assets/instructions.js'])
})

it('a non-redirected HTML lazy chunk is not cached during best-effort precache', async () => {
 const sw = stampSw(source, {stamp: 'i03', lazy: ['./assets/lazy.js']})
 const cache = await install(sw, async (url: string) => url === 'index.html' ? ok(shell) : url.includes('lazy') ? new Response('<h1>login</h1>', {headers: {'content-type': 'text/html'}}) : ok('code'))
 expect([...cache.keys()]).toContain('index.html'); expect([...cache.keys()]).not.toContain('./assets/lazy.js')
})
