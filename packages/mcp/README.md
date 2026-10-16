# openGym MCP

The local Bun process speaks MCP over stdio to Claude/Codex. Every profile read and write goes over
HTTP to the API with a Bearer agent credential; it never opens the server's data directory or SQLite
file. Local authoring works without API credentials. Each HTTP-backed profile tool verifies `/api/me` before accessing data;
unavailable or partially configured APIs do not block local draft tools.

Configure these environment variables in your MCP client's launch configuration:

| Variable | Meaning |
| --- | --- |
| `OPENGYM_URL` | Server base URL. HTTPS, or HTTP on localhost/127.0.0.1/::1; no credentials, query or fragment. |
| `OPENGYM_TOKEN` | Agent Bearer credential, supplied outside the repository. |
| `OPENGYM_UID` | Profile ID; must equal the authenticated `/api/me` user ID. |
| `OPENGYM_AUTHORING_DIR` | Private local draft directory; defaults to `~/Library/Application Support/opengym-authoring` on macOS, `$XDG_DATA_HOME/opengym-authoring` (or `~/.local/share/opengym-authoring`) on Linux, and `%LOCALAPPDATA%/opengym-authoring` on Windows. Overrides must be outside git work trees and cloud sync roots. |
| `OPENGYM_ENABLE_PROGRAMME_AUTHORING` | Set to `1` to create, edit or delete personal drafts; independent of programme writes. |
| `OPENGYM_ENABLE_PROGRAMME_WRITES` | Set to `1` to enable conditional programme actions, reviewed max applies and workout log/undo writes; otherwise disabled. |

Launch from the repository with `bun packages/mcp/src/index.ts`. Reserve stdout for MCP JSON-RPC;
startup errors go to stderr. An operator provisions `kind=agent` credentials **in-process** through
the server auth service; pairing redemption mints `kind=paired` and is not an agent-mint endpoint.
There is no HTTP MCP listener in this unit.

The fourteen tools retain the legacy names, schemas and JSON results:

- `list_routines`, `get_routine`, `preview_session`, `get_week_plan`
- `list_workouts`, `get_workout`, `get_bodyweight`, `estimate_1rm`, `muscle_balance`
- `get_programme`, `programme_position`
- `activate_programme`, `shift_programme`, `skip_programme_session`

Each of these original profile tools verifies the profile and polls `/api/data/rev` once. Cached data is refreshed when either
revision or write identity changes, including a same-revision restore. Renewed tokens stay in memory
and reset when endpoint, configured token or profile changes. HTTP requests dial directly and never
follow redirects.

Writes require the `expected_rev` and `expected_wid` from a fresh programme read. The API receives
`baseRev` and `baseWid`; a conflict is returned without retrying or rebasing. Activation of a definition
missing from the state installs the library's original definition plus a causal `installed` marker,
then runs the existing activation guards and one conditional state PUT. The active-cycle and workout
guards remain in force. `appliedRev` reports the PUT's acknowledgment; `rev` is the readback revision
and can be higher when server stamping signals a merge.

Verify with `bun run gate M01` from the repository root. Tests use only synthetic temporary servers
on OS-assigned loopback ports, check server identity and reject Tailscale response headers. The golden
suite compares all fourteen legacy outputs and replays each write against the S04 API.


Twelve authoring tools use host `drafts.db`: `validate_program`, `create_program_draft`,
`get_program_draft`, `list_program_drafts`, `delete_program_draft`, `patch_program_draft`, `set_slot`,
`set_slot_targets`, `set_progression`, `set_program_metadata`, `repeat_week`, `generate_deload`.
All drafts are personal and private, never synced into the state document. Clone source exercise
metadata is retained locally so custom exercises still validate without a server round trip.
The draft store requires a macOS or Linux host for directory-relative, no-follow filesystem operations.

Creation takes `from: "scratch"` with `name` and `unit` (or `definition`), `from: "clone"` with one of
`definition`, `draft_id`, `programme_id`, or `from: "import"` with `format: "json" | "library"` and
`content`. Saved programme cloning/validation reads through the authenticated HTTP API. Structural
and progression issues remain visible; unfinished drafts can be Invalid. Missing session and slot
identities are assigned once. Patch operations address stable identities and commit atomically. Invalid conformance levels are allowed for work in progress; malformed operations and prescription changes inconsistent with retained per-set loads or targets are rejected without writing or advancing the revision.
Stale `expected_rev` produces `REV_CONFLICT` and the current revision. Metadata cannot clear privacy.

