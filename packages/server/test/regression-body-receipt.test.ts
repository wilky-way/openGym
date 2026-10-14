import {test, expect} from 'bun:test'
import {request} from 'node:http'
import {authServer, cookie} from './auth-helpers'
const send = (url: string, chunked: boolean, bytes: number, path: string) => new Promise<{status: number; body: string}>((done, fail) => {
 const req = request(url + path, {method: 'POST', agent: false, headers: {...cookie('u_test_1'), ...(chunked ? {'Transfer-Encoding': 'chunked'} : {'Content-Length': String(bytes)})}}, res => {
  let body = ''; res.on('data', p => body += p); res.on('end', () => done({status: res.statusCode!, body}))
 }); req.on('error', fail); req.end('x'.repeat(bytes))
})
for (const path of ['/api/logout', '/api/logout/all', '/api/login/options']) for (const chunked of [false, true]) test(`ignored-body ${path} enforces the byte cap before a mutation (${chunked ? 'chunked' : 'framed'})`, async () => {
 const h = authServer(), response = await send(h.api, chunked, h.config.maxBodyBytes + 1, path)
 expect(response.status).toBe(413); expect(JSON.parse(response.body)).toEqual({error: 'body too large'})
 if (path === '/api/logout/all') expect(h.auth.sessionOf(new Request(h.api, {headers: cookie('u_test_1')}))).toBeTruthy()
})
test('ignored malformed small bodies retain their legacy success response', async () => {
 const h = authServer(); expect((await send(h.api, false, 1, '/api/logout')).status).toBe(200)
})
