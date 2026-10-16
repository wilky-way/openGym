import { isDeepStrictEqual } from 'node:util'
import { expect, put, rawStored, revOf, type Ctx, type GoldenScenario } from './helpers'

const DATA = ['GET /api/data/rev', 'PUT /api/data']
const cycle = (id: string, status = 'pending') => ({ id, occurrences: [
  { instanceId: `${id}-one`, status: 'pending', setTargets: [{ reps: 5, tm: 80 }] },
  { instanceId: `${id}-two`, status: 'pending', setTargets: [{ reps: 8, tm: 70 }] }
], status })
const programmes = (cycles: unknown[], definitions: unknown[] = [{ id: 'synthetic' }]) => ({ version: 1, fork: 'wilky/1', definitions, cycles })
const occ = (raw: Record<string, any> | null, i = 0) => raw?.programmes?.cycles?.[0]?.occurrences?.[i]
const state = (extra: Record<string, unknown> = {}) => ({ workouts: [], routines: [], ...extra })

/** Omitting programmes never wipes them, on a stamped or unstamped writer (INV-43). */
export const progOmitKeeps: GoldenScenario = {
  id: 'programmes-omit-keeps', routes: DATA, invs: [43], seed: 20261020,
  async run(ctx: Ctx) {
    expect((await put(ctx, { stamped: true, baseRev: 0, state: state({ programmes: programmes([cycle('c')]) }) })).status === 200, 'programme block stored')
    // The server keeps content, not bytes: it may reorder keys inside a cycle, so compare parsed values.
    const before = structuredClone((await rawStored(ctx))?.programmes)
    let rev = await revOf(ctx)
    expect((await put(ctx, { baseRev: rev.rev, state: state() })).status === 200, 'unstamped writer omits programmes')
    expect(isDeepStrictEqual((await rawStored(ctx))?.programmes, before), 'omitted programmes are never wiped (INV-43)')
    rev = await revOf(ctx)
    expect((await put(ctx, { stamped: true, baseRev: rev.rev, state: state() })).status === 200, 'stamped writer omits programmes')
    expect(isDeepStrictEqual((await rawStored(ctx))?.programmes, before), 'omitted programmes survive a stamped writer too (INV-43)')
  }
}

/** Per-occurrence merge with independent clocks; a finished workout beats a skip; deleting the log reverts it (INV-44, 45). */
export const progOccurrenceMerge: GoldenScenario = {
  id: 'programmes-occurrence-merge', routes: DATA, invs: [44, 45], seed: 20261021,
  async run(ctx: Ctx) {
    expect((await put(ctx, { stamped: true, baseRev: 0, state: state({ programmes: programmes([cycle('c')]) }) })).status === 200, 'cycle stored')
    // An unstamped planner skips occurrence one; a stamped device pins occurrence two independently.
    let rev = await revOf(ctx)
    const skipped = JSON.parse(JSON.stringify(programmes([cycle('c')])))
    skipped.cycles[0].occurrences[0].status = 'skipped'
    expect((await put(ctx, { baseRev: rev.rev, state: state({ programmes: skipped }) })).status === 200, 'planner skips one occurrence')
    rev = await revOf(ctx)
    const pinned = JSON.parse(JSON.stringify(programmes([cycle('c')])))
    pinned.cycles[0].occurrences[1].pinnedOn = '2026-10-16'
    expect((await put(ctx, { stamped: true, baseRev: rev.rev, state: state({ programmes: pinned }) })).status === 200, 'stamped device pins occurrence two')
    expect(occ(await rawStored(ctx), 0)?.status === 'skipped', 'skip kept (INV-45)')
    expect(occ(await rawStored(ctx), 1)?.pinnedOn === '2026-10-16', 'pin kept with its own clock (INV-45)')
    // INV-44: a finished workout linked to occurrence one beats the skip and marks it done with the date.
    rev = await revOf(ctx)
    const log = { id: 'log', d: '2026-10-12', name: 'Synthetic session', start: 1, end: 2, entries: [], programmeInstance: { cycleId: 'c', instanceId: 'c-one' } }
    expect((await put(ctx, { baseRev: rev.rev, state: state({ workouts: [log], programmes: programmes([cycle('c')]) }) })).status === 200, 'finished workout logged')
    expect(occ(await rawStored(ctx), 0)?.status === 'done', 'finished workout beats the skip (INV-44)')
    expect(occ(await rawStored(ctx), 0)?.date === '2026-10-12', 'done occurrence records the date (INV-44)')
    // Deleting the log reverts done → pending and clears the date (INV-44).
    rev = await revOf(ctx)
    expect((await put(ctx, { baseRev: rev.rev, state: state({ programmes: programmes([cycle('c')]) }) })).status === 200, 'log deleted')
    expect(occ(await rawStored(ctx), 0)?.status === 'pending', 'deleting the log reverts done to pending (INV-44)')
    expect(occ(await rawStored(ctx), 0)?.date === undefined, 'deleting the log clears the date (INV-44)')
  }
}

