-- openGym rewrite — SQLite schema v1 (bun:sqlite). Frozen contract; see ../STORAGE-CONTRACT.md.
-- Opened with: PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;
--              PRAGMA busy_timeout=5000;  (bun:sqlite Database(path, { strict: true, create: true }))
-- File: $DATA_DIR/opengym.db, mode 0600, dir 0700. Migrations run in one transaction each at boot,
-- recorded in schema_migrations; a failed migration aborts boot (fail closed, never half-applied).

CREATE TABLE schema_migrations (
  version     INTEGER PRIMARY KEY,
  name        TEXT    NOT NULL,
  applied_at  INTEGER NOT NULL            -- ms epoch
) STRICT;

CREATE TABLE meta (
  key   TEXT PRIMARY KEY,                 -- 'instance_id', 'imported_from', 'json_mirror' …
  value TEXT NOT NULL
) STRICT;

-- ───────────── accounts (was db.json) ─────────────
-- Column-per-field for what the server queries; `x` keeps every other legacy field verbatim (JSON
-- object) so an import → export of db.json round-trips. Password fields (pw, pwReset, email) are
-- dropped by the importer (password login deleted) and logged in the import report.
CREATE TABLE users (
  id            TEXT PRIMARY KEY,         -- 16-char base64url
  name          TEXT NOT NULL,
  created       TEXT NOT NULL,            -- ISO string as legacy stores it
  admin         INTEGER NOT NULL DEFAULT 0 CHECK (admin IN (0,1)),
  disabled      INTEGER NOT NULL DEFAULT 0 CHECK (disabled IN (0,1)),
  sv            INTEGER NOT NULL DEFAULT 0,   -- session version ("sign out everywhere")
  invited_by    TEXT,
  last_pull     INTEGER,                  -- ms
  last_reminder TEXT,                     -- 'YYYY-MM-DD'
  last_nudge    TEXT,
  ord           INTEGER NOT NULL,         -- legacy array order (admin list, first-user logic)
  x             TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(x))
) STRICT;
-- No uniqueness on name: legacy passkey registration never checks it (Codex #14). Import must accept duplicates.

CREATE TABLE creds (
  id          TEXT PRIMARY KEY,           -- credential id (base64url)
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key  TEXT NOT NULL,              -- base64url
  counter     INTEGER NOT NULL,
  transports  TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(transports)),
  created     TEXT,
  last_used   TEXT,
  name        TEXT,
  ord         INTEGER NOT NULL,
  x           TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(x))
) STRICT;
CREATE INDEX creds_user ON creds(user_id);

CREATE TABLE push_subs (
  endpoint    TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  device_id   TEXT,
  created     TEXT,
  ord         INTEGER NOT NULL
) STRICT;
CREATE INDEX push_subs_user ON push_subs(user_id);

CREATE TABLE invites (
  code        TEXT PRIMARY KEY,           -- 16 hex upper
  note        TEXT NOT NULL DEFAULT '',
  created_by  TEXT,
  created     TEXT,
  used_by     TEXT,
  used_at     TEXT,
  revoked     INTEGER NOT NULL DEFAULT 0,  -- read-only legacy flag; revoke deletes the row
  ord         INTEGER NOT NULL
) STRICT;

-- Per-device sessions (contract api.ts "per-device tokens"). One row per signed-in browser, paired device,
-- agent (local host MCP) or native shell. Revoking a row kills that device's token only.
CREATE TABLE devices (
  id          TEXT PRIMARY KEY,           -- 16-char base64url; legacy tokens map to 'legacy:<16 hex>'
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('browser','paired','agent','native','legacy')),
  name        TEXT NOT NULL DEFAULT '',
  sv          INTEGER NOT NULL,           -- copy of users.sv at mint; mismatch → invalid (sign out everywhere)
  created     INTEGER NOT NULL,
  last_seen   INTEGER,                    -- updated at most once per 10 min
  revoked_at  INTEGER
) STRICT;
CREATE INDEX devices_user ON devices(user_id);

CREATE TABLE device_links (
  h        TEXT PRIMARY KEY,              -- sha256('opengym-link:' + clean(code))
  user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exp      INTEGER NOT NULL,
  created  INTEGER NOT NULL
) STRICT;

CREATE TABLE audit_events (
  id    INTEGER PRIMARY KEY,              -- monotonic, never reset (legacy: ids survive clear)
  ts    INTEGER NOT NULL,
  ev    TEXT NOT NULL,
  ok    INTEGER NOT NULL CHECK (ok IN (0,1)),
  uid   TEXT, name TEXT, tgt TEXT, tname TEXT, msg TEXT, act TEXT, ip TEXT
) STRICT;
CREATE INDEX audit_ts ON audit_events(ts);

