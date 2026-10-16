import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import * as fs from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DraftStore, authoringDirectory } from '../src/draft-store'
import { openAt, mkdirAt } from '../src/authoring-fs'

vi.mock('node:fs', async original => {
  const actual = await original<typeof fs>()
  return { ...actual, openSync: vi.fn(actual.openSync), fchmodSync: vi.fn(actual.fchmodSync) }
})
vi.mock('../src/authoring-fs', async original => {
  const actual = await original<typeof import('../src/authoring-fs')>()
  return { ...actual, openAt: vi.fn(actual.openAt), mkdirAt: vi.fn(actual.mkdirAt) }
})
let root: string
beforeEach(() => { root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'm02-safe-'))) })
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(root, { recursive: true, force: true }) })
test('neutral platform data defaults and explicit override keep authoring outside app config', () => {
  expect(authoringDirectory({}, 'darwin', root)).toBe(join(root, 'Library', 'Application Support', 'opengym-authoring'))
  expect(authoringDirectory({}, 'linux', root)).toBe(join(root, '.local', 'share', 'opengym-authoring'))
  expect(authoringDirectory({ XDG_DATA_HOME: join(root, 'data') }, 'linux', root)).toBe(join(root, 'data', 'opengym-authoring'))
  expect(authoringDirectory({ LOCALAPPDATA: join(root, 'data') }, 'win32', root)).toBe(join(root, 'data', 'opengym-authoring'))
  expect(authoringDirectory({ OPENGYM_AUTHORING_DIR: join(root, 'override') }, 'darwin', root)).toBe(join(root, 'override'))
})
test.each(['Mobile Documents', 'CloudStorage', 'Dropbox', 'Dropbox (Personal)', 'OneDrive', 'OneDrive - Company', 'Google Drive', 'GoogleDrive-user@example.test'])('refuses sync root %s before creating descendants', name => {
  const sync = join(root, name); fs.mkdirSync(sync)
  expect(() => new DraftStore(join(sync, 'new', 'drafts'))).toThrow('sync roots')
  expect(fs.readdirSync(sync)).toEqual([])
})
test('physical sync root and user directory symlink escapes are refused before writes', () => {
  const sync = join(root, 'Mobile Documents'); fs.mkdirSync(sync); fs.symlinkSync(sync, join(root, 'alias'))
  expect(() => new DraftStore(join(root, 'alias', 'new'))).toThrow('sync roots')
  const target = join(root, 'external'); fs.mkdirSync(target); fs.symlinkSync(target, join(root, 'linked'))
  for (const path of [join(root, 'linked'), join(root, 'linked', 'drafts')])
    expect(() => new DraftStore(path)).toThrow('must not be symlinks')
  expect(fs.readdirSync(sync)).toEqual([]); expect(fs.readdirSync(target)).toEqual([])
})
test.each(['drafts.db', 'drafts.db-wal', 'drafts.db-shm', 'drafts.db-journal'])('refuses symlink escape entry %s without changing target', entry => {
  const dir = join(root, 'drafts'), victim = join(root, 'victim'); fs.mkdirSync(dir); fs.writeFileSync(victim, 'Synthetic untouched', { mode: 0o644 })
  fs.symlinkSync(victim, join(dir, entry))
  expect(() => new DraftStore(dir)).toThrow('regular, unlinked')
  expect(fs.readFileSync(victim, 'utf8')).toBe('Synthetic untouched'); expect(fs.statSync(victim).mode & 0o777).toBe(0o644)
})
test('tightens existing directory and database permissions through checked descriptors', () => {
  const dir = join(root, 'drafts'); fs.mkdirSync(dir, { mode: 0o755 }); const s = new DraftStore(dir); s.close()
  expect(fs.statSync(dir).mode & 0o777).toBe(0o700); expect(fs.statSync(join(dir, 'drafts.db')).mode & 0o777).toBe(0o600)
})
test.each(['symlink', 'replacement', 'after-open'])('lstat to open race refuses %s and leaves replacement untouched', async kind => {
  const actual = await vi.importActual<typeof fs>('node:fs'), native = await vi.importActual<typeof import('../src/authoring-fs')>('../src/authoring-fs'), dir = join(root, 'drafts'), victim = join(root, 'victim')
  new DraftStore(dir).close(); fs.writeFileSync(victim, 'Synthetic untouched', { mode: 0o644 })
  const file = join(dir, 'drafts.db'); let swapped = false
  vi.mocked(openAt).mockImplementation((dirFd, name, flags, mode) => {
    if (name !== 'drafts.db' || swapped) return native.openAt(dirFd, name, flags, mode)
    swapped = true
    const fd = kind === 'after-open' ? native.openAt(dirFd, name, flags, mode) : undefined
    actual.renameSync(file, join(dir, 'original.db'))
    if (kind === 'symlink') actual.symlinkSync(victim, file)
    else actual.writeFileSync(file, 'Synthetic replacement', { mode: 0o644 })
    return fd ?? native.openAt(dirFd, name, flags, mode)
  })
  expect(() => new DraftStore(dir)).toThrow(/changed|unsafe/)
  expect(swapped).toBe(true); expect(fs.readFileSync(victim, 'utf8')).toBe('Synthetic untouched')
  if (kind !== 'symlink') { expect(fs.readFileSync(file, 'utf8')).toBe('Synthetic replacement'); expect(fs.statSync(file).mode & 0o777).toBe(0o644) }
})
test('SQLite second open also refuses a link swapped after descriptor validation', async () => {
  const actual = await vi.importActual<typeof fs>('node:fs'), dir = join(root, 'drafts')
  new DraftStore(dir).close(); const file = join(dir, 'drafts.db'), outside = join(root, 'outside.db'); let swapped = false
  vi.mocked(fs.fchmodSync).mockImplementation((fd, mode) => {
    actual.fchmodSync(fd, mode)
    if (!swapped && actual.fstatSync(fd).isFile()) { swapped = true; actual.renameSync(file, outside); actual.symlinkSync(outside, file) }
  })
  const before = fs.readFileSync(file)
  expect(() => new DraftStore(dir)).toThrow()
  expect(swapped).toBe(true); expect(fs.readFileSync(outside)).toEqual(before)
})


