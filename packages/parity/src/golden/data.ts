import type { Json } from '../types'
import { restore, call, expect, getData, getRev, jsonOf, put, revOf, storedOf, type Ctx, type GoldenScenario } from './helpers'

const DATA = ['GET /api/data', 'GET /api/data/rev', 'PUT /api/data']
const workout = (id: string, d = '2026-09-01') => ({ id, d, name: 'Synthetic session', start: 1, end: 2, entries: [] })

/** Revision, conditional write and strict baseRev (INV-1..3, 11). */
export const dataRevConditional: GoldenScenario = {
  id: 'data-rev-conditional', routes: DATA, invs: [1, 2, 3, 11], seed: 20261001,
  async run(ctx: Ctx) {
    await restore(ctx, {})
    const empty = jsonOf(await getData(ctx))
    expect(empty.state === null && empty.rev === 0, 'nothing synced yet reads as {state:null, rev:0}')
    // INV-1: client _rev is ignored; first write is rev 1; active never stored.
    const first = await put(ctx, { state: { _rev: 99, _ts: 100, workouts: [workout('w1')], routines: [], active: { id: 'running' } }, baseRev: 0 })
    expect(jsonOf<{ rev: number }>(first).rev === 1, 'first write is revision 1')
    expect((await storedOf(ctx))?.active === undefined, 'active is not stored (INV-11)')
    // INV-2: strict baseRev; "1" is not 1, and a refused write changes nothing.
    const stringRev = await put(ctx, { state: { workouts: [workout('w9')], routines: [] }, baseRev: '1' })
    expect(stringRev.status === 409, 'string baseRev is a conflict (INV-2)')
    const stale = await put(ctx, { state: { workouts: [], routines: [] }, baseRev: 0 })
    expect(stale.status === 409 && jsonOf<{ rev: number }>(stale).rev === 1, 'stale baseRev returns 409 with rev 1')
    expect((await revOf(ctx)).rev === 1, 'refused writes leave the revision unchanged')
    // Matching baseRev advances; INV-3 absent/null baseRev overwrites unconditionally.
    expect((await put(ctx, { state: { workouts: [workout('w2')], routines: [] }, baseRev: 1 })).status === 200, 'matching baseRev writes')
    expect((await put(ctx, { state: { workouts: [workout('w3')], routines: [] }, baseRev: null })).status === 200, 'null baseRev overwrites (INV-3)')
    expect((await put(ctx, { state: { workouts: [workout('w4')], routines: [] } })).status === 200, 'absent baseRev overwrites (INV-3)')
    expect((await getRev(ctx)).status === 200, 'rev endpoint answers after writes')
  }
}

/** Shape checks precede the conflict check; malformed bodies (INV-6..10). */
export const dataShapePrecedence: GoldenScenario = {
  id: 'data-shape-precedence', routes: ['GET /api/data', 'PUT /api/data'], invs: [6, 7, 8, 9, 10], seed: 20261002,
  async run(ctx: Ctx) {
    await restore(ctx, {})
    expect((await put(ctx, { state: { workouts: [workout('seed')], routines: [] } })).status === 200, 'seed document')
    // INV-7: a document with nothing of the profile is refused (`_rev`/`_ts` do not count).
    expect((await put(ctx, {})).status === 400, '{} refused (INV-7)')
    expect((await put(ctx, { state: { _rev: 5, _ts: 9 } })).status === 400, '{_rev,_ts} refused (INV-7)')
    expect((await put(ctx, { state: [] })).status === 400, 'array state refused (INV-7)')
    expect((await put(ctx, { state: { workouts: 'x', routines: [] } })).status === 400, 'non-array workouts refused (INV-7)')
    // INV-6: a shape error with a stale baseRev is a 400, not a 409.
    const shapeFirst = await put(ctx, { state: { workouts: 'x' }, baseRev: 99 })
    expect(shapeFirst.status === 400, 'shape check precedes conflict (INV-6)')
    // INV-7: null/non-object list items dropped silently.
    const dropped = await put(ctx, { state: { workouts: [null, 'x', workout('w2')], routines: [] }, baseRev: 1 })
    expect(dropped.status === 200, 'null/non-object items are dropped, not refused (INV-7)')
    const kept = (await storedOf(ctx))?.workouts as { id: string }[]
    expect(kept.map(w => w.id).join() === 'w2', 'only the object entry is stored (INV-7)')
    // INV-8: malformed JSON → 400 without a stack; oversized body → 413 with nothing written.
    expect((await call(ctx, 'PUT', '/api/data', { body: { raw: '{"state":' } })).status === 400, 'bad JSON is 400 (INV-8)')
    const huge = `{"state":{"workouts":[],"routines":[],"pad":"${'a'.repeat(5 * 1024 * 1024)}"}}`
    expect((await call(ctx, 'PUT', '/api/data', { body: { raw: huge } })).status === 413, '>5 MiB is 413 (INV-8)')
    // INV-9: too-deep nesting is a 400 and nothing is written.
    // Legacy refuses nesting from ~3000 deep (stringify RangeError → 400); 6000 stays inside what the recorder can walk.
    const deep = `{"state":{"workouts":[],"routines":[],"deep":${'['.repeat(6000)}${']'.repeat(6000)}}}`
    expect((await call(ctx, 'PUT', '/api/data', { body: { raw: deep } })).status === 400, 'deep nesting is 400 (INV-9)')
    // INV-10: an unreadable state file is 503 on GET and PUT and is never replaced.
    await restore(ctx, { [ctx.uid]: '{not json' })
    expect((await getData(ctx)).status === 503, 'unreadable state is 503 on GET (INV-10)')
    expect((await put(ctx, { state: { workouts: [], routines: [] } })).status === 503, 'unreadable state is 503 on PUT (INV-10)')
    await restore(ctx, {})
  }
}

