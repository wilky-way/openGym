# openGym state document + whole-doc sync protocol — frozen contract

Documents the original openGym synchronization protocol. All examples are synthetic.
Paths below are relative to that repo. `FE` = `frontend/src`.

Companion: `state-doc.ts` (types). This file is the behavioural contract; the `.ts` is the shape.

> Note: `docs/programme-model.md` and `docs/programme-model.schema.json` do **not exist** at this
> commit (only `docs/programme-targets.md`). Programme shapes below are reverse-engineered from
> `FE/lib/programme*.js`.

---

## 0. One-paragraph model

The whole profile is **one JSON document per user** (`DATA_DIR/state-<uid>.json`). Clients hold a
full copy (localStorage `gym_state_v1`, plus a file mirror on mobile), mutate it locally, stamp
every change with hybrid-ish logical clocks, and **PUT the whole document** with an optimistic
`baseRev`/`baseWid` guard. On 409 the server returns its whole document; the client runs a
deterministic 3-way-less **state merge** (`mergeStates`) and re-PUTs. The server never merges two
client copies; it (a) refuses stale writes, (b) joins the monotone records (`deleted`, `edited`),
(c) stamps on behalf of writers that do not stamp (old apps, API scripts, MCP), (d) unions the
programme block, (e) re-derives programme ownership, and (f) assigns `_rev`/`_wid`/`_wids`.

Clock primitive everywhere: **ms-epoch numbers**, compared numerically, with a "causal lift":
every new stamp is `max(wallclock, highestStamp(copy)+1)` (`FE/lib/sync-merge.js:1028-1071`,
`api/sync-stamps.js:509`).

---

## 1. Top-level keys

Legend — **Writer**: C = client app, S = server (PUT /api/data), M = MCP/API planner (via PUT).
**Sync**: Y = travels in GET/PUT; N = stripped / never sent; S-only = stored, never sent to clients.
**Clock**: how conflicts on that key are resolved (see §2 for each mechanism).
DEF = `FE/store/useStore.js:89-243` default value.

### 1a. Server bookkeeping / clock records

| Key | Type | Writer | Sync | Clock / rule | Cite |
|---|---|---|---|---|---|
| `_ts` | number (ms) | C (every persist that stamps); S echoes | Y | Copy-level "last changed". Merge: `max(a._ts,b._ts)`; `newerOf` picks base side (first arg on tie). | useStore.js:584, sync-merge.js:90,877 |
| `_rev` | int ≥0 | **S only** (client value ignored) | Y (GET/409 body) | Counter. `cur+1`, or `cur+2` when server corrected an unstamped writer's doc. Client merge deletes it. | server.js:2263-2269, sync-merge.js:881 |
| `_wid` | string (16 hex) | S only | Y | New random id every successful PUT. | server.js:2272 |
| `_wids` | string[] (≤50) | S only | Y | Ancestors: previous `_wids` + previous `_wid`, last 50 (`WID_KEEP`). | server.js:167,2270-2271 |
| `_unstamped` | `{fp, ed?, f?}` | S only | **S-only** (`forClient` strips) | Stamps server gave the last unstamped writer's push; keyed by fingerprint of its `edited`. | sync-stamps.js:155-190,536-545; server.js:195-199 |
| `_prior` | `{[fieldKey]: string[]}` (≤6 hashes per key, ≤5000 keys) | S only | **S-only** | Hash history of prior values per setting/plan-day/entry-field. | sync-stamps.js:192-247 |
| `edited` | `{[settingKey]: number}` | C (`stampEdits`), S (unstamped writers; `queue` by reconcile) | Y | Per-setting LWW clocks. Joined per key = max. Server drops `_wid`/`_wids` keys from it. | sync-merge.js:606-718; sync-stamps.js:96-102,522-526 |
| `undone` | `{[settingKey]: [base,del] \| [base,del,at]}` | C only | Y | Undo markers for settings (see §2.6). | sync-merge.js:232-318,866-872 |
| `deleted` | `{[list]: {[entryKey]: number}}` (≤5000/list) | C (`stampDeletions`), S (unstamped + `keepHeld`) | Y | Tombstones: `+t` removed at t, `-t` added back at t. Joined per key by `laterDel`. | sync-merge.js:491-604; sync-stamps.js:49-94,474-490 |
| `resetAt` | number | C (Reset everything) | Y | Monotone: only moves forward (client merge, `keepReset`, server PUT). | sync-merge.js:740,897-907; server.js:2249-2254 |
| `resetIds` | `{[list]: string[]}` (≤20000/list) | C | Y | Names wiped by the reset; union for same `resetAt`. | sync-merge.js:400-437 |
| `unitSet` | `{at:number, convert:boolean}` | C (`setUnit`) | Y | Decides which unit survives a merge. | useStore.js:1394-1401; sync-merge.js:744-755 |
| `active` | object (in-progress workout) | C | **N** — server `delete body.state.active` | Device-local; carried across merges by `carryActive`. | server.js:2244; useStore.js:714-718 |
| `langAuto` | `true` \| absent | C | Y | Plain setting (stamped in `edited`). | useStore.js:262-271 |

Pseudo-key (only inside `edited`/`undone`): `routineOrder` — order of routines (`ORDER_KEY`,
sync-merge.js:625; sync-stamps.js:337).

### 1b. Entity lists (union + per-entry clocks)

