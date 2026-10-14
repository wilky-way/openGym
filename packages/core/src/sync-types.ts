/** Internal views of legacy JSON. Unknown extension fields round-trip without validation. */
export type JsonMap = Record<string, unknown>
export type ClockMap = Record<string, number>
export type UndoMap = Record<string, number[]>
export interface SyncEntry extends JsonMap {
  id?: string
  d?: string
  start?: number
  end?: number | string
  _ts?: number
  _f?: ClockMap
  _u?: UndoMap
  t?: number
  w?: number
  entries?: SyncEntry[]
  media?: JsonMap[]
}
export interface SyncDoc extends JsonMap {
  _ts?: number
  resetAt?: number
  resetIds?: Record<string, string[]>
  unit?: string
  unitSet?: { at?: number; convert?: boolean }
  edited?: ClockMap
  undone?: UndoMap
  deleted?: Record<string, ClockMap>
  workouts?: SyncEntry[]
  routines?: SyncEntry[]
  customEx?: SyncEntry[]
  equipProfiles?: SyncEntry[]
  gymCards?: SyncEntry[]
  bodyweight?: SyncEntry[]
  measurements?: SyncEntry[]
  favEx?: string[]
  exWeights?: Record<string, SyncEntry>
  programmes?: SyncProgrammes
  dayNotes?: JsonMap
}
export interface SyncProgrammes extends SyncEntry {
  definitions?: SyncEntry[]
  cycles?: SyncEntry[]
  offloaded?: Record<string, ManifestEntry>
  installed?: Record<string, ManifestEntry>
}
export interface ManifestEntry { versionId: string; at: number }
export const map = (v: unknown): JsonMap => v as JsonMap
export const entries = (v: unknown): SyncEntry[] => Array.isArray(v) ? v : []
