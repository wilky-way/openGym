# Porting rules for every unit (contract v1)

The rewrite is a **behaviour-preserving port to strict TypeScript on a new server**, not a redesign.
That is what makes 4,893 frontend tests, 110 MCP tests and the recorded API transcripts usable as gates.
These rules are part of the frozen contract.

## R1. Layout (Bun workspaces)
```
packages/contract   types + zod request schemas + generated model types (from contract/ verbatim)
packages/core       pure domain (no DOM/React/storage/fetch); runs in browser, Bun server, MCP
packages/server     Bun.serve + Hono + bun:sqlite
packages/web        React 19 + Vite 8 PWA (TS/TSX)
packages/mcp        MCP server (Bun, stdio)
packages/parity     oracle runner, transcript recorder/replayer, differential helpers (dev-only)
packages/parity/fixtures/oracle/  bounded independent public oracle snapshot; separately hash/mode verified
catalogue/          unchanged, byte-identical
```

## R2. One module in, one module out
`frontend/src/lib/foo.js` → `packages/core/src/foo.ts` (pure) or `packages/web/src/lib/foo.ts`
(browser). Same file stem, same **export names and signatures** (types added, never renamed). Views and
components keep their file names (`.jsx` → `.tsx`). The zustand stores keep their public API
(`useStore.getState/setState`, `useUI.getState().sheets`, `ui().openSheet`) because ~680 tests drive it.
Allowed structural changes, and only these:
- split a file >1,500 LOC along the line ranges in EXECUTION.md §3 (re-export from the old stem);
- break the two cycles (store ↔ sheets via an injected prompt service; media-sync → useUI via an
  injected notifier);
- `exercises.ts` takes the exercise index as a parameter instead of mutating a module global
  (`registerCustom` stays as a thin compatibility wrapper used by the web only);
- server twins (`api/queue.js`, `programme-calendar.js`, `programme-sync.js`, `programme-prescription.js`,
  `nudge.js`) are **not** ported: the server imports `packages/core`. Exception: `api/sync-stamps.js` IS
  ported, separately, as `core/src/server-stamp.ts` (see R5).

## R3. Deleted, never ported
AI Coach (`lib/coach*.js`, `views/Coach*.jsx`, `views/AdminCoach.jsx`, `coach.css`, `api/coach/**`), all
Capacitor/native code (list in EXECUTION §1.4), password login, the 17 non-English locale packs
(`t()`/`tn()` stay as an English passthrough; `instr/en.js`, `exercise-desc/en.js` stay), Helm, k8s,
Nix, website, gitea/gitlab CI. Code inside kept files that branches on `MOBILE`, Capacitor or Coach is
removed with the branch's non-web side; each removal is listed in the unit's PR notes.

## R4. Tests port with their code
- Every legacy test file of the unit's modules is ported in the same unit, with the same `describe`/`it`
  names. `bun run parity:assert-count <unit>` fails if a ported file has fewer `expect(`/`assert`
  calls than its legacy twin, unless the drop is listed in `packages/<pkg>/PORTING-WAIVERS.md` with a
  reason (deleted feature, source-text assertion rewritten against the new path, …). Codex checks every
  waiver.
- Tests that read source text (`readFileSync` of CSS/JSX/sw.js; 43 files) are rewritten to assert the
  same property against the new path. Same assertion count rule.
- No test may depend on the wall clock or the host TZ: use `vi.setSystemTime`/injected clocks. The gate
  runs each package twice, `TZ=America/Chicago` and `TZ=UTC`; nightly also at a DST boundary date.
- Runners: `packages/server` → `bun test` (own process per file via `bun run test`); everything else →
  `bun --bun vitest run` (MCP with `--pool=vmThreads`). Node is never required.

## R5. Two sync algorithms stay two
Legacy has a client merge (`lib/sync-merge.js`) and a server stamper (`api/sync-stamps.js`) that have
already drifted (server ignores weigh-in `t` in `highestStamp`; only the client prunes 180-day setting
stamps; the server's programme merge ignores Undo markers). The port reproduces **each side's legacy
behaviour exactly** and records the three drifts as named tests. Unifying them is out of scope.

## R6. Differential tests against legacy
Units owning a pure module listed in EXECUTION §4.3 add a `*.diff.test.ts` that imports the legacy JS
from the bounded public oracle snapshot and the new TS, runs both on fast-check inputs (seeded; 1,000 runs in the gate, 100,000
nightly) and asserts deep equality **and** `JSON.stringify` equality (key order).

## R7. Strict TS
`strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: false`, TS 7. No `any` in
`packages/core` and `packages/server` outside `// legacy-shape:` commented lines that touch `[k: string]:
unknown` passthrough data. `@ts-expect-error` needs a reason.

## R8. Privacy
No BBM/SBS content, no real training data, no tokens in any file in the repo, fixture or snapshot.
Fixtures are synthetic (`core/test/fixtures/synthetic-*.ts`, seeded). The private-library guard test
(MCP `private-library-guard`) is ported and runs in every gate.

## R9. Shell-agnostic web (Tauri-ready)
`packages/web` reaches storage, the service worker, navigation and the network only through
`contract/platform/adapters.ts` (`Platform`), injected at boot in `main.tsx`. Direct `localStorage`,
`indexedDB`, `navigator.serviceWorker`, `window.location` or `fetch` outside `packages/web/src/platform/` fails
`lint:boundaries`. The API base URL comes from `platform.server.baseUrl()` (per device; '' = same origin),
never from a build constant. The browser implementation must stay byte-compatible with legacy localStorage keys.

## R10. Server runs anywhere
`packages/server` must run as `bun build --compile` single binary as well as in Docker: config only from
flags/env (`--data-dir`/`DATA_DIR`, `--port`/`PORT`, `--host`/`HOST`, optional `--static-dir`/`STATIC_DIR`
to serve the web `dist` and `exercise-media` without nginx), migrations embedded as text imports, no reads
relative to the source tree at runtime.