| Key | Item identity | Writer | Clock | Delete key (`DEL_LISTS`) | Delete time (`DEL_TIME`) |
|---|---|---|---|---|---|
| `workouts` | `id`, else `` `${d}|${start}` `` | C (finish/edit/import), S stamps for unstamped | `_ts`,`_f`,`_u` (only after a post-log edit; live-finished workouts carry **no `_ts`**) | workoutKey | `_ts` ‖ `end` ‖ `start` |
| `routines` | `id` | C, M, S stamps | `_ts`,`_f`,`_u`; order via `edited.routineOrder` | id | `_ts` |
| `customEx` | `id` | C | `_ts`,`_f`,`_u` | id | `_ts` |
| `equipProfiles` | `id` | C | `_ts`,`_f`,`_u` | id | `_ts` |
| `gymCards` | `id` | C | `_ts`,`_f`,`_u` | id | `_ts` |
| `bodyweight` | `d` (one per day) | C | entry `t` (later `t` wins the day) | `d` | `t` |
| `measurements` | `d` (one per day) | C | entry `t` | `d` | `t` |
| `favEx` | the string itself | C | none; ordered set union (newer first); delete/add-back via `deleted.favEx` | value | always 0 (any removal beats it) |

Cites: sync-merge.js:133,398,502-513,756-843; sync-stamps.js:47-57.
Reset naming (`RESET_LISTS`) differs for weigh-ins: `` `${d}|${t ?? ''}` `` (sync-merge.js:401-405).

### 1c. Stamped maps (`STAMPED_MAPS`, each value carries its own `_ts`)

`balanceOverrides`, `loadKind`, `plates`, `dbLoad`, `dumbbells`, `dayNotes` —
merge per key: later `value._ts` wins, tie → newer copy; `prefer` → preferred copy. A "clear" is a
stamped entry (`{_ts}` / `{id:null,_ts}`), never a key delete. sync-merge.js:87,367-381,856-858;
sync-stamps.js:74. Never stamped in `edited`.

### 1d. Other maps with own merge (OWN_MERGE, not in `edited`)

| Key | Merge |
|---|---|
| `exWeights` `{[exId]: {w,d}}` | key union; per key the "better" `w` (`beatsWeight`: larger, or smaller for assisted machines); recomputed from history for exercises touched by a kept workout edit or a deletion. sync-merge.js:177-203,844-849 |
| `programmes` | `mergeProgrammes` (union by id, per-field `_f` clocks) — §5. |

### 1e. Per-key settings (`PER_KEY`, stamped as `edited["<key>.<sub>"]`)

`week` (`{[0-6 getDay()]: routineId[]}`, legacy scalar id tolerated; `[]`/absent = rest —
`FE/lib/history.js:468-480`), `dayPlan` (`{[iso]: routineId | 'rest'}`, scalar), `exNotes` (`{[exId]: string}`), `barWeights` (`{[exId]: number}`).
Merge: start from key-union `{...o,...n}` (exNotes/barWeights) / newer copy (week/dayPlan), then
`applyEdits` takes each sub-key from the side with the later stamp, removal included.
sync-merge.js:622,694-718,850-852.

### 1f. Whole-value settings (stamped as `edited["<key>"]`, LWW, absent stamp → newer copy)

Every other key. From DEF + code that writes `S.<key>`:
`unit`* `restSec restPauseSec sound soundOnSilent vibrateOnSilent vibrate timerFlash
timedSetOvertime keepAwake lang langAuto theme accent accentCustom body targetW queue rotation
scheduleMode gifSize heatmapMetric workoutView collapseCompleted exerciseView wc hints reminder
effort showRir(legacy) autoBackup activeEquipId equipFilterOn weekStart wdec speedUnit
lastGymCardId checkIn showWeightCard weighIn connStatus shareMap connLocal startFrom enParens
enOnly logRef balanceTemplate measurementEnabled customMeasurements restSound classicChime
oneRmFormula exFigure coach`.
(*`unit` is in OWN_MERGE: resolved by `unitSet`, never by `edited`.)
Special: picking an own accent stamps both `accent` and `accentCustom` (sync-merge.js:656-662).
`coach` (Coach chat/log, `FE/lib/coach.js:37-45`) is one whole-value LWW setting — concurrent
chat on two devices loses one side. **Unknown future keys are whole-value settings too.**

**Count:** 15 bookkeeping/clock keys (incl. `active`, `langAuto`) + 8 lists + 6 stamped maps +
2 own-merge maps + 4 per-key maps + ~51 whole-value settings ≈ **86 named top-level keys**
(DEF itself declares 69). The document is open: any unknown key round-trips (§3.6).

---

## 2. Clock mechanisms

### 2.1 Copy stamp `_ts`
Set by `persist` when `stamp=true` (an edit): `_ts = max(now, base.ts+1, S._ts)` (useStore.js:584).
Adoptions/pulls keep the server's `_ts` (persist(..., stamp=false)). Decides `newerOf` and which
side is `n` (base) in `mergeStates`.

### 2.2 Causal lift (`stampChange`, client) — sync-merge.js:1000-1071
`now = max(wall, highestStamp(prev)+1)`. Applied in `update()` (useStore.js:1353-1371) to:
workouts whose `_ts` a screen changed (`stampWorkout`) → `stampEntry`; stamped-map entries whose
`_ts` changed → `_ts=now`; weigh-ins/measurements whose `t` moved → `t=max(t,now)`; routines
(`stampRoutines`, skipping a routine put back by Undo), customEx, equipProfiles, gymCards
(`stampEntries`), programmes (`stampProgrammes`), `stampDeletions`, `stampEdits`.
`highestStamp` reads `_ts`, `unitSet.at`, `resetAt`, all `edited`, all `|deleted|`, entry `_ts`/`_f`
of the 5 entry lists, stamped-map `_ts`, weigh-in/measurement `t` (client only — see §6 RISK),
and `programmeStamp`.

### 2.3 Per-entry field clocks `_ts` / `_f` / `_u` — sync-merge.js:220-365
- `stampEntry(old, x, now)`: `x._ts=now`; `_f = {...old._f}` plus `f[k]=now` for every non-meta key
  that differs (presence or JSON) — removal included. New entry: `_ts` only. Meta = `id,_ts,_f,_u`.
