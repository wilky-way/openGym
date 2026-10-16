-- OPTIONAL (unit S12, off the critical path; built only if the GM opts in).
-- Not applied unless OPENGYM_PROJECTION=1. Safe to add later: derived data only.

-- ───────────── derived projection (rebuildable; never a source of truth) ─────────────
-- Rebuilt from state_docs.json inside the PUT transaction (full rebuild; gate U-S5 benchmarks it
-- and switches to per-workout diff if p99 > 15 ms at 1,040 synthetic workouts). Dropping these
-- tables and running `bun run projection:rebuild` must reproduce them exactly.
CREATE TABLE p_workouts (
  profile_id    TEXT NOT NULL,
  wkey          TEXT NOT NULL,            -- workout.id, else `${d}|${start}` (legacy workoutKey)
  d             TEXT NOT NULL,            -- 'YYYY-MM-DD'
  start_ms      INTEGER, end_ms INTEGER,
  routine_id    TEXT, cycle_id TEXT, occurrence_id TEXT,
  sets_done     INTEGER NOT NULL,
  volume        REAL,
  PRIMARY KEY (profile_id, wkey)
) STRICT, WITHOUT ROWID;
CREATE INDEX p_workouts_day ON p_workouts(profile_id, d DESC);

CREATE TABLE p_sets (
  profile_id   TEXT NOT NULL,
  wkey         TEXT NOT NULL,
  entry_ix     INTEGER NOT NULL,
  set_ix       INTEGER NOT NULL,
  exercise_id  TEXT NOT NULL,
  d            TEXT NOT NULL,
  w            REAL, r INTEGER, done INTEGER NOT NULL,
  e1rm         REAL,                      -- computed with the profile's oneRmFormula at projection time
  PRIMARY KEY (profile_id, wkey, entry_ix, set_ix)
) STRICT, WITHOUT ROWID;
CREATE INDEX p_sets_ex_day  ON p_sets(profile_id, exercise_id, d DESC);
CREATE INDEX p_sets_ex_e1rm ON p_sets(profile_id, exercise_id, e1rm DESC);

CREATE TABLE p_exercise_stats (
  profile_id  TEXT NOT NULL,
  exercise_id TEXT NOT NULL,
  top_w       REAL, best_e1rm REAL, sets INTEGER NOT NULL, last_d TEXT,
  PRIMARY KEY (profile_id, exercise_id)
) STRICT, WITHOUT ROWID;

INSERT INTO schema_migrations(version, name, applied_at) VALUES (2, 'projection', CAST(unixepoch('subsec') * 1000 AS INTEGER));
