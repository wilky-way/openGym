import { test, expect } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { dataServer, dataHeaders } from './data-helpers'
import { MAX_STATE_CONTAINERS, assertStateDepth } from '../src/data'

test('SQLite depth oracle exception: 800 total containers succeeds; 801 returns 400 without writes', async () => {
  const h = dataServer()
  const raw = (containers: number) => `{"workouts":[],"routines":[],"deep":${'['.repeat(containers - 1)}0${']'.repeat(containers - 1)}}`
  expect(MAX_STATE_CONTAINERS).toBe(800)
  for (const containers of [800, 801]) {
    const text = raw(containers)
    expect(h.db.query<{ valid: number }, [string]>('SELECT json_valid(?) AS valid').get(text)!.valid).toBe(containers === 800 ? 1 : 0)
  }
  const good = await fetch(h.api + '/api/data', { method: 'PUT', headers: dataHeaders('u1'), body: `{"stamped":true,"state":${raw(800)}}` })
  expect(good.status).toBe(200)
  const before = h.stored(), mirror = fs.readFileSync(path.join(h.dataDir, 'state-u1.json'), 'utf8')
  const bad = await fetch(h.api + '/api/data', { method: 'PUT', headers: dataHeaders('u1'), body: `{"stamped":true,"baseRev":1,"state":${raw(801)}}` })
  expect(bad.status).toBe(400)
  expect(await bad.json()).toEqual({ error: 'invalid state' })
  expect(h.stored()).toBe(before)
  expect(fs.readFileSync(path.join(h.dataDir, 'state-u1.json'), 'utf8')).toBe(mirror)
  expect(h.db.query('SELECT * FROM state_doc_history').all()).toHaveLength(1)
  // The migration importer calls this same exported function before writing.
  expect(() => assertStateDepth(JSON.parse(raw(800)))).not.toThrow()
  expect(() => assertStateDepth(JSON.parse(raw(801)))).toThrow('invalid state')
})
