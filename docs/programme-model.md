# Programme model

A program is an authored training block: program → explicit weeks → days → sessions → slots. A definition is a reusable template. Activating it freezes a cycle snapshot and materializes ordinary routines; editing a saved definition never rewrites a running or paused block. The same model handles an authored full schedule and a repeated block. Repeat is an end policy, not a second program type.

Show the authored target; the athlete chooses the weight. Progression rules are versioned JSON interpreted by the deterministic engine, never executable source. Slots without attached rules retain their authored target; explicit load-producing rules provide prescriptions with Why explanations. A percentage retains its authored 1RM/TM reference; do not silently apply a training-max factor. Optional existing TM calculations remain compatible with the runtime, and missing maxima do not block Start.

## Structure and fields

| Layer | Fields and meaning |
| --- | --- |
| Program | `id`, `name`, `unit: 'lb'|'kg'`, `weeks`; metadata `goal`, `level`, `daysPerWeek`, `lengthWeeks`, `equipment: string[]`, `source`, `licence`. `source.private` is an explicit boolean; private permission does not imply redistribution permission. `end: 'next'|'repeat'|'stop'` controls what happens after a run. `endPlan` explains the training decision. |
| Week | Unique positive `index`, optional `label`, `sourceWeek`, and `mode: 'train'|'deload'|'test'|'inserted'`. Every week carries explicit days. Optional numeric `rir` is a default, overridden by authored per-set effort. Deload factors describe an authored or explicitly chosen policy. |
| Inserted week | In a cycle, `weekId` and `orderIndex` identify an inserted stage without renumbering authored weeks. An inserted deload uses `mode: 'deload'` plus that identity; `mode: 'inserted'` alone does not imply a deload. Cycle insertion never changes the saved definition or logged routines. |
| Day | A unique `key` within the week, optional positive `ordinal`, and one or more `sessions`. Days describe training order; the cycle cadence floats rather than assigning fixed weekdays. |
| Session | Optional stable `sessionTemplateId`; `routineSnapshot: {name?, ex: [...]}`. Separate lift/GPP sessions on the same day remain separate queued sessions and require schedule review. Empty sessions may parse but cannot be Complete. |
| Slot | Resolved catalogue/custom `id`, or `{open:true, category, label?}` without an ID; stable `slotId` for authoring/history; `role: 'main'|'supplement'|'accessory'|'gpp'`. `sets` is the working-set count, `reps` the upper target or `'max'` for AMRAP, and `repsMin` the optional lower bound. Timed strength GPP uses `mode:'time'` and `sec`. |
| Per-set prescription | A pyramid uses `pyramid` for ordered reps and `setRepsMin` for ordered lower bounds. `target: {rir?, rpe?, pct?}` supplies defaults; `setTargets` supplies overrides. RIR/RPE are numbers 0–10; percentages are finite positive numbers. A row-specific RPE/RIR replaces both default effort scales. Legacy `tm: {key, percentages, reference?}` retains its reference and percentages. |
| Guidance | `loadGuidance` is optional prose; `instructions` contains authored/translated instructions; `progression: {kind, instructions, parameters?, provenance?}` names a rule and supplies its plain text. `restSec` is optional rest in seconds; `note` is optional training context; `noteKind` records planner provenance. `generatedRules` retains bounded numeric rule inputs (including ordered RPE 1–10 / RIR 0–10 ranges), while `authoredInstructions` stays verbatim when generated instructions are rendered in the profile’s effort scale. `weight`/`pyramidWeight` can retain literal template seeds; they are not predictions. |

`progression.kind` is one of `linear`, `double`, `reps-sum`, `percentage`, `authored`, `manual`, or `none`. Structured parameter values are passive data. For a rule-picker implementation, each rule kind must have an explicit parameter form and text renderer; the current model validates the envelope and required text, not a universal calculation language. A main lift with deliberately fixed progression still needs a rule such as `none` with the authored instruction to keep the prescription fixed. General grip/setup notes do not count as a progression rule.

Rep ranges use the current upper-target/lower-bound representation. AMRAP and timed GPP are explicit prescriptions; both still require authored effort to be Complete. Warmups are not working slots and do not require working effort targets. Source set counts or percentage ranges follow the existing importer's documented minimum/upper-rep representation, with original conditional instructions retained. RPE/RIR ranges are retained in instructions and marked for review; the refresh never picks an effort endpoint.

A week's default RIR is part of its effective prescription. Every working row is checked using the same `setTargetAt` rules as session creation. Authored deload prescriptions are not scaled twice. Catalogue resolution includes the profile's explicit custom exercises when supplied to the checker.

## Conformance levels

Call `programmeConformance(def)` or `programmeConformance(def, {catalogue:[...CATALOGUE,...customEx]})`. It is pure and returns `{level, issues}`. Levels are ordered; `Invalid` describes input outside the structural contract.

