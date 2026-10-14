import { randomBytes } from 'node:crypto'
import type { Database } from 'bun:sqlite'
import { highestStamp } from '@opengym/core/server-stamp'
import { offloadInputs } from '@opengym/core/programme-offload'
import type { SyncProgrammes } from '@opengym/core/sync-types'
import { LIMITS } from '@opengym/contract/http/api'
import { assertStateDepth } from '../data'
import { readStateDoc, commitStateDoc } from '../storage/state'
import { setMeta, getMeta } from '../storage/repos'
import { writeStateMirror } from '../storage/mirror'
import { definitionInUse, canonicalJson, libraryVersionId, getLibraryEntry, listLibrary, putLibraryEntry, assertLibraryId } from '../storage/library'
import { openMigration, record } from './importer'
import type { MigrationOptions } from './safety'

const SAFE_BYTES = Math.floor(4.5 * 1024 * 1024)
function state(db: Database, id?: string): { id: string; doc: Record<string, unknown> } {
  if (!id) throw new Error('--profile required')
  const row = readStateDoc(db, id)
  if (!row) throw new Error('profile has no state')
  return { id, doc: record(JSON.parse(row.json)) }
}
function definitions(p: Record<string, unknown>): Record<string, unknown>[] {
  if (p.definitions === undefined) return []
  if (!Array.isArray(p.definitions)) throw new Error('malformed definitions')
  const seen = new Set<string>()
  return p.definitions.map(v => {
    const d = record(v)
    if (typeof d.id !== 'string' || seen.has(d.id)) throw new Error('duplicate or invalid definition id')
    assertLibraryId(d.id); seen.add(d.id); return d
  })
}
function clock(doc: Record<string, unknown>, now: number): number {
  const t = Math.max(now, highestStamp(doc) + 1)
  if (!Number.isSafeInteger(t) || t >= Number.MAX_SAFE_INTEGER) throw new Error('causal clock exhausted')
  return t
}
function seal(doc: Record<string, unknown>, t: number): void {
  const rev = Number(doc._rev ?? 0) + 1
  if (!Number.isSafeInteger(rev)) throw new Error('revision exhausted')
  const previousWid = typeof doc._wid === 'string' ? doc._wid : null
  doc._rev = rev; doc._ts = t; doc._wid = randomBytes(16).toString('hex')
  doc._wids = [...(Array.isArray(doc._wids) ? doc._wids.filter(w => typeof w === 'string') : []), ...(previousWid ? [previousWid] : [])].slice(-50)
  assertStateDepth(doc)
}
function sizes(doc: Record<string, unknown>) {
  const text = JSON.stringify(doc), bytes = Buffer.byteLength(text)
  const requestBytes = Buffer.byteLength(JSON.stringify({ state: doc, rev: doc._rev, stamped: true }))
  return { text, bytes, requestBytes, fits: bytes <= SAFE_BYTES && requestBytes <= LIMITS.maxBodyBytes }
}
function mirror(db: Database, data: string, id: string): string | null {
  try { writeStateMirror(db, data, id); setMeta(db, `mirror_stale:${id}`, '0'); return null }
  catch { setMeta(db, `mirror_stale:${id}`, '1'); return 'state mirror stale; run rollback:prepare before rollback' }
}
export function offloadLibrary(options: MigrationOptions) {
  const { db, data } = openMigration(options, true)
  try {
    const run = () => {
      const { id, doc } = state(db, options.profile), p = doc.programmes === undefined ? {} : record(doc.programmes)
      const defs = definitions(p), moved = defs.filter(d => !definitionInUse(doc, d.id as string))
      const protectedIds = defs.filter(d => definitionInUse(doc, d.id as string)).map(d => d.id)
      if (!moved.length) return { dryRun: !options.apply, moved: [], protectedIds, bytes: sizes(doc).bytes, mirrorWarning: null }
      const t = clock(doc, options.now ?? Date.now())
      const manifests = { ...(p.offloaded === undefined ? {} : record(p.offloaded)) }
      const movedReport = moved.map(d => {
        const did = d.id as string, versionId = libraryVersionId(canonicalJson(d))
        {
          const current = getLibraryEntry(db, id, did)
          const entry = putLibraryEntry(db, id, did, { definition: d, expectedVersionId: current?.versionId ?? null, minLevel: 'Invalid', origin: 'migration', now: options.now })
          if (libraryVersionId(canonicalJson(entry.definition)) !== versionId) throw new Error('library content verification failed')
          const saved = getLibraryEntry(db, id, did, entry.versionId)
          if (!saved || libraryVersionId(canonicalJson(saved.definition)) !== versionId) throw new Error('library read-back verification failed')
          setMeta(db, `offload_original:${id}:${did}:${versionId}`, JSON.stringify(d))
          if (getMeta(db, `offload_original:${id}:${did}:${versionId}`) !== JSON.stringify(d)) throw new Error('offload original byte verification failed')
        }
        Object.defineProperty(manifests, did, { value: { versionId, at: t }, enumerable: true, configurable: true, writable: true })
        return { id: did, versionId, bytes: Buffer.byteLength(JSON.stringify(d)) }
      })
      const movedIds = new Set(movedReport.map(d => d.id))
      doc.programmes = { ...p, offloaded: manifests, definitions: defs.filter(d => !movedIds.has(d.id as string)) }
      // Consume the same authoritative helper as both sync engines.
      const [filtered] = offloadInputs(doc.programmes as SyncProgrammes, null)
      doc.programmes = filtered
      seal(doc, t)
      const size = sizes(doc)
      if (size.bytes > LIMITS.maxBodyBytes) throw new Error('offloaded state exceeds cap')
      if (options.apply) {
        const prior: unknown = JSON.parse(getMeta(db, `offload_order:${id}`) ?? '[]')
        const order = Array.isArray(prior) ? prior.filter((v): v is string => typeof v === 'string') : []
        setMeta(db, `offload_order:${id}`, JSON.stringify([...new Set([...order, ...defs.map(d => d.id as string)])]))
        setMeta(db, 'offload_rule', '1')
        commitStateDoc(db, id, size.text, t, 30)
      }
      return { dryRun: !options.apply, moved: movedReport, protectedIds, bytes: size.bytes, mirrorWarning: null as string | null }
    }
    const report = db.transaction(run).immediate()
    if (options.apply && report.moved.length) report.mirrorWarning = mirror(db, data, options.profile!)
    return report
  } finally { db.close() }
}
export function reinstallLibrary(options: MigrationOptions) {
  const { db, data } = openMigration(options, true)
  try {
    const run = () => {
      const { id, doc } = state(db, options.profile), p = doc.programmes === undefined ? {} : record(doc.programmes)
      const manifest = p.offloaded === undefined ? {} : record(p.offloaded)
      const manifestIds = Object.keys(manifest)
      const newIds = listLibrary(db, id).items.map(d => d.id).filter(did => !Object.hasOwn(manifest, did) && !definitions(p).some(d => d.id === did))
      const t = clock(doc, options.now ?? Date.now())
      function expanded(originals: boolean, includeNew: boolean) {
        const next = structuredClone(doc), programmes = next.programmes === undefined ? {} : record(next.programmes)
        const existing = definitions(programmes), byId = new Map(existing.map(d => [d.id as string, d]))
        const installed = { ...(programmes.installed === undefined ? {} : record(programmes.installed)) }
        const installedIds: string[] = [], changedHeads: { id: string; versionId: string; originalVersionId: string }[] = []
        for (const did of [...manifestIds, ...(includeNew ? newIds : [])]) {
          const marker = Object.hasOwn(manifest, did) ? record(manifest[did]) : null
          const version = originals && marker ? String(marker.versionId) : undefined
          const entry = getLibraryEntry(db, id, did, version)
          if (!entry) throw new Error('missing library version: ' + did)
          // Preserve definitions reinstalled/edited since offload and any in-use definition.
          if (!byId.has(did)) {
            const original = marker && entry.versionId === marker.versionId ? getMeta(db, `offload_original:${id}:${did}:${entry.versionId}`) : null
            if (original && libraryVersionId(canonicalJson(JSON.parse(original))) !== entry.versionId) throw new Error('offload original fingerprint mismatch')
            byId.set(did, original ? record(JSON.parse(original)) : record(entry.definition)); installedIds.push(did)
            if (marker && entry.versionId !== marker.versionId) changedHeads.push({ id: did, versionId: entry.versionId, originalVersionId: String(marker.versionId) })
          }
          const priorInstalled = Object.hasOwn(installed, did) ? record(installed[did]) : null
          const installAt = Math.max(Number(marker?.at ?? 0), Number(priorInstalled?.at ?? 0)) + 1
          if (!Number.isSafeInteger(installAt) || installAt > Number.MAX_SAFE_INTEGER) throw new Error('install clock exhausted')
          Object.defineProperty(installed, did, { value: { versionId: entry.versionId, at: installAt }, enumerable: true, configurable: true, writable: true })
        }
        const order: unknown = JSON.parse(getMeta(db, `offload_order:${id}`) ?? '[]')
        const ordered = Array.isArray(order) ? order.filter((v): v is string => typeof v === 'string' && byId.has(v)) : []
        const seen = new Set(ordered)
        programmes.definitions = [...ordered.map(did => byId.get(did)!), ...[...byId].filter(([did]) => !seen.has(did)).map(([, d]) => d)]
        programmes.installed = installed; next.programmes = programmes
        seal(next, t)
        return { next, installedIds, changedHeads, ...sizes(next) }
      }
      let originals = !!options.originals
      let result = expanded(originals, !!options.includeNew)
      let fallback = false
      if (!result.fits && !originals) { originals = true; fallback = true; result = expanded(true, false) }
      if (!result.fits) throw new Error('reinstall exceeds rollback budget; keep the new server and fix forward')
      if (options.apply && manifestIds.length + (options.includeNew ? newIds.length : 0) > 0) {
        commitStateDoc(db, id, result.text, t, 30)
        setMeta(db, 'offload_rule', '0')
      }
      return { dryRun: !options.apply, installedIds: result.installedIds, changedHeads: result.changedHeads, newLibraryOnly: newIds, originals, fallback, bytes: result.bytes, requestBytes: result.requestBytes, mirrorWarning: null as string | null }
    }
    const report = db.transaction(run).immediate()
    if (options.apply) report.mirrorWarning = mirror(db, data, options.profile!)
    return report
  } finally { db.close() }
}