- `mergeEntry(a,b)`: base `n` = later `_ts` (a on tie). For each key: side with later `_f[k]`
  wins (absence = removal), with Undo override (`undoPick`). `_f` = per-key max; `_ts` = max of both
  and any bump. Fields neither side stamped → base's value.
- Applies to `workouts` (not with `prefer`), `routines`, `customEx`, `equipProfiles`, `gymCards`
  and every programme record (definitions, cycles minus occurrences, occurrences, root metadata).

### 2.4 Setting clocks `edited` — sync-merge.js:636-718
`stampEdits(prev,next,now)`: every non-OWN_MERGE key whose JSON changed gets `edited[k]=now`;
PER_KEY maps per sub-key `edited["k.s"]`; routine reorder → `edited.routineOrder`. Per-key stamps
older than **180 days** for a sub-key neither copy holds are pruned (`EDIT_KEEP_MS`, client only).
`applyEdits`: for each stamped key, the copy with the later stamp provides the value (absence =
delete); tie with no Undo marker → leave base value. `mergeEdits` = per-key max.

### 2.5 Tombstones `deleted` — sync-merge.js:491-604
- `stampDeletions(prev,next,now)`: entry in prev, not in next → `m[k]=max(now, time(x)+1)`.
  Entry newly in next whose key has a positive record (or any favEx) → `m[k] = -now` (add-back).
  Only keys **this change** brought in are marked added back.
- `applyDeletions`: drop entry iff `at>0 && at >= time(x)`. An edit later than the removal keeps it.
- `laterDel(v,cur)`: larger `|stamp|` wins; equal magnitudes → negative (add-back) wins,
  order-independently. Cap 5000/list, oldest `|stamp|` evicted first.
- With `prefer`, only the preferred side's tombstones count.

### 2.6 Undo markers `_u` (entries) / `undone` (settings) — sync-merge.js:232-318
`[base, del]` pending → completed to `[base, del, at]` by the next stamp of that field (`settleMarks`),
dropped once the field moves on. In a merge, if the other side's stamp `t` is strictly between
`base` and `del`, the other side wins and the field is bumped to `max+1`. On equal stamps the Undo
wins regardless of argument order.

### 2.7 Units
Different `unit`s are never merged numerically: the lead (later `unitSet.at`; tie/none → newer copy;
`prefer` → preferred) converts the other first (`convertStateUnit`), or relabels if
`unitSet.convert===false`. `active` is carried into the result's unit. sync-merge.js:383-395,744-755.