| Level | Requirement |
| --- | --- |
| Invalid | Does not pass `validateProgrammeDefinition`. Fix structural issues before saving/importing. |
| Valid | Passes the structural validator: explicit supported prescriptions, bounded structure, and resolved exercises or native open slots. It may still be an unfinished/structure-only template. |
| Complete | Valid, plus a resolvable exercise or categorised open slot, explicit reps/rep range/AMRAP/duration, and RIR/RPE/% on every working set. No structure-only leftovers, omitted unprescribed slots in session notes, or empty sessions remain. |
| Ready | Complete, plus explicit role for every slot, structured/fully translated progression on every main lift, an authored deload or explicit `endPlan`, all metadata filled, and no unresolved source/schedule review reasons. |

Ready metadata means nonblank goal, level and licence; positive frequency; length matching explicit week count; nonempty equipment list; source kind plus a name/reference/URL/workbook/repository; and an explicit private flag. These are recorded facts, not medical or licensing certification. A `next`/`stop` scheduling flag alone is not an end-of-block training plan. An explicit end plan may describe a test, repeat, next block or stop; an authored deload in the block also meets the requirement.

Each issue has `code`, `location`, `fix` (plain-English action), and `requiredFor` (the first blocked level). Slot issues include authored week index, day key, session identity/position, and slot identity/position. Program/schema issues use a JSON-pointer `path`; missing-effort issues also list the missing one-based `sets`. One effort issue is counted per slot, rather than once per set. The checker does not mutate, acknowledge review, or fabricate missing information. Lower levels are useful draft states; they are not permission to present a program as Ready.

Codes include `structure.invalid`, `slot.category`, `slot.effort`, `slot.structure-only`, `slot.role`, `slot.progression`, `session.empty`, `program.structure-only`, `program.end-plan`, `metadata.*`, `review.unresolved`, and `review.schedule`. Structural invalidity is reported before quality issues, so an Invalid program's issue list is the next repair step, not an exhaustive quality audit.

## Machine-readable contract

[programme-model.schema.json](programme-model.schema.json) is generated from `packages/core/src/programme-model-schema.ts`. The runtime structural validator consumes that same schema. A test compares the generated file byte for byte with its source, and tests exercise both accepted and rejected definitions. Regenerate and check with:

```sh
bun run gen:model
bun run gen:model --check
```

The schema describes the structural envelope, not the Complete/Ready quality bar. It allows unknown extensions for offline compatibility. JSON Schema cannot express catalogue membership, unique index/key projections, cross-field array lengths/range comparisons, or a summed expansion budget. The schema lists these in `x-opengym-semantic-constraints`; `validateProgrammeDefinition` performs them. Use both the schema and validator for authoritative structural validation. Numeric rep/load strings accepted by legacy imports are checked semantically; new builders emit numeric values.

Limits remain 64 explicit weeks, 14 days/week, 8 sessions/day, 100 slots/session, 100 sets/slot, 10 rows/pyramid chunk, 10,000 total expanded sets, and 5 MiB per imported file. Display strings are limited to 10,000 characters and metadata depth to 20. The legacy source-document index at `rules.instructions`/`libraryRules.instructions` is archival data; it never becomes an object in displayed `instructions`.

## Offline library repair

The offline pure core helpers audit an export and prepare a new export. They never contact the API. Repairs derive length, uniform day count, fully known equipment, and week-default RIR; re-import explicit source rules/targets; and recover source fields only with retained source week/session/slot identities and aligned set rows. Ambiguous identities and guessed exercise families cannot provide repairs. Explicit decisions can fill the remaining gaps, but do not silently clear review reasons.

An active/paused program's saved definition, every frozen cycle snapshot, routines, queue, logs, and the running workout remain protected. Only inactive saved definitions can change. Private input files, mappings, source decisions, prepared exports, and reports belong outside git. A prepared export still requires review and a separately authorized live load.

## Synthetic example

```json
{
  "id": "synthetic-strength", "name": "Synthetic strength block", "unit": "lb",
  "goal": "Strength", "level": "Intermediate", "daysPerWeek": 1, "lengthWeeks": 1,
  "equipment": ["barbell"], "licence": "Author permission; private",
  "source": {"kind": "own", "ref": "Synthetic author", "private": true},
  "end": "stop", "endPlan": {"kind": "stop", "instructions": "End the block and review the log."},
  "weeks": [{"index": 1, "mode": "train", "days": [{"key": "d1", "sessions": [{
    "sessionTemplateId": "d1:lift", "routineSnapshot": {"name": "Main lift", "ex": [{
      "id": "0025", "slotId": "bench", "role": "main", "sets": 3, "reps": 5,
      "target": {"rpe": 8}, "restSec": 180,
      "progression": {"kind": "manual", "instructions": "Keep the reps and effort target; choose the load yourself."}
    }]}
  }]}]}]
}
```

## Native per-set targets

Slots may carry a closed `nativePrescription` with stable source and row identities, explicit rep/effort/percentage targets, and supported relative-load anchors. The current engine preserves these through Start, Finish and Repeat; unresolved relative loads refuse completion. Added/copied rows cannot inherit source authority. Read [NATIVE-RELATIVE-LOADS.md](NATIVE-RELATIVE-LOADS.md) for anchors and back-off semantics.
