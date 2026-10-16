# NEW sync rule: library offload manifest (contract v1)

Everything in `SYNC-CONTRACT.md` is legacy behaviour the rewrite reproduces exactly. This file is the
**only** intended change to doc semantics. It ships dark in cutover A and is switched on in cutover B
(EXECUTION.md §5).

## Why
`mergeProgrammes` unions `programmes.definitions` by id and has no deletion mechanism except Reset
(SYNC-CONTRACT §5). A plain omission is merged back from the stored doc, and a stale phone copy
re-pushes the whole library (PLAN.md Codex finding 3). Moving 82 inactive definitions to the library
needs an authoritative, clocked "these left the doc" record.

## Shape
```ts
// inside StateDoc.programmes (unknown keys to legacy code, so legacy round-trips them untouched)
offloaded?: Record<DefinitionId, { versionId: string; at: Stamp }>
installed?: Record<DefinitionId, { versionId: string; at: Stamp }>   // explicit install marker (Codex #1)
```
- `versionId` = the library version the definition was moved to (`'sha256:…'`).
- `at` = server stamp of the offload (`max(now, highestStamp(doc)+1)`, the usual causal lift).
- Joined per id by max `at`; equal stamps choose the lexicographically greater `versionId`. Never shrinks except through Reset (`programmesSinceReset`
  drops manifest entries with `at <= resetAt`).

## Rule (server, inside `stampPut`, **before** `stampProgrammes` and `mergeProgrammes`, for every writer)
Why before: legacy `stampProgrammes` gives an unstamped writer's definitions fresh stamps
(`sync-stamps.js:553`), so a `_ts` comparison after stamping would let a stale copy through (Codex #1, probed).
`_ts` is therefore **never** evidence of re-installation. Only the explicit marker is.

1. Join `offloaded` and `installed` from both sides per id by max `at`.
2. For a definition present in either input, an active/paused legacy-normalized cycle referencing its id
   protects it. If joined `offloaded[id]` exists and `installed[id]` is absent or has `at <= offloaded[id].at`,
   synthesize `installed[id] = {versionId: offloaded[id].versionId, at: offloaded[id].at + 1}`.
   The marker survives terminal release until an explicit later offload, making repeated filtering idempotent.
3. A definition `d` (in `next` or the stored doc) with `offloaded[d.id]` is **dropped** from both inputs
   unless (a) a cycle with status `active`/`paused` has `programmeId === d.id`, or
   (b) `installed[d.id].at > offloaded[d.id].at`.
4. Then run legacy stamping and `mergeProgrammes` on the filtered inputs, unchanged.
5. `installed` entries whose definition is present stay. When a terminal cycle releases a definition, nothing
   happens automatically (re-offload is a later explicit `library:offload`).

`report.changed` is computed after step 4 (so a drop for an unstamped writer sets it) and **before** `_rev`
is assigned (legacy step 12), so a drop for an unstamped writer still fires the legacy +2 rev signal and old
clients re-read. The client applies the same rule in `mergeProgrammes` so a merged copy never resurrects a
definition the server would drop (parity test against the server function).

## Install path (new client)
Activation from the library: `GET /api/programmes/library/:id` → put `original_json` into
`programmes.definitions` and set `installed[id] = {versionId, at: stamp()}` → run legacy `activate` unchanged. Offline: the client
uses its IndexedDB library cache (`ETag` from `GET /api/programmes/library`); activation of an
uncached definition fails closed with a toast.

## Required tests (unit S04 / K10)
- stale legacy client (no manifest knowledge) re-PUTs the full library → doc unchanged, library intact;
- two devices offload concurrently → one manifest, no definition lost;
- activate from library after offload → definition installed (`installed.at > offloaded.at`), stays across a stale replay;
- an unstamped stale writer pushing the old library (server stamps it fresh) → still dropped (the probe case);
- a cycle in use is never stripped, even if listed;
- Reset clears the manifest;
- legacy server (a2f2daca/df8bfa03) given a doc with `offloaded` round-trips it unchanged (oracle run).
