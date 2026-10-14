import { programmeSchemaIssues } from '@opengym/core/programme-model-schema'
import type { Platform } from '@opengym/contract/platform/adapters'
import type { LibraryEntry, LibrarySummary } from '@opengym/contract/http/api'

export type LibraryVersion = string | number
export interface LibraryList { items: LibrarySummary[]; etag: string }
export class LibraryError extends Error {
  constructor(message: string, public code: string, public status?: number) { super(message) }
}
// Mirrored from server assertLibraryId; tests check the exact validation patterns.
export const LIBRARY_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/
export const LIBRARY_DOT_ID_PATTERN = /^\.+$/
const opaqueId = (id: string) => {
  if (!LIBRARY_ID_PATTERN.test(id) || LIBRARY_DOT_ID_PATTERN.test(id)) throw new LibraryError('Invalid program id.', 'invalid-id')
  return encodeURIComponent(id)
}
const levels = ['Invalid', 'Valid', 'Complete', 'Ready']
const listBody = (value: any): value is LibraryList => value && Array.isArray(value.items) && typeof value.etag === 'string' && value.items.every((item: any) =>
  item && typeof item.id === 'string' && item.id.length > 0 && typeof item.name === 'string' && levels.includes(item.level) &&
  typeof item.private === 'boolean' && typeof item.inUse === 'boolean' && typeof item.updatedAt === 'string' &&
  typeof item.versionId === 'string' && item.versionId.length > 0 && Number.isInteger(item.versionN) && item.versionN > 0 &&
  Number.isSafeInteger(item.bytes) && item.bytes >= 0)
const entryBody = (value: any, id: string): value is LibraryEntry => value && value.definition?.id === id && Array.isArray(value.definition.weeks) && typeof value.versionId === 'string' && value.versionId.length > 0 && Number.isInteger(value.n) && value.n > 0 && programmeSchemaIssues(value.definition).length === 0 && levels.includes(value.level)

// All clients in this app session share the cache namespace and its request ordering.
const denied = new Map<string, number>()
let generation = 0
const requestRealm = Math.random().toString(36).slice(2)
const latest = new Map<string, number>()
const authEpoch = new Map<string, number>()
const writes = new Map<string, Promise<void>>()

