import {expect, it} from 'vitest'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
const source = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8')
const current = 'opengym-rt-__BUILD__'
function worker(code: string, network: () => Promise<Response>) {
 const caches = new Map<string, Map<string, Response>>(), listeners: Record<string, (event: any) => void> = {}
 const open = async (name: string) => {
  let rows = caches.get(name); if (!rows) caches.set(name, rows = new Map())
  const key = (request: any) => typeof request === 'string' ? request : request.url
  return {put: async (r: any, body: Response) => {rows!.set(key(r), body)}, match: async (r: any) => rows!.get(key(r)), keys: async () => [...rows!.keys()], add: async () => {}}
 }
 const api = {open, keys: async () => [...caches.keys()], delete: async (name: string) => caches.delete(name),
  match: async (request: any) => {for (const name of caches.keys()) {const hit = await (await open(name)).match(request); if (hit) return hit}}}
 runInNewContext(code, {self: {registration: {scope: 'https://gym.example/'}, clients: {claim: async () => {}, matchAll: async () => []}, addEventListener: (type: string, callback: (event: any) => void) => {listeners[type] = callback}},
  location: {origin: 'https://gym.example'}, caches: api, fetch: network, URL, Response, setTimeout, clearTimeout})
 const fire = async (type: string, request?: any) => {
  let waited: Promise<unknown> | undefined, response: Promise<Response> | undefined
  listeners[type]!({request, waitUntil: (p: Promise<unknown>) => {waited = p}, respondWith: (p: Promise<Response>) => {response = p}})
  if (waited) await waited
  return response ? await response : undefined
 }
 return {open, caches, fire}
}
async function sweep(code: string) {
 const w = worker(code, async () => {throw new Error('offline')})
 await (await w.open('other-app-no-shell')).put('/other/logo.png', new Response('unrelated bytes'))
 await (await w.open(current)).put('index.html', new Response('CURRENT'))
 await w.fire('activate')
 return w.caches.has('other-app-no-shell') && await (await (await w.open('other-app-no-shell')).match('/other/logo.png'))?.text() === 'unrelated bytes'
}
async function navigation(code: string) {
 const w = worker(code, async () => {throw new Error('offline')})
 await (await w.open('other-app')).put('https://gym.example/', new Response('POISONED NAVIGATION'))
 await (await w.open(current)).put('index.html', new Response('CURRENT'))
 return (await w.fire('fetch', {url: 'https://gym.example/', method: 'GET', mode: 'navigate'}))!.text()
}
it('cache-sweep fixture detects restoring the broad same-origin deletion', async () => {
 const mutant = source.replaceAll('ownsRuntimeCache(k) && k !== CACHE', 'k !== CACHE')
 expect(mutant).not.toBe(source); expect(await sweep(source)).toBe(true); expect(await sweep(mutant)).toBe(false)
})
it('navigation fixture detects looking in any cache before the canonical current shell', async () => {
 const mutant = source.replace("return await current.match('index.html') || await current.match(e.request, { ignoreSearch: true })", "return await caches.match(e.request, { ignoreSearch: true }) || await current.match('index.html')")
 expect(mutant).not.toBe(source); expect(await navigation(source)).toBe('CURRENT'); expect(await navigation(mutant)).toBe('POISONED NAVIGATION')
})
