# Porting waivers

Assertion drops are registered in scripts/public-parity-map.json with their explicit reasons below.

## S01

- Pre-header trickle limitation: Bun 1.4.1 exposes an idle pre-header timeout, not Node's absolute `headersTimeout` deadline. `idleTimeout: 60` closes idle peers, but continuously trickled headers require the edge proxy's header deadline; the nginx template explicitly sets `client_header_timeout 60s`. Direct Bun listeners retain this limitation under the coordinator-approved transport ruling (no TCP front door). The absolute framed-body deadline remains enforced in Bun.
- Network-authority plus parent-dot target: raw `//other/../api/health` returns 200 in legacy, but Bun 1.4.1 exposes it as `Request.url = http://x//api/health` before `fetch`, losing `other/..`. Re-parsing that remaining target yields `/health`, so the direct Bun listener returns 404; a wire regression pins this safe refusal. The GM explicitly approved this runtime waiver and ruled out a raw-TCP front door; nginx at the edge normalises these targets anyway. Plain `//other/api/health`, network targets with dots inside the pathname and normal origin-form dot segments retain legacy dispatch behavior and share the CSRF guard.
- S01 retains the framed-body deadline and header-timeout wiring from server-media; upload-only assertions are deleted with exercise-media uploads by the GM ruling.
  Legacy file: 139 assertion sites; retained deadline, completion, drain and listener-wiring tests: 23 sites; allowance: 116.
- server-cors retains all assertion sites but expects the removed native Private-Network-Access header to be absent.
- server-config-session retains all assertion sites; password/media expectations pin deletion, and verified cookie/Bearer callers add the contract `signedIn: true` marker.
- Health uses an injected clock to check the unchanged 5s probe cache without sleeping.

- S01 ports JSON parsing and body caps; route-field, authentication and storage assertions belong to S03/S13 (registration, pairing, logout), S04 (data documents) and S05 (rest-timer fields).
  Legacy file: 46 sites; S01 transport tests: 23 sites; allowance: 23. The two generic test names are retained.

- Deliberate transport ordering exception: an unsafe request with hostile Origin to an unknown route returns CSRF 403 before routing (legacy returns 404); `csrf.test.ts` pins `/api/missing` and `/api/unlisted`. Trusted unknown routes may start bounded body receipt before their 404. Deleted routes still return 404 before CSRF or body receipt.

# Porting waivers

No waivers. Add explicit JSON waivers to scripts/public-parity-map.json for assertion drops, with reasons.

## Deferred, not dropped (S02)

- legacy `durable.test.js` "server.js and media.js write through it": the storage half is ported in
  `test/durable.test.ts` ("storage writers write through atomicWrite"). The `server.js` and `media.js` halves move with
  those modules to S03 and S04, which carry the same source-text assertion against their new paths. No assertion budget
  is waived: the ported file holds more `expect` calls than the legacy twin.

## S03

- S03 ports pairing audit flood suppression and newest-code replacement; the five assertion sites in junk passkey sign-ins and sign-ups are answered but not each written to the audit log belong to S13 with passkey handlers.

## S08 new surface

S08 authors the new programme library and validation HTTP surface; legacy has no library repository or route tests. K13 owns the conformance legacy twins.

## S09 — new migration CLI

S09 authors cutover migration CLI; legacy has no importer, verifier, offload or rollback CLI twins. GET parity uses S04 actual handler and synthetic legacy oracle. Synthetic migration tests cover byte preservation, failure atomicity, data ownership and the explicit ZIP CRC-32 and state-depth oracle exceptions.
## S04

- S04 ports data-body validation, oversize transport, entry filtering and deep nesting; registration/pairing field validation belongs to S03/S13 and rest-timer field validation to S05. Assertion budget: 9.
- S04 ports the named unreadable-state GET/PUT refusal; the three db.json recovery/startup scenarios belong to storage/import units S02/S09. Assertion budget: 12.

- Named OFFLOAD exception `data-offload-bearer` (GM ruling): legacy retained a definition alongside an offloaded marker; unconditional consumption by K10/K17 removes it, even with OFFLOAD_RULE off. Every other F3 sync scenario must replay byte-equal. The legacy transcript remains an oracle/rollback proof; the new route has a separate rule regression.
- The stat-free SQLite rev cache replaces the legacy pinned-mtime cache probe with query-read counts and authoritative generation invalidation. Source assertions pin the S04 rev route; push-language readers remain S05 scope. No assertion count is dropped.
- Path security: S04 mounts fixed paths only; it introduces no decoded ID route parameters. Encoded slash/dot-dot/backslash suffixes have wire 404 regressions.

