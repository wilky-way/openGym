import type { StoreDocument } from './useStore'
import { entryKey } from '@opengym/core/sync-merge'

import type { WorkoutJournalStorage } from '@opengym/contract/platform/adapters'
export type { WorkoutJournalStorage } from '@opengym/contract/platform/adapters'

/** Separate from reclaimable media/library caches. Never evict an unacknowledged session. */
export interface JournalSession {id?: string; start?: number; key: string; editor?: string; incarnation?: string}
export const journalSession = (session: any): JournalSession => ({id:session?.id,start:session?.start,key:session?.key ?? entryKey('workouts',session),
  ...((session?.editor ?? session?.editingWorkoutId) ? {editor:session.editor ?? session.editingWorkoutId,incarnation:session.incarnation ?? session.editBase?.sheetInstanceId} : {})})
const identity = (session: any) => { const s=journalSession(session); return s.editor ? [s.id,s.start,s.editor,s.incarnation] : [s.id,s.start] }
export const sameJournalSession = (a: any,b: any) => !!a && !!b && JSON.stringify(identity(a)) === JSON.stringify(identity(b))
export interface WorkoutJournalRecord {
  scope: string
  baseline: string
  baselineKind?: 'session-v1'
  at: number
  active: any
  finished: any
  ts: number
  /** A consumed/discarded session must not reopen from an older primary copy. */
  session?: JournalSession
  previousFinished?: string
  closed?: JournalSession & {deletedAt?: number}
}
export function workoutJournal(objects: WorkoutJournalStorage | undefined) {
  let queue: Promise<unknown> = Promise.resolve()
  const run = <T,>(action: () => Promise<T>): Promise<T> => {
    const next = queue.then(action, action)
    queue = next.catch(() => {})
    return next
  }
  const matches = sameJournalSession
  const keyOf = (scope: string, session: any) => JSON.stringify([scope, ...identity(session)])
  const primaryHas = (state: StoreDocument, session: any) => matches(state.active,session) || state.workouts?.some((w: any) => matches(w,session))
  return {
    remove(scope: string, session: any) { return run(() => objects!.delete(keyOf(scope,session))) },
    pruneClosed(scope: string, primary: StoreDocument) {
      return run(async () => {
        for (const [key, raw] of await objects!.receipts()) {
          const record: WorkoutJournalRecord = JSON.parse(raw), closed = record.closed
          if (record.scope !== scope || !closed || matches(primary.active,closed)) continue
          if (closed.deletedAt && (primaryHas(primary,closed) || !(Number(primary.deleted?.workouts?.[closed.key]) >= closed.deletedAt))) continue
          await objects!.delete(key,raw)
        }
      })
    },
    write(record: WorkoutJournalRecord) {
      const session = record.session || record.active || record.finished || record.closed
      const key = keyOf(record.scope,session)
      return run(async () => {
        if (await objects!.put(key,JSON.stringify(record)) === false) throw new Error('Recovery record was superseded by a closed session')
      })
    },
    records() {
      return run(async () => {
        const records: [string, WorkoutJournalRecord][] = []
        for (const key of await objects!.keys()) {
          try {
            const raw = await objects!.get(key)
            if (typeof raw === 'string') records.push([key, JSON.parse(raw)])
          } catch { /* preserve unreadable records */ }
        }
        for (const [key, raw] of await objects!.receipts()) {
          try { records.push([key, JSON.parse(raw)]) } catch { /* preserve unreadable receipts */ }
        }
        return records.sort((a, b) => a[1].at - b[1].at)
      })
    },
    acknowledge(scope: string, sent: StoreDocument, primary: StoreDocument | null) {
      return run(async () => {
        for (const key of await objects!.keys()) {
          const raw = await objects!.get(key)
          if (typeof raw !== 'string') continue
          const record: WorkoutJournalRecord = JSON.parse(raw)
          // Only the exact completed session acknowledged by a PUT may be reclaimed.
          if (record.scope === scope && record.finished && sent.workouts?.some((w: any) => JSON.stringify(w) === JSON.stringify(record.finished))) {
            if (primary && !matches(primary.active,record.session || record.finished)) await objects!.delete(key,raw)
            else {
              const closed = record.session || journalSession(record.finished)
              await objects!.put(key,JSON.stringify({...record,active:null,finished:null,closed}))
            }
          }
        }
      })
    },
    flush: () => queue,
  }
}
