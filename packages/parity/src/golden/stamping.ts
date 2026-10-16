import { expect, put, rawStored, revOf, type Ctx, type GoldenScenario } from './helpers'

const DATA = ['GET /api/data/rev', 'PUT /api/data']
const session = (id: string, d = '2026-09-01') => ({ id, d, name: 'Synthetic session', start: 1, end: 2, entries: [{ id: 'ex', sets: [{ r: 5, w: 20, done: true }] }] })

/** A writer that does not stamp (`stamped` absent) gets its removals, settings and omissions stamped on
 * the server (INV-36..41), and the server's bookkeeping never leaks to clients (INV-12, 17). */
export const stampingUnstampedWriter: GoldenScenario = {
  id: 'stamping-unstamped-writer', routes: DATA, invs: [12, 15, 16, 17, 18, 20, 21, 36, 37, 38, 39, 40, 41], seed: 20261005,
  async run(ctx: Ctx) {
    // INV-41: a stamped writer's document is stored as sent (apart from the joins the server always does).
    const seeded = await put(ctx, { stamped: true, baseRev: 0, state: { workouts: [session('w1'), session('w2')], routines: [], restSec: 90, unit: 'kg', futureTop: { z: 1 } } })
    expect(seeded.status === 200, 'stamped writer accepted')
    let raw = await rawStored(ctx)
    expect(raw?.workouts?.length === 2 && raw?.restSec === 90, 'stamped writer stored as sent (INV-41)')
    // INV-37 + INV-36 + INV-39: an unstamped writer that omits a key it could not have dropped gets it back;
    // its removal of w1 and its restSec change are stamped; a writer omitting `edited` entirely goes through.
    let rev = await revOf(ctx)
    const unstamped = await put(ctx, { baseRev: rev.rev, state: { workouts: [session('w2')], routines: [], restSec: 120 } })
    expect(unstamped.status === 200, 'unstamped writer with matching baseRev goes through (INV-39)')
    raw = await rawStored(ctx)
    expect(raw?.futureTop?.z === 1, 'unknown top-level key put back (INV-37)')
    const acknowledged = rev.rev + 1
    expect(JSON.parse(unstamped.body.data).rev === acknowledged && raw?._rev === rev.rev + 2, 'restored fields store +2 while acknowledging +1 (INV-15)')
    expect((await revOf(ctx)).rev === acknowledged + 1, 'next revision check exposes the restored document (INV-15)')
    expect((await put(ctx, { baseRev: acknowledged, state: { workouts: [], routines: [] } })).status === 409, 'push over the acknowledged revision must merge (INV-15)')
    expect(typeof raw?.deleted?.workouts?.w1 === 'number' && raw.deleted.workouts.w1 > 0, 'removal of w1 is stamped (INV-36)')
    expect(typeof raw?.edited?.restSec === 'number', 'settings change is stamped (INV-36)')
    expect(raw?._unstamped !== undefined, 'the unstamped writer leaves a fingerprint record (INV-40)')
    // INV-16: deleted never shrinks; a writer that omits `deleted` leaves w1's tombstone in place.
    rev = await revOf(ctx)
    expect((await put(ctx, { baseRev: rev.rev, state: { workouts: [session('w2')], routines: [], restSec: 120 } })).status === 200, 'unstamped repeat accepted')
    raw = await rawStored(ctx)
    expect(raw?.deleted?.workouts?.w1 !== undefined, 'tombstone never shrinks (INV-16)')
    // INV-12: _unstamped and _prior are never sent to clients, including on a 409.
    const stale = await put(ctx, { baseRev: 0, state: { workouts: [], routines: [] } })
    expect(stale.status === 409, 'stale baseRev is a conflict')
    const conflictText = Buffer.from(stale.body.data, 'utf8').toString()
    expect(!conflictText.includes('_unstamped') && !conflictText.includes('_prior'), 'server bookkeeping never leaves the server (INV-12)')
    // INV-17: edited never carries _wid/_wids, even from a stamped writer.
    rev = await revOf(ctx)
    expect((await put(ctx, { stamped: true, baseRev: rev.rev, state: { workouts: [session('w2')], routines: [], restSec: 120, edited: { restSec: 1, _wid: 'x', _wids: ['x'] } } })).status === 200, 'stamped writer with bookkeeping in edited accepted')
    raw = await rawStored(ctx)
    expect(raw?.edited && !('_wid' in raw.edited) && !('_wids' in raw.edited), 'edited never contains _wid/_wids (INV-17)')
    // INV-38: stale copy protection. The stale writer holds the copy it read before the stamped change, so
    // it sends its old edited stamp for restSec. A stamped writer then moves restSec to 60 with a newer stamp;
    // the stale copy still sends 120, which it previously held, and must not undo the newer value.
    const staleEdited = (await rawStored(ctx))?.edited
    rev = await revOf(ctx)
    const newer = (Number(staleEdited?.restSec) || 0) + 1000
    expect((await put(ctx, { stamped: true, baseRev: rev.rev, state: { workouts: [session('w2')], routines: [], restSec: 60, edited: { restSec: newer } } })).status === 200, 'stamped restSec change')
    rev = await revOf(ctx)
    expect((await put(ctx, { baseRev: rev.rev, state: { workouts: [session('w2')], routines: [], restSec: 120, edited: staleEdited } })).status === 200, 'stale unstamped copy accepted')
    raw = await rawStored(ctx)
    expect(raw?.restSec === 60, 'stored newer stamp beats the stale copy (INV-38)')
    // INV-40: the same unstamped writer changing the same field twice in a row keeps the second change.
    rev = await revOf(ctx)
    expect((await put(ctx, { baseRev: rev.rev, state: { workouts: [session('w2')], routines: [], restSec: 200 } })).status === 200, 'first change of restSec')
    rev = await revOf(ctx)
    expect((await put(ctx, { baseRev: rev.rev, state: { workouts: [session('w2')], routines: [], restSec: 210 } })).status === 200, 'second change of restSec')
    raw = await rawStored(ctx)
    expect(raw?.restSec === 210, 'second unstamped change is kept (INV-40)')
    // INV-20 / INV-21 / INV-18: a tombstone whose stamp is at least the entry's time keeps it removed; the
    // delete is stamped after the entry it removes.
    rev = await revOf(ctx)
    expect((await put(ctx, { baseRev: rev.rev, state: { workouts: [], routines: [], restSec: 210 } })).status === 200, 'remove w2 unstamped')
    raw = await rawStored(ctx)
    expect(raw?.deleted?.workouts?.w2 > 0, 'delete of w2 is stamped (INV-21)')
    rev = await revOf(ctx)
    expect((await put(ctx, { baseRev: rev.rev, state: { workouts: [session('w2')], routines: [], restSec: 210 } })).status === 200, 're-send w2 unstamped')
    raw = await rawStored(ctx)
    // keepHeld: the re-sent entry is kept, and its tombstone is re-marked as a negative add-back (INV-20).
    expect(raw?.workouts?.some((w: { id: string }) => w.id === 'w2'), 'held entry is kept (INV-20)')
    expect(raw?.deleted?.workouts?.w2 < 0, 'held tombstone is marked negative (INV-20)')
  }
}

/** A reset from an old writer is not refilled from the profile it wiped (INV-42, INV-13 with an unstamped writer). */
export const stampingResetUnstamped: GoldenScenario = {
  id: 'stamping-reset-unstamped', routes: DATA, invs: [42], seed: 20261006,
  async run(ctx: Ctx) {
    expect((await put(ctx, { stamped: true, baseRev: 0, state: { workouts: [session('old')], routines: [], restSec: 90 } })).status === 200, 'profile to be reset')
    const rev = await revOf(ctx)
    const reset = await put(ctx, { baseRev: rev.rev, state: { workouts: [], routines: [], restSec: 90, resetAt: 1000, resetIds: { workouts: ['old'] } } })
    expect(reset.status === 200, 'unstamped reset accepted')
    const raw = await rawStored(ctx)
    expect(raw?.workouts?.length === 0, 'a reset is not refilled from the wiped profile (INV-42)')
    expect(raw?.resetAt === 1000, 'reset stamp stored (INV-13)')
  }
}

export const stampingScenarios: GoldenScenario[] = [stampingUnstampedWriter, stampingResetUnstamped]
