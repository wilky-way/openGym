// #261, differential: the server's copy of the note sync rules (legacy api/sync-stamps.js) treats the
// day-notes map the same way the client does. The legacy server import lives here, the only place
// the rewrite may import legacy/ besides the parity package.
import type { Legacy } from './legacy-shape'
import { describe, expect, it } from 'vitest'
// @ts-expect-error the legacy server is untyped JS; this differential test is its only importer
import * as Server from '../../../packages/parity/fixtures/oracle/api/sync-stamps.js'
import { highestStamp, STAMPED_MAPS } from '@opengym/core/sync-merge'

describe('day notes: server sync rules (differential)', () => {
  it('the server\'s sync rules know the map: same list, same highest stamp, never stamped as a setting', () => {
    expect(Server.STAMPED_MAPS).toEqual(STAMPED_MAPS)
    const doc = { _ts: 5, dayNotes: { '2026-10-01': { tag: 'sick', _ts: 77 } } }
    expect(Server.highestStamp(doc)).toBe(77)
    expect(highestStamp(doc)).toBe(77)
    // an older app (no stamps of its own) pushing over a copy with notes: the notes come back
    // from the stored copy, and no `edited.dayNotes` stamp is made up for them
    const cur = { _ts: 10, unit: 'kg', workouts: [], dayNotes: { '2026-10-01': { tag: 'sick', _ts: 9 } } }
    const next: Legacy = { _ts: 11, unit: 'kg', workouts: [], restSec: 60 }
    Server.stampPut(cur, next, { overRead: true, now: 20 })
    expect(next.dayNotes).toEqual(cur.dayNotes)
    expect(next.edited?.dayNotes).toBeUndefined()
  })
})