test.each([false,true])('ancestor swap cannot create or chmod an outside entry, existing=%s',async existing=>{
  const actual=await vi.importActual<typeof fs>('node:fs'),native=await vi.importActual<typeof import('../src/authoring-fs')>('../src/authoring-fs')
  const dir=join(root,'drafts'),outside=join(root,'external');fs.mkdirSync(outside)
  if(existing){new DraftStore(dir).close();fs.writeFileSync(join(outside,'drafts.db'),'Synthetic untouched',{mode:0o644})}
  let swapped=false
  vi.mocked(openAt).mockImplementation((dirFd,name,flags,mode)=>{
    if(!swapped && name==='drafts.db'){swapped=true;actual.renameSync(dir,join(root,'original'));actual.symlinkSync(outside,dir)}
    return native.openAt(dirFd,name,flags,mode)
  })
  expect(()=>new DraftStore(dir)).toThrow();expect(swapped).toBe(true)
  if(existing){expect(fs.readFileSync(join(outside,'drafts.db'),'utf8')).toBe('Synthetic untouched');expect(fs.statSync(join(outside,'drafts.db')).mode&0o777).toBe(0o644)}
  else expect(fs.readdirSync(outside)).toEqual([])
})
test('ancestor swaps during missing directory creation remain anchored and never write into the target',async()=>{
  const actual=await vi.importActual<typeof fs>('node:fs'),native=await vi.importActual<typeof import('../src/authoring-fs')>('../src/authoring-fs')
  const parent=join(root,'parent'),outside=join(root,'external');fs.mkdirSync(parent);fs.mkdirSync(outside,{mode:0o755})
  let swapped=false
  vi.mocked(mkdirAt).mockImplementation((dirFd,name)=>{
    if(!swapped && name==='nested'){swapped=true;actual.renameSync(parent,join(root,'original'));actual.symlinkSync(outside,parent)}
    native.mkdirAt(dirFd,name)
  })
  expect(()=>new DraftStore(join(parent,'nested','drafts'))).toThrow('must not be symlinks')
  expect(swapped).toBe(true);expect(fs.readdirSync(outside)).toEqual([]);expect(fs.statSync(outside).mode&0o777).toBe(0o755)
})
