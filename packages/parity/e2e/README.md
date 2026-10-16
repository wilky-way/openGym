# I01 production-browser differential

From the repository root, after `bun install --frozen-lockfile` and installing the
matching reviewed public workspace dependencies with Bun 1.4.1 (the frozen snapshot itself remains immutable):

```sh
bun packages/parity/e2e/I01.mjs
# Public gate checks all six packages and reports browser resource gaps explicitly:
bun run gate I01
# Reproduce signal cleanup independently:
bun packages/parity/e2e/interruption.mjs
```

Requires `agent-browser` (validated with 0.8.5), its local Chromium installation,
and `mise which node --tool=node@22.23.3` for the frozen oracle. Browser actions and
screenshots go through agent-browser. CDP configures software WebAuthn, clocks,
timezones and two isolated device storage contexts; it does not drive app actions.

The same UI script runs against production legacy and rewrite bundles. It creates
and signs into a synthetic passkey profile, logs 42.5 kg × 6 offline, finishes and
reconnects, authenticates a second tab, holds divergent concurrent state writes,
proves the actual server returns 200/409 and the retry body merges both changes,
activates the same library program, checks Today, and accepts a week rollover.
The rewrite additionally ends the cycle and activates the cached library entry
offline, then verifies its identity, active status and queue survive syncing.

Each server/browser binds an ephemeral loopback port. Readiness checks verify a
per-run nonce before credentials are sent. HTTP uses literal loopback requests
with `agent:false`, without proxy environment variables. Data, browser profiles,
raw state documents, PID records and wire counters stay in a private 0700
`/private/tmp/opengym-I01-*` directory; files are 0600. The harness stops its exact
recorded PIDs on success, failure and handled interruption. It uses no containers
and has no live data paths or fixed live ports.

Screenshots, accessibility snapshots and normalized synthetic state comparisons
go to `packages/parity/.artifacts/I01/`. `comparison.json` gives every raw difference a field
path and explanation. Current authored content, logged content, field-clock map
membership, unknown fields and normalized JSON key order must agree. The exact
fixture library location, installation marker, snapshot source clocks, numeric
sync clocks and generated ids are the documented normalization seams.

`--legacy-only` and `--new-only` are diagnostic runs and do not provide differential
acceptance. Set `I01_EVIDENCE` to another evidence directory when desired. Set
`I01_REMOVE_SCRATCH=1` to remove a successful run's scratch directory after cleanup;
failed scratch is retained for investigation. No session carriers or WebAuthn
private keys are written to repository evidence.
