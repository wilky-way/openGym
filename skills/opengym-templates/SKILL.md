---
name: opengym-templates
description: Search exercises and create, edit, delete or undo openGym routine templates and custom exercises through MCP, using bound previews and training guards.
---

Use the MCP tools for profile changes; exercise names are search terms, never write identities.
Read [the tool inventory](../../docs/MCP-TOOLS.md) for tool parameters and
[the gap matrix](../../docs/MCP-GAPS.md) when the request goes beyond templates or exercises.

Search `search_exercises({"query":"bench press","limit":10})`, then choose an explicit
`exercise_id`. If variants are ambiguous, show them and ask which one the user means.

Every template/exercise write previews by default. Review its exact `target`, `changes`,
`training_status`, `expected_rev`, `expected_wid` and fingerprint. Apply by repeating the exact
parameters with `apply:true` and the returned `preview_token`. The process must have
`OPENGYM_ENABLE_ROUTINE_WRITES=1` or `OPENGYM_ENABLE_EXERCISE_WRITES=1`, respectively.
A preview token is single use, process/profile/credential scoped, expires after 15 minutes, and
is invalid after any document change. A conflict means obtain and review a new preview; never
automatically rebase the action. An uncertain response means inspect the profile before retrying.

For example, after choosing two IDs, preview a template (replace the illustrative IDs):

```json
{"name":"Full body A","exercises":[{"exercise_id":"chosen-squat-id","sets":3,"reps":5,"rest_sec":180},{"exercise_id":"chosen-row-id","sets":3,"reps":8,"rest_sec":90}],"placement":{"kind":"week","days":["1","4"]}}
```

Call `create_routine` with that object, then the same object plus `apply:true` and `preview_token`.
Creation requires explicit placement: `none`, `week` (Sunday=0), `date` (local YYYY-MM-DD), or
`queue` (`index`, and `starts_on` for a new manual queue). Existing queue metadata is retained.
Programme/rotation-owned queues are protected. Editing with a placement first removes that
routine's existing plan/manual-queue references, then places it; `none` explicitly unplaces it.
Omitting placement on an edit retains all references. A date already occupied by another routine
is refused. Queue entries go at the supplied zero-based index.

`edit_routine` identifies the routine with `routine_id`. An `exercises` array supplies its full
ordered list; removed slots are removed deliberately. Include `source_index` to carry extensions
from a specific old slot, especially when an exercise appears twice. Existing slot extensions
survive edits and reordering. Adjacent slots with the same non-null `superset` form a group of at
least two. `superset:null` removes grouping. Weights may include `unit:kg|lb` and are converted to
the profile unit. Per-set/engine prescriptions require the app if changing their shape.
`delete_routine` previews removal of the routine and its plan/manual-queue pointers.

Example `create_custom_exercise` preview:

```json
{"name":"Assisted neutral row","muscles":["back"],"secondary_muscles":["biceps"],"equipment":"leverage machine","bodyweight":false,"assisted":true,"notes":"Neutral handles"}
```

`edit_custom_exercise` uses its exact `exercise_id` and only the fields to change. Primary muscles
use `muscles`; notes use `notes`. Bodyweight and assisted cannot both be true. Built-ins cannot be
edited. Active/paused programme references are protected, including exercise metadata changes.

An apply returns a before/after record and, when readback seals it successfully, `undo_token`.
Call `undo_template_change({"undo_token":"returned-token"})` to preview undo, then repeat with
`apply:true` and that preview's `preview_token`. Undo needs the original write gate and refuses
any intervening document write. Undo tokens last one hour in the same MCP process; retain the
returned change record if longer-term manual review is needed.

Active training and unknown/expired device activity block apply. Reads and previews remain
available. Ask the owning device to finish/discard and confirm idle; MCP cannot clear training
markers. Never treat heartbeat expiry as permission. A session that has never reached the server
while offline cannot be detected by this guard.

Routine prescription inputs support reps mode. Use the app for cardio/time prescriptions;
unchanged retained slots can still be renamed, reordered or annotated. `UNSUPPORTED_CONFIG`
means the requested flat load/rest would be ineffective under actual Start/progression or timer
ownership, or an owned prescription/mode needs the app. Preserve those prescriptions and policy;
do not retry by deleting owned fields or disabling progression. Omit unchanged optional load/rest
fields for metadata-only edits. Per-set and superset rests take precedence over scalar defaults.