`repeat_week` requires `fromWeek`, `copies`, and explicit `keep: {targets, rules}` booleans.
`generate_deload` takes `afterWeek` and an explicit week or a factor policy with **all** of
`fromWeek`, `setsFactor`, `loadFactor`, and `effort` (RIR/RPE). It previews without changing the
stored draft; only `confirm: true` commits the insertion. Preview JSON is capped by default;
`full: true` explicitly returns the entire generated week. Factor policies remove copied automatic
slot rules, explicitly disable automatic progression for the authored deload, remap existing week references, and scale assisted loads in the opposite direction. No cycle or state is changed.

Limits are 50 drafts, 5 MiB per draft, 100 MiB stored JSON, 64 weeks, 100 slots per session, and
10,000 working sets. Summary output is capped at 64 KiB, issues at 200; full JSON is explicit via
`get_program_draft {draft_id, full: true}`. Database files are mode 600 and cannot be symlinks or
hard links. Authoring directories are mode 700, including existing directories. User directory symlinks and iCloud, CloudStorage, Dropbox, OneDrive, and Google Drive roots are refused after resolving the physical path. File opens forbid symlinks and verify device/inode identity before any database writes; repository checks cover case variants and worktree `.git` files.
Verify with `bun run gate M02`.

`list_programmes {offset?, limit?}` returns authenticated library summaries (`items` and `etag`), including
privacy, head version and active use. Large results are capped with `nextOffset` for pagination;
long metadata strings are shortened. `diff_programs {from, to, full?}` accepts
`draft:<id>[@rev]` and `def:<id>[@versionN|versionId]`; definitions without a version use the
library head, or an installed definition when absent from the library. Two local drafts need
no API credentials. Diffs use week index, day key, sessionTemplateId and slotId, report order
changes separately, and include resolved/introduced conformance issues. Details are capped
unless `full:true` is supplied. Changed collections without unique stable identities fail
with `EINVAL`; unchanged anonymous legacy collections still allow metadata comparisons.

Drafts are never automatically published. `publish_program_draft` requires `draft_id`,
`expected_rev`, and `expected_parent_version_id` (null for a new library entry). It defaults
to a read-only dry run; `confirm:true` alone still previews. Writing requires **both**
`dry_run:false` and `confirm:true`, plus both authoring and programme write environment gates.
An existing library id additionally requires `replace:true`. Publication uses the draft's own
definition id (a clone has a new id) and `PUT /api/programmes/library/:id` with `minLevel:'Ready'`.
Non-Ready drafts, active/paused definitions, non-private personal drafts, invalid opaque library
ids and stale draft/parent revisions are refused. The server repeats the library checks atomically.
Publishing keeps the draft, its revision, and the state document unchanged. Verify with `bun run gate M03`.
# Progression authoring

`validate_progression` accepts exactly one of `definition`, `draft_id`, or
`programme_id`. Supplied JSON and local drafts validate without an API token;
programme IDs read the authenticated profile or library over HTTP. Draft validation
uses the custom catalogue saved with that draft; remote validation uses the current
profile catalogue.

Local results and errors (including SDK argument validation and draft diffs) use
the same redactor as HTTP progression diagnostics before any output truncation.
Configured and retained renewed tokens, their payload/signature segments of at
least eight characters, Bearer values and Cookie header values are redacted in
output views; stored draft definitions remain verbatim. Local validation never
needs an HTTP request to redact a credential.

`preview_progression` takes `source:{definition}`, `source:{definitionId,versionId?}`,
or `source:{draft_id}`, plus `weeks`, optional `cycle_id`, `as_of`, and
`hypothetical_logs`. It calls `/api/progression/preview` without writing state.
Each week contains stable slot references and every set's load, reps, effort and
Why (`ruleId`, `kind`, `text`). `full:true` includes Why inputs and the TM timeline.
Summaries over 128 KiB refuse with `TOO_LARGE`; request fewer weeks or full output.