- Named SQLite nesting oracle exception (GM): Bun 1.4.1 SQLite json_valid accepts at most 800 nested object/array containers (root included), whereas the legacy oracle accepts deeper input. S04 returns 400 invalid state before writing at 801 containers, pins both sides against SQLite, and narrowly translates json_valid CHECK failures to the same refusal. The frozen schema is unchanged. S09 must call assertStateDepth from server/data before importer writes.

- S04 ports the named real GET-data pull assertion with S06 installed; the other admin-state scenarios remain covered by S06. Assertion budget: 20. The six original pull assertions use real list/detail routes, fixed clocks and the durable accounts mirror.

- GM performance gate ruling: the 25 ms planning estimate is superseded by a same-window legacy comparison over 200 PUTs after 20 warmup at 1,040 workouts (~740 KB); new p99 must be <= legacy p99 * 1.1 and < 50 ms. Both distributions, host load and phase breakdown are retained; durability is unchanged.

## S06

- No assertion drops: server-admin-state retains 26 sites; server-admin-delete retains 19.
- The legacy admin-state test "a pull shows as the last sync, in the list and the drill-down"
  exercises the persisted `users.last_pull` seam here. S04 owns the actual GET /api/data transport
  that updates it; I01 must run that path with S06 installed. The test keeps all six assertions
  and verifies admin list/detail timestamps plus the accounts mirror after the persisted pull.
- S05 owns activity/presence TTL and injects `AppServices.admin.livePresence` and `dropPresence`.
  S06 tests a real synthetic presence registry and its disable/delete cleanup callbacks.
- GM security exception: unsafe opaque user ids and invite codes return 400 before lookup.
  Query/body identifiers remain undecoded at the repository boundary. Encoded slash, dot-dot,
  backslash, double encoding and literal hostile body fields have wire regressions.
- The deleted media-upload cleanup call is not ported; historical workout `media` fields are
  still stripped from admin drill-down responses, preserving privacy and the legacy test.
- S13 owns first-user-admin registration and invite consumption on passkey registration;
  S06 owns admin invite create/list/revoke and preserves used codes across user deletion.
## S08 new surface

S08 authors the new programme library and validation HTTP surface; legacy has no library repository or route tests. K13 owns the conformance legacy twins.

## P5 new endpoints and activation seed
New progression HTTP endpoints and activation TM seed resolver; S04 owns legacy data route twins.
Evaluation excludes malformed workout dates with `log.invalid-date`; storage retains legacy date acceptance.

# Porting waivers

Assertion drops are registered in scripts/public-parity-map.json with their explicit reasons below.

## S01

- Pre-header trickle limitation: Bun 1.4.1 exposes an idle pre-header timeout, not Node's absolute `headersTimeout` deadline. `idleTimeout: 60` closes idle peers, but continuously trickled headers require the edge proxy's header deadline; the nginx template explicitly sets `client_header_timeout 60s`. Direct Bun listeners retain this limitation under the coordinator-approved transport ruling (no TCP front door). The absolute framed-body deadline remains enforced in Bun.
- Network-authority plus parent-dot target: raw `//other/../api/health` returns 200 in legacy, but Bun 1.4.1 exposes it as `Request.url = http://x//api/health` before `fetch`, losing `other/..`. Re-parsing that remaining target yields `/health`, so the direct Bun listener returns 404; a wire regression pins this safe refusal. The GM explicitly approved this runtime waiver and ruled out a raw-TCP front door; nginx at the edge normalises these targets anyway. Plain `//other/api/health`, network targets with dots inside the pathname and normal origin-form dot segments retain legacy dispatch behavior and share the CSRF guard.
- S01 retains the framed-body deadline and header-timeout wiring from server-media; upload-only assertions are deleted with exercise-media uploads by the GM ruling.
  Legacy file: 139 assertion sites; retained deadline, completion, drain and listener-wiring tests: 23 sites; allowance: 116.
- server-cors retains all assertion sites but expects the removed native Private-Network-Access header to be absent.
- server-config-session retains all assertion sites; password/media expectations pin deletion, and verified cookie/Bearer callers add the contract `signedIn: true` marker.
- Health uses an injected clock to check the unchanged 5s probe cache without sleeping.

- S01 ports JSON parsing and body caps; route-field, authentication and storage assertions belong to S03/S13 (registration, pairing, logout), S04 (data documents) and S05 (rest-timer fields).
  Legacy file: 46 sites; S01 transport tests: 23 sites; allowance: 23. The two generic test names are retained.

## Deferred, not dropped (S02)

- legacy `durable.test.js` "server.js and media.js write through it": the storage half is ported in
  `test/durable.test.ts` ("storage writers write through atomicWrite"). The `server.js` and `media.js` halves move with
  those modules to S03 and S04, which carry the same source-text assertion against their new paths. No assertion budget
  is waived: the ported file holds more `expect` calls than the legacy twin.

## S03