-- ───────────── the state doc (truth for /api/data) ─────────────
-- One row per profile holding the EXACT text legacy would have written to state-<uid>.json
-- (JSON.stringify of the stored doc, incl. server-only _unstamped/_prior; key order preserved).
-- Not normalised on purpose: sync change detection compares JSON.stringify output, unknown keys must
-- round-trip, and whole-doc sync is the agreed end state (DECISIONS #8). Queries use the derived
-- p_* projection below. See STORAGE-CONTRACT.md §2 for why this differs from STORAGE.md's prototype.
CREATE TABLE state_docs (
  profile_id  TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  rev         INTEGER NOT NULL,           -- == json._rev (stored value, may be curRev+2)
  wid         TEXT,                       -- == json._wid
  json        TEXT NOT NULL CHECK (json_valid(json)),
  bytes       INTEGER NOT NULL,           -- length in UTF-8 bytes; size guard + metrics
  updated_at  INTEGER NOT NULL
) STRICT;

-- Last N committed versions per profile (STATE_HISTORY_KEEP, default 30) for recovery drills and
-- the "data rewound" investigation. Written in the same transaction as state_docs. Never served.
CREATE TABLE state_doc_history (
  profile_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rev         INTEGER NOT NULL,
  wid         TEXT NOT NULL,
  json        TEXT NOT NULL,
  written_at  INTEGER NOT NULL,
  PRIMARY KEY (profile_id, wid)
) STRICT;
CREATE INDEX state_doc_history_time ON state_doc_history(profile_id, written_at DESC);

-- ───────────── programme library (outside the doc; DECISIONS #4) ─────────────
-- Canonical bytes (sorted keys, no whitespace) keyed by their digest: the semantic identity of a version.
CREATE TABLE library_bodies (
  sha   TEXT PRIMARY KEY,                 -- 'sha256:' + hex of `json` below
  json  TEXT NOT NULL CHECK (json_valid(json)),   -- CANONICAL JSON
  bytes INTEGER NOT NULL
) STRICT;

CREATE TABLE library_definitions (
  profile_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id           TEXT NOT NULL,             -- definition.id (stable slug)
  head_n       INTEGER NOT NULL,
  head_sha     TEXT NOT NULL REFERENCES library_bodies(sha),
  name         TEXT NOT NULL,
  level        TEXT NOT NULL CHECK (level IN ('Invalid','Valid','Complete','Ready')),
  private      INTEGER NOT NULL CHECK (private IN (0,1)),
  source_kind  TEXT,
  days_per_week INTEGER, length_weeks INTEGER, goal TEXT,
  updated_at   TEXT NOT NULL,             -- ISO
  PRIMARY KEY (profile_id, id)
) STRICT, WITHOUT ROWID;

CREATE TABLE library_versions (
  profile_id      TEXT NOT NULL,
  definition_id   TEXT NOT NULL,
  n               INTEGER NOT NULL,       -- 1,2,3… per definition
  sha             TEXT NOT NULL REFERENCES library_bodies(sha),
  parent_sha      TEXT,
  level           TEXT NOT NULL,
  published_at    TEXT NOT NULL,
  origin          TEXT NOT NULL CHECK (origin IN ('migration','api','mcp')),
  original_json   TEXT NOT NULL CHECK (json_valid(original_json)), -- exactly as submitted (key order kept); this is what gets installed into the doc
  PRIMARY KEY (profile_id, definition_id, n),
  FOREIGN KEY (profile_id, definition_id) REFERENCES library_definitions(profile_id, id) ON DELETE CASCADE
) STRICT, WITHOUT ROWID;

-- Public compatibility and regression coverage.
-- Blobs stay on disk at $DATA_DIR/uploads/<uid>/<sha256>.<ext> exactly as legacy. This table
-- replaces uploads/<uid>/.gc.json and the in-memory index.
CREATE TABLE media_objects (
  profile_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hash              TEXT NOT NULL,        -- sha256 hex
  mime              TEXT NOT NULL,
  ext               TEXT NOT NULL,
  size              INTEGER NOT NULL,
  unreferenced_since INTEGER,             -- ms; NULL while referenced by the doc
  PRIMARY KEY (profile_id, hash)
) STRICT, WITHOUT ROWID;

INSERT INTO schema_migrations(version, name, applied_at) VALUES (1, 'init', CAST(unixepoch('subsec') * 1000 AS INTEGER));