/** Server-owned wid identity and the 50-entry ancestor cap (INV-4, 5, 52, 55). */
export const dataWidIdentity: GoldenScenario = {
  id: 'data-wid-identity', routes: DATA, invs: [4, 5, 52], seed: 20261003,
  async run(ctx: Ctx) {
    await restore(ctx, {})
    const a = await put(ctx, { state: { workouts: [workout('a')], routines: [] }, baseRev: 0 })
    const widA = (await revOf(ctx)).wid
    expect(typeof widA === 'string' && /^[0-9a-f]{16}$/.test(widA), 'rev endpoint reports wid (INV-5)')
    expect(jsonOf<{ wid: string }>(a).wid === widA, 'write response wid matches stored wid (INV-5)')
    // INV-4: a present baseWid must match the stored wid (null is a mismatch when a wid exists).
    expect((await put(ctx, { state: { workouts: [], routines: [] }, baseRev: 1, baseWid: 'deadbeefdeadbeef' })).status === 409, 'foreign baseWid is 409 (INV-4)')
    expect((await put(ctx, { state: { workouts: [], routines: [] }, baseRev: 1, baseWid: null })).status === 409, 'null baseWid against a wid is 409 (INV-4)')
    // Absent baseWid is revision-only (INV-4) and returns 200.
    const b = await put(ctx, { state: { workouts: [workout('b')], routines: [] }, baseRev: 1 })
    expect(b.status === 200, 'absent baseWid keeps the revision-only contract (INV-4)')
    // INV-52: a conflict hands back the document; re-pushing on its rev and wid succeeds.
    const conflict = await put(ctx, { state: { workouts: [workout('c')], routines: [] }, baseRev: 1, baseWid: widA })
    expect(conflict.status === 409, 'stale baseWid is 409 (INV-52 trigger)')
    const merged = jsonOf<{ rev: number; wid?: string; state: { _wid?: string } }>(conflict)
    // Merge: keep the server's workouts and add the local one, then re-push on the returned rev and wid.
    const serverWorkouts = (merged.state as unknown as { workouts: Json[] }).workouts
    const retry = await put(ctx, { state: { workouts: [...serverWorkouts, workout('c')], routines: [] }, baseRev: merged.rev, baseWid: merged.state._wid ?? null })
    expect(retry.status === 200, 're-push on the 409 document succeeds (INV-52)')
    const ids = ((await storedOf(ctx))?.workouts as { id: string }[]).map(w => w.id)
    expect(ids.includes('b') && ids.includes('c'), 'the merge keeps the server workout and the local one (INV-52)')
    // INV-5: _wids holds the ancestors, capped at 50.
    for (let i = 0; i < 52; i++) {
      const rev = (await revOf(ctx)).rev
      expect((await put(ctx, { state: { workouts: [workout(`n${i}`)], routines: [] }, baseRev: rev })).status === 200, `chained write ${i}`)
    }
    const doc = (await ctx.rec.request({ method: 'GET', path: '/api/data', session: { uid: ctx.uid } }))
    expect(doc.status === 200, 'document reads after 52 chained writes')
    // Server half of INV-55 (rev rewind / foreign wid at the same revision is a 409). Whether the client merges or adopts is I02's.
    await restore(ctx, { [ctx.uid]: '{"_rev":1,"_wid":"aaaaaaaaaaaaaaaa","workouts":[],"routines":[]}' })
    expect((await put(ctx, { state: { workouts: [], routines: [] }, baseRev: 1, baseWid: 'bbbbbbbbbbbbbbbb' })).status === 409, 'foreign wid at same rev is 409 (INV-55)')
    expect((await put(ctx, { state: { workouts: [], routines: [] }, baseRev: 1, baseWid: 'aaaaaaaaaaaaaaaa' })).status === 200, 'matching wid writes (INV-55)')
  }
}