`apply_progression` requires `cycle_id`, `weeks`, `expected_rev`, `expected_wid`,
and the human's explicit `confirmNoActiveSession:true`. It defaults to a dry run.
Writing requires **all four** of `dry_run:false`, `confirm:true`,
`OPENGYM_ENABLE_PROGRAMME_AUTHORING=1` and `OPENGYM_ENABLE_PROGRAMME_WRITES=1`;
missing consent or gates refuses before any HTTP call. `confirm:true` alone stays
a dry run. Writes use the P5 endpoint's compare-and-write, never rebase or retry.
409 conflicts and 422 validation refusals carry safe codes, issues and warnings.
Large inventory adjustments refuse with 422 until the caller separately supplies
`confirmInventoryAdjustment:true`; the MCP never supplies this automatically and
returns warnings on success too. Today's and past prescriptions, logs and frozen
TM seeds remain protected by the server. From-e1rm seeds are materialized only
at activation; apply never recomputes them from later history.
Large apply summaries preserve the acknowledged revision and report
`totalChanges`/`changedTruncated` and `totalWarnings`/`warningsTruncated` instead
of turning a committed write into an output-size error; `full:true` returns all details.

Draft `patch_program_draft` supports `setProgressionRules {rules}`, `attachRule
{at,ruleId}` and `detachRule {at,ruleId}`. `at` is one stable slot reference or an
array. Every rule operation validates semantics, closed rule JSON and references
using the draft catalogue, and a failure rolls back the entire patch, including
metadata and revision. Stall rules attach/detach through `progression.onStall`;
other rules use `progression.rules`. Existing authored instructions are preserved.
`set_progression_rule {draft_id,expected_rev,rule,at?}` atomically upserts one rule
and optionally attaches it. Private draft edits need the authoring gate and never
write the account document. Progression issues prevent Ready publication.

## Workout logging and undo (M04)

`log_workout` logs a completed historical or freestyle session using the same core
backfill draft and finish/file helpers as the UI's **Log a past workout**. Arguments:

| Field | Meaning |
| --- | --- |
| `date` | Valid local `YYYY-MM-DD`, up to today. |
| `name`, `notes` | Optional session name and note. |
| `routine_id` | Optional existing routine; omitted means Freestyle. Only a programme routine carries programme occurrence credit. |
| `duration_min` | 1–1440 minutes, default 60. The local start is 18:00, matching the UI default; a session ending in the future is refused. |
| `exercises` | Ordered `{exercise, sets}` entries. `exercise` is a catalogue/custom ID or name. Each set may supply integer `reps` (0–9999) or integer `seconds` (0–86400) (both omitted means counts are unspecified), optional finite `weight` (0–9999 before and after conversion), `unit: "kg" | "lb"` (profile unit by default), and `done` (true by default). Use one measurement mode per exercise. |
| `dry_run` | **true by default**. Only explicit `false` plus `OPENGYM_ENABLE_PROGRAMME_WRITES=1` writes. |

The result contains `workout` (the exact proposed record), `resolved_exercises`
(input, ID, name), and `created_exercises`. The session uses profile load units;
explicit other-unit weights use the same conversion/rounding as the app. At least
one set must be completed. Unchecked rows are retained alongside completed rows;
exercises without any completed sets drop out just as in the UI.

Name resolution prefers IDs, then normalized full names (including plurals), then
the UI catalogue's fuzzy search. Multiple matches refuse with `AMBIGUOUS_EXERCISE`
and a list of candidate IDs/names; choose an ID and retry. Unknown names refuse.
`supermans` resolves to catalogue `3436`. The plain bodyweight `donkey kick` is
missing (the catalogue has smith/cable/cross variants), so only that exact missing
move creates a custom **Donkey kick (agent-created)**, with a stable agent alias
for reuse. An existing custom full-name match wins. The dry run shows this proposed
custom record; it is stored atomically with the workout only on an enabled write.

```json
{"date":"2026-10-13","name":"Strength class","duration_min":45,
 "exercises":[{"exercise":"supermans","sets":[{"reps":12}]},
              {"exercise":"donkey kicks","sets":[{"reps":12}]}]}
```