- S03 ports pairing audit flood suppression and newest-code replacement; the five assertion sites in junk passkey sign-ins and sign-ups are answered but not each written to the audit log belong to S13 with passkey handlers.

## S05

- Security r1 exception (dispatched SSRF fix): refuse endpoints when legacy `url.parse` and WHATWG hostname parsing disagree, including otherwise public noncanonical IP spellings; send only WHATWG `href` to web-push. Stored endpoint identity/status/unsubscribe remain unchanged. The socket Agent independently validates literals, all DNS answers, and connected peers with the existing `ALLOWED_PRIVATE_IPS` exceptions. Named regressions cover the percent-encoded-dot bypass, numeric IP forms, mapped IPv6, rebinding/mixed DNS, local redirects, and zero loopback connections under both Bun and Node 22.

- R2 adapter exception reviewed on 2026-10-13: serverNudgeFor orchestrates scalar missed-day/back-off using core effectiveRoutineIds(...)[0] || null, queueLiveOn, excusedOn and nudge constants. Core list misses differ for malformed falsy IDs; masking dates as rest would change queue pins when a malformed routine has id='rest'. The adapter preserves legacy ordering and UTC lookback, with seeded and targeted legacy-server differentials; no core changes or copied server twin module.

- S05 reminder twin: PUT /api/data array-shape validation (7 assertion sites) belongs to S04; this unit ports every reminder-tick case and adds pinned boundary transcripts.
- English-only ruling changes pt-BR/de/de-CH push-copy expectations to the same English output, preserving every assertion site and legacy test name. Server nudge-copy no longer generates a duplicate translated pool: its twin proves payloads consume the shared core English pool.
- SQLite owns state, so the cache reads committed JSON instead of legacy (mtime,size). The cache-bounds twin retains LRU/TTL tests and proves content invalidation; intentionally preserving a stale out-of-band file revision would violate the storage contract.
- Prune-save failure is injected as EIO after SQLite pruning, without chmod/root skips. Both awaited-send and unattended rest-timer failure cases still prove a serving API and no unhandled rejection.
- Presence twin exercises POST /api/activity and GET /api/admin/users through the merged S06 handlers. A separate seam test proves createApp passes livePresence/dropPresence to admin installation.


## S06

- No assertion drops: server-admin-state retains 26 sites; server-admin-delete retains 19.
- The legacy admin-state test "a pull shows as the last sync, in the list and the drill-down"
  exercises the persisted `users.last_pull` seam here. S04 owns the actual GET /api/data transport
  that updates it; I01 must run that path with S06 installed. The test keeps all six assertions
  and verifies admin list/detail timestamps plus the accounts mirror after the persisted pull.
- S05 owns activity/presence TTL and injects `AppServices.admin.livePresence` and `dropPresence`.
  S06 tests a real synthetic presence registry and its disable/delete cleanup callbacks.
- GM security exception: unsafe opaque user ids and invite codes return 400 before lookup.
  Query/body identifiers remain undecoded at the repository boundary. Encoded slash, dot-dot,
  backslash, double encoding and literal hostile body fields have wire regressions.
- The deleted media-upload cleanup call is not ported; historical workout `media` fields are
  still stripped from admin drill-down responses, preserving privacy and the legacy test.
- S13 owns first-user-admin registration and invite consumption on passkey registration;
  S06 owns admin invite create/list/revoke and preserves used codes across user deletion.
## S13 passkey-only port

S13 removes 39 assertion sites in seven password-only cases and the password-change part of the mixed link case because password login and password proof are deleted; the password-on last-way-in case now asserts passkey-only refusal for both flag values.

S13 removes eight password-registration assertion sites because password registration is deleted; the surviving admin.first-user audit assertion moves to passkey registration, mixed bootstrap cases use passkey registration, and ADMIN_UIDS is asserted through authenticated me instead of the S06-owned admin users route.

S03's five passkey audit-flood assertion sites are now present by name in server-anon-flood.test.ts. Its second phase uses another synthetic address to respect the new 60/min bootstrap burst limit, with ten failures logged per address; no failure bypass is introduced.

### S13 pending-enrollment revocation (authorized security exception)

Passkey removal, device revocation and logout now invalidate all pending add-passkey and device-link enrollments for that user. Completion re-checks the proving credential, proving device, account session version and an auxiliary per-user generation inside the commit transaction. This intentionally closes legacy's stale-proof takeover path. Default v1 cookies retain their existing logout semantics, while their pending enrollment challenges are invalidated too. Imported legacy device-link codes lack proof provenance and must be recreated; user/credential/session formats and the frozen schema are unchanged. `passkey-revocation.test.ts` covers the stolen-device sequence over real loopback TCP, every trigger before/during crypto verification, independent completion-time credential/device checks, and options-generation races.

### S03 fixes on S13 (GM's expanded security round)