/** Reset stamp moves forward only; durability of the rev cache (INV-13, 14). */
export const dataResetMonotone: GoldenScenario = {
  id: 'data-reset-monotone', routes: ['GET /api/data', 'GET /api/data/rev', 'PUT /api/data'], invs: [13, 14], seed: 20261004,
  async run(ctx: Ctx) {
    await restore(ctx, {})
    expect((await put(ctx, { state: { workouts: [], routines: [] }, baseRev: 0 })).status === 200, 'never-reset profile written')
    expect((await storedOf(ctx))?.resetAt === undefined, 'never-reset profile has no resetAt key (INV-13)')
    const reset = await put(ctx, { state: { workouts: [], routines: [], resetAt: 500, resetIds: { workouts: ['a'] } }, baseRev: 1 })
    expect(reset.status === 200, 'reset stamp accepted')
    expect((await put(ctx, { state: { workouts: [], routines: [], resetAt: 100 }, baseRev: 2 })).status === 200, 'older reset stamp accepted')
    let doc = await storedOf(ctx)
    expect(doc?.resetAt === 500, 'older resetAt never moves the stamp back (INV-13)')
    expect(JSON.stringify(doc?.resetIds) === '{"workouts":["a"]}', 'resetIds kept with the stored stamp (INV-13)')
    expect((await put(ctx, { state: { workouts: [], routines: [] }, baseRev: 3 })).status === 200, 'absent resetAt accepted')
    doc = await storedOf(ctx)
    expect(doc?.resetAt === 500, 'absent resetAt keeps the stored stamp (INV-13)')
    // INV-14: the rev read reflects a restored file of the same length (stat cache never stale).
    await restore(ctx, { [ctx.uid]: '{"_rev":7,"_wid":"cccccccccccccccc","workouts":[],"routines":[]}' })
    expect((await revOf(ctx)).rev === 7, 'rev after restore is 7 (INV-14)')
    await restore(ctx, { [ctx.uid]: '{"_rev":8,"_wid":"cccccccccccccccc","workouts":[],"routines":[]}' })
    expect((await revOf(ctx)).rev === 8, 'same-size restore is not served stale (INV-14)')
  }
}


/** Offload manifest survives a legacy round-trip (OFFLOAD.md), and a Bearer writer (the MCP agent path) is a
 * writer like any other: unstamped with matching baseRev (INV-36, INV-3). */
export const dataOffloadBearer: GoldenScenario = {
  id: 'data-offload-bearer', routes: DATA, invs: [36], seed: 20261030,
  async run(ctx: Ctx) {
    await restore(ctx, {})
    const manifest = { 'def-synthetic': { versionId: 'v1', at: 500 } }
    // OFFLOAD.md: the manifest sits inside StateDoc.programmes, where legacy round-trips unknown keys untouched.
    const programmes = { version: 1, fork: 'wilky/1', definitions: [{ id: 'def-synthetic' }], cycles: [], offloaded: manifest }
    expect((await put(ctx, { stamped: true, baseRev: 0, state: { workouts: [], routines: [], programmes } })).status === 200, 'document with offload manifest stored')
    const read = jsonOf<{ state: { programmes: { offloaded: unknown } } }>(await getData(ctx))
    expect(JSON.stringify(read.state.programmes.offloaded) === JSON.stringify(manifest), 'offload manifest round-trips through legacy unchanged')
    const rev = await revOf(ctx)
    const agent = await put(ctx, { baseRev: rev.rev, state: { workouts: [{ id: 'mcp-1', d: '2026-10-12', name: 'Agent session', start: 1, end: 2, entries: [] }], routines: [], programmes } }, { bearer: true })
    expect(agent.status === 200, 'Bearer (MCP agent) writer with matching baseRev is accepted')
    expect(jsonOf<{ rev: number }>(agent).rev === rev.rev + 1, 'agent write advances the revision by one')
  }
}

/** A stored document whose bytes are not valid UTF-8 survives restore, read and replay byte for byte (transcript v2
 * stores doc bytes as base64 when the UTF-8 text would not round trip). */
export const dataInvalidUtf8Doc: GoldenScenario = {
  id: 'data-invalid-utf8-doc', routes: ['GET /api/data'], invs: [], seed: 20261031,
  async run(ctx: Ctx) {
    const original = Buffer.concat([
      Buffer.from('{"_rev":3,"_wid":"dddddddddddddddd","workouts":[],"routines":[],"note":"'),
      Buffer.from([0xff, 0xfe, 0xc3]),
      Buffer.from('"}')
    ])
    expect(!original.equals(Buffer.from(original.toString('utf8'))), 'fixture is not valid UTF-8')
    await ctx.rec.restoreDocs({ [ctx.uid]: original })
    const stored = (await ctx.target.storedDocs())[ctx.uid]
    expect(stored !== undefined && stored.equals(original), 'restored bytes are stored exactly')
    expect((await getData(ctx)).status === 200, 'document with invalid UTF-8 text reads through legacy')
  }
}

export const dataScenarios: GoldenScenario[] = [dataRevConditional, dataShapePrecedence, dataWidIdentity, dataResetMonotone, dataOffloadBearer, dataInvalidUtf8Doc]
