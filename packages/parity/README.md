# Rewrite parity harness (test-only)

The checked-in bounded snapshot lives at `fixtures/oracle/`. Its path/SHA256/mode
manifest is anchored by `scripts/verify-public-oracle.ts`; run `bun run legacy:verify`
before executing comparisons. It is independent generic AGPL source, with narrowly
substituted public repository URLs. It is not the historical full-archive freeze.
No athlete exports, private programme bodies or historical acceptance receipts are inputs.

The full public validation entry point is `bun run gate --all`; `bun run gate --list`
lists commands and resource-dependent proof gaps. Supply the declared public dependency graph
through the normal public workspace, never write dependency links inside the frozen snapshot.
The oracle requires `mise` and Node 22.23.3; the harness runs on Bun 1.4.1.
Node is resolved through mise before launch; server and extra-gate processes receive
an empty, owned temporary HOME rather than the host HOME. No process accepts an external DATA_DIR: `startOracle` owns a mode-0700 temp directory,
writes synthetic fixtures and a fixed **test-only** HMAC secret, binds `127.0.0.1` on PORT=0, and reads
the OS-assigned port announcement. The test-only network preload adds a fresh per-run nonce to every response;
startup verifies it with a health request before exposing the oracle. Every subsequent request verifies it too,
and any `tailscale-*` response header immediately fails with a harness error. Requests always use the announced
`http://127.0.0.1:<port>`, preventing IPv4/IPv6 port collisions from reaching another service.
The nonce is removed only after verification, before application parity comparison.
Call `stop()` in finally/onTestFinished; it awaits
child exit before removing the directory. It does not create containers or read live data.
Oracle and server-under-test requests use `directRequest` (`node:http.request` with `agent: false`)
to literal `127.0.0.1:<port>`. Parent HTTP/HTTPS/ALL proxy variables cannot reroute them.
Each oracle socket is authenticated over private parent/child IPC against the child's accepted connections
before HTTP headers, Bearers or bodies are released. A crash or port reuse before dialing fails without
sending HTTP bytes to the replacement listener; an established TCP connection cannot switch peers.
Oracle requests reject `Expect` headers before connecting, because Node eagerly flushes those headers before
socket authorization. Raw-socket server tests own continue/expect semantics. The four F2 data twins also use
the owned oracle transport. Each request
reads the complete response body before returning, including error and redirect bodies;
transport errors propagate without harness retries. Caller-supplied headers stay verbatim.

```ts
import { startOracle, syntheticProfile, TranscriptRecorder, replayTranscript, jsonBody } from '@opengym/parity/index'
const profile = syntheticProfile(20261012)
const oracle = await startOracle(profile)
try {
  const recorder = new TranscriptRecorder(oracle, 'example', profile)
  await recorder.request({ method: 'PUT', path: '/api/data',
    session: { uid: profile.db.users[0]!.id, bearer: true },
    body: jsonBody({ state: { workouts: [], routines: [] }, stamped: true }) })
  const transcript = recorder.snapshot()
  const replay = await startOracle(transcript.profile)
  try { await replayTranscript(transcript, replay) } finally { await replay.stop() }
} finally { await oracle.stop() }
```

Use `session` for harness-minted auth, rather than persisting a raw signed cookie.
Returned runtime responses allow subsequent requests to quote a wid/token/challenge.
The recorder stores identities as placeholders and the replayer resolves them to the
new run's identities. A shared first-occurrence bijection preserves repeated IDs,
ancestry order, rewind branches and token/cookie relationships. Only protocol bookkeeping
locations are normalised; similarly named fields inside unknown data stay verbatim. Malformed wids and
empty cookies stay literal. All response headers from both sides, error codes, status and body bytes
are compared. The sole header ignore-list is `date`, `connection`, `keep-alive` and
`transfer-encoding` (transport timing/framing). Header names are case-insensitive;
`content-length`, security/auth headers and unknown extra headers remain compared.
Introduced legacy tokens must have `uid:expiry[:sv].HMAC` shape with a canonical
43-character base64url SHA-256 signature; empty logout cookies remain literal.
Binary bodies use base64 and are compared unchanged. Socket timing/abort semantics are
not normalised; F3/S01 should test them with a dedicated raw HTTP transport.