Pairing is bound to its initiating device and refuses redemption after that device is deleted or revoked. Device revoke/logout deletes that device's pending pairing codes and links, and bumps the enrollment generation. Logout-all acknowledges its committed revocation even if its accounts mirror fails, with the shared stale-marker/fixed-warning rule. The GM also explicitly ruled that secure-mode plain `gymsid` accepts only a one-time legacy v1 migration and immediately issues Host/clears plain cookies; plain-v2 cookies are rejected. Host-cookie precedence, default nonsecure cookie behavior, and authenticated device-renewal successor provenance are retained. These intentional security exceptions are covered by `auth-pending-revocation.test.ts` and `auth-cookie-migration.test.ts`; no legacy assertion budget is dropped.

## S03/S13 public startup device-token requirement

GM safety ruling, 2026-10-13: startServer refuses public exposure without device tokens before creating the data directory or binding a listener, including callers that pass ServerConfig directly. Private exposure still accepts an explicit legacy-token rollback configuration. Public auth fixtures now explicitly enable device tokens. public-startup.test.ts pins all explicit disabling spellings, no startup side effects on refusal, and successful public/private startup. S10 owns the shipped device-token defaults and configuration guard; this startup check preserves the invariant for direct-config callers too.
## S08 new surface

S08 authors the new programme library and validation HTTP surface; legacy has no library repository or route tests. K13 owns the conformance legacy twins.

- S09 ports the three account recovery scenarios; S04 owns unreadable-state GET/PUT refusal (three assertions). Deleted password registration is represented by a synthetic account creation and rollback mirror; failed imports preserve the unreadable source without making an aside copy. Assertion budget: 3.
## S11 hardening

- Security headers match the legacy nginx edge on all API/standalone-static responses, including refusals. F3 data replay adds the four exact edge-header values to oracle expectations; all original headers, bodies and stored-doc bytes still compare.
- The rate-limit twin retains every test name and assertion budget. The all-kept overflow case intentionally refuses a new key at maxKeys rather than growing without bound; numeric maxKeys must be a positive safe integer.
- Operational logs use fixed messages, omitting configured strings, profile/routine ids and arbitrary transport/exception text. Existing push/reminder source assertions use those fixed messages with no assertion drops. The protected SQLite audit API retains its contract fields (including legacy admin invite identifiers); passkey credentials, bearer/cookie tokens, device-link and pairing secrets never enter it.
- Malformed numeric coercions in presence, push keys and state stamping return 400 instead of 500 before writes, while valid legacy coercions and unknown doc fields are preserved. The coordinator confirmed ignored-body routes retain legacy behavior; the hardening test explicitly inventories them.
- The shared server runner honors the GM quiet-host performance ruling: data-performance runs only under gate --perf / OPENGYM_GATE_PERF=1. Correctness suites and strict TS still run in both timezones.

## P5 integration follow-up: malformed routine preservation

The GM-assigned apply preflight now checks routines alongside workouts, since the shared data writer filters malformed routine elements. Dry-run and apply both reject invalid collection shapes and null/primitive/array members with 422 INVALID_RULES before calling the writer; document and history bytes remain untouched. Missing/null collections retain the already accepted workouts compatibility behavior. Added real API regressions preserve every existing P5 golden, transcript and KEEP assertion; no assertion-count waiver or frozen contract change.

Inline review P2: bulk spread accumulation exceeded Bun's argument limit for a valid-size 1,000,000-null-routine document. Accumulate named issues individually; the production-handler regression fails with RangeError before the fix and passes with 422 INVALID_RULES, all 1,000,000 issue paths, no writer invocation and unchanged bytes after the fix.

## I03 security exceptions (GM, 2026-10-13)

No assertion budget is reduced. Invite-create/revoke audit messages use `[redacted invite]`; the frozen transcript fixture is unchanged and only those expected audit fields are projected explicitly during replay. Account disable increments sv, so re-enable cannot revive a session. CORS allows configured ORIGIN only, and mixed Cookie/Bearer requests retain CSRF checks. Push endpoint reuse by another account is 409. Non-reading routes await receipt bounds before mutation; small malformed ignored bodies keep legacy behavior. New installs default to invite-only and can create the first admin with a one-time setup token in the existing code field, consumed atomically and never mirrored/audited. Parity fixture helpers explicitly set INVITE_ONLY=0 where their frozen oracle assumes open registration. Migration protection uses an explicit OPENGYM_LIVE_DATA_DIR with no machine-specific default. Each change has an I03 regression; frozen wire/schema files remain unchanged.

I03 body-deadline retains every assertion: a trickled known ignored-body logout now returns 408 because bounds are awaited before mutation; unknown/deleted routes keep early 404. Complete small ignored malformed bodies remain unchanged. Session privilege is revalidated after receipt.
