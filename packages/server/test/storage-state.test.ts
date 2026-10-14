// The state document: verbatim text, rev and wid read from the document, and a bounded history ring.
import { test, expect } from 'bun:test'
import { openStore, commitStateDoc, readStateDoc, stateHistory, isKnownWid } from '../src/storage'
import * as repo from '../src/storage/repos'
import { scratchDir, user, stateText } from './helpers'

test('a committed document is returned byte-for-byte, key order included', () => {
  const store = openStore(scratchDir())
  try {
    repo.putUser(store.db, user('p1'))
    const text = '{"workouts":[],"_rev":2,"_wid":"w-2","zeta":1,"alpha":2}'
    const result = commitStateDoc(store.db, 'p1', text, 1000, 30)
    expect(result).toEqual({ rev: 2, wid: 'w-2', bytes: Buffer.byteLength(text) })
    const row = readStateDoc(store.db, 'p1')
    expect(row?.json).toBe(text)
    expect(row?.rev).toBe(2)
    expect(row?.wid).toBe('w-2')
    expect(row?.updated_at).toBe(1000)
  } finally { store.close() }
})

test('a later commit replaces the current row and adds to the history', () => {
  const store = openStore(scratchDir())
  try {
    repo.putUser(store.db, user('p1'))
    commitStateDoc(store.db, 'p1', stateText(1, 'w1'), 1, 30)
    commitStateDoc(store.db, 'p1', stateText(2, 'w2'), 2, 30)
    expect(readStateDoc(store.db, 'p1')?.wid).toBe('w2')
    expect(stateHistory(store.db, 'p1').map(h => h.wid)).toEqual(['w2', 'w1'])
    expect(isKnownWid(store.db, 'p1', 'w1')).toBe(true)
    expect(isKnownWid(store.db, 'p1', 'nope')).toBe(false)
  } finally { store.close() }
})

test('the history ring keeps only the newest STATE_HISTORY_KEEP versions', () => {
  const store = openStore(scratchDir())
  try {
    repo.putUser(store.db, user('p1'))
    for (let rev = 1; rev <= 6; rev++) commitStateDoc(store.db, 'p1', stateText(rev, `w${rev}`), rev, 3)
    expect(stateHistory(store.db, 'p1').map(h => h.rev)).toEqual([6, 5, 4])
    expect(isKnownWid(store.db, 'p1', 'w1')).toBe(false)
    expect(readStateDoc(store.db, 'p1')?.rev).toBe(6)
  } finally { store.close() }
})

test('a document without _wid commits but writes no history entry', () => {
  const store = openStore(scratchDir())
  try {
    repo.putUser(store.db, user('p1'))
    const result = commitStateDoc(store.db, 'p1', '{"_rev":5}', 1, 30)
    expect(result.wid).toBeNull()
    expect(stateHistory(store.db, 'p1')).toEqual([])
    expect(readStateDoc(store.db, 'p1')?.rev).toBe(5)
  } finally { store.close() }
})

test('documents that are not objects, or lack an integer _rev, are rejected before anything is written', () => {
  const store = openStore(scratchDir())
  try {
    repo.putUser(store.db, user('p1'))
    expect(() => commitStateDoc(store.db, 'p1', '[1,2]', 1, 30)).toThrow(TypeError)
    expect(() => commitStateDoc(store.db, 'p1', '{"_rev":"2"}', 1, 30)).toThrow(TypeError)
    expect(() => commitStateDoc(store.db, 'p1', 'not json', 1, 30)).toThrow()
    expect(readStateDoc(store.db, 'p1')).toBeNull()
  } finally { store.close() }
})

test('a state document needs an existing profile (foreign key), and a deleted profile takes its history', () => {
  const store = openStore(scratchDir())
  try {
    expect(() => commitStateDoc(store.db, 'ghost', stateText(1, 'w1'), 1, 30)).toThrow()
    repo.putUser(store.db, user('p1'))
    commitStateDoc(store.db, 'p1', stateText(1, 'w1'), 1, 30)
    repo.deleteUser(store.db, 'p1')
    expect(readStateDoc(store.db, 'p1')).toBeNull()
    expect(stateHistory(store.db, 'p1')).toEqual([])
  } finally { store.close() }
})

test('a rewound revision cannot prune the newest commit: the history follows commit order', () => {
  const store = openStore(scratchDir())
  try {
    repo.putUser(store.db, user('p1'))
    commitStateDoc(store.db, 'p1', stateText(5, 'a'), 1, 1)
    commitStateDoc(store.db, 'p1', stateText(2, 'b'), 2, 1)
    expect(stateHistory(store.db, 'p1').map(h => h.wid)).toEqual(['b'])
    expect(readStateDoc(store.db, 'p1')?.rev).toBe(2)
  } finally { store.close() }
})

test('a repeated revision and a re-committed wid are ordered by commit, not by revision', () => {
  const store = openStore(scratchDir())
  try {
    repo.putUser(store.db, user('p1'))
    commitStateDoc(store.db, 'p1', stateText(3, 'w'), 1, 2)
    commitStateDoc(store.db, 'p1', stateText(4, 'x'), 1, 2)
    commitStateDoc(store.db, 'p1', stateText(4, 'w'), 1, 2)
    expect(stateHistory(store.db, 'p1').map(h => h.wid)).toEqual(['w', 'x'])
  } finally { store.close() }
})
