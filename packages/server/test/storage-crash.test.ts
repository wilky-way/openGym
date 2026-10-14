// Public compatibility and regression coverage.
// Each drill starts a real child process and sends it SIGKILL at the point where the write is cut short.
import { test, expect } from 'bun:test'
import fs from 'node:fs'
import { openStore, bootStore, writeStateMirror, writeAccountsMirror, commitStateDoc, stateMirrorFile, accountsMirrorFile } from '../src/storage'
import * as repo from '../src/storage/repos'
import { scratchDir, user, stateText } from './helpers'

const FIXTURE = new URL('./fixtures/crash-mirror.ts', import.meta.url).pathname

/** Runs the child in `mode` until it reports READY, then SIGKILLs it. */
async function killedAt(mode: string, dir: string, ...args: string[]): Promise<void> {
  const child = Bun.spawn([process.execPath, FIXTURE, mode, dir, ...args], { stdout: 'pipe', stderr: 'pipe' })
  const reader = child.stdout.getReader()
  const decoder = new TextDecoder()
  let seen = ''
  while (!seen.includes('READY')) {
    const { value, done } = await reader.read()
    if (done) break
    seen += decoder.decode(value)
  }
  if (!seen.includes('READY')) {
    throw new Error(`child (${mode}) never reached the write: ${await new Response(child.stderr).text()}`)
  }
  child.kill(9)
  await child.exited
  expect(child.signalCode).toBe('SIGKILL')
}

const tmpFiles = (dir: string) => fs.readdirSync(dir).filter(n => n.endsWith('.tmp'))

test('kill -9 during a state mirror write: boot rewrites the stale mirror from SQLite and sweeps the leftover', async () => {
  const dir = scratchDir()
  const store = openStore(dir)
  repo.putUser(store.db, user('p1'))
  commitStateDoc(store.db, 'p1', stateText(1, 'w1'), 1, 30)
  writeStateMirror(store.db, dir, 'p1')
  store.close()

  await killedAt('mirror', dir, stateText(2, 'w2'))

  // On disk now: SQLite holds w2, the mirror still holds w1, and one complete temporary file holds w2.
  const leftovers = tmpFiles(dir)
  expect(leftovers.length).toBe(1)
  expect(fs.readFileSync(stateMirrorFile(dir, 'p1'), 'utf8')).toBe(stateText(1, 'w1'))

  const booted = bootStore(dir)
  try {
    expect(booted.swept).toEqual(leftovers)
    expect(booted.mirrors).toEqual([{ profileId: 'p1', action: 'rewritten', mirrorWid: 'w1', sqliteWid: 'w2' }])
    expect(fs.readFileSync(stateMirrorFile(dir, 'p1'), 'utf8')).toBe(stateText(2, 'w2'))
  } finally { booted.close() }
  expect(tmpFiles(dir)).toEqual([])
}, 30_000)

test('kill -9 after a state commit but before any mirror write: boot creates the mirror from SQLite', async () => {
  const dir = scratchDir()
  const store = openStore(dir)
  repo.putUser(store.db, user('p1'))
  store.close()

  await killedAt('commit', dir, stateText(1, 'w1'))
  expect(fs.existsSync(stateMirrorFile(dir, 'p1'))).toBe(false)

  const booted = bootStore(dir)
  try {
    expect(booted.mirrors).toEqual([{ profileId: 'p1', action: 'created', mirrorWid: null, sqliteWid: 'w1' }])
    expect(fs.readFileSync(stateMirrorFile(dir, 'p1'), 'utf8')).toBe(stateText(1, 'w1'))
  } finally { booted.close() }
}, 30_000)

test('kill -9 during a db.json write: boot rewrites db.json and its backup from SQLite', async () => {
  const dir = scratchDir()
  const store = openStore(dir)
  repo.putUser(store.db, user('p1'))
  writeAccountsMirror(store.db, dir)
  store.close()

  await killedAt('accounts', dir)

  // db.json still holds the previous accounts; SQLite and the fingerprints know about p2.
  expect(JSON.parse(fs.readFileSync(accountsMirrorFile(dir), 'utf8')).users.map((u: { id: string }) => u.id)).toEqual(['p1'])
  expect(tmpFiles(dir).length).toBe(1)

  const booted = bootStore(dir)
  try {
    expect(booted.accounts.action).toBe('rewritten')
    const onDisk = JSON.parse(fs.readFileSync(accountsMirrorFile(dir), 'utf8')) as { users: { id: string }[] }
    expect(onDisk.users.map(u => u.id)).toEqual(['p1', 'p2'])
    expect(fs.readFileSync(accountsMirrorFile(dir) + '.bak', 'utf8')).toBe(fs.readFileSync(accountsMirrorFile(dir), 'utf8'))
  } finally { booted.close() }
  expect(tmpFiles(dir)).toEqual([])
}, 30_000)