### 2.8 Reset
`resetEverything` (useStore.js:1412-1426): `restartedState`, `resetAt = max(now, highest+1)`,
`resetIds = names of every entry/map key of this copy` (+ server's, merged after a GET), pushed as a
**forced replace (no baseRev)**. Merge with a copy that hasn't seen it: `sinceReset` drops exactly
the named entries (or, with no ids, entries with time ≤ resetAt and all un-timed lists), recomputes
`exWeights`, deletes `edited`/`undone`/`unitSet` so the reset copy's settings win.
sync-merge.js:439-489,727-743.

---

## 3. HTTP protocol

All `/api/*` answer `application/json`, `Cache-Control: no-store` (server.js:722-726).
Auth: signed session cookie `__Host-gymsid` (https) / `gymsid`, or `Authorization: Bearer <same token>`
(paired phone, MCP). Duplicate differing cookie values → treated as signed out (server.js:578-611).
CSRF: non-GET from a browser must be `Sec-Fetch-Site: same-origin|none`, or (absent) `Origin == ORIGIN`
or no Origin; Bearer requests exempt → else **403 `{error:'cross-origin request refused'}`**
(server.js:657-680, 2668-2674). Unknown route → 404 `{error:'not found'}`.

### 3.1 `GET /api/data` (server.js:2174-2181)
- 401 `{error:'not signed in'}`
- 503 `{error:'state unreadable'}` if file exists but unreadable/unparseable (`readStateStrict`).
- 200 `{state: StateDoc | null, rev: number}` — `state` is the stored doc minus `_unstamped`/`_prior`
  (still includes `_rev`, `_wid`, `_wids`); `rev = state?._rev || 0`. No file → `{state:null, rev:0}`.
- Side effect: `user.lastPull` noted (≤ once / 10 min).

### 3.2 `GET /api/data/rev` (server.js:2188-2193)
- 401 as above. 200 `{rev: number, wid?: string}` (`wid` omitted when the doc has none).
- Served from a stat-keyed cache (mtime+size, ≤64 users, TTL 10 min; PUT evicts its user).
  An unreadable file reads as `{rev:0}` here (readState swallows) — not 503.

### 3.3 `PUT /api/data` (server.js:2195-2293) — exact order
Request body `PutDataRequest = { state: object, baseRev?: number|null, baseWid?: string|null, stamped?: boolean }`. Max body **5 MiB** (`MAX_BODY`, server.js:93).

1. No session → **401** `{error:'not signed in'}`.
2. `readBody`: >5 MiB → **413** `{error:'body too large'}` (rest drained; >10 MiB socket destroyed);
   unparseable or non-object JSON → **400** `{error:'invalid json'}`; empty body → `{}`.
3. `!state || typeof state !== 'object'` → **400** `{error:'state required'}`.
4. Non-array state whose only keys are `_rev`/`_ts` (incl. `{}`) → **400** `{error:'state required'}`.
5. Array state, or `workouts`/`routines` present and neither null nor array → **400** `{error:'invalid state'}`.
6. `workouts`/`routines`: non-object items silently dropped (`records`).
7. Read stored doc; unreadable → **503** `{error:'state unreadable'}`.
8. Conflict check (`curRev = cur?._rev || 0`):
   - `baseRev != null && baseRev !== curRev` (strict `!==`; `"4"` ≠ 4) → **409**
   - `baseRev != null && hasOwn(body,'baseWid') && baseWid !== (cur?._wid || null)` → **409**
     (explicit `baseWid:null` must match a doc with no `_wid`; omitted `baseWid` = rev-only check)
   - 409 body: `{error:'conflict', rev: curRev, state: forClient(cur)}` (state may be `null`).
   - `baseRev` absent or `null` → **unconditional overwrite** (legacy clients, forced replace).
9. `delete state.active`.
10. Reset monotonicity: if stored `resetAt` > sent `resetAt` (or sent absent) → sent gets stored
    `resetAt` and stored `resetIds` (or `resetIds` deleted if stored has none).
11. `stampPut(cur, state, {overRead: baseRev!=null && baseRev===curRev, stamped: body.stamped===true, report})`
    — mutates `state` (§4). `RangeError` (too deep) → **400** `{error:'invalid state'}`.
12. `_rev = curRev+1`; **if `report.changed` → `_rev = curRev+2`** (only for unstamped writers whose
    doc the server altered beyond stamps).
13. `_wids = [...cur._wids, cur._wid].filter(string).slice(-50)`; `_wid = randomBytes(8).hex`.
14. `JSON.stringify` (RangeError → 400 invalid state); `atomicWrite` = write `.tmp`, fsync, rename,
    fsync dir (`api/durable.js:28-38`); evict stat cache; media refcount bookkeeping (never fails the write).
15. **200** `{ok:true, ts: state._ts || null, rev: curRev+1, wid: state._wid}`.
    NB: `rev` is **always `curRev+1`** even when step 12 stored `curRev+2` — deliberate, so the
    unstamped writer's next rev poll sees movement and re-reads (sync-stamps.test.js:245-270).

Other errors: handler throw → 500 `{error:'server error'}`; client hang-up mid-body → no response.
The PUT is the **only writer** of `state-<uid>.json` (admin delete-user unlinks it, server.js:2491).
Compare-and-write is atomic per process only because read→write is synchronous (no await between).

### 3.4 Rev bump rules (summary)
- Successful PUT: +1; +2 when `report.changed` (unstamped writer, server put back/kept something).
- 409/4xx/5xx: no change, nothing written.
- `_rev` is not unique across history (backup restore / power loss can rewind) → `_wid`/`_wids` exist.

### 3.5 `wid` semantics (client side, useStore.js:1667-1683)
- `serverMoved = rev !== base.rev || (base.wid && wid && wid !== base.wid)`.
- `descends = !base.wid || !wid || wid === base.wid || state._wids.includes(base.wid)`.
- Not descended → never adopt as-is: merge and push (data dir rewound).

### 3.6 Unknown keys on the server
- **Stamped writer** (`stamped:true`): any top-level key is stored verbatim; the server never
  removes unknown keys (it only adds/joins records). A key the client omits is **gone** (no
  keepUnknown for stamped writers) — except `programmes` (omission ≠ deletion, re-filled from stored;
  sync-stamps.js:548-552) and `resetAt`/`resetIds` (step 10).
- **Unstamped writer**: `keepUnknown` puts back every key of the stored doc the writer omitted,
  recursively into routines/ex, workouts/entries/sets, customEx, equipProfiles, gymCards, except the
  keys v1.3.9 itself could drop (`V139_DROPS`, sync-stamps.js:375-387) and server bookkeeping
  (`NOT_KEPT`). Unknown keys inside entries are therefore preserved for old writers.
- Unknown keys are stamped like whole-value settings (`edited[k]`) by both stampEdits and stampUnstamped.

---

## 4. `stampPut(cur, next, {overRead, stamped, now, report})` — sync-stamps.js:506-568

```
t = max(now, highestStamp(cur)+1, highestStamp(next)+1)
reset = next.resetAt > cur?.resetAt
sent = copy of next.edited (the writer's record as sent) | null
prevOwn = cur._unstamped | null
delete next._unstamped, next._prior            // never trust client copies
if cur && !reset:
  next.deleted = mergeDeletions(cur.deleted, next.deleted)   // never shrinks
  next.edited  = mergeEdits(cur.edited, next.edited) minus keys _wid/_wids
  if !stamped: keepUnknown(cur, next)                       // step 0
  for each routine in next: retainAuthoredExercises(cur routine.ex, r.ex)   // ALL writers (fork)
  retainSnapshotPrescriptions(cur.programmes, next.programmes)            // ALL writers (fork)
  if !stamped && overRead:
     own = cur._unstamped if its fp == fingerprint(sent)
     stampUnstamped(cur, next, sent, t, own)                // step 2
     next._unstamped = ownRecord(next, t, own, fp) (if any)
  elif prevOwn: next._unstamped = ownRecord(next, NaN, prevOwn, prevOwn.fp)   // carry forward
  report.changed |= content changed by keepUnknown/retain/stampUnstamped
if next.programmes || (!reset && cur.programmes):
  resetAt = max(next.resetAt, cur.resetAt); resetIds = reset ? next.resetIds : cur.resetIds || next.resetIds
  previous = reset ? null : programmesSinceReset(cur.programmes, resetAt, resetIds)
  next.programmes = programmesSinceReset(next.programmes || previous, resetAt, resetIds)
  if !stamped: stampProgrammes(previous, next.programmes, t, cb)   // cb restores fields whose stored _f is newer
  next.programmes = mergeProgrammes(next.programmes, previous, next.workouts, mergeProgrammeEntry)
reconcileProgrammeOwnership(next)                           // all writers, even first write
keepHeld(next, t)                                           // step 3: entry held vs tombstone → -max(t, at+1)
if cur && !reset: notePrior(cur, next)                      // record old-value hashes
report.changed |= content(next) != content(as sent)         // unstamped only
```

`stampUnstamped` (sync-stamps.js:249-335), for an unstamped writer that wrote over the rev it read:
1. Removals: every entry in `cur` missing from `next` → tombstone `max(t, time(x)+1)` unless a
   positive tombstone ≥ time already exists.
2. Settings & per-key subkeys that differ: if the stored stamp is later than the one the writer
   sent (`stale`) **and** the sent value is one the field held before (`_prior` hash, or no history)
   → put back the stored value; else, unless writer moved its own stamp (`moved`), `edited[k]=t`.
   Absent keys are not changes (writer doesn't know them). Own previous stamps (`_unstamped`) are
   not "stale". A writer that sends no `edited` at all (`sent=null`) is never stale.
3. Routine order: same rule with `routineOrder` (`inOrderOf` restores stored order).
4. Entries: new entry (non-workout) without `_ts` → `_ts=t`. Changed entry: per field, if stored
   `_f[k]` > writer's `_f[k]` and value was held before → put back; `_f` joined; if still equal to
   stored → keep stored `_ts`; else `stampEntry(old, x, t)`.

`mergeProgrammeEntry` (sync-stamps.js:571-585) = mergeEntry without Undo handling.

---

## 5. Programmes block (`programmes`) — programme-sync.js (api and FE copies byte-identical)

Shape: `{version:1, fork:'wilky/1', definitions: Definition[], cycles: Cycle[], ...unknown, _ts?, _f?}`.
`normaliseProgrammes` is a tolerant read (never a migration): keeps unknown fields, filters
`definitions`/`cycles` to objects with unique non-empty string `id`, occurrences by unique
`instanceId` (first wins).

`mergeProgrammes(a, b, workouts, mergeEntry)`:
- Root (minus lists) = `mergeEntry`.
- `definitions`: **union by id**, shared id → `mergeEntry`. No deletion mechanism (only reset).
- `cycles`: union by id; shared → `mergeEntry` of cycle-minus-occurrences; terminal precedence:
  any `activationConflict` → status `archived` (+ conflict kept), else any `finished`, else any
  `archived` wins over `active`/`paused` regardless of clocks; `_f.status` = max. Occurrences:
  union by `instanceId`, `mergeEntry` per occurrence.
- `resolveOccurrences(cycle, workouts)`: `done` is **derived** from finished workouts (entry
  `occurrenceId`, else `programmeInstance`, else legacy routine/date rule); a `done` with no workout
  reverts to `pending` (date deleted); a found workout forces `done` + `date=w.d` and clears
  `skippedAt`/`reason` (finished log beats skip).
- Single running cycle: among `active|paused`, keep active first, then oldest `since`, then id;
  others → `archived`, `activationConflict = winner.id`, stamped `max(...)+1`.
- `reconcileProgrammeOwnership(S)`: routines owned by a terminal cycle (not a conflict loser) and not
  in the winner's occurrences → `programmeHistory={cycleId,series}`, `programme` deleted, stamped.
  Stale queue of a terminal cycle → `queue=null`, `edited.queue` bumped. Conflict → winner reclaims
  routines (re-derives `routine.programme`) and rebuilds `queue` for its current week; stamps
  `edited.queue = max(edited.queue, programmeStamp)+1`.
- Reset: `programmesSinceReset` drops definitions/cycles named in `resetIds.programmeDefinitions` /
  `programmeCycles` unless `_ts > resetAt`; without ids, drops everything with `_ts <= resetAt`.
- Client: omission of `programmes` in a pulled doc is not deletion (`adoptedState`, useStore.js:305-312).

---

### 5a. Rewrite extension: deterministic offload protection (K10 ruling)

`OFFLOAD.md` adds `programmes.offloaded` and `programmes.installed`, each an optional
`Record<DefinitionId, {versionId: string, at: number}>`. Consumers apply this rule unconditionally
when a manifest exists; the feature flag gates producers only. Without manifests, legacy merge
behaviour above is unchanged.

Join both manifests per id by greatest `at`; equal stamps choose the lexicographically greater
`versionId`. Use own-key lookups, including for prototype-named ids. For a definition present in
either input, if an active/paused **legacy-normalized** cycle references its id, joined
`offloaded[id]` exists, and `installed[id]` is absent or `installed[id].at <= offloaded[id].at`,
synthesize:

```ts
installed[id] = { versionId: offloaded[id].versionId, at: offloaded[id].at + 1 }
```

This deterministic protection marker persists in the merged programmes after terminal release,
until an explicit later offload supersedes it. It prevents repeated merges from stripping a
previously protected definition and makes duplicate filtering idempotent. An existing install
marker strictly newer than the offload is retained. Reset drops manifest entries with `at <= resetAt`.
Client and server share K10's `offloadInputs`, `resetOffload` and `offloadStamp` helpers; K04's
public programme merge and K17's stamping path consume the same rule.

## 6. Client flow (`FE/store/useStore.js`)

### 6.1 Device-local storage

localStorage:
| Key | Content |
|---|---|
| `gym_state_v1` | the full StateDoc incl. `active` (`KEY`, :33) |
| `gym_sync` | `{rev, ts, wid?}` — base revision of the saved copy (:40) |
| `gym_state_wid` | client-side write id of the saved copy (tab join; ≠ server `_wid`) (:42) |
| `gym_state_owner` | owner uid the saved copy was written under, `''` = guest (:45) |
| `gym_dirty` | `'1'` when the copy owes the server (:46) |
| `gym_legacy_owed` | `{fp, owner}` — owed copy left by v1.3.9 (:49) |
| `gym_synced_at` | ms of last confirmed sync (:50) |
| `gym_synced_fp` | fingerprint of last agreed copy (`lib/sync-changes.js`) (:51) |
| `gym_stash` | `{[server|uid]: {server, uid, name, at, state, adopt?}}` kept-aside copies (:54) |
| `gym_logout_owed` | `'1'` (:60) |
| `gym_adopt` | `{uid, rejoined, alwaysAsk, pre}` open sign-in question (:67) |
| `gym_owner`, `gym_owner_name`, `gym_user`, `gym_guest` | session identity |
| `gym_plan_view`, `gym_default_lang`, `gym_device`, `gym_rest_notif_asked`, `gym_demo_seeded_v1`, ProgrammeCalendar keys | UI/device prefs, never synced |
localStorage (CORRECTED by Codex review #17: deliberately not sessionStorage, so a timer survives the PWA being killed): `gym_rest` (rest timer), `gym_work` (hold timer) (`FE/store/useUI.js:449-505`). Port must restore both at boot with the active workout.
Mobile files: `opengym-state.json` (mirror), `opengym-state-owner.json` `{owner, ts}`,
`opengym-stash.json`. Coach device settings in their own file.

Per-tab in memory: `meta` WeakMap copy → `{base:{rev,ts,wid?}|null, owed:boolean}` (:390-420).

### 6.2 Push (`doPush`, :735-799; `pushState`, :1613-1624)
- Debounce 1500 ms after `persist` (:630); flushed on `visibilitychange→hidden` and `pagehide`.
- One PUT in flight; requests during flight coalesce into one follow-up.
- Body: `{state: S (incl. active), stamped: !(legacy owed for this user)}` +
  `baseRev/baseWid` from: import replace (`replaceRev`) > none if `forceNext` (reset/first push into
  empty profile) > `meta.base`. `baseWid` only sent when known.
- 200: `writeSync(r.rev, S._ts, r.wid)`, clear legacy, `owed=false`, `confirmed`. `r.rev == null` → drop base.
- 409 with body, attempt < 2: `mergeInto(local, e.data.state, e.data.rev||0)` then retry → max **3 PUTs**.
  Third failure → stays owed; next pull resolves.
- Other errors: owed, sync status (offline / auth / error), 413 toast once per streak.
- No push while `adoptHold` (open sign-in question) or before boot `ready` (`pushPending`).

### 6.3 Pull (`checkRev`, :648-667; `pullState`, :1628-1688)
Triggers: 30 s poll (`POLL_MS`), `visibilitychange→visible`, `focus`, `pageshow(persisted)`,
`online` (forced), app resume, other tab's `gym_sync` change. Checks <3 s apart coalesce.
`checkRev`: no base or owes → full pull; else `GET /api/data/rev`; moved rev or wid → pull; else
`confirmed`. Non-network/non-401 error on `/rev` → full pull (older API).
`pullState`: first flushes a pending debounced push. Then (`dirty = owed || pushPending`):
- `rev == null` (pre-revision server): newer `_ts` wins (`restoredStateFor`).
- No base: dirty → merge+push; server newer/no local data → adopt; local data → push against `rev`;
  else record base.
- Base: `!serverMoved` → push if changed else confirm. No server state → push. `!descends` →
  merge+push. Not changed → adopt server copy (keeping local `active`, advancing programme). Both
  changed → `mergeInto` + push.
- `mergeInto`: optional legacy lift, `mergeStates(local, remote)`, carry `active`, rotation refill
  (stamps `edited.queue`), `advanceProgramme` (stampChange), `persist(merged, push=false)`, base
  `{rev, ts: OLD base.ts, wid: remote._wid}` so it stays "changed" until pushed.
- `adopt`: keeps server `_ts`; if `advanceProgramme` changed it, stamps and pushes.

### 6.4 Offline queue
There is **no op queue**: the whole doc is the queue. Offline = `gym_dirty='1'` + `base` kept; next
online/poll pushes the whole copy with the old `baseRev` → 409 → merge → push. Sign-out with owed
changes refuses unless forced; forced → stash in `gym_stash` (+file), re-merged on next sign-in to
the same server+account (`applyStash`).

### 6.5 Multi-tab
Each `persist` writes `gym_state_wid`; another tab detecting a foreign wid merges the saved copy into
its own (`joinSaved`/`syncFromSaved`, `mergeStates` + `active` rule). Owner change via `gym_owner`
storage event → tab drops its copy and refuses writes until it can take the new owner's saved copy.

### 6.6 Device-local only (never on server)
`active` (in-progress or being-edited workout; `active.editingWorkoutId`, `active.backfill`),
rest/hold timers (localStorage, see §6.1), all §6.1 non-state keys, mobile Coach device settings, media
blobs (separate `/api/media` protocol), sync status. Note `active` IS in the localStorage copy and
IS sent in the PUT body; the server strips it.

---

## 7. Parity: `api/sync-stamps.js` ↔ `FE/lib/sync-merge.js`

- `api/sync-stamps.js` is a **hand copy** (header :3-6) of `DEL_LISTS`, `DEL_TIME`, `DELETED_MAX`,
  `capStamps`, `OWN_MERGE`, `PER_KEY`, `STAMPED_MAPS`, `laterDel`, `mergeDeletions`, `mergeEdits`,
  `highestStamp`, `stampEntry`, `settleMarks`, `orderMoved`, `inOrderOf`(=`unionByNeighbours`-ish).
  Server-only: `stampPut`, `stampUnstamped`, `keepUnknown`, `keepHeld`, `notePrior`, `ownRecord`,
  `fingerprint`, `V139_DROPS`, `pairItems`, `retain*`, `mergeProgrammeEntry`.
- Test: `FE/lib/sync-stamps-parity.test.js` — 299 seeded random cases comparing `mergeDeletions`,
  `mergeEdits`, `highestStamp` (doc with routines + plates only), `stampEntry` (incl. `_u`); plus
  scenario tests that server-stamped docs survive the client merge (planner week, v1.3.9 delete /
  setting / pyramid / dead-spot, add-back tie order-independence, records not stamped as settings).
- `programme-sync.js` and `programme-prescription.js` are **byte-identical** copies; asserted by
  `FE/lib/programme.test.js:115` and `api/test/programme-fix1.test.js:39-41`.
- **Divergences not covered by parity:** (a) server `highestStamp` ignores `bodyweight[].t` and
  `measurements[].t` (client includes them, sync-merge.js:1018) — the server's `t` can be lower than
  the client's lift; (b) client prunes per-key `edited` stamps >180 d, server never prunes;
  (c) client `mergeEntry` honours Undo markers, server `mergeProgrammeEntry` doesn't.

---

## 8. Invariants (a rewrite must keep all)

Test refs: `ST`=api/test/sync-stamps.test.js, `PS`=api/test/programme-sync.test.js,
`SM`=FE/lib/sync-merge.test.js, `PAR`=FE/lib/sync-stamps-parity.test.js, `US`=FE/store/useStore.*.test.jsx.

**Server protocol**
- INV-1 `_rev` is server-owned; client `_rev` ignored; first write → 1. (server-data-rev.test.js)
- INV-2 `baseRev` mismatch (strict, no coercion; `"4"`≠4) → 409 with current doc + `rev`; refused write changes nothing. (server-data-rev)
- INV-3 Absent/`null` `baseRev` = unconditional overwrite (legacy / forced replace). (server-data-rev)
- INV-4 `baseWid` present (even `null`) must equal stored `_wid` (or null if none) → else 409; absent `baseWid` = rev-only. (server-data-wid)
- INV-5 Every success: new random `_wid`, `_wids` = ancestors capped 50; `/rev` returns `{rev,wid}`. (server-data-wid, server-data-rev-endpoint)
- INV-6 Shape checks (400) precede the conflict check (409). (server-data-rev)
- INV-7 `{}` / `{_rev}` / `{_ts}` state → 400 `state required`; array or non-array `workouts`/`routines` → 400 `invalid state`; null/non-object list items dropped silently. (server-data-rev, server-bad-input)
- INV-8 Body >5 MiB → 413 readable by client, nothing written; bad JSON → 400 no stack. (server-bad-input)
- INV-9 Too-deep nesting → 400, nothing written. (server-bad-input)
- INV-10 Unreadable state file → 503 on GET and PUT, file not replaced. (server-db-unreadable)
- INV-11 `active` never stored. (server-data-rev; persistence.test.js)
- INV-12 `_unstamped`/`_prior` never sent to clients (GET, 409); client copies of them discarded on PUT. (ST "…note stays on the server")
- INV-13 `resetAt` only moves forward on PUT; older/absent → stored `resetAt`+`resetIds` kept; never-reset profile gets no `resetAt` key. (server-data-reset)
- INV-14 Writes are durable (fsync file, rename, fsync dir) and the stat cache never serves a stale rev. (durable.test, server-state-cache-bounds, server-state-read-cost)
- INV-15 Response `rev` = curRev+1 even when stored `_rev` = curRev+2 (`report.changed`). (ST:245)

**Records / clocks**
- INV-16 `deleted` and `edited` never shrink across a PUT (unless the PUT is a newer reset, which keeps its own). (ST:27,80; PAR:87)
- INV-17 `edited` never contains `_wid`/`_wids`; old such stamps removed. (ST:229)
- INV-18 Tombstone vs entry: dropped iff `stamp>0 && stamp >= entryTime`; an edit after the removal keeps it. (SM:718,732)
- INV-19 Add-back (negative) wins equal-magnitude ties regardless of argument order, both sides. (PAR:35-40)
- INV-20 Server `keepHeld`: entry present with a tombstone ≥ its time is kept and marked `-max(t, at+1)`. (ST:68; PAR:87)
- INV-21 A delete is always stamped after the entry it removes (`max(now, time+1)`). (SM:798)
- INV-22 Only keys a change brings in are marked added back; favEx star always stamped. (SM:741,754,766)
- INV-23 Causal lift: every stamp of a change > every stamp in its base copy, regardless of wall clock. (US clock.test; SM:781; tabs.test:183)
- INV-24 Per-field entry merge: later `_f[k]` wins incl. removal; unstamped fields follow the later-`_ts` version; tie → first arg (local). (SM:830,855)
- INV-25 Undo markers: other side's stamp strictly inside `(base,del)` wins and is bumped; Undo wins ties. (PAR:42; SM Undo tests)
- INV-26 Stamped maps: a clear is a stamped entry and beats older choices; later choice beats a clear. (SM:326-425; US balance-sync)
- INV-27 Settings/plan days per key from the side that changed them last; unstamped → newer copy; `prefer` → preferred side. (SM:891-939)
- INV-28 Routine order: `edited.routineOrder`; add/remove is not a reorder; routine only in older copy inserted after its old neighbour. (sync-routine-order.test; SM:276)
- INV-29 Weigh-ins/measurements: one per day, later `t` wins; logging/correcting lifts `t` past highest stamp; unit conversion does not re-stamp. (SM:32,966-980; US clock)
- INV-30 exWeights: better weight per exercise (direction-aware); recomputed for exercises touched by a kept edit or deletion; never resurrects a corrected typo. (SM:135-156)
- INV-31 Workout media: union by hash in kept version's order, also under `prefer`. (SM:439; ServerSync.media.test)
- INV-32 Units never mixed: lead by `unitSet.at`; convert vs relabel (`convert:false`); running workout follows. (SM:486-513; US unit-sync)
- INV-33 Reset: copy unaware of a reset loses exactly `resetIds` entries; without ids, only post-reset entries survive; reset copy's settings win; `resetAt`/`resetIds` monotone (keepReset). (SM:537-657; US reset-sync)
- INV-34 `mergeStates` drops `_rev,_wid,_wids,_unstamped,_prior`; never mutates inputs; commutative on union fields and idempotent. (SM:163,175)
- INV-35 Accent values sanitized on every merge/load. (SM via sanitizeAccent)

**Unstamped writers (old app v1.3.9, API planner, MCP)**
- INV-36 Writer without `stamped:true` and with matching `baseRev` gets changes stamped at server time: removals, settings, plan days, order, entry fields. (ST:27,43; PAR:61)
- INV-37 `keepUnknown`: keys the writer omitted that it could not have dropped (`V139_DROPS`) are restored, recursively incl. ex/entries/sets; ambiguous set lists not guessed. (ST:125,143,162,272; PAR:101)
- INV-38 Stale-copy protection: stored stamp newer than writer's AND sent value previously held (`_prior`) → stored value kept; a never-held value goes through. Field without history → put back. (ST:187,338,374; PAR:115)
- INV-39 Writer that sends no `edited` at all always goes through. (ST:209)
- INV-40 Same unstamped writer changing the same field twice in a row keeps the second change (`_unstamped` fingerprint). (ST:286,318,383)
- INV-41 Stamped writers' (app's) docs are left as sent apart from record joins, programme merge, ownership reconcile, keepHeld, and prescription retention. (ST:56,162)
- INV-42 A reset from an old app is not refilled from the profile it wiped. (ST:176)

**Programmes**
- INV-43 Definitions/cycles/occurrences are union-only; omitting `programmes` (unforked client) never wipes it — on server PUT and client adopt. (PS:38; US sync.test:59,78)
- INV-44 Finished workout beats a skipped occurrence; deleting the log reverts `done` → `pending` and clears date. (PS:29,68)
- INV-45 Occurrence edits merge per occurrence with independent clocks. (PS:7,13,21)
- INV-46 Reset cannot resurrect reset programme ids from either side; re-import of same id after reset keeps the newer record. (PS:44,55,80)
- INV-47 At most one running (active/paused) cycle after any merge; losers archived with `activationConflict`; terminal status beats running. (PS:108; programme-fix1/2)
- INV-48 Unstamped PUT restores newer cycle fields with their clocks. (PS:95)
- INV-49 Authored prescription fields (`setTargets, instructions, open, label, target, setRepsMin, tm, repsMin`) survive a writer that omits them, resized to the new set count. (programme-fix1/2, programme-targets-compat)
- INV-50 `programme-sync.js` and `programme-prescription.js` identical on both sides. (programme.test:115; programme-fix1:39)

**Client flow**
- INV-51 Push carries the tab's own base rev (not another tab's marker). (US tabs:75,96)
- INV-52 409 → merge server doc → re-push against its rev, at most 2 retries; then owed. (US sync:201,219)
- INV-53 Forced replace (reset/import) sends no baseRev once; if it fails, retried as normal conditional push. (US sync:232; tabs:164)
- INV-54 One PUT in flight; asks during flight coalesce to one follow-up. (US sync:250)
- INV-55 Rev rewind / foreign wid at same rev → merge+push, never adopt. (US rev-rewind)
- INV-56 Adopt only when the local copy has nothing owed; merged copy stays "changed" (old base.ts) until pushed. (US sync:90-162)
- INV-57 Non-JSON 2xx (proxy/asset server) is an error, not success; copy stays owed. (US tabs:202; mobile-remote:215)
- INV-58 No pull/push while a sign-in question is open; Keep applies to the server copy at close time. (US adopt-hold)
- INV-59 Sign-in `prefer`: the account's settings/tombstones/reset win; device only adds its entries; guest tombstones never delete account entries; guest reset never becomes account reset. (US signin-safety; SM:246,565)
- INV-60 Sign-out never wipes owed changes silently (stash); running workout stashed. (US sync-status, kept-copy, hold-signout)
- INV-61 Storage-full: marker dropped, copy owed, restart merges instead of adopting. (US quota)
- INV-62 Tabs join each other's saves; another owner's copy never joined. (US tabs-join, tabs-owner)
- INV-63 Legacy v1.3.9 owed copy: first sync lifts its settings via fingerprint search or keeps copy aside; or pushes unstamped so server stamps. (sync-legacy.test; US legacy-upgrade)
- INV-64 Backup restore = add-back of everything it holds + settings stamped now; Replace also tombstones what it replaced (stampReplace). (US import-restore)

---

## 9. Biggest risks for a rewrite

1. **Two hand-copied algorithms** (client merge + server stamping) with partial parity tests and
   known drift (§7). A TS rewrite should share one module; but changing it alters behaviour on edge
   cases (e.g. server `highestStamp` excluding weigh-in `t`).
2. **`rev` lie**: 200 says `curRev+1` while disk holds `curRev+2`. Old-app compatibility depends on it.
3. **Unknown-key semantics differ by `stamped`**: stamped writers can delete keys by omission;
   unstamped ones can't. Strict Zod-like schemas on the server would break passthrough (INV-37, 43).
4. **`_prior` / `_unstamped` hidden server state** affects outcomes and is invisible to clients;
   must be persisted in the same doc (or equivalent) or old-app behaviour regresses.
5. **Derived state written back**: server runs `resolveOccurrences`, `reconcileProgrammeOwnership`
   (mutates routines + `queue` + `edited.queue`) on every PUT — the server is not a dumb store.
6. **Programme union-only** — no way to delete a definition except reset.
7. `coach` chat/log is one LWW setting; nested shapes of `active`, `coach`, `reminder`, workout
   `entries[].target`/`planned` are only partially pinned (see `// UNSURE` in the .ts).
8. JSON-string equality (`JSON.stringify`) is used as the change detector everywhere → **key order
   matters**. A rewrite that reorders object keys (e.g. a schema serializer) will spuriously stamp
   changes / bump `_f` (and on the server, mark `report.changed` → +2 revs).