/** Cache is per server AND account. No authentication failure can unlock cached private content. */
export function createProgrammeLibrary(platform: Platform, accountId: () => string | null, timeoutMs = 15000, toast: (message: string) => void = () => {}) {
  const scope = () => {
    const uid = accountId()
    if (!uid) throw new LibraryError('Sign in to load the program library.', 'auth', 401)
    return JSON.stringify([platform.server.baseUrl(), uid])
  }
  const check = (owner: string) => { if (scope() !== owner) throw new LibraryError('The account or server changed. Try again.', 'scope-changed') }
  const key = (owner: string, item: string) => owner + ':' + item
  const read = async (owner: string, item: string) => {
    try { const raw = await platform.objects.get('library', key(owner, item)); return typeof raw === 'string' ? JSON.parse(raw) : null } catch { return null }
  }
  const write = async (owner: string, item: string, body: unknown) => {
    try { await platform.objects.put('library', key(owner, item), JSON.stringify(body)) } catch {
      try { toast('Could not save this program for offline use. The previous copy was kept.') } catch { /* online result remains usable */ }
    }
  }
  // Serialize each cache key, while allowing refusals to persist beside a slow body write.
  const ordered = (owner: string, item: string, body: unknown, current: () => boolean | Promise<boolean>) => {
    const target = key(owner, item)
    const pending = (writes.get(target) ?? Promise.resolve()).then(async () => {
      check(owner)
      if (await current()) await write(owner, item, body)
    })
    const settled = pending.catch(() => {})
    writes.set(target, settled)
    void settled.then(() => { if (writes.get(target) === settled) writes.delete(target) })
    return pending
  }
  const refusalStatus = (record: any): number | null => typeof record === 'number' ? record : record?.status ?? null
  const authStatus = async (owner: string, resource: string) => denied.get(key(owner, resource)) ?? refusalStatus(await read(owner, 'refused:' + resource))
  const refusalSnapshot = (owner: string, resource: string) => Promise.all(['auth', resource].map(target => read(owner, 'refused:' + target)))
  // Best effort across tabs: ObjectStore has no CAS. Keep a changed, newer or unstamped denial.
  const persistedCurrent = async (owner: string, resource: string, epoch: number, startedAt: number, prior: unknown[]) => {
    const records = await refusalSnapshot(owner, resource)
    return records.every((record, i) => {
      if (!refusalStatus(record)) return true
      if (typeof record?.requestId === 'string' && record.requestId.startsWith(requestRealm + ':')) {
        return Number(record.requestId.slice(requestRealm.length + 1)) < epoch
      }
      if (typeof record?.startedAt === 'number') return record.startedAt < startedAt
      // Legacy numeric refusals can only be cleared when observed before transport started.
      return JSON.stringify(record) === JSON.stringify(prior[i])
    })
  }
  const refuse = async (owner: string, resource: string, epoch: number, startedAt: number, error: unknown) => {
    if (error instanceof LibraryError && [401, 403].includes(error.status ?? 0)) {
      const target = error.status === 401 ? 'auth' : resource
      const epochs = target === 'auth' ? authEpoch : latest
      const epochKey = target === 'auth' ? owner : key(owner, resource)
      if ((epochs.get(epochKey) ?? 0) > epoch) return
      epochs.set(epochKey, epoch)
      denied.set(key(owner, target), error.status!)
      await ordered(owner, 'refused:' + target, { status: error.status, startedAt, requestId: requestRealm + ':' + epoch }, async () => {
        const prior = await read(owner, 'refused:' + target)
        return epochs.get(epochKey) === epoch && (!refusalStatus(prior) ||
          (typeof prior?.startedAt === 'number' && prior.startedAt <= startedAt) ||
          prior?.requestId === requestRealm + ':' + epoch)
      })
    }
  }
  const accepted = async (owner: string, resource: string, epoch: number, startedAt: number, prior: unknown[], bodies: [string, unknown][] = []) => {
    const stale = () => (latest.get(key(owner, resource)) ?? 0) > epoch ||
      ((authEpoch.get(owner) ?? 0) > epoch && denied.has(key(owner, 'auth')))
    if (stale() || !await persistedCurrent(owner, resource, epoch, startedAt, prior) || stale()) return
    const current = async () => latest.get(key(owner, resource)) === epoch && !stale() &&
      await persistedCurrent(owner, resource, epoch, startedAt, prior) && !stale()
    latest.set(key(owner, resource), epoch)
    denied.delete(key(owner, resource))
    const pending = bodies.map(([item, body]) => ordered(owner, item, body, current))
    pending.push(ordered(owner, 'refused:' + resource, null, current))
    if ((authEpoch.get(owner) ?? 0) <= epoch) {
      authEpoch.set(owner, epoch)
      denied.delete(key(owner, 'auth'))
      pending.push(ordered(owner, 'refused:auth', null, async () => authEpoch.get(owner) === epoch && await persistedCurrent(owner, 'auth', epoch, startedAt, [prior[0], prior[0]]) && authEpoch.get(owner) === epoch))
    }
    await Promise.all(pending)
  }
  const blocked = async (owner: string, resource: string) => await authStatus(owner, 'auth') || await authStatus(owner, resource)
  const request = async (path: string, headers?: Record<string, string>) => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        (async () => {
          const response = await platform.transport.fetch(path, { headers: { Accept: 'application/json', ...headers }, signal: controller.signal, cache: 'no-store' })
          if (response.status === 304) return { status: 304, body: null }
          if (!response.ok) throw new LibraryError('Could not load the program library.', 'http', response.status)
          let body: unknown
          try { body = await response.json() } catch { throw new LibraryError('The server returned invalid library data.', 'bad-response', response.status) }
          return { status: response.status, body }
        })(),
        new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new LibraryError('The library request timed out.', 'timeout')) }, timeoutMs) }),
      ])
    } finally { clearTimeout(timer) }
  }
  const unreachable = (error: unknown) => !(error instanceof LibraryError) || error.code === 'timeout'
  return {
    async list(): Promise<LibraryList> {
      const owner = scope(), epoch = ++generation, startedAt = Date.now(), cached = await read(owner, 'list')
      const prior = await refusalSnapshot(owner, 'list')
      check(owner)
      try {
        const response = await request('/api/programmes/library', listBody(cached) ? { 'If-None-Match': cached.etag } : undefined)
        check(owner)
        if (response.status === 304) {
          if (!listBody(cached)) throw new LibraryError('The library cache is missing.', 'bad-response', 304)
          await accepted(owner, 'list', epoch, startedAt, prior); check(owner)
          return cached
        }
        if (!listBody(response.body)) throw new LibraryError('The server returned invalid library data.', 'bad-response', response.status)
        await accepted(owner, 'list', epoch, startedAt, prior, [['list', response.body]]); check(owner)
        return response.body
      } catch (error) {
        check(owner)
        await refuse(owner, 'list', epoch, startedAt, error); check(owner)
        const refused = await blocked(owner, 'list'); check(owner)
        if (unreachable(error) && refused) throw new LibraryError('Sign in again to load the program library.', 'auth', refused)
        if (unreachable(error) && listBody(cached)) return cached
        throw error
      }
    },
    async get(id: string, version?: LibraryVersion): Promise<LibraryEntry> {
      const path = '/api/programmes/library/' + opaqueId(id) + (version !== undefined ? '?version=' + encodeURIComponent(String(version)) : '')
      const resource = 'definition:' + id
      const owner = scope(), epoch = ++generation, startedAt = Date.now(), item = 'entry:' + JSON.stringify([id, version === undefined ? 'head' : String(version)])
      const matches = (body: LibraryEntry) => version === undefined || body.versionId === version || (String(body.n) === String(version))
      const cached = await read(owner, item) ?? (version === undefined ? null : await read(owner, 'entry:' + JSON.stringify([id, 'head'])))
      const prior = await refusalSnapshot(owner, resource)
      check(owner)
      try {
        const response = await request(path); check(owner)
        if (!entryBody(response.body, id) || !matches(response.body)) throw new LibraryError('The server returned invalid library data.', 'bad-response', response.status)
        await accepted(owner, resource, epoch, startedAt, prior, [
          [item, response.body],
          ['entry:' + JSON.stringify([id, response.body.versionId]), response.body],
          ['entry:' + JSON.stringify([id, String(response.body.n)]), response.body],
        ]); check(owner)
        return response.body
      } catch (error) {
        check(owner)
        await refuse(owner, resource, epoch, startedAt, error); check(owner)
        const refused = await blocked(owner, resource); check(owner)
        if (unreachable(error)) {
          if (refused) throw new LibraryError('Sign in again to load the program library.', 'auth', refused)
          if (entryBody(cached, id) && matches(cached)) return cached
          throw new LibraryError('This program is not saved on this device. Connect to the server to activate it.', 'offline-uncached')
        }
        throw error
      }
    },
  }
}
