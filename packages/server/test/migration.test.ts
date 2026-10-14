import { test, expect, spyOn } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { importLegacy, verifyLegacy } from '../src/migration/importer'
import { offloadLibrary, reinstallLibrary } from '../src/migration/library'
import { prepareRollback } from '../src/migration/rollback'
import { authorize, confirmationToken } from '../src/migration/safety'
import { readMigrationArchive } from '../src/migration/archive'
import { parseMigrationArgs } from '../src/cli/migrate'
import { openDb, bootStore, getMeta, setMeta, putUser, getUser, listAudit, appendAudit, readStateDoc, commitStateDoc, accountsText } from '../src/storage'
import { getLibraryEntry, putLibraryEntry } from '../src/storage/library'
import { zipStore } from '@opengym/core/zip'
import { stampPut } from '@opengym/core/server-stamp'
import { definition } from './library-helpers'
import { scratchDir } from './helpers'

const NOW = 1791840000000
function fixture(body: Record<string, unknown> = {}) {
  const data = scratchDir()
  const account = { users: [{ id: 'synthetic', name: 'Synthetic', created: '2026-10-01T00:00:00Z', sv: 0, extension: { z: 1 } }], creds: [{ id: 'cred', userId: 'synthetic', publicKey: 'synthetic-key', counter: 0, transports: ['internal'], extra: true }], subs: [{ endpoint: 'https://example.test/push', userId: 'synthetic', keys: { p256dh: 'synthetic', auth: 'synthetic' } }], invites: [{ code: 'INVITE', note: 'synthetic', createdBy: 'synthetic', created: '2026-10-01', usedBy: null, usedAt: null }], deviceLinks: [{ h: 'hash', userId: 'synthetic', exp: NOW + 1000, created: NOW }], extension: 'keep original' }
  const text = JSON.stringify({ _rev: 7, _wid: 'legacy-wid', _ts: 12, _prior: { keep: true }, workouts: [], unit: 'lb', unknown: { z: 1, a: 'ü' }, programmes: { definitions: [definition('inactive'), definition('busy'), definition('later')], cycles: [{ id: 'cycle', programmeId: 'busy', status: 'paused' }] }, ...body }, null, 2)
  const raw = JSON.stringify(account, null, 2)
  fs.writeFileSync(path.join(data, 'db.json'), raw)
  fs.writeFileSync(path.join(data, 'state-synthetic.json'), text)
  fs.writeFileSync(path.join(data, 'secret'), 'synthetic secret')
  fs.writeFileSync(path.join(data, 'vapid.json'), '{"synthetic":true}')
  fs.writeFileSync(path.join(data, 'audit.log'), JSON.stringify({ id: 41, ts: NOW, ev: 'sign-in', ok: true, uid: 'synthetic' }) + '\n{torn\n')
  fs.mkdirSync(path.join(data, 'uploads/synthetic'), { recursive: true })
  fs.writeFileSync(path.join(data, 'uploads/synthetic/inert.jpg'), 'synthetic inert blob')
  const options = { data, scratch: data, protectedRoot: () => '/synthetic-protected-opengym', profile: 'synthetic', now: NOW }
  return { data, text, raw, account, options }
}
const dbOf = (data: string) => openDb(path.join(data, 'opengym.db'))
function contents(data: string): Record<string, string> {
  return Object.fromEntries(fs.readdirSync(data).filter(n => fs.statSync(path.join(data, n)).isFile()).map(n => [n, fs.readFileSync(path.join(data, n)).toString('base64')]))
}

