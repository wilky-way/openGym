import { test, expect } from 'bun:test'
import { openDb } from '../src/storage/db'
import { putUser, commitStateDoc } from '../src/storage'
import { assertLibraryId, canonicalJson, libraryVersionId, getLibraryEntry, listLibrary, listLibraryVersions, putLibraryEntry, privateDefinition } from '../src/storage/library'
import { definition } from './library-helpers'
import { CATALOGUE, EXIDX } from '@opengym/core/exercises'
import { validateDefinition } from '../src/library-validation'
import { readStateDoc } from '../src/storage/state'
import { scratchDir, user } from './helpers'
import { join } from 'node:path'

function repo() {
  const file = join(scratchDir(), 'opengym.db'), db = openDb(file)
  putUser(db, user('p', 0)); putUser(db, user('other', 1))
  return { db, file, publish: (d = definition(), parent: string | null = null) => putLibraryEntry(db, 'p', d.id, { definition: d, expectedVersionId: parent, now: 1791840000000 }) }
}

test('canonical sha recursively ignores key order and retains array order and prototype-named fields', () => {
  const a = JSON.parse('{"z":[{"b":2,"a":1},3],"__proto__":{"x":1},"10":1,"2":2}'), b = JSON.parse('{"2":2,"10":1,"__proto__":{"x":1},"z":[{"a":1,"b":2},3]}')
  expect(canonicalJson(a)).toBe(canonicalJson(b))
  expect(canonicalJson(a)).toBe('{"10":1,"2":2,"__proto__":{"x":1},"z":[{"a":1,"b":2},3]}')
  expect(libraryVersionId(canonicalJson(a))).toBe(libraryVersionId(canonicalJson(b)))
  expect(libraryVersionId(canonicalJson([1,2]))).not.toBe(libraryVersionId(canonicalJson([2,1])))
  expect(libraryVersionId('null')).toBe('sha256:74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b')
})

test('canonical no-op versions retain the first submitted bytes and do not duplicate history', () => {
  const h = repo()
  try {
    const a = definition(), one = h.publish(a)
    const b = Object.fromEntries(Object.entries(a).reverse()) as typeof a
    const two = h.publish(b, one.versionId)
    expect(two).toEqual(one)
    expect(JSON.stringify(getLibraryEntry(h.db, 'p', a.id, '1')!.definition)).toBe(JSON.stringify(a))
    expect(JSON.stringify(getLibraryEntry(h.db, 'p', a.id)!.definition)).toBe(JSON.stringify(a))
    expect(getLibraryEntry(h.db, 'p', a.id, one.versionId)!.n).toBe(1)
    expect(listLibraryVersions(h.db, 'p', a.id)!.map(v => v.parentVersionId)).toEqual([null])
    expect(h.db.query('SELECT * FROM library_bodies').all()).toHaveLength(1)
    expect(getLibraryEntry(h.db, 'other', a.id)).toBeNull()
    expect(listLibrary(h.db, 'other').items).toEqual([])
    expect(listLibraryVersions(h.db, 'other', a.id)).toBeNull()
    const changed = h.publish({ ...b, name: 'Changed' }, one.versionId)
    expect(changed.n).toBe(2)
    expect(listLibraryVersions(h.db, 'p', a.id)!.map(v => v.parentVersionId)).toEqual([null,one.versionId])
    expect(JSON.stringify(getLibraryEntry(h.db, 'p', a.id, '1')!.definition)).toBe(JSON.stringify(a))
    expect(JSON.stringify(getLibraryEntry(h.db, 'p', a.id, '2')!.definition)).toBe(JSON.stringify({ ...b, name: 'Changed' }))
  } finally { h.db.close() }
})

test('two independent connections with the same parent admit exactly one changed child', () => {
  const h = repo(), second = openDb(h.file)
  try {
    const parent = h.publish()
    const d = { ...definition(), name: 'Child A' }
    const first = h.publish(d, parent.versionId)
    expect(() => putLibraryEntry(second, 'p', d.id, { definition: { ...d, name: 'Child B' }, expectedVersionId: parent.versionId })).toThrow('version conflict')
    expect(getLibraryEntry(second, 'p', d.id)!.versionId).toBe(first.versionId)
    expect(listLibraryVersions(second, 'p', d.id)).toHaveLength(2)
  } finally { second.close(); h.db.close() }
})

test('failed version insert rolls back the body, summary and head as one transaction', () => {
  const h = repo()
  try {
    const parent = h.publish(), before = listLibrary(h.db, 'p')
    h.db.run("CREATE TRIGGER fail_version BEFORE INSERT ON library_versions BEGIN SELECT RAISE(ABORT,'synthetic fault'); END")
    expect(() => h.publish({ ...definition(), name: 'Broken' }, parent.versionId)).toThrow('synthetic fault')
    expect(listLibrary(h.db, 'p')).toEqual(before)
    expect(listLibraryVersions(h.db, 'p', 'synthetic')).toHaveLength(1)
    expect(h.db.query('SELECT * FROM library_bodies').all()).toHaveLength(1)
  } finally { h.db.close() }
})

