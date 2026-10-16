# Native relative loads

Native model v1 can author one exact load reduction from an explicitly identified earlier
row in the same exercise entry. This is additive to W41 fixed-count goals. Canonical source
conversion is unchanged: arbitrary source metadata, generated rules and instructions do not
author this feature or earn `rulesSupported`.

An invented three-row entry has a five-rep anchor and two five-rep back-offs. Each back-off
has `relativeLoad: {kind: 'same-entry-reduction', reductionPercent: 10, anchor}`. The anchor
contains the exact `variantKey`, the complete prescription `source`, `sourceTemplateId`,
and a one-based `rowOrdinal` in the expanded authored entry. Repeated template IDs are valid
because ordinal is explicit. Missing, future, self, other-source, other-entry or other-movement
references refuse admission before installation and Start. Runtime row identities are checked
again; copied duplicate identities and rebound rows refuse completion, Finish and Repeat.

`reductionPercent` must be one finite number strictly greater than 0 and less than 100.
Dependent reps must be fixed; a percentage-max goal cannot also be a relative-load goal.
This represents a bounded exact reduction, without conditional, unbounded, until-effort,
exact-total, timed, adaptive, history, family, max, or top/first/last/heaviest inference.
Authoritative assisted built-in and custom identities refuse calculated loads even when the
configuration says `assisted: false`. Manual native reps/effort and legacy fixed loads survive.

A pure `evaluateNativeRelativeLoad` reads only the unique earlier anchor in its entry.
An incomplete anchor or unknown/invalid actual load produces a visible pending reason.
A completed finite nonnegative load, including explicit zero, can resolve the goal. Calculation
converts the anchor using the existing precise kg/lb conversion, then uses `dropGrid` (owned
bells/plates) or `snapWeight` with the exercise increment. Zero bypasses a positive empty-bar
floor and stays zero. The result is displayed as **Planned**; it never fills or cascades actual
`w`. Manual actuals may differ from the plan, and pending completion preserves typed drafts.

`prepareNativeCompletion` runs inside the existing synchronous guarded workout producer,
after captured account/profile/document/editor/entry/row checks. It freezes a separate
`nativeLoadEvaluation` containing version, exact authored relation, exact anchor identity,
anchor actual value/unit and planned value/unit. Relation-entry rows also stamp
`nativeActualLoad`; unit conversion retains those explicit stamps. When profile conversion
explains the current actual number, calculation retains its original exact value/unit; a
manual edit records its new value in the current unit. Existing unit-conversion behavior for
actual input values remains in effect. Frozen completed evaluations retain their own units.

Editing an anchor or a completed dependent's actual never changes a completed evaluation.
Undo explicitly clears that row's evaluation and actual stamp, preserving typed actuals;
re-completion deliberately evaluates the current anchor again. Undoing an anchor makes
unfinished dependents pending but leaves completed dependent snapshots unchanged. Finish
checks that each completed dependent has a valid separate receipt and clones it into history.
Log editing preserves the receipt unless the row is undone/re-completed.

Repeat of a relation-bearing entry restores all authored rows and relations, with actual
reps/load/effort/failure/time values (including rest-pause clusters) and evaluation/actual stamps
cleared, including its anchor. Session-added intensifier and warm-up modifiers reset to ordinary
authored rows; opaque row metadata and notes remain.
It can resolve only from its own repeated session's anchor. Source and row metadata are
retained; nonrelative native and legacy Repeat behavior is unchanged.

Generate schema/types with `bun run gen:model`, and native API declarations with
`bun run gen:core-api`; both support `--check`. No storage, sync, durable-close, source mapping,
paid/public programme conversion or publication changes are included. W41's known P3
candidate/default-index import/save inconsistency remains: callers supply the effective custom
exercise index. Strict collisions, review/basis/guide semantics and legacy-overlay refusals
remain required. Independent review and separately matched integration precede rollout.


Athlete structural edits use a separate row namespace. Add set, Add warm-up and
Copy on a relative entry create `nativeExtraIdentity: {kind:'athlete-extra',id}`
with a fresh UUID, never a `NativeRowIdentity`. Copying an authored row or another
extra retains manual reps/load, notes and opaque metadata, but clears authored
reps/effort/relative/max targets, authored identity, completion time, subrows,
evaluation and actual-unit stamp. Extras cannot serve as relative anchors.
The source prescription and its authored expanded row count never grow.

Finish and history Save keep all rows of an entry with completed work, including
completed, partial and empty extras, under ordinary Finish semantics. They clone
extra metadata as well as authored rows. A missing, malformed or duplicated
authored identity/target still refuses; an extra marker must be valid, unique in
its entry, and cannot coexist with authored identity, target or receipts.
Removing an authored anchor never rebinds to an extra or a nearby row: fresh
dependent completion stays pending. Completed dependent receipts stay frozen.

Converting an authored straight row to a warm-up and back changes phase and row
placement while retaining that exact authored identity, target, actuals, notes,
opaque metadata and frozen receipts. An empty actual load stays unknown. A
converted dependent positioned before its own authored anchor cannot complete
again until its exact anchor is earlier. New/converted athlete extras remain
ordinary extras in either phase.

Repeat rebuilds the original authored rows with blank actuals and their own
anchors, as above. Completed ordinary extra work sets also repeat with fresh
extra identities and the logged manual reps/load, preserving notes and opaque
metadata; done/time/effort/subrows/session modifiers and native receipts are
cleared. Extras keep their source placement after the nearest preceding authored
ordinal (or before all authored rows when none precedes them). Removed authored
rows are rebuilt without borrowing extra metadata. Incomplete extras and extra
warm-ups remain in the original log but do not repeat, matching ordinary
completed-work-set semantics. A converted authored warm-up is rebuilt as its
original authored work row. Repeat never changes the source history.

`WorkoutSet` declares the extra marker in the document contract; the generated
native core API exposes the row constructor. Athlete extras are not source
prescriptions, so the strict programme JSON schema and its generated model types
remain unchanged and cannot author an extra identity.
