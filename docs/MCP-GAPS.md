# MCP control gap matrix

Baseline: the 35 tools before W36. The generated [runtime inventory](MCP-TOOLS.md) now lists 44.
The current surface includes template/custom exercise control and audited training-max decisions.

| App capability | Baseline tools | W36 outcome / remaining gap |
| --- | --- | --- |
| Routine list, detail, opening prescription, plan | list_routines, get_routine, preview_session, get_week_plan | Existing reads retained |
| Workout/history reads, estimates, balance, bodyweight reads | list_workouts, get_workout, get_bodyweight, estimate_1rm, muscle_balance | Existing reads retained; richer RIR/volume/trend coaching views follow |
| Programme read and position | get_programme, programme_position | Existing reads retained |
| Programme activation, date shift, skip | activate_programme, shift_programme, skip_programme_session | Existing conditional writes retained; atomic server training guard added; other controls follow in W37 |
| Local draft validation, creation, reads, deletion, patching | validate_program, create_program_draft, get_program_draft, list_program_drafts, delete_program_draft, patch_program_draft | Existing private authoring retained |
| Slot, target, progression, metadata authoring | set_slot, set_slot_targets, set_progression, set_progression_rule, set_program_metadata | Existing draft operations retained |
| Repeat/deload draft authoring | repeat_week, generate_deload | Existing draft operations retained; live programme repeat/deload remains separate |
| Library list, diff, publish | list_programmes, diff_programs, publish_program_draft | Existing library surface retained |
| Progression validation, preview, apply | validate_progression, preview_progression, apply_progression | Existing tools retained; apply shares the atomic training guard |
| Historical workout logging and sealed undo | log_workout, delete_workout | Existing tools retained; history edits, date moves, warmups and body logging deferred to W37 |
| Catalogue/custom lookup | None | **search_exercises** returns exact IDs and metadata, no fuzzy auto-selection |
| Routine template creation | None | **create_routine**: ordered explicit IDs, sets/reps/weight/unit/rest, notes, flags, supersets, explicit placement |
| Routine edit/delete | None | **edit_routine**, **delete_routine**: unknown extensions preserved; plan/manual queue references maintained; programme/rotation ownership protected |
| Plan/queue placement | Reads and programme actions only | Template create/edit supports unplaced, weekdays, date override, indexed manual queue placement. Owned queues/rotations remain app/programme controls |
| Custom exercise create/edit | None | **create_custom_exercise**, **edit_custom_exercise**: name, primary/secondary muscles, equipment, bodyweight/assisted, notes; catalogue immutable |
| Reversal of template/custom changes | None | **undo_template_change**, before/after records; single-use process-bound previews and sealed undo refuse later document changes |
| Trustworthy active-training exclusion | Fetched active was stripped; presence expired | Durable per-device auxiliary marker, 70-second heartbeat expiry becomes unknown, atomic agent write refusal; reads/previews available |
| Custom exercise deletion, favourites, broader equipment/settings | None | Deferred; no generic settings/key writer introduced |
| Audited training-max decisions | set_training_max, undo_training_max | Preview-sealed conditional changes and compensating undo; see [max semantics](MAX_ADJUSTMENTS.md) |
| Broader history/body/check-in writes and programme controls | Limited tools above | Remain outside this tool surface |
| Backup/export/health tools and coaching read model | None | Deferred; no ops/auth/admin/invite/token tool added |

All new writes require `apply:true`, the appropriate environment write gate, and an exact preview
token bound to action/parameters/profile/credential, document revision/write identity and canonical
content hash. Preview tokens last 15 minutes; undo seals last one hour, bounded in this MCP process.
Before/after records are returned, never silently persisted in the synced profile. Tokens are lost
on MCP restart and may be evicted at the memory limit. Any intervening document change invalidates
undo (a deliberately conservative limit). No conflict retry or automatic rebasing occurs.

Template editing supplies a complete ordered exercise list. `source_index` preserves each existing
slot's unknown fields during reorder or explicit replacement. Per-set/engine prescriptions require
the app if their shape changes. Routine placements on edit are explicit replacements; omission
retains existing placement. Programme-owned routines and active/paused references are protected.

See [device guard semantics and offline limits](training-write-guard.md) and the
[usage skill](../skills/opengym-templates/SKILL.md) for examples.

Routine prescription inputs are strength/reps only. Catalogue and custom cardio, and retained
explicit time/cardio slots, cannot accept strength prescription changes through these tools.
Unchanged retained prescriptions can still carry notes, routine names and ordering changes.
Explicit flat loads must agree with actual Start rows under the existing history and progression;
this surface does not switch progression off or erase a per-set/TM prescription to force a load.
Explicit rests must agree with the effective work-set timers, including per-set overrides,
superset group/partner ownership and profile fallback. Warmup rests retain their separate policy.
An ineffective request fails `UNSUPPORTED_CONFIG` during preview and never becomes an apply token.
