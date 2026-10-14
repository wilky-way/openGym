export type JsonMap = Record<string, unknown>;
export type ClockMap = Record<string, number>;
export type UndoMap = Record<string, number[]>;
export interface SyncEntry extends JsonMap {
  id?: string; d?: string; start?: number; end?: number | string; _ts?: number;
  _f?: ClockMap; _u?: UndoMap; t?: number; w?: number;
  entries?: SyncEntry[]; media?: JsonMap[];
}
/** Joined by max at; equal at chooses the lexicographically greater versionId. */
export interface ManifestEntry { versionId: string; at: number }
export interface SyncProgrammes extends SyncEntry {
  definitions?: SyncEntry[]; cycles?: SyncEntry[];
  offloaded?: Record<string, ManifestEntry>;
  /** A present definition referenced by an active/paused legacy-normalized cycle gets
   * {versionId: offloaded[id].versionId, at: offloaded[id].at + 1} if its install
   * marker is absent or no newer than the offload. Persists after terminal release
   * until an explicit later offload; reset drops markers at or before resetAt. */
  installed?: Record<string, ManifestEntry>;
}