Inspect the preview and send the same input with `dry_run:false` to commit.
Agent records carry `loggedBy:"agent"` and an `agentUndoDigest` seal for undo.
Preview calls allocate a proposed
ID; the later write allocates its own ID. Repeating an explicit write is a new
workout, so inspect history after an uncertain response before retrying.

`delete_workout {workout_id, confirm:true}` removes only an unchanged record
created by this tool and writes the normal sync tombstone. There is no `force`
argument or human-record deletion path. The canonical SHA-256 seal covers all
original record contents, including `_ts`; any edit or missing seal refuses with
`WORKOUT_MODIFIED`, including older agent records. Delete those in the app.
Undo uses the programme write environment gate, keeps created custom exercises,
and lowers confirmed working weights using the same helper as UI editor deletion.
Routine logs apply the UI's rotation queue refill and pin cleanup; freestyle logs
provide no routine credit. Both follow normal UI programme reconciliation.
Programme occurrence credit, week rollover and queue advancement use the same
`advanceProgramme` lifecycle as the UI, after both logging and deletion.

Both tools refuse a server-visible active workout or editor. **Residual risk:**
phone editors and unsynced drafts are local to that device, so the server cannot
prove no editor is open. An unchanged agent record may still be open in a local
phone editor when undo removes it; finish or close that editor before requesting
undo. The phone keeps its local draft and reports that the saved workout was
deleted elsewhere. The seal protects already-synced edits, including edits
racing a conditional write; it does not claim to detect local drafts. A cross-device editor lease would
be needed to eliminate that remaining race.

The UI set fields have no upper numeric ceiling; MCP deliberately adds the bounds
above to reject extreme or nonfinite numbers before conversion, volume calculation
or JSON transport, so overflow cannot silently persist as `null`.

These two tools authenticate the configured profile and read a fresh `/api/data`
snapshot. PUT uses both `baseRev` and `baseWid`. On HTTP 409 they reauthenticate,
reload and rebuild only the requested log/deletion against the new document, with
all resolution, provenance, unchanged-record and active-workout guards
repeated (three attempts maximum). Other failures never retry. Dry runs need authenticated reads but no
write gate and never PUT. Existing programme/progression actions retain their
no-rebase semantics. Verify with `bun run gate M04`; synthetic servers only.

## Max decisions (W29)

`set_training_max` previews by default with the expected revision/write identity. The
preview shows current/proposed max, canonical unit, effective date, basis and audit
event. Applying requires the same inputs plus `apply:true`, its expiring
`preview_token` and `OPENGYM_ENABLE_PROGRAMME_WRITES=1`. An exact unchanged
authenticated document and trustworthy idle activity are required. This tool
fails closed against pre-W36 servers and requires a matched release with the
W36 atomic training guard; missing or unknown activity never means idle.

`undo_training_max` previews a compensating audited max decision using the returned
`undo_token`. Its explicit apply needs its own preview token and unchanged post-write
identity/content. It keeps the original event and seed. A missing prior max cannot
be safely undone. Tokens live only in this MCP process; uncertain writes consume
tokens, read back and require an inspection-only next call before a fresh preview.
See [max adjustments](../../docs/MAX_ADJUSTMENTS.md) for binding, expiry and limits.

W36 adds `search_exercises`, `create_routine`, `edit_routine`, `delete_routine`,
`create_custom_exercise`, `edit_custom_exercise`, and `undo_template_change` (44 total tools).
Routine writes need `OPENGYM_ENABLE_ROUTINE_WRITES=1`; custom exercise writes need
`OPENGYM_ENABLE_EXERCISE_WRITES=1`. Both default to preview and require `apply:true` plus the exact
returned `preview_token`. Undo uses the original write gate. A preview is single use and expires
after 15 minutes; a sealed undo expires after one hour. Both are bounded to the current MCP process,
profile and credential and refuse document changes. Apply never retries or rebases a conflict.
The server must support the durable device training guard; unknown/expired activity blocks apply.

See [the generated tool inventory](../../docs/MCP-TOOLS.md), [gap matrix](../../docs/MCP-GAPS.md),
[usage examples](../../skills/opengym-templates/SKILL.md), and
[training guard/offline limits](../../docs/training-write-guard.md).
Regenerate inventory with `bun scripts/gen-mcp-tools.ts`; verify it with `--check`.
