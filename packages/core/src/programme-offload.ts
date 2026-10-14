import type { ManifestEntry, SyncEntry, SyncProgrammes } from './sync-types'

type Manifest = Record<string, ManifestEntry>
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const marker = (v: unknown, offloaded: boolean): v is ManifestEntry =>
  object(v) && typeof v.versionId === 'string' && typeof v.at === 'number'
  && Number.isSafeInteger(v.at) && (!offloaded || v.at < Number.MAX_SAFE_INTEGER)
const list = (v: unknown): SyncEntry[] => Array.isArray(v) ? v : []
// Match legacy normaliseProgrammes: only the first nonempty string id is a cycle.
const cycles = (v: unknown): SyncEntry[] => {
  const seen = new Set<string>()
  return list(v).filter(c => {
    if (!object(c) || typeof c.id !== 'string' || !c.id || seen.has(c.id)) return false
    seen.add(c.id)
    return true
  })
}

/** Authoritative manifests join by clock; equal clocks choose the larger versionId deterministically. */
function join(a: unknown, b: unknown, offloaded = false): Manifest | undefined {
  if (!object(a) && !object(b)) return undefined
  const out = new Map<string, ManifestEntry>()
  for (const input of [a, b]) {
    if (!object(input)) continue
    for (const [id, value] of Object.entries(input)) {
      if (!marker(value, offloaded)) continue
      const entry = { ...value, versionId: value.versionId, at: value.at }
      const previous = out.get(id)
      if (!previous || (entry.at > previous.at || entry.at === previous.at && entry.versionId > previous.versionId)) out.set(id, entry)
    }
  }
  return Object.fromEntries(out)
}

/** Filters BOTH programme inputs before legacy stamping/union. It never uses definition _ts. */
export function offloadInputs(a: SyncProgrammes | null | undefined, b: SyncProgrammes | null | undefined): [SyncProgrammes | null | undefined, SyncProgrammes | null | undefined] {
  const offloaded = join(a?.offloaded, b?.offloaded, true)
  let installed = join(a?.installed, b?.installed)
  if (!offloaded && !installed) return [a, b]
  const inUse = new Set([...cycles(a?.cycles), ...cycles(b?.cycles)]
    .filter(c => c.status === 'active' || c.status === 'paused').map(c => c.programmeId))
  // compatibility policy: protection is an explicit install, so terminal release cannot re-offload.
  // The offloaded version and its clock + 1 are identical on client and server; no wall clock.
  for (const d of [...list(a?.definitions), ...list(b?.definitions)]) {
    if (!d?.id || !inUse.has(d.id) || !offloaded || !Object.hasOwn(offloaded, d.id)) continue
    const off = offloaded[d.id]!
    const install = installed && Object.hasOwn(installed, d.id) ? installed[d.id] : undefined
    if (install && install.at > off.at) continue
    installed = { ...installed, [d.id]: { versionId: off.versionId, at: off.at + 1 } }
  }
  const keep = (d: SyncEntry) => {
    const off = d?.id && offloaded && Object.hasOwn(offloaded, d.id) ? offloaded[d.id] : undefined
    const install = d?.id && installed && Object.hasOwn(installed, d.id) ? installed[d.id] : undefined
    return !off || inUse.has(d.id) || (!!install && install.at > off.at)
  }
  const filter = (p: SyncProgrammes | null | undefined): SyncProgrammes => ({
    ...(p || {}),
    ...(offloaded ? { offloaded } : {}),
    ...(installed ? { installed } : {}),
    definitions: list(p?.definitions).filter(keep),
  })
  return [filter(a), filter(b)]
}

/** A stale copy contributes only manifests newer than Reset, independently of reset id lists. */
export function resetOffload<T extends SyncProgrammes>(p: T, resetAt: number): T {
  if (!(resetAt > 0)) return p
  const out = { ...p }
  for (const key of ['offloaded', 'installed'] as const) {
    if (!object(p[key])) continue
    out[key] = Object.fromEntries(Object.entries(p[key]).filter(([, v]) => marker(v, key === 'offloaded') && v.at > resetAt))
  }
  return out
}

/** The causal clock also sees offload/install markers once the new rule is present. */
export function offloadStamp(p: SyncProgrammes | null | undefined): number {
  let at = 0
  for (const [manifest, offloaded] of [[p?.offloaded, true], [p?.installed, false]] as const) {
    if (!object(manifest)) continue
    for (const value of Object.values(manifest)) {
      if (marker(value, offloaded)) at = Math.max(at, value.at)
    }
  }
  return at
}