Every attempted write records **all stored document bytes**, including rejected writes
and deletes. `ParityTarget.storedDocs()` on the new server must read the authoritative
SQLite JSON bytes as Buffers, not re-stringify objects or use a potentially stale file mirror.
Initial documents and fixture restores are compared too. Byte-span lexical replacement changes
only allowed identity string tokens; whitespace, escapes and key order otherwise survive.

F3 can extend random identity handling with route + JSON pointer selectors, e.g.
`{ 'POST /api/pair/create#/code': 'pair-code', 'POST /api/pair/redeem#/code': 'pair-code' }`.
Prefer scoped selectors to broad field names such as `code` or `id`, which would hide
error-code or user-identity drift. `setTime()` records acknowledged clock changes;
`restoreDocs()` records synthetic backup rewind actions for targets exposing that fixture hook.
Corrupt stored JSON is preserved as raw bytes for unreadable-state scenarios. Unseen
synthetic backup IDs bind after a restore. Literal placeholder text stays user content.
Create/replay one scenario sequentially; fresh targets must be seeded from `transcript.profile`.
`saveTranscript` writes normalised JSON (0600); `loadTranscript` accepts version 2; v1 transcripts must be re-recorded.
Stored and restored documents use lossless `{encoding, data}` envelopes on disk
(UTF-8 only after a byte round-trip check, otherwise base64), decoded to Buffers
before comparison. Synthetic profile seeds remain explicit UTF-8 strings.

`differential({ inputs: fc.tuple(...), legacy, next })` independently clones arguments,
compares returned values/errors **and mutations**, and checks deep equality plus
JSON.stringify bytes. Defaults: fixed seed 20261012, 1000 cases; `PARITY_NIGHTLY=1`
selects 100000. Failures report fast-check's seed/path for reproduction and shrinking.

F2 owns four complete `server-data-*` scenario twins and the harness tests.
The extra gate runs all four untouched legacy data files plus `sync-stamps.test.js`
on Node 22 with the pinned preload inherited by their child servers (26 tests).
K17 owns the stamping module's pure test port; F3 owns complete KEEP-route/INV goldens
and the global API name mapping. F2 does not claim that broader coverage.

## Failure captures and connection reuse

A replay, recording or determinism mismatch writes a uniquely named `<kind>-<name>-run<N>-…capture.json` under `PARITY_ARTIFACT_DIR` (default `packages/parity/.artifacts/`,
git-ignored). It holds the transcript step, the full actual response (body as base64), and the oracle's stdout and
stderr tails, base URL and child PID. Recording captures identify the active step; restore failures identify the restore step without reusing
the preceding response. Determinism captures hold both normalised recordings and the differing step. The error
message names the path; capture-write failures append their own error and preserve the original failure as the cause.
Startup failures are captured too, including startup logs and identity-rejected responses with their full body bytes.
The legacy test-name inventory rejects registrations hidden inside unrecognised syntax instead of silently omitting them.

F3 goldens disable `MEDIA_UPLOADS` on their synthetic oracle to reflect the GM's media-deletion ruling. All four
former media routes return 404; their legacy test names and INV-31 have deletion waivers. Pairing goldens redeem a
code, then use the returned Bearer token in `/api/me` to pin the pairing owner and validate the signature on replay.

Each request uses a fresh socket (the oracle client does not pool connections). With pooling off, parity cannot exercise
keep-alive or pipelining; the raw-socket server tests own that behaviour.

## Checker proof scope

`test/fixtures/I02-synthetic-checker.json` is an invented complete input for the
I02 receipt validator. Its positive case and mutation/missing-row cases test the
validator, including the historical moved-count target of 82. They do not execute
browser, authentication, cache, rollback or container rehearsals. The receipt CLI
requires `--evidence-dir`; actual integration proof remains separately scheduled.

Optional frontend and MCP snapshot runners preserve historical assertions and
fixture-local setup/configuration. Execution uses the declared public dependency
graph in the parity workspace, which differs from the embedded historical lockfiles
(including lean-qr 2.7.3 versus public 2.7.4 and optional UI versions). No execution
against the historical full dependency graph is claimed. Browser builds additionally need separately reviewed static assets
and granted resources; the bounded source verifier does not certify those runs.