test('active state and installed privacy are read from SQLite at publish time', () => {
  const h = repo()
  try {
    commitStateDoc(h.db, 'p', JSON.stringify({ _rev: 1, programmes: { definitions: [{ ...definition(), source: { private: true } }], cycles: [] } }), 1, 50)
    expect(() => h.publish()).toThrow('private downgrade')
    commitStateDoc(h.db, 'p', JSON.stringify({ _rev: 2, programmes: { cycles: [{ id: 'c', status: 'paused', snapshot: { id: 'synthetic' } }] } }), 2, 50)
    expect(() => h.publish()).toThrow('active definition')
    expect(listLibrary(h.db, 'p').items).toEqual([])
  } finally { h.db.close() }
})

test('repository IDs are opaque SQL keys and reject decoded separators or dot-only segments', () => {
  const h = repo()
  try {
    for (const id of ['a/b', '../x', '..', '.', 'a\\b', '%2F', '', 'a'.repeat(129), "x' OR 1=1"]) {
      expect(() => assertLibraryId(id)).toThrow('bad request')
      expect(() => getLibraryEntry(h.db, 'p', id)).toThrow('bad request')
      expect(() => listLibraryVersions(h.db, 'p', id)).toThrow('bad request')
      expect(() => h.publish(definition(id))).toThrow('bad request')
    }
    expect(assertLibraryId('__proto__')).toBe('__proto__')
    expect(privateDefinition(definition([String.fromCharCode(98,98,109), 'synthetic'].join('-')))).toBe(true)
    expect(privateDefinition(definition([String.fromCharCode(115,98,115), 'synthetic'].join('-')))).toBe(true)
    expect(privateDefinition(definition([String.fromCharCode(115,98,115), 'synthetic'].join('-')))).toBe(true)
    expect(listLibrary(h.db, 'p').items).toEqual([])
  } finally { h.db.close() }
})


test('exact definition byte limit admits a synthetic document and one extra byte is refused', () => {
  const h = repo()
  try {
    const d = { ...definition(), retained: '' }
    d.retained = 'x'.repeat(5 * 1024 * 1024 - Buffer.byteLength(JSON.stringify(d)))
    const first = h.publish(d)
    expect(Buffer.byteLength(JSON.stringify(first.definition))).toBe(5 * 1024 * 1024)
    expect(() => h.publish({ ...d, retained: d.retained + 'x' }, first.versionId)).toThrow('too large')
    expect(listLibraryVersions(h.db, 'p', d.id)).toHaveLength(1)
  } finally { h.db.close() }
})

test('in-process non-JSON input fails closed without partially publishing', () => {
  const h = repo()
  try {
    const d = { ...definition(), retained: 1n }
    expect(() => h.publish(d as any)).toThrow('bad request')
    const cycle: any = definition(); cycle.retained = cycle
    expect(() => h.publish(cycle)).toThrow('bad request')
    expect(listLibrary(h.db, 'p').items).toEqual([])
  } finally { h.db.close() }
})


test('validation and successful or refused publishing leave caller definitions, profile customs and global catalogue unchanged', () => {
  const h = repo()
  try {
    const d = definition(), customEx = [{ id: 'custom-assisted', name: 'Synthetic assisted pull-up', eq: 'assisted', bp: 'back', custom: true, assisted: true }]
    d.weeks[0]!.days[0]!.sessions[0]!.routineSnapshot.ex[0]!.id = 'custom-assisted'
    const original = JSON.stringify(d), customs = JSON.stringify(customEx), catalogue = JSON.stringify(CATALOGUE), index = JSON.stringify(EXIDX)
    const state = JSON.stringify({ _rev: 1, customEx })
    commitStateDoc(h.db,'p',state,1,50)
    expect(validateDefinition(d, customEx).level).toBe('Ready')
    const published = putLibraryEntry(h.db,'p',d.id,{ definition:d, expectedVersionId:null, minLevel:'Ready' })
    expect(published.level).toBe('Ready')
    expect(() => putLibraryEntry(h.db,'other',d.id,{ definition:d, expectedVersionId:null, minLevel:'Ready' })).toThrow('not ready')
    expect(() => h.publish(d,null)).toThrow('version conflict')
    expect(JSON.stringify(d)).toBe(original)
    expect(JSON.stringify(customEx)).toBe(customs)
    expect(readStateDoc(h.db,'p')!.json).toBe(state)
    expect(JSON.stringify(CATALOGUE)).toBe(catalogue)
    expect(JSON.stringify(EXIDX)).toBe(index)
    expect(EXIDX['custom-assisted']).toBeUndefined()
    expect(readStateDoc(h.db,'other')).toBeNull()
  } finally { h.db.close() }
})
