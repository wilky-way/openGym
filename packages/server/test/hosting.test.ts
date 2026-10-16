import { test, expect } from 'bun:test'
import { mkdirSync, writeFileSync, readFileSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { start, scratchDir } from './helpers'
import { loadConfig } from '../src/config'
import { staticHandler } from '../src/static'
import { snapshotCommand } from '../src/cli/snapshot'
import { openStore, putUser, commitStateDoc, verifyBackup, readStateDoc } from '../src/storage'
import { Database } from 'bun:sqlite'
import { request } from 'node:http'
import { connect } from 'node:net'

function dist() {
  const root = scratchDir()
  mkdirSync(join(root, 'exercise-media/clip'), { recursive: true })
  writeFileSync(join(root, 'index.html'), '<html>' + 'synthetic '.repeat(200) + '</html>')
  writeFileSync(join(root, 'app.js'), '/*' + 'synthetic '.repeat(200) + '*/')
  writeFileSync(join(root, 'exercise-media/clip/0001.mp4'), '0123456789')
  return root
}

test('literal base paths route API and SPA, redirect with query, and exclude unprefixed paths', async () => {
  for (const BASE_PATH of ['/gym', '/g+ym.v1', '/apps/gym']) {
    const h = start({ BASE_PATH, STATIC_DIR: dist() })
    for (const path of ['/', '/api/health', '/app.js', '/exercise-media/clip/0001.mp4']) expect((await fetch(h.api + BASE_PATH + path)).status).toBe(200)
    const redirect = await fetch(h.api + BASE_PATH + '/unknown?a=1', { redirect: 'manual' })
    expect(redirect.status).toBe(302); expect(redirect.headers.get('location')).toBe(BASE_PATH + '/?a=1')
    expect((await fetch(h.api + BASE_PATH, { redirect: 'manual' })).headers.get('location')).toBe(BASE_PATH + '/')
    for (const path of ['/api/health', '/', '/gym-other/app.js', '/%67ym/app.js']) expect((await fetch(h.api + path)).status).toBe(404)
  }
  for (const BASE_PATH of ['gym', '/gym/', '/', '//gym', '/a/../gym', '/%67ym', '/gym?x']) expect(() => loadConfig({ BASE_PATH })).toThrow('BASE_PATH')
})

test('media range, suffix, HEAD, cache validation and errors retain containment and security', async () => {
  const root = dist(), serve = staticHandler(root, '/gym')
  const get = (path: string, headers = {}, method = 'GET') => serve(new Request('http://localhost/gym' + path, { headers, method }))!
  let res = get('/exercise-media/clip/0001.mp4', { Range: 'bytes=2-5' })
  expect(res.status).toBe(206); expect(await res.text()).toBe('2345'); expect(res.headers.get('content-range')).toBe('bytes 2-5/10')
  expect(await get('/exercise-media/clip/0001.mp4', { Range: 'bytes=-3' }).text()).toBe('789')
  expect(await get('/exercise-media/clip/0001.mp4', {}, 'HEAD').text()).toBe('')
  expect(get('/exercise-media/clip/0001.mp4', { Range: 'bytes=20-' }).status).toBe(416)
  const etag = get('/app.js').headers.get('etag')!
  expect(get('/app.js', { 'If-None-Match': etag }).status).toBe(304)
  expect(get('/app.js').headers.get('cache-control')).toBe('no-cache, must-revalidate')
  const outside = scratchDir(); writeFileSync(join(outside, 'secret.json'), '{}'); symlinkSync(join(outside, 'secret.json'), join(root, 'alias.json'))
  for (const path of ['/alias.json', '/%2e%2e%2fsecret.json', '/%5csecret.json', '/app.js.map', '/exercise-media/clip/custom.mp4', '/exercise-media/arbitrary.json', '/exercise-media/clip/9999.mp4']) {
    res = get(path); expect(res.status).toBe(404); expect(res.headers.get('x-content-type-options')).toBe('nosniff'); expect(res.headers.get('content-security-policy')).toBe("frame-ancestors 'none'")
    if (path.startsWith('/exercise-media/')) expect(res.headers.get('cross-origin-resource-policy')).toBe('same-origin')
  }
})

function wire(port: number, headers: Record<string,string>, path = '/app.js') {
  return new Promise<{ status: number; headers: import('node:http').IncomingHttpHeaders; bytes: Buffer }>((done, fail) => {
    const req = request({ host: '127.0.0.1', port, path, headers, agent: false }, res => {
      const parts: Buffer[] = []; res.on('data', p => parts.push(p)); res.on('end', () => done({ status:res.statusCode!, headers: res.headers, bytes: Buffer.concat(parts) }))
    }); req.on('error', fail); req.end()
  })
}
test('wire ranges honor If-Range fallback instead of Bun automatically ranging the full file', async () => {
  const h=start({STATIC_DIR:dist()}),path='/exercise-media/clip/0001.mp4'
  const full=await wire(h.server.port!,{},path)
  for (const validator of ['Thu, 01 Jan 1970 00:00:00 GMT',full.headers.etag!,'"different"']) {
    const res=await wire(h.server.port!,{Range:'bytes=2-5','If-Range':validator},path)
    expect(res.status).toBe(200);expect(res.bytes.toString()).toBe('0123456789')
    expect(res.headers['content-range']).toBeUndefined()
  }
  const partial=await wire(h.server.port!,{Range:'bytes=2-5','If-Range':full.headers['last-modified']!},path)
  expect(partial.status).toBe(206);expect(partial.bytes.toString()).toBe('2345')
  expect(partial.headers['content-range']).toBe('bytes 2-5/10')
  const multiple=await wire(h.server.port!,{Range:'bytes=0-1,4-5'},path)
  expect(multiple.status).toBe(200);expect(multiple.bytes.toString()).toBe('0123456789')
})
test('wire media paths reject case aliases with CORP on case-sensitive and insensitive filesystems', async () => {
  const root=dist();writeFileSync(join(root,'exercise-media/clip/custom.mp4'),'not catalogue')
  const h=start({STATIC_DIR:root})
  for (const path of ['/Exercise-Media/clip/custom.mp4','/Exercise-Media/clip/0001.mp4','/EXERCISE-MEDIA/clip/9999.mp4','/exercise-media/Clip/0001.mp4']) {
    const res=await wire(h.server.port!,{},path)
    expect(res.status).toBe(404);expect(res.headers['cross-origin-resource-policy']).toBe('same-origin')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
  }
})
test('copyable hosting env refuses the required offload placeholder until the current value is supplied', () => {
  const example=readFileSync(join(import.meta.dir,'../../../deploy/server.env.example'),'utf8')
  const value=/^OFFLOAD_RULE=(.+)$/m.exec(example)![1]!
  expect(()=>loadConfig({OFFLOAD_RULE:value})).toThrow('OFFLOAD_RULE')
  expect(loadConfig({OFFLOAD_RULE:'0'}).offloadRule).toBe(false)
  expect(loadConfig({OFFLOAD_RULE:'1'}).offloadRule).toBe(true)
})
test('wire media separator aliases refuse with CORP at root and literal base paths', async () => {
  for (const BASE_PATH of ['', '/gym']) {
    const root = dist()
    writeFileSync(join(root, 'exercise-media/clip/custom.mp4'), 'not catalogue')
    const h = start({ STATIC_DIR: root, BASE_PATH })
    for (const suffix of [
      '//exercise-media/clip/custom.mp4', '//Exercise-Media/clip/custom.mp4',
      '/%2fExercise-Media/clip/custom.mp4', '/%2Fexercise-media/clip/0001.mp4',
      '/exercise-media//clip/0001.mp4', '/exercise-media%2fclip/0001.mp4',
    ]) {
      const res = await wire(h.server.port!, {}, BASE_PATH + suffix)
      expect(res.status).toBe(404)
      expect(res.headers['cross-origin-resource-policy']).toBe('same-origin')
      expect(res.headers['x-content-type-options']).toBe('nosniff')
    }
    const canonical = await wire(h.server.port!, {}, BASE_PATH + '/exercise-media/clip/0001.mp4')
    expect(canonical.status).toBe(200)
    expect(canonical.bytes.toString()).toBe('0123456789')
    expect(canonical.headers['cross-origin-resource-policy']).toBe('same-origin')
  }
})
test('gzip is negotiated, varies alongside CORS, and never compresses ranges', async () => {
  const root = dist(), h = start({ STATIC_DIR: root })
  const zipped = await wire(h.server.port!, { 'Accept-Encoding': 'gzip', Origin: 'http://localhost:8080' })
  expect(zipped.headers['content-encoding']).toBe('gzip'); expect(zipped.headers.vary).toContain('Origin'); expect(zipped.headers.vary).toContain('Accept-Encoding')
  expect(Buffer.from(Bun.gunzipSync(new Uint8Array(zipped.bytes))).toString()).toBe(readFileSync(join(root, 'app.js'), 'utf8'))
  expect((await wire(h.server.port!, { 'Accept-Encoding': 'gzip;q=0' })).headers['content-encoding']).toBeUndefined()
  expect((await wire(h.server.port!, { Range: 'bytes=0-4', 'Accept-Encoding': 'gzip' })).headers['content-encoding']).toBeUndefined()
})

test('static requests share the absolute body deadline and body cap', async () => {
  const h = start({ STATIC_DIR: dist(), BODY_TIMEOUT_MS: '70' })
  async function raw(body: string, length: number, method = 'GET') {
    return new Promise<string>((done, fail) => {
      const socket = connect(h.server.port!, '127.0.0.1'), parts: Buffer[] = []
      const timer = setTimeout(() => { socket.destroy(); fail(new Error('deadline failed')) }, 3000)
      socket.on('connect', () => socket.write(`${method} /app.js HTTP/1.1\r\nHost: localhost\r\nContent-Length: ${length}\r\nConnection: close\r\n\r\n${body}`))
      socket.on('data', b => parts.push(Buffer.from(b))); socket.on('error', error => { if (!parts.length) fail(error) }); socket.on('close', () => { clearTimeout(timer); done(Buffer.concat(parts).toString()) })
    })
  }
  expect(await raw('x', 20)).toContain('400')
  expect(await raw('', h.config.maxBodyBytes + 1)).toContain('413')
  expect(await raw('x', 20, 'POST')).toContain('408')
})

test('read-only snapshot includes committed WAL, does not boot or repair, and refuses reuse/overlap', () => {
  const root = scratchDir(), data = join(root, 'data'); mkdirSync(data)
  const store = openStore(data)
  try {
    putUser(store.db, { id: 'synthetic', name: 'Synthetic', created: '', admin: 0, disabled: 0, sv: 0, invited_by: null, last_pull: null, last_reminder: null, last_nudge: null, ord: 0, x: '{}' })
    const json = JSON.stringify({ _rev: 7, _wid: 'synthetic-wal', workouts: [{ id: 'synthetic' }], future: { nested: [1,2] } })
    commitStateDoc(store.db, 'synthetic', json, 123, 50)
    writeFileSync(join(data, 'state-synthetic.json'), 'deliberately stale mirror')
    const dest = join(root, 'snapshot')
    snapshotCommand(['create', join(data, 'opengym.db'), dest])
    expect(verifyBackup(join(dest, 'opengym.db')).ok).toBe(true)
    const copy = new Database(join(dest, 'opengym.db'), { readonly: true })
    try { expect(readStateDoc(copy, 'synthetic')?.json).toBe(json) } finally { copy.close() }
    expect(readFileSync(join(data, 'state-synthetic.json'), 'utf8')).toBe('deliberately stale mirror')
    expect(() => snapshotCommand(['create', join(data, 'opengym.db'), dest])).toThrow()
    expect(() => snapshotCommand(['create', join(data, 'opengym.db'), join(data, 'snapshot')])).toThrow('overlap')
  } finally { store.close() }
})
