import { test, expect } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { importLegacy, verifyLegacy } from '../src/migration/importer'
import { prepareRollback } from '../src/migration/rollback'
import { openDb, getUser, putUser } from '../src/storage'
import { scratchDir, user } from './helpers'
const NOW = 1791840000000
const users = [{ id: 'u_a', name: 'Synthetic A', created: '2026-10-01' }, { id: 'u_b', name: 'Synthetic B', created: '2026-10-01' }]
function fixture() {
  const data = scratchDir(), text = JSON.stringify({ users, creds: [], subs: [], invites: [] })
  fs.writeFileSync(path.join(data, 'db.json'), text)
  return { data, text, options: { data, scratch: data, protectedRoot: () => '/synthetic-protected-opengym', now: NOW, apply: true } }
}
test('db.json cut short with no previous version: the server refuses to start and keeps the file', async () => {
  const f = fixture(), broken = f.text.slice(0, f.text.length >> 1)
  fs.writeFileSync(path.join(f.data, 'db.json'), broken)
  await expect(importLegacy(f.options)).rejects.toThrow('Refusing to start')
  expect(fs.readFileSync(path.join(f.data, 'db.json'), 'utf8')).toBe(broken)
  expect(fs.existsSync(path.join(f.data, 'opengym.db'))).toBe(false)
  expect(fs.readdirSync(f.data)).toEqual(['db.json'])
})
test('db.json cut short after a save: the copy kept with it is used, and every account is still there', async () => {
  const f = fixture()
  fs.writeFileSync(path.join(f.data, 'db.json.bak'), f.text)
  fs.writeFileSync(path.join(f.data, 'db.json'), '')
  expect(fs.existsSync(path.join(f.data, 'db.json.bak'))).toBe(true)
  const report = await importLegacy(f.options)
  const db = openDb(path.join(f.data, 'opengym.db'))
  try { expect(getUser(db, 'u_b')?.id).toBe('u_b') } finally { db.close() }
  expect(report.accountsSource).toBe('db.json.bak')
})
test('missing or corrupt UTF-8 db.json recovers a verified backup without changing source files', async () => {
  for (const corrupt of [false, true]) {
    const f = fixture(), primary = path.join(f.data, 'db.json'), backup = primary + '.bak'
    fs.writeFileSync(backup, f.text)
    if (corrupt) fs.writeFileSync(primary, Buffer.from([0xc3, 0x28]))
    else fs.unlinkSync(primary)
    const before = corrupt ? fs.readFileSync(primary) : null
    const result = await importLegacy(f.options)
    expect(result.accountsSource).toBe('db.json.bak')
    expect(verifyLegacy(f.options).ok).toBe(true)
    const db = openDb(path.join(f.data, 'opengym.db'))
    try { expect(getUser(db, 'u_b')?.id).toBe('u_b') } finally { db.close() }
    expect(fs.readFileSync(backup, 'utf8')).toBe(f.text)
    expect(corrupt ? fs.readFileSync(primary) : null).toEqual(before)
    expect(fs.existsSync(primary)).toBe(corrupt)
  }
})
test('missing or corrupt UTF-8 primary and unusable backup refuse cleanly before any database write', async () => {
  for (const corrupt of [false, true]) for (const backup of ['missing', 'invalid-json', 'invalid-utf8']) {
    const f = fixture(), file = path.join(f.data, 'db.json')
    if (corrupt) fs.writeFileSync(file, Buffer.from([0xff]))
    else fs.unlinkSync(file)
    if (backup !== 'missing') fs.writeFileSync(file + '.bak', backup === 'invalid-json' ? Buffer.from('{bad') : Buffer.from([0xff]))
    await expect(importLegacy(f.options)).rejects.toThrow('no readable db.json or db.json.bak; restore a backup')
    expect(fs.existsSync(path.join(f.data, 'opengym.db'))).toBe(false)
  }
})
test('db.json unreadable after a sign-up: the copy kept is the last save, so the new profile is still there', async () => {
  const f = fixture(); await importLegacy(f.options)
  const db = openDb(path.join(f.data, 'opengym.db'))
  try { putUser(db, user('u_new', 2)); expect(getUser(db, 'u_new')?.id).toBe('u_new') } finally { db.close() }
  prepareRollback(f.options)
  expect(fs.readFileSync(path.join(f.data, 'db.json.bak'), 'utf8')).toBe(fs.readFileSync(path.join(f.data, 'db.json'), 'utf8'))
  expect(fs.statSync(path.join(f.data, 'db.json.bak')).mode & 0o777).toBe(0o600)
  fs.writeFileSync(path.join(f.data, 'db.json'), '{"users":[{"id"')
  await importLegacy({ ...f.options, reconcile: true })
  const imported = openDb(path.join(f.data, 'opengym.db'))
  try { for (const id of ['u_a', 'u_b', 'u_new']) expect(getUser(imported, id)?.id).toBe(id) } finally { imported.close() }
  expect(verifyLegacy(f.options).ok).toBe(true)
})
