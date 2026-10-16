# Storage contract (v1)

DDL: `migrations/0001_init.sql` (required), `migrations/0002_projection_OPTIONAL.sql` (unit S12, opt-in).
Both apply cleanly under `bun:sqlite` 1.4.1 (checked 2026-10-12).

## 1. Files under `$DATA_DIR`

| File | Writer | Notes |
|---|---|---|
| `opengym.db` (+`-wal`, `-shm`) | server | 0600; WAL; `synchronous=FULL` |
| `secret`, `vapid.json` | server (first boot, if absent) | **reused unchanged** from legacy: same HMAC secret means existing sessions and the agent token stay valid across cutover; same VAPID keys keep push subscriptions valid. Written tmp + fsync + rename (legacy didn't fsync) |
| `state-<uid>.json` | server JSON mirror | written after every committed PUT while `STATE_JSON_MIRROR=1` (enabled by default). Exact legacy bytes. This is what the rollback image reads |
| `db.json` (+`.bak`) | server JSON mirror | same mirror rule for accounts (users, creds, subs, invites, deviceLinks), legacy shape |
| `audit.log` | — | imported once into `audit_events`; no longer appended (UNSURE: mirror it too? not needed for rollback) |
| `uploads/<uid>/…` | server (media, if kept) | unchanged layout |
| `backups/opengym-YYYY-MM-DD.db.zst` | operator backup job | outside `DATA_DIR` |

Mirror writes use a **unique** temp name (`<file>.<pid>.<rand>.tmp`), fsync, rename, fsync dir.

## 2. The state doc is stored verbatim (deliberate departure from STORAGE.md's normalised prototype)

`state_docs.json` holds exactly the text legacy would write to `state-<uid>.json`. Reasons, all from
the sync contract: change detection compares `JSON.stringify` output, so key order is significant;
unknown keys and `_unstamped`/`_prior` must round-trip; missing-key semantics differ by writer; and
whole-doc sync is the agreed end state (DECISIONS #8). STORAGE.md's round-trip test compared
*sorted-key* JSON, which would hide exactly the reorderings that break sync. After the library offload the
doc is ~120 KB, so a whole-row write is cheap (benchmark gate in S04: p99 PUT < 25 ms at 1,040
synthetic workouts).

## 3. PUT /api/data transaction (normative ordering)

```
BEGIN IMMEDIATE
  cur = SELECT json FROM state_docs WHERE profile_id = ?
  … legacy steps 8–13 (SYNC-CONTRACT §3.3) using core/server-stamp, then the offload rule …
  text = JSON.stringify(next)                       -- same serializer call as legacy
  if bytes(text) > 5 MiB → ROLLBACK, 413 (legacy has no such check; NEW guard, logged)
  UPSERT state_docs; INSERT state_doc_history; prune history beyond STATE_HISTORY_KEEP
COMMIT                                               -- durable (synchronous=FULL) before the 200
mirror state-<uid>.json (tmp+fsync+rename)           -- failure logs + raises the stale-mirror flag, never fails the 200
respond 200 {ok, ts, rev: curRev+1, wid}
```
Boot (write-ownership rule, Codex #2/#3): `meta.write_owner` is `sqlite` or `legacy`.
- `sqlite`, mirror `_wid` equals `state_docs.wid` → normal.
- `sqlite`, mirror `_wid` is in `state_doc_history` (mirror merely behind) → rewrite the mirror.
- mirror `_wid` **unknown** to SQLite (legacy wrote after a rollback) → **refuse to serve**, log `LEGACY_WRITES_DETECTED`,
  and require `bun run import --reconcile`, which re-imports every legacy JSON file in one transaction (JSON wins:
  it descends from the last SQLite state), then sets `write_owner=sqlite`. SQLite never overwrites newer JSON.

Rollback to legacy (`bun run rollback:prepare`, run with the new api stopped): export every profile and `db.json`
from SQLite to the mirrors, verify each file byte-equal to `state_docs.json` / the account export, set
`write_owner=legacy`, print the verification. If any file fails, abort; do not start the legacy image. A mirror
failure during normal running already raises the stale-mirror flag; `rollback:prepare` is what makes rollback safe
regardless.
The compare-and-write is serialised by `BEGIN IMMEDIATE` (one writer), replacing legacy's
"no await between read and write".

## 4. Library

- `library_bodies` holds **canonical** JSON (recursively sorted keys, no whitespace) keyed by
  `'sha256:' + hex(sha256(canonical))`: the semantic identity, shared by equal versions.
  `library_versions.original_json` holds each version **as submitted** (original key order); that is what gets
  installed into the doc and what `GET /api/programmes/library/:id` returns.
- Versions are immutable; `head_n`/`head_sha` move on publish; nothing is deleted automatically.
- Migration (S10) inserts every definition from the legacy doc with `origin='migration'`, `n=1`,
  level from conformance validation.
- Private flag: `source.private === true` **or** id prefix `bbm-`/`sbs-` (legacy `importProgramme`
  rule). Private bodies must remain in local storage and backups; review provenance before sharing.

## 5. Backup and restore

- An operator-managed backup schedule: before cutover → `GET /api/data` via the
  agent token to `api-data-YYYY-MM-DD.json` + data-dir tgz; after cutover → `VACUUM INTO` a temp file,
  `PRAGMA integrity_check`, zstd, plus the JSON export. All files 0600.
- Restore: stop api → copy `.db` back → `integrity_check` → start. Or `bun run import` from any
  JSON backup. Both rehearsed in unit I02.
- `bun run backup:verify <file>` opens a backup read-only, runs integrity_check, exports every doc, and
  checks each against its recorded sha256.

## 6. Migrations

Forward-only, numbered, one transaction each, at boot. A failure aborts boot with the old DB untouched
(the transaction never commits). Any schema change after freeze is a contract change (README §change).
