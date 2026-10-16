import { expect, it } from 'vitest'
import { IdentityNormaliser, assertStoredDocBytes, mapJsonStrings, encodeBytes, decodeBytes, fixtureDocs, mintSession } from '../src'
const docs = (values: Record<string, string>) => new IdentityNormaliser().docs(fixtureDocs(values))
const compare = (a: Record<string, string>, b: Record<string, string>) => assertStoredDocBytes(fixtureDocs(a), fixtureDocs(b))
it('normalises identity positions across wid/ancestry but preserves duplicates, null and malformed IDs', () => {
  const n = new IdentityNormaliser()
  expect(n.json('{"wid":"1111111111111111","state":{"_wid":"2222222222222222","_wids":["1111111111111111","1111111111111111"]}}')).toBe('{"wid":"@parity:wid:1@","state":{"_wid":"@parity:wid:2@","_wids":["@parity:wid:1@","@parity:wid:1@"]}}')
  expect(n.json('{"wid":null,"_wid":"bad","_wids":[]}')).toBe('{"wid":null,"_wid":"bad","_wids":[]}')
  expect(n.materialiseRequest({ method: 'PUT', path: '/api/data', body: { encoding: 'utf8', data: '{"baseWid":"@parity:wid:2@"}' } }).body?.data).toBe('{"baseWid":"2222222222222222"}')
  expect(() => n.materialise('@parity:wid:999@')).toThrow('Unbound')
})
it('normalises only string values at identity fields, retaining JSON escapes, key order and whitespace', () => {
  const raw = ' { "z" : 2, "_wid" : "1111111111111111", "a": "\\u0041", "note":"1111111111111111", "token":"keep", "array":[true,null,-2.5,{"q":"\\\""}] }\n'
  const next = docs({ u: raw }).u!.toString()
  expect(next).toBe(raw.replace('"1111111111111111"', '"@parity:wid:1@"'))
  expect(mapJsonStrings(' {"a": [], "b": {}, "c": "\\u0041" } ', v => v)).toBe(' {"a": [], "b": {}, "c": "\\u0041" } ')
  expect(() => mapJsonStrings('{bad}', v => v)).toThrow()
})
it('normalises tokens and session cookies with one bijection and preserves all cookie attributes', () => {
  const n = new IdentityNormaliser(), first = mintSession('first', 123), second = mintSession('second', 123)
  const response = n.response({ status: 200, body: { encoding: 'utf8', data: JSON.stringify({ token: first }) }, headers: { 'set-cookie': [`gymsid=${first}; Path=/; Max-Age=99; HttpOnly; SameSite=Lax`, `__Host-gymsid=${second}; Secure`, 'gymsid=; Max-Age=0'] } })
  expect(response.body.data).toBe('{"token":"@parity:token:1@"}')
  expect(response.headers['set-cookie']).toEqual(['gymsid=@parity:token:1@; Path=/; Max-Age=99; HttpOnly; SameSite=Lax', '__Host-gymsid=@parity:token:2@; Secure', 'gymsid=; Max-Age=0'])
  expect(n.request({ method: 'GET', path: '/api/me', headers: { Authorization: `Bearer ${first}`, Cookie: `extra=x; gymsid=${second}` } }).headers).toEqual({ Authorization: 'Bearer @parity:token:1@', Cookie: 'extra=x; gymsid=@parity:token:2@' })
})
it('stored comparator catches order, whitespace, unknown keys and absent docs after allowed wid normalisation', () => {
  const left = docs({ u: '{"_wid":"1111111111111111","z":2,"a":1}' })
  const right = docs({ u: '{"_wid":"2222222222222222","z":2,"a":1}' })
  expect(() => assertStoredDocBytes(left, right)).not.toThrow()
  expect(() => assertStoredDocBytes(left, fixtureDocs({ u: '{"_wid":"@parity:wid:1@","a":1,"z":2}' }))).toThrow('byte')
  expect(() => compare({ u: '{"x":1}' }, { u: '{ "x":1}' })).toThrow('byte')
  expect(() => compare({ u: '{"unknown":1}' }, { u: '{}' })).toThrow('byte')
  expect(() => assertStoredDocBytes(left, {})).toThrow('identities')
})
it('binary bodies are lossless, and utf8 identity strings are never applied to binary data', () => {
  const bytes = Buffer.from([0, 255, 128, 34])
  expect(encodeBytes(bytes).encoding).toBe('base64')
  expect(decodeBytes(encodeBytes(bytes))).toEqual(bytes)
  expect(encodeBytes(Buffer.from('hello'))).toEqual({ encoding: 'utf8', data: 'hello' })
})
it('route/pointer identity extensions preserve error enums and safely materialise escaped JSON and URLs', () => {
  const n = new IdentityNormaliser({ 'POST /api/pair/create#/code': 'pair-code', 'POST /api/pair/redeem#/code': 'pair-code' })
  expect(n.json('{"code":"random-code"}', false, true, 'POST /api/pair/create')).toBe('{"code":"@parity:pair-code:1@"}')
  expect(n.response({ status: 400, headers: {}, body: { encoding: 'utf8', data: '{"code":"pair-invalid"}' } }, 'POST /api/pair/redeem').body.data).toBe('{"code":"pair-invalid"}')
  // Errors on any other route are unchanged; scoped selectors avoid global `code` masking.
  expect(n.json('{"code":"not-found"}', false, true, 'GET /api/me')).toBe('{"code":"not-found"}')
  const strings = new IdentityNormaliser({ challenge: 'challenge' })
  strings.json('{"challenge":"a\\\"b/c"}')
  expect(strings.materialiseRequest({ method: 'POST', path: '/api/verify?challenge=@parity:challenge:1@', body: { encoding: 'utf8', data: '{"challenge":"@parity:challenge:1@"}' } })).toEqual({ method: 'POST', path: '/api/verify?challenge=a%22b%2Fc', body: { encoding: 'utf8', data: '{"challenge":"a\\\"b/c"}' } })
  expect(strings.request({ method: 'GET', path: '/api/verify?challenge=a%22b%2Fc' }).path).toBe('/api/verify?challenge=@parity:challenge:1@')
})
it('review P1: unknown nested bookkeeping-like fields remain verbatim and expose drift', () => {
  const raw = '{"_wid":"1111111111111111","future":{"_wid":"aaaaaaaaaaaaaaaa","_wids":["bbbbbbbbbbbbbbbb"],"token":"literal"}}'
  const n = new IdentityNormaliser(), normalised = n.docs(fixtureDocs({ u: raw })).u!
  expect(normalised).toEqual(Buffer.from(raw.replace('1111111111111111', '@parity:wid:1@')))
  expect(n.response({ status: 200, headers: {}, body: { encoding: 'utf8', data: `{"state":${raw}}` } }).body.data).toContain('"_wid":"aaaaaaaaaaaaaaaa"')
  expect(() => assertStoredDocBytes({ u: normalised }, docs({ u: raw.replace('aaaaaaaaaaaaaaaa', 'cccccccccccccccc') }))).toThrow('byte')
})
it('review P2: literal placeholder text survives notes, identity fields, headers and URL values', () => {
  const n = new IdentityNormaliser()
  n.json('{"wid":"1111111111111111"}')
  const raw = { method: 'PUT', path: '/api/data?note=%40parity%3Awid%3A1%40', headers: { 'x-note': '@parity:wid:1@' }, body: { encoding: 'utf8' as const, data: '{"baseWid":"@parity:wid:1@","state":{"note":"@parity:wid:1@","future":{"_wid":"@parity:wid:999@"}}}' } }
  const replay = n.materialiseRequest(n.request(raw))
  expect(replay.body).toEqual(raw.body)
  expect(replay.path).toBe(raw.path)
  expect(replay.headers).toEqual(raw.headers)
  expect(n.materialiseDocs(n.docs(fixtureDocs({ u: '{"_wid":"@parity:literal:abc@","note":"@parity:wid:999@"}' })))).toEqual(fixtureDocs({ u: '{"_wid":"@parity:literal:abc@","note":"@parity:wid:999@"}' }))
})
it('review P2: corrupt JSON stored bytes are compared unchanged', () => {
  expect(docs({ u: '{broken' })).toEqual(fixtureDocs({ u: '{broken' }))
  expect(() => compare({ u: '{broken' }, { u: '{damaged' })).toThrow('byte')
})
