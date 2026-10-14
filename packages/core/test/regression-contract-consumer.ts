import type { StateDoc } from '../../contract/domain/state-doc'
import type { SyncEntry } from '../src/sync-types'
import { queueOf } from '../src/queue'
import { programmeStamp, type StampEntry } from '../src/programme-sync'
// Compile-time interoperability: full stored documents and optional-field
// sync callback shapes must work with the tolerant core helpers.
export const queueFromContract = (doc: StateDoc) => queueOf(doc)
export const clockFromContract = (doc: StateDoc) => programmeStamp(doc)
export const sharedStamp: StampEntry = (_old: SyncEntry, next: SyncEntry, now: number) => { next._ts = now }