test('dry-run defaults to no disk writes and validates a synthetic legacy directory', async () => {
  const f = fixture(), before = contents(f.data), r = await importLegacy(f.options)
  expect(r.dryRun).toBe(true); expect(r.profiles[0]?.equal).toBe(true)
  expect(r.auditEvents).toBe(1); expect(r.auditSkipped).toBe(1)
  expect(r.uploadsIgnored).toEqual([{ path: 'uploads/synthetic/inert.jpg', bytes: 20 }])
  expect(contents(f.data)).toEqual(before)
  expect(parseMigrationArgs(['import', '--data', f.data, '--scratch', f.data]).options.apply).toBeUndefined()
})
test('import preserves exact stored text, accounts, ids, secrets and uploads; verifier detects drift', async () => {
  const f = fixture(), before = contents(f.data)
  const r = await importLegacy({ ...f.options, apply: true })
  expect(r.accountsEqual).toBe(true); expect(verifyLegacy(f.options).ok).toBe(true)
  const db = dbOf(f.data)
  try {
    expect(readStateDoc(db, 'synthetic')?.json).toBe(f.text)
    expect(readStateDoc(db, 'synthetic')?.rev).toBe(7)
    expect(getUser(db, 'synthetic')?.x).toBe('{"extension":{"z":1}}')
    expect(JSON.parse(accountsText(db)).creds[0].extra).toBe(true)
    expect(listAudit(db)[0]?.id).toBe(41)
    expect(appendAudit(db, { ts: NOW, ev: 'test', ok: 1, uid: null, name: null, tgt: null, tname: null, msg: null, act: null, ip: null })).toBe(42)
    expect(db.query('SELECT COUNT(*) AS n FROM media_objects').get()).toEqual({ n: 0 })
    expect(getMeta(db, 'write_owner')).toBe('sqlite')
  } finally { db.close() }
  for (const [name, bytes] of Object.entries(before)) expect(contents(f.data)[name]).toBe(bytes)
  fs.writeFileSync(path.join(f.data, 'state-synthetic.json'), '{"_rev":8}')
  expect(() => verifyLegacy(f.options)).toThrow('verification failed')
})
test('pre-revision state retains original bytes and imports revision zero', async () => {
  const f = fixture(); const text = '{"unknown":1,"workouts":[]}'
  fs.writeFileSync(path.join(f.data, 'state-synthetic.json'), text)
  await importLegacy({ ...f.options, apply: true })
  const db = dbOf(f.data)
  try { expect(readStateDoc(db, 'synthetic')?.json).toBe(text); expect(readStateDoc(db, 'synthetic')?.rev).toBe(0) } finally { db.close() }
})
test('BOM-prefixed state fails loudly without publishing or changing any source bytes', async () => {
  const f = fixture(), file = path.join(f.data, 'state-synthetic.json')
  const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(f.text)])
  fs.writeFileSync(file, bytes)
  await expect(importLegacy({ ...f.options, apply: true })).rejects.toThrow()
  expect(fs.readFileSync(file)).toEqual(bytes)
  expect(fs.existsSync(path.join(f.data, 'opengym.db'))).toBe(false)
})
test('verifier refuses BOM-only and otherwise semantically identical state byte deltas', async () => {
  const f = fixture(), file = path.join(f.data, 'state-synthetic.json')
  await importLegacy({ ...f.options, apply: true })
  for (const bytes of [Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(f.text)]), Buffer.from(f.text + '\n'), Buffer.from(f.text.replace('ü', '\\u00fc'))]) {
    fs.writeFileSync(file, bytes)
    expect(() => verifyLegacy(f.options)).toThrow()
  }
})
test('archive BOM payload is retained byte-exactly and rejected before import writes', async () => {
  const f = fixture(), text = '\ufeff' + f.text
  const zip = await zipStore([{ name: 'db.json', blob: new Blob([f.raw]) }, { name: 'state-synthetic.json', blob: new Blob([text]) }], { now: new Date(NOW) })
  expect((await readMigrationArchive(zip)).get('state-synthetic.json')).toBe(text)
  fs.writeFileSync(path.join(f.data, 'synthetic.zip'), new Uint8Array(await zip.arrayBuffer()))
  fs.rmSync(path.join(f.data, 'state-synthetic.json'))
  await expect(importLegacy({ ...f.options, archive: 'synthetic.zip', apply: true })).rejects.toThrow()
  expect(fs.existsSync(path.join(f.data, 'opengym.db'))).toBe(false)
})
test('synthetic protected database hardlinks and symlinks refuse reconciliation without inode writes', async () => {
  const protectedFixture = fixture()
  await importLegacy({ ...protectedFixture.options, apply: true })
  const protectedDb = path.join(protectedFixture.data, 'opengym.db')
  const before = fs.readFileSync(protectedDb)
  for (const kind of ['hardlink', 'symlink'] as const) {
    const f = fixture(), target = path.join(f.data, 'opengym.db')
    if (kind === 'hardlink') fs.linkSync(protectedDb, target)
    else fs.symlinkSync(protectedDb, target)
    const options = { ...f.options, protectedRoot: () => protectedFixture.data }
    expect(() => authorize(options)).toThrow(kind)
    await expect(importLegacy({ ...options, reconcile: true, apply: true })).rejects.toThrow(kind)
    expect(fs.readFileSync(protectedDb)).toEqual(before)
    fs.unlinkSync(target)
  }
})
test('database swaps before and after descriptor open refuse before reconciliation writes', async () => {
  for (const phase of ['before', 'after'] as const) {
    const f = fixture(), replacement = fixture()
    await importLegacy({ ...f.options, apply: true })
    await importLegacy({ ...replacement.options, apply: true })
    const file = fs.realpathSync.native(path.join(f.data, 'opengym.db')), other = path.join(replacement.data, 'opengym.db')
    const before = fs.readFileSync(other), originalOpen = fs.openSync
    let swapped = false
    const swap = () => { fs.renameSync(file, file + '.old'); fs.renameSync(other, file); swapped = true }
    const spy = spyOn(fs, 'openSync').mockImplementation((...args: Parameters<typeof fs.openSync>) => {
      if (args[0] !== file || swapped) return originalOpen(...args)
      if (phase === 'before') swap()
      const fd = originalOpen(...args)
      if (phase === 'after') swap()
      return fd
    })
    try { await expect(importLegacy({ ...f.options, reconcile: true, apply: true })).rejects.toThrow('changed between check and open') }
    finally { spy.mockRestore() }
    expect(swapped).toBe(true)
    expect(fs.readFileSync(file)).toEqual(before)
  }
})
test('symlink swap at descriptor open is refused by O_NOFOLLOW before protected bytes change', async () => {
  const f = fixture(), replacement = fixture()
  await importLegacy({ ...f.options, apply: true })
  await importLegacy({ ...replacement.options, apply: true })
  const file = fs.realpathSync.native(path.join(f.data, 'opengym.db')), other = path.join(replacement.data, 'opengym.db')
  const before = fs.readFileSync(other), originalOpen = fs.openSync
  const spy = spyOn(fs, 'openSync').mockImplementation((...args: Parameters<typeof fs.openSync>) => {
    if (args[0] === file) { fs.renameSync(file, file + '.old'); fs.symlinkSync(other, file) }
    return originalOpen(...args)
  })
  try { await expect(importLegacy({ ...f.options, protectedRoot: () => replacement.data, reconcile: true, apply: true })).rejects.toThrow('ELOOP') }
  finally { spy.mockRestore() }
  expect(fs.readFileSync(other)).toEqual(before)
})
test('SQLite swap-and-restore refuses the actual mismatched handle before any protected write', async () => {
  const f = fixture(), protectedFixture = fixture()
  await importLegacy({ ...f.options, apply: true })
  await importLegacy({ ...protectedFixture.options, apply: true })
  const file = fs.realpathSync.native(path.join(f.data, 'opengym.db')), other = path.join(protectedFixture.data, 'opengym.db')
  const before = fs.readFileSync(other), originalStat = fs.lstatSync
  let swapped = false, restored = false
  const spy = spyOn(fs, 'lstatSync').mockImplementation(((...args: Parameters<typeof fs.lstatSync>) => {
    if (args[0] === file && swapped && !restored) {
      fs.renameSync(file, other); fs.renameSync(file + '.old', file); restored = true
    }
    try { return originalStat(...args) }
    finally {
      // Last path check before SQLite's constructor. Restore only after SQLite opens.
      if (args[0] === file + '-journal' && !swapped) {
        fs.renameSync(file, file + '.old'); fs.renameSync(other, file); swapped = true
      }
    }
  }) as typeof fs.lstatSync)
  try { await expect(importLegacy({ ...f.options, protectedRoot: () => protectedFixture.data, reconcile: true, apply: true })).rejects.toThrow('SQLite database inode changed') }
  finally { spy.mockRestore() }
  expect(swapped && restored).toBe(true)
  expect(fs.readFileSync(other)).toEqual(before)
})
test('kill -9 during fresh import or reconciliation keeps legacy sources and committed database intact', async () => {
  for (const reconcile of [false, true]) {
    const f = fixture()
    if (reconcile) await importLegacy({ ...f.options, apply: true })
    const originals = ['db.json', 'state-synthetic.json', 'secret', 'vapid.json', 'audit.log']
    const capture = () => originals.map(name => { const file = path.join(f.data, name), stat = fs.statSync(file); return { name, ino: stat.ino, mtime: stat.mtimeMs, bytes: fs.readFileSync(file) } })
    const before = capture()
    const child = Bun.spawn([process.execPath, new URL('./fixtures/crash-import.ts', import.meta.url).pathname, f.data, String(reconcile)], { stdout: 'pipe', stderr: 'pipe' })
    try {
      const ready = path.join(f.data, 'import-ready'), deadline = performance.now() + 5000
      while (!fs.existsSync(ready) && performance.now() < deadline && child.exitCode === null) await Bun.sleep(10)
      expect(fs.existsSync(ready)).toBe(true)
      child.kill(9); await child.exited
      expect(child.signalCode).toBe('SIGKILL')
      expect(capture()).toEqual(before)
      expect(fs.existsSync(path.join(f.data, 'opengym.db'))).toBe(reconcile)
      if (reconcile) expect(verifyLegacy(f.options).ok).toBe(true)
      await importLegacy({ ...f.options, reconcile, apply: true })
      expect(verifyLegacy(f.options).ok).toBe(true)
    } finally { if (child.exitCode === null && child.signalCode === null) child.kill(9); await child.exited }
  }
}, 10000)
test('migration permission changes use checked descriptors, never raceable path chmod', async () => {
  const f = fixture()
  const spy = spyOn(fs, 'chmodSync').mockImplementation(() => { throw new Error('path chmod is forbidden') })
  try { expect((await importLegacy({ ...f.options, apply: true })).profiles[0]?.equal).toBe(true) }
  finally { spy.mockRestore() }
  expect(verifyLegacy(f.options).ok).toBe(true)
})
test('password fields are removed and counted, original sanitized accounts survive rollback', async () => {
  const f = fixture(); Object.assign(f.account.users[0]!, { pw: 'synthetic', pwReset: 'synthetic', email: 'synthetic@example.test' })
  fs.writeFileSync(path.join(f.data, 'db.json'), JSON.stringify(f.account))
  const r = await importLegacy({ ...f.options, apply: true })
  expect(r.passwordFieldsDropped).toBe(3)
  prepareRollback({ ...f.options, apply: true })
  const a = JSON.parse(fs.readFileSync(path.join(f.data, 'db.json'), 'utf8'))
  expect(a.users[0].pw).toBeUndefined(); expect(a.users[0].pwReset).toBeUndefined(); expect(a.users[0].email).toBeUndefined(); expect(a.extension).toBe('keep original')
})
test('missing profiles stay missing and orphan, duplicate and unsafe ids refuse import', async () => {
  const f = fixture(); fs.rmSync(path.join(f.data, 'state-synthetic.json'))
  expect((await importLegacy(f.options)).profiles).toEqual([])
  fs.writeFileSync(path.join(f.data, 'state-orphan.json'), '{}')
  await expect(importLegacy(f.options)).rejects.toThrow('orphan')
  fs.rmSync(path.join(f.data, 'state-orphan.json')); f.account.users.push(f.account.users[0]!)
  fs.writeFileSync(path.join(f.data, 'db.json'), JSON.stringify(f.account))
  await expect(importLegacy(f.options)).rejects.toThrow('duplicate')
  f.account.users[1]!.id = '../escape'; fs.writeFileSync(path.join(f.data, 'db.json'), JSON.stringify(f.account))
  await expect(importLegacy(f.options)).rejects.toThrow('unsafe')
})
test('scratch containment and symlink escapes refuse before reading or writing', async () => {
  const f = fixture(), other = scratchDir()
  expect(() => authorize({ protectedRoot: () => '/synthetic-protected-opengym', data: other, scratch: f.data, apply: true })).toThrow('scratch')
  expect(() => authorize({ protectedRoot: () => '/synthetic-protected-opengym', data: f.data, apply: true })).toThrow('outside scratch')
  expect(() => authorize({ protectedRoot: () => '/synthetic-protected-opengym', data: f.data, live: true, confirm: 'wrong' })).toThrow('matching')
  expect(authorize({ protectedRoot: () => '/synthetic-protected-opengym', data: f.data, live: true, confirm: confirmationToken(f.data) })).toBe(fs.realpathSync(f.data))
  fs.rmSync(path.join(f.data, 'db.json')); fs.symlinkSync(path.join(other, 'missing.json'), path.join(f.data, 'db.json'))
  await expect(importLegacy({ ...f.options, apply: true })).rejects.toThrow('symlink')
  expect(fs.existsSync(path.join(f.data, 'opengym.db'))).toBe(false)
})
test('malformed, oversized and excessive nesting states refuse before writes', async () => {
  const f = fixture()
  for (const text of ['{bad', '[]', '{"_rev":1.5}', '{"_rev":1,"s":"' + 'ü'.repeat(3 * 1024 * 1024) + '"}', '{"_rev":1,"deep":' + '['.repeat(801) + '0' + ']'.repeat(801) + '}']) {
    fs.writeFileSync(path.join(f.data, 'state-synthetic.json'), text)
    await expect(importLegacy({ ...f.options, apply: true })).rejects.toThrow()
    expect(fs.existsSync(path.join(f.data, 'opengym.db'))).toBe(false)
  }
})
test('SQL failure leaves no partially imported accounts or state', async () => {
  const f = fixture(); f.account.creds[0]!.userId = 'nonexistent'
  fs.writeFileSync(path.join(f.data, 'db.json'), JSON.stringify(f.account))
  await expect(importLegacy({ ...f.options, apply: true })).rejects.toThrow()
  expect(fs.existsSync(path.join(f.data, 'opengym.db'))).toBe(false)
  expect(fs.readdirSync(f.data).some(n => n.startsWith('opengym.db.import-'))).toBe(false)
})
test('offload dry-run leaves both database and JSON unchanged; offload only moves inactive definitions', async () => {
  const f = fixture(); await importLegacy({ ...f.options, apply: true })
  const before = fs.readFileSync(path.join(f.data, 'opengym.db'))
  const r = offloadLibrary(f.options)
  expect(r.moved.map(d => d.id)).toEqual(['inactive', 'later']); expect(r.protectedIds).toEqual(['busy'])
  expect(fs.readFileSync(path.join(f.data, 'opengym.db'))).toEqual(before)
  expect(fs.readFileSync(path.join(f.data, 'state-synthetic.json'), 'utf8')).toBe(f.text)
  offloadLibrary({ ...f.options, apply: true })
  const db = dbOf(f.data)
  try {
    const s = JSON.parse(readStateDoc(db, 'synthetic')!.json)
    expect(s.programmes.definitions.map((d: {id:string}) => d.id)).toEqual(['busy'])
    expect(s.programmes.offloaded.inactive.at).toBe(NOW)
    expect(s._wids.at(-1)).toBe('legacy-wid')
    expect(s._wids).not.toContain(s._wid)
    expect(getLibraryEntry(db, 'synthetic', 'inactive')?.definition).toEqual(definition('inactive'))
    const stale = stampPut(s, JSON.parse(f.text), { now: NOW + 10 })
    expect(stale.programmes.definitions.map((d: {id:string}) => d.id)).toEqual(['busy'])
    expect(getMeta(db, 'offload_rule')).toBe('1')
  } finally { db.close() }
})
test('offload then reinstall preserves original definition bytes/order and current workouts', async () => {
  const f = fixture(); await importLegacy({ ...f.options, apply: true }); offloadLibrary({ ...f.options, apply: true })
  let db = dbOf(f.data)
  try { const s = JSON.parse(readStateDoc(db, 'synthetic')!.json); s.workouts.push({ id: 'newly-logged', d: '2026-10-02' }); commitStateDoc(db, 'synthetic', JSON.stringify(s), NOW, 30) } finally { db.close() }
  const preflight = reinstallLibrary(f.options); expect(preflight.dryRun).toBe(true)
  reinstallLibrary({ ...f.options, apply: true, now: NOW + 1 })
  db = dbOf(f.data)
  try {
    const s = JSON.parse(readStateDoc(db, 'synthetic')!.json)
    expect(JSON.stringify(s.programmes.definitions)).toBe(JSON.stringify(JSON.parse(f.text).programmes.definitions))
    expect(s.workouts).toEqual([{ id: 'newly-logged', d: '2026-10-02' }])
    expect(s.unknown).toEqual(JSON.parse(f.text).unknown)
    expect(Object.keys(s.programmes.offloaded)).toEqual(['inactive', 'later'])
    const replay = stampPut(s, JSON.parse(f.text), { now: NOW + 20 })
    expect(replay.programmes.definitions.map((d: { id: string }) => d.id)).toEqual(['inactive', 'busy', 'later'])
    expect(s.programmes.installed.inactive.at).toBeGreaterThan(NOW)
    expect(getMeta(db, 'offload_rule')).toBe('0')
  } finally { db.close() }
})
test('reinstall uses head versions, lists new library-only ids and supports explicit originals', async () => {
  const f = fixture(); await importLegacy({ ...f.options, apply: true }); offloadLibrary({ ...f.options, apply: true })
  const db = dbOf(f.data)
  try {
    const e = getLibraryEntry(db, 'synthetic', 'inactive')!
    putLibraryEntry(db, 'synthetic', 'inactive', { definition: { ...e.definition, name: 'New head' }, expectedVersionId: e.versionId, now: NOW })
    putLibraryEntry(db, 'synthetic', 'new-library-only', { definition: definition('new-library-only'), expectedVersionId: null, now: NOW })
  } finally { db.close() }
  expect(reinstallLibrary(f.options).newLibraryOnly).toEqual(['new-library-only'])
  expect(reinstallLibrary(f.options).changedHeads.map(d => d.id)).toEqual(['inactive'])
  reinstallLibrary({ ...f.options, apply: true, includeNew: true })
  const after = dbOf(f.data)
  try { const s = JSON.parse(readStateDoc(after, 'synthetic')!.json); expect(s.programmes.definitions[0].name).toBe('New head'); expect(s.programmes.definitions.at(-1).id).toBe('new-library-only') } finally { after.close() }
})
test('oversized heads fall back to manifest originals; oversized current doc refuses without mutation', async () => {
  const f = fixture(); await importLegacy({ ...f.options, apply: true }); offloadLibrary({ ...f.options, apply: true })
  const db = dbOf(f.data)
  try {
    const e = getLibraryEntry(db, 'synthetic', 'inactive')!
    putLibraryEntry(db, 'synthetic', 'inactive', { definition: { ...e.definition, extra: 'x'.repeat(4800000) }, expectedVersionId: e.versionId, now: NOW })
    expect(reinstallLibrary(f.options).fallback).toBe(true)
    const s = JSON.parse(readStateDoc(db, 'synthetic')!.json); s.extra = 'x'.repeat(4800000)
    commitStateDoc(db, 'synthetic', JSON.stringify(s), NOW, 30)
    const before = readStateDoc(db, 'synthetic')!.json
    expect(() => reinstallLibrary({ ...f.options, apply: true })).toThrow('fix forward')
    expect(readStateDoc(db, 'synthetic')!.json).toBe(before)
  } finally { db.close() }
})
test('rollback defaults to dry run; exports every current byte then sets owner legacy and requires reconcile', async () => {
  const f = fixture(); await importLegacy({ ...f.options, apply: true })
  expect(prepareRollback(f.options).dryRun).toBe(true)
  expect(prepareRollback({ ...f.options, apply: true }).verified).toBe(true)
  expect(fs.readFileSync(path.join(f.data, 'db.json'), 'utf8')).toBe(f.raw)
  expect(fs.readFileSync(path.join(f.data, 'state-synthetic.json'), 'utf8')).toBe(f.text)
  expect(() => bootStore(f.data)).toThrow('reconcile')
  const newer = '{"_rev":8,"_wid":"legacy-new","workouts":[{"id":"new"}]}'
  fs.writeFileSync(path.join(f.data, 'state-synthetic.json'), newer)
  await expect(importLegacy({ ...f.options, apply: true })).rejects.toThrow('reconcile')
  await importLegacy({ ...f.options, apply: true, reconcile: true })
  expect(verifyLegacy(f.options).ok).toBe(true)
  const store = bootStore(f.data)
  try { expect(readStateDoc(store.db, 'synthetic')!.json).toBe(newer) } finally { store.close() }
})
test('rollback exports changed accounts rather than stale imported original', async () => {
  const f = fixture(); await importLegacy({ ...f.options, apply: true })
  const db = dbOf(f.data)
  try { putUser(db, { ...getUser(db, 'synthetic')!, name: 'Changed' }) } finally { db.close() }
  prepareRollback({ ...f.options, apply: true })
  expect(JSON.parse(fs.readFileSync(path.join(f.data, 'db.json'), 'utf8')).users[0].name).toBe('Changed')
})
test('rollback output failure leaves SQLite owner intact', async () => {
  const f = fixture(); await importLegacy({ ...f.options, apply: true })
  const initial = dbOf(f.data)
  try { setMeta(initial, 'accounts_mirror_stale', '1') } finally { initial.close() }
  fs.mkdirSync(path.join(f.data, 'db.json.bak'))
  expect(() => prepareRollback({ ...f.options, apply: true })).toThrow()
  const db = dbOf(f.data)
  try { expect(getMeta(db, 'write_owner')).toBe('sqlite'); expect(getMeta(db, 'accounts_mirror_stale')).toBe('1') } finally { db.close() }
})
test('verified rollback clears the durable stale account mirror flag; preview leaves it set', async () => {
  const f = fixture(); await importLegacy({ ...f.options, apply: true })
  let db = dbOf(f.data)
  try { setMeta(db, 'accounts_mirror_stale', '1') } finally { db.close() }
  prepareRollback(f.options)
  db = dbOf(f.data)
  try { expect(getMeta(db, 'accounts_mirror_stale')).toBe('1') } finally { db.close() }
  expect(prepareRollback({ ...f.options, apply: true }).verified).toBe(true)
  db = dbOf(f.data)
  try { expect(getMeta(db, 'accounts_mirror_stale')).toBe('0'); expect(getMeta(db, 'write_owner')).toBe('legacy') } finally { db.close() }
})
test('ZIP CRC oracle exception: still-parseable corrupted archive is rejected', async () => {
  const original = await zipStore([{ name: 'db.json', blob: new Blob(['{"users":[]}']) }], { now: new Date(NOW) })
  expect((await readMigrationArchive(original)).get('db.json')).toBe('{"users":[]}')
  const bytes = new Uint8Array(await original.arrayBuffer()); const offset = 30 + 'db.json'.length
  bytes[offset + 2] = 'U'.charCodeAt(0)
  expect(JSON.parse(new TextDecoder().decode(bytes.subarray(offset, offset + 12)))).toEqual({ Users: [] })
  await expect(readMigrationArchive(new Blob([bytes]))).rejects.toThrow('crc-mismatch')
})
test('archive import is dry-run by default and duplicate archive names refuse', async () => {
  const f = fixture(), zip = await zipStore([{ name: 'db.json', blob: new Blob([f.raw]) }, { name: 'state-synthetic.json', blob: new Blob([f.text]) }], { now: new Date(NOW) })
  fs.writeFileSync(path.join(f.data, 'synthetic.zip'), new Uint8Array(await zip.arrayBuffer()))
  expect((await importLegacy({ ...f.options, archive: 'synthetic.zip' })).profiles[0]?.equal).toBe(true)
  expect(fs.existsSync(path.join(f.data, 'opengym.db'))).toBe(false)
  const duplicate = await zipStore([{ name: 'db.json', blob: new Blob([f.raw]) }, { name: 'db.json', blob: new Blob([f.raw]) }], { now: new Date(NOW) })
  await expect(readMigrationArchive(duplicate)).rejects.toThrow('duplicate-name')
})
test('duplicate relational account keys refuse before importing; projection never conceals lost rows', async () => {
  for (const field of ['creds', 'subs', 'invites', 'deviceLinks'] as const) {
    const f = fixture(); const rows = f.account[field]; rows.push({ ...rows[0]! } as never)
    fs.writeFileSync(path.join(f.data, 'db.json'), JSON.stringify(f.account))
    await expect(importLegacy({ ...f.options, apply: true })).rejects.toThrow('duplicate')
    expect(fs.existsSync(path.join(f.data, 'opengym.db'))).toBe(false)
  }
})
test('audit verifier detects missing or changed imported events and regressed monotonic sequence', async () => {
  const f = fixture(); await importLegacy({ ...f.options, apply: true })
  const db = dbOf(f.data)
  try {
    db.run("UPDATE audit_events SET ev='changed' WHERE id=41")
    expect(() => verifyLegacy(f.options)).toThrow('verification failed')
    db.run("UPDATE audit_events SET ev='sign-in' WHERE id=41; UPDATE meta SET value='0' WHERE key='audit_seq'")
    expect(() => verifyLegacy(f.options)).toThrow('verification failed')
    db.run("UPDATE meta SET value='41' WHERE key='audit_seq'; DELETE FROM audit_events")
    expect(() => verifyLegacy(f.options)).toThrow('verification failed')
  } finally { db.close() }
})
test('repeated offload after terminal release retains original definition ordering', async () => {
  const f = fixture(); await importLegacy({ ...f.options, apply: true }); offloadLibrary({ ...f.options, apply: true })
  const db = dbOf(f.data)
  try {
    const s = JSON.parse(readStateDoc(db, 'synthetic')!.json); s.programmes.cycles[0].status = 'completed'
    commitStateDoc(db, 'synthetic', JSON.stringify(s), NOW + 1, 30)
  } finally { db.close() }
  offloadLibrary({ ...f.options, apply: true, now: NOW + 2 })
  reinstallLibrary({ ...f.options, apply: true, now: NOW + 3 })
  const after = dbOf(f.data)
  try { expect(JSON.stringify(JSON.parse(readStateDoc(after, 'synthetic')!.json).programmes.definitions)).toBe(JSON.stringify(JSON.parse(f.text).programmes.definitions)) } finally { after.close() }
})
test('canonical no-op library key order preserves exact offloaded bytes through reinstall', async () => {
  const f = fixture(); await importLegacy({ ...f.options, apply: true })
  const db = dbOf(f.data)
  try {
    const d = definition('inactive'), reordered = Object.fromEntries(Object.entries(d).reverse())
    putLibraryEntry(db, 'synthetic', 'inactive', { definition: reordered, expectedVersionId: null, now: NOW })
    expect(offloadLibrary(f.options).moved.map(d => d.id)).toEqual(['inactive', 'later'])
    offloadLibrary({ ...f.options, apply: true })
    reinstallLibrary({ ...f.options, apply: true })
    expect(JSON.stringify(JSON.parse(readStateDoc(db, 'synthetic')!.json).programmes.definitions)).toBe(JSON.stringify(JSON.parse(f.text).programmes.definitions))
  } finally { db.close() }
})
test('archive applied import boots on matching JSON and rejects divergent existing mirrors', async () => {
  const f = fixture(), zip = await zipStore([{ name: 'db.json', blob: new Blob([f.raw]) }, { name: 'state-synthetic.json', blob: new Blob([f.text]) }], { now: new Date(NOW) })
  fs.writeFileSync(path.join(f.data, 'synthetic.zip'), new Uint8Array(await zip.arrayBuffer()))
  await importLegacy({ ...f.options, archive: 'synthetic.zip', apply: true })
  const store = bootStore(f.data)
  try { expect(readStateDoc(store.db, 'synthetic')!.json).toBe(f.text) } finally { store.close() }
  const other = fixture(); fs.writeFileSync(path.join(other.data, 'synthetic.zip'), new Uint8Array(await zip.arrayBuffer()))
  fs.writeFileSync(path.join(other.data, 'state-synthetic.json'), '{"_rev":999}')
  await expect(importLegacy({ ...other.options, archive: 'synthetic.zip', apply: true })).rejects.toThrow('conflicts')
  expect(fs.existsSync(path.join(other.data, 'opengym.db'))).toBe(false)
})
test('arbitrary directory symlink aliases and conflicting CLI mutation flags refuse', async () => {
  const f = fixture(), root = scratchDir(), alias = path.join(root, 'alias')
  fs.symlinkSync(f.data, alias)
  expect(() => authorize({ protectedRoot: () => '/synthetic-protected-opengym', data: alias, scratch: root })).toThrow('alias')
  expect(() => parseMigrationArgs(['import', '--data', f.data, '--apply', '--dry-run'])).toThrow('conflicts')
  expect(() => parseMigrationArgs(['import', '--data', f.data, '--dry-run', '--apply'])).toThrow('conflicts')
})
test('physical and symlink scratch aliases of a synthetic protected live root refuse', () => {
  const physical = scratchDir(), root = scratchDir(), namedProtected = path.join(root, 'protected')
  fs.symlinkSync(physical, namedProtected)
  const protectedRoot = () => fs.realpathSync(namedProtected)
  expect(() => authorize({ data: physical, scratch: physical, protectedRoot })).toThrow('live data')
  const alias = path.join(root, 'scratch-alias'); fs.symlinkSync(physical, alias)
  expect(() => authorize({ data: alias, scratch: root, protectedRoot })).toThrow('alias')
})
test('offload dry-run rejects missing definition name just like apply', async () => {
  const f = fixture(); const doc = JSON.parse(f.text); delete doc.programmes.definitions[2].name
  fs.writeFileSync(path.join(f.data, 'state-synthetic.json'), JSON.stringify(doc))
  await importLegacy({ ...f.options, apply: true })
  expect(() => offloadLibrary(f.options)).toThrow()
  expect(() => offloadLibrary({ ...f.options, apply: true })).toThrow()
  const db = dbOf(f.data)
  try { expect(db.query('SELECT COUNT(*) AS n FROM library_definitions').get()).toEqual({ n: 0 }) } finally { db.close() }
})
test('failed reconciliation preserves all previously committed accounts, state, library and ownership', async () => {
  const f = fixture(); await importLegacy({ ...f.options, apply: true }); offloadLibrary({ ...f.options, apply: true })
  const db = dbOf(f.data), before = readStateDoc(db, 'synthetic')!.json
  db.close()
  f.account.creds[0]!.userId = 'nonexistent'
  fs.writeFileSync(path.join(f.data, 'db.json'), JSON.stringify(f.account))
  await expect(importLegacy({ ...f.options, apply: true, reconcile: true })).rejects.toThrow()
  const after = dbOf(f.data)
  try {
    expect(readStateDoc(after, 'synthetic')!.json).toBe(before)
    expect(getUser(after, 'synthetic')?.id).toBe('synthetic')
    expect(getLibraryEntry(after, 'synthetic', 'inactive')).not.toBeNull()
    expect(getMeta(after, 'write_owner')).toBe('sqlite')
  } finally { after.close() }
})
test('missing manifest library version and exhausted clocks refuse reinstall without changing the doc', async () => {
  const f = fixture(); await importLegacy({ ...f.options, apply: true }); offloadLibrary({ ...f.options, apply: true })
  const db = dbOf(f.data)
  try {
    const before = readStateDoc(db, 'synthetic')!.json
    db.query('DELETE FROM library_definitions WHERE profile_id=? AND id=?').run('synthetic', 'inactive')
    expect(() => reinstallLibrary({ ...f.options, apply: true })).toThrow('missing library version')
    expect(readStateDoc(db, 'synthetic')!.json).toBe(before)
    const s = JSON.parse(before); s.programmes.installed = { inactive: { versionId: s.programmes.offloaded.inactive.versionId, at: Number.MAX_SAFE_INTEGER } }
    commitStateDoc(db, 'synthetic', JSON.stringify(s), NOW, 30)
    expect(() => reinstallLibrary({ ...f.options, apply: true })).toThrow('clock exhausted')
  } finally { db.close() }
})
test('code rollback refuses offloaded definitions until reinstall, then keeps the retained manifest', async () => {
  const f = fixture(); await importLegacy({ ...f.options, apply: true }); offloadLibrary({ ...f.options, apply: true })
  expect(() => prepareRollback({ ...f.options, apply: true })).toThrow('reinstall')
  reinstallLibrary({ ...f.options, apply: true })
  expect(prepareRollback({ ...f.options, apply: true }).verified).toBe(true)
  const s = JSON.parse(fs.readFileSync(path.join(f.data, 'state-synthetic.json'), 'utf8'))
  expect(Object.keys(s.programmes.offloaded)).toEqual(['inactive', 'later'])
  expect(s.programmes.installed.inactive.at).toBeGreaterThan(s.programmes.offloaded.inactive.at)
})

test('configurable live root is refused lexically and by canonical path; default is unset', () => {
 const root = scratchDir(), data = path.join(root, 'synthetic-live'); fs.mkdirSync(data)
 expect(() => authorize({data, scratch: root, liveDataDir: data})).toThrow('live data')
 expect(authorize({data, scratch: root})).toBe(fs.realpathSync(data))
 const alias = path.join(root, 'alias-live'); fs.symlinkSync(data, alias)
 expect(() => authorize({data: alias, scratch: root, liveDataDir: data})).toThrow(/alias|symlink/)
})