/** A reset cannot resurrect programme ids from the writer that held them (INV-46). */
export const progResetNoResurrect: GoldenScenario = {
  id: 'programmes-reset-no-resurrect', routes: DATA, invs: [46], seed: 20261022,
  async run(ctx: Ctx) {
    expect((await put(ctx, { stamped: true, baseRev: 0, state: state({ programmes: programmes([cycle('c')], [{ id: 'synthetic' }]) }) })).status === 200, 'programme stored')
    let rev = await revOf(ctx)
    expect((await put(ctx, { stamped: true, baseRev: rev.rev, state: state({ programmes: programmes([cycle('c')], [{ id: 'synthetic' }]), resetAt: 500, resetIds: { programmeDefinitions: ['synthetic'], programmeCycles: ['c'] } }) })).status === 200, 'reset wipes programmes')
    rev = await revOf(ctx)
    // The stale writer still holds the reset programme and pushes it back.
    expect((await put(ctx, { baseRev: rev.rev, state: state({ programmes: programmes([cycle('c')], [{ id: 'synthetic' }]) }) })).status === 200, 'stale writer pushes the reset programme back')
    const raw = await rawStored(ctx)
    expect(!raw?.programmes?.definitions?.some((d: { id: string }) => d.id === 'synthetic'), 'reset definition is not resurrected (INV-46)')
    expect(!raw?.programmes?.cycles?.some((c: { id: string }) => c.id === 'c'), 'reset cycle is not resurrected (INV-46)')
  }
}

/** At most one running cycle after a merge; the loser is archived with an activationConflict (INV-47). */
export const progSingleRunning: GoldenScenario = {
  id: 'programmes-single-running', routes: DATA, invs: [47], seed: 20261023,
  async run(ctx: Ctx) {
    expect((await put(ctx, { stamped: true, baseRev: 0, state: state({ programmes: programmes([cycle('a', 'active')]) }) })).status === 200, 'first running cycle stored')
    const rev = await revOf(ctx)
    expect((await put(ctx, { baseRev: rev.rev, state: state({ programmes: programmes([cycle('a', 'active'), cycle('b', 'active')]) }) })).status === 200, 'second running cycle written')
    const cycles = (await rawStored(ctx))?.programmes?.cycles as { id: string; status: string; activationConflict?: unknown }[]
    expect(cycles.filter(c => c.status === 'active' || c.status === 'paused').length <= 1, 'at most one running cycle (INV-47)')
    expect(cycles.some(c => c.activationConflict !== undefined), 'loser archived with activationConflict (INV-47)')
  }
}

/** An unstamped writer's stale copy restores a cycle field it omits, with the newer stored clock (INV-48, PS:95),
 * and authored prescription fields survive a writer that omits them (INV-49). */
