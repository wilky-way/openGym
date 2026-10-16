# MCP contract (v1)

TS on Bun, stdio (`@modelcontextprotocol/sdk`, zod). Runs locally as a stdio process.

## Data access: HTTP only (CHANGED)
Legacy reads `$OPENGYM_DATA/state-<uid>.json` directly with `fs.watch`. The rewrite **does not read the
data dir**: SQLite in WAL mode is unsafe to share across the OrbStack bind mount, and the doc is
~120 KB after offload. Every tool reads `GET /api/data` (cached by `GET /api/data/rev` + `wid`, polled
at most once per tool call) with the agent token. Max decision/compensation tools bypass that read cache, reauthenticate and read fresh full state on every call.

Env: `OPENGYM_URL` (https or loopback http, no credentials, no query), `OPENGYM_TOKEN` (Bearer, from
your local client environment), `OPENGYM_UID` (must equal `/api/me` user id or every tool fails
`PROFILE_MISMATCH`). Write gates unchanged: `OPENGYM_ENABLE_PROGRAMME_WRITES=1`; authoring adds
`OPENGYM_ENABLE_PROGRAMME_AUTHORING=1`.

## Tools (names, params and result JSON identical to legacy unless marked)

| Tool | R/W | Notes |
|---|---|---|
| `list_routines`, `get_routine`, `preview_session`, `get_week_plan`, `list_workouts`, `get_workout`, `get_bodyweight`, `estimate_1rm`, `muscle_balance`, `get_programme`, `programme_position` | R | port 1:1; golden outputs recorded from legacy MCP on the synthetic fixture must match |
| `activate_programme`, `shift_programme`, `skip_programme_session` | W | unchanged conditional write (`expected_rev`/`expected_wid` → PUT with `baseRev`/`baseWid`, no auto-rebase). `activate_programme` CHANGED: if the definition isn't in the doc it installs it from `GET /api/programmes/library/:id` first (OFFLOAD.md install path) |
| NEW `set_training_max` `{cycle_id, lift, value, unit, expected_rev, expected_wid, today?, reason?, apply?, preview_token?}` | preview/W | `apply` defaults false; preview performs no PUT. Explicit `apply:true`, programme-write opt-in and an exact process-local 15-minute preview seal are required. Binds authenticated server/profile/configured credential, normalized action, rev/wid and canonical full document. Fresh `/api/data/activity` must be idle; unsupported/unknown fails closed. One `stampChange`-stamped conditional PUT with `requireIdle:true`; W36 atomically fences agents. Never sends active/close proofs, retries or rebases. Positive finite value and explicit `lb`/`kg` use the shared core helper; appends audited history and preserves seed/logs/extensions. See [max semantics and matched-server requirement](../../../docs/MAX_ADJUSTMENTS.md). |
| NEW `undo_training_max` `{undo_token, today?, apply?, preview_token?}` | preview/W | Preview by default; explicit apply and its own preview seal append an audited compensating absolute max, referencing the original id. Exact post-apply rev/wid/full fingerprint/target and same auth/gate required. Original history is never deleted. No prior max means no safe undo. Undo seals expire after one hour; uncertain writes return no replay/undo token and require fresh inspection before a new action. |
| NEW `list_programmes` | R | `GET /api/programmes/library` summary |
| NEW `validate_program` `{definition? \| draft_id? \| programme_id?}` | R | pure; no token needed for `definition` |
| NEW `create_program_draft`, `get_program_draft`, `list_program_drafts`, `delete_program_draft`, `patch_program_draft` (+ sugar `set_slot`, `set_slot_targets`, `set_progression`, `set_program_metadata`, `repeat_week`, `generate_deload`) | drafts | PROGRAM-API.md types and op list verbatim (`DraftOp`, `DeloadPolicy` with **no defaults**). Store: host `bun:sqlite` at `$OPENGYM_AUTHORING_DIR/drafts.db` (platform-specific application-data directory, described in [MCP README](../../mcp/README.md)), **refuses a path inside any git work tree** (walk up for `.git`, resolve symlinks, case-fold on macOS). Drafts stay local to the MCP host |
| NEW `diff_programs` | R | keyed by week.index/day.key/sessionTemplateId/slotId |
| NEW `publish_program_draft` `{draft_id, expected_rev, expected_parent_version_id, replace?}` | library | `PUT /api/programmes/library/:id` with `minLevel:'Ready'`. Never touches the state doc (CHANGED from PROGRAM-API, which upserted into the doc; the library now lives outside it) |
| NEW `validate_progression` `{definition? \| draft_id? \| programme_id?}` | R | `ProgressionValidateResult` (domain/progression.ts); pure |
| NEW `preview_progression` `{source, cycle_id?, weeks, as_of?, hypothetical_logs?}` | R | `POST /api/progression/preview`; output summarised per week with every load's Why (full with `full:true`) |
| NEW `apply_progression` `{cycle_id, weeks, expected_rev, expected_wid, dry_run?}` | W | gated by `…_PROGRAMME_WRITES=1`; `POST /api/progression/apply`; refuses during an active session (`TRAINING_NOW`); `dry_run` defaults **true** |
| NEW draft ops `setProgressionRules` / `attachRule` / `detachRule` (+ sugar `set_progression_rule`) | drafts | rules are `ProgressionRule` JSON; validated on every op; a draft with progression issues can't publish |
Seed export is not a shipped MCP tool. Do not export private programme bodies; review provenance and license before sharing a definition.

Errors: `{isError:true}` with text `CODE: message`, codes from PROGRAM-API `AuthoringErrorCode`.
Tool output is capped (summaries by default; `full:true` for whole definitions).