export const progRestoreFields: GoldenScenario = {
  id: 'programmes-restore-fields', routes: DATA, invs: [48, 49], seed: 20261024,
  async run(ctx: Ctx) {
    expect((await put(ctx, { stamped: true, baseRev: 0, state: state({ programmes: programmes([cycle('c')]) }) })).status === 200, 'cycle stored')
    // A stamped device moves weekIndex with its own clock (200).
    let rev = await revOf(ctx)
    const newer = JSON.parse(JSON.stringify(programmes([cycle('c')])))
    Object.assign(newer.cycles[0], { weekIndex: 5, _ts: 200, _f: { weekIndex: 200 } })
    expect((await put(ctx, { stamped: true, baseRev: rev.rev, state: state({ programmes: newer }) })).status === 200, 'stamped device sets weekIndex')
    // The stale unstamped copy (older clock 100) omits weekIndex and must not drop it.
    rev = await revOf(ctx)
    const stale = JSON.parse(JSON.stringify(programmes([cycle('c')])))
    Object.assign(stale.cycles[0], { _ts: 100, _f: { status: 100 } })
    expect((await put(ctx, { baseRev: rev.rev, state: state({ programmes: stale }) })).status === 200, 'stale unstamped copy accepted')
    const cyc = (await rawStored(ctx))?.programmes?.cycles?.[0]
    expect(cyc?.weekIndex === 5, 'omitted newer cycle field restored with its value (INV-48)')
    expect(cyc?._f?.weekIndex === 200, 'restored field keeps the newer clock (INV-48)')
    // INV-49: authored prescription fields of a snapshot's routine survive a writer that omits them.
    const snapshot = (ex: unknown[]) => ({ weeks: [{ weekId: 'w1', days: [{ key: 'd1', sessions: [{ sessionTemplateId: 't1', routineSnapshot: { ex } }] }] }] })
    // Authored fields are kept per matching slot of an open exercise (sync-stamps retainAuthoredExercises).
    const authored = [{ id: 'e1', slotId: 'pick', open: true, label: 'Synthetic pick', instructions: 'Stay tight', sets: 2, setTargets: [{ reps: 5, tm: 80 }, { reps: 5, tm: 82.5 }] }]
    rev = await revOf(ctx)
    // The stamped cycle carries a newer clock; an untimed cycle loses the merge to the stored one.
    const withSnap = JSON.parse(JSON.stringify(programmes([{ ...cycle('c'), _ts: 300, _f: { snapshot: 300 }, snapshot: snapshot(authored) }])))
    expect((await put(ctx, { stamped: true, baseRev: rev.rev, state: state({ programmes: withSnap }) })).status === 200, 'snapshot with authored prescription stored')
    rev = await revOf(ctx)
    const bareSnap = JSON.parse(JSON.stringify(programmes([{ ...cycle('c'), snapshot: snapshot([{ id: 'e1', slotId: 'pick', sets: 2 }]) }])))
    expect((await put(ctx, { baseRev: rev.rev, state: state({ programmes: bareSnap }) })).status === 200, 'writer omits the prescription fields')
    const kept = (await rawStored(ctx))?.programmes?.cycles?.[0]?.snapshot?.weeks?.[0]?.days?.[0]?.sessions?.[0]?.routineSnapshot?.ex?.[0]
    expect(JSON.stringify(kept?.setTargets) === JSON.stringify([{ reps: 5, tm: 80 }, { reps: 5, tm: 82.5 }]) && kept?.instructions === 'Stay tight', 'authored prescription survives an omitting writer (INV-49)')
    // Changing only the row count must grow by repeating the final target, then trim the tail.
    for (const [sets, targets] of [
      [4, [{ reps: 5, tm: 80 }, { reps: 5, tm: 82.5 }, { reps: 5, tm: 82.5 }, { reps: 5, tm: 82.5 }]],
      [1, [{ reps: 5, tm: 80 }]]
    ] as const) {
      rev = await revOf(ctx)
      const resized = programmes([{ ...cycle('c'), snapshot: snapshot([{ id: 'e1', slotId: 'pick', sets }]) }])
      expect((await put(ctx, { baseRev: rev.rev, state: state({ programmes: resized }) })).status === 200, `set count resized to ${sets}`)
      const exercise = (await rawStored(ctx))?.programmes?.cycles?.[0]?.snapshot?.weeks?.[0]?.days?.[0]?.sessions?.[0]?.routineSnapshot?.ex?.[0]
      expect(exercise?.sets === sets && isDeepStrictEqual(exercise?.setTargets, targets), `exact retained targets after resize to ${sets} (INV-49)`)
    }
  }
}

/** A routine owned by an archived cycle that the active cycle still schedules is reassigned to the active
 * cycle on write (reconcileProgrammeOwnership, the staleRoutine branch). */
export const progRoutineOwnership: GoldenScenario = {
  id: 'programmes-routine-ownership', routes: ['PUT /api/data'], invs: [], seed: 20261025,
  async run(ctx: Ctx) {
    const cycles = [
      { id: 'old', status: 'archived', occurrences: [{ instanceId: 'o1', routineId: 'r1', status: 'done' }] },
      { id: 'new', status: 'active', occurrences: [{ instanceId: 'n1', routineId: 'r1', status: 'pending' }] }
    ]
    const routines = [{ id: 'r1', name: 'Synthetic routine', ex: [], programme: { cycleId: 'old', series: 's1' } }]
    expect((await put(ctx, { stamped: true, baseRev: 0, state: state({ routines, programmes: { version: 1, fork: 'wilky/1', definitions: [{ id: 'synthetic' }], cycles } }) })).status === 200, 'archived cycle still owns the routine')
    const raw = await rawStored(ctx)
    const owned = (raw?.routines as { id: string; programme?: { cycleId: string } }[] | undefined)?.find(r => r.id === 'r1')
    expect(owned?.programme?.cycleId === 'new', 'routine reassigned to the active cycle that schedules it')
  }
}

export const programmeScenarios: GoldenScenario[] = [progOmitKeeps, progOccurrenceMerge, progResetNoResurrect, progSingleRunning, progRestoreFields, progRoutineOwnership]
