# Community programme repair

This offline tool proposes versioned definition repairs. It never accesses an API,
SQLite, or a live library. Keep private inputs and generated manifests outside the
repository. A plan is a review artifact, not a claim that a programme is Ready.

```sh
bun scripts/community-repair.ts plan input.json manifest.json
bun scripts/community-repair.ts apply input.json manifest.json repaired.json
```

`plan input.json` prints JSON without writing any files. Named outputs must be new
files; existing files are never overwritten. `apply` verifies hashes of the original
definition and source, recomputes the plan, and rejects stale, modified or blocked
manifests. It creates a local definition file only. Publishing a new library version
is a separate, authorized operation through the app's API/MCP, after backup and review.
Do not replace an active cycle snapshot with a library repair.

Input is `{definition, source, options?, customEx?}`. `definition` is a native
programme; `source` is its original `opengym-library/1` conversion input, including
`weeks`, per-exercise `rules`, `length_weeks`, `rules.frequency` and provenance.
The tool recognizes exact built-in script strings on `rules[].script` and exact
summaries emitted by the earlier converter. It does not parse free-form instructions.
Those old summaries omit initial counters: verify their exact arguments against the
pinned original source before publication. Prefer explicit `script` values when
that information is available; nonzero counters in explicit scripts are rejected.

Options:

- `bindings`: explicit `{ref:{week,day,session,slot}, sourceWeek, sourceDay,
  sourceKind?, sourcePosition}` mappings when the native importer identity cannot be
  resolved uniquely. Source positions are one-based; duplicate candidates block repair.
- `rotation`: ordered source day keys, such as `["d1","d2"]`. A one-week rotation
  expands to its intended frequency and closes at a whole number of weeks. A/B at
  three sessions becomes A/B/A, B/A/B, then repeats. Multiweek schedule mismatches
  and multiple sessions on one source day require review.
- `rounding`: engine `{increment,mode,usePlates}`. Omitted: source load increment,
  nearest, no inventory constraint. Review this against the athlete's equipment.
- `athleteLoads`: explicit starting loads in definition units, keyed by the plan's
  reported `continuityKey`. Omitted: athlete chooses the first load. Imported sample
  weights and pyramid weights are removed from every candidate slot.
- `maxBasis`: explicit `1rm`, `tm` or `e1rm` from verified provenance. Omitted: no
  inference from programme name, family, or legacy `tm.reference` is made.

Supported: absolute kg/lb `lp` increments, zero initial counters, percentage stall
resets, and ordinary all-set `dp` rep steps and high-endpoint load increases. Rules
attach through `progressionRules`; pyramids keep `prog=off`. Repeated source slots
share a `progression.parameters.continuityKey`. `repProgression=step` opts double
rules into rep steps; other double rules retain existing semantics. Load history
crosses cycles only through explicit repeat/restart ancestry with the same programme,
series, exercise and compatible rule configuration. No TM history is borrowed.
Opt-in slots evaluate when a workout starts, so actual session rows use the earned
load without a separate progression apply between sessions. Started targets remain
frozen; ordinary sessions keep their existing behavior.

Unsupported: custom/update scripts, sum-of-reps scripts, nonzero initial counters,
percentage increases, absolute decrements, exercise/set variations, conditional
sets, percentage/TM combinations, split source slots and unresolved bindings. These
produce explicit slot issues and block apply; custom scripts are never executed or
reported as converted. Paid/private method families are inventoried separately and
deferred. No paid or imported programme bodies are bundled here.

Metadata includes actual expanded length, source-authored length, weekly frequency,
goal and source family/provenance. Existing unknown fields, private flags, warnings
and review requirements remain. `rulesSupported` stays false until an independent
review certifies the full programme. All automated examples/tests are synthetic.

Built-in syntax and source-label grouping follow the
[Liftosaur reference](https://www.liftosaur.com/doc/liftoscript); unsupported source
features remain manual rather than being approximated.

Executable admission validates the current source independently of native flags.
Only bounded scalar work counts/reps, scalar RPE or RIR, ordinary absolute sample
loads, and explicit numeric AMRAP success floors with linear progression are
admitted. Double progression requires uniform source reps at its lower endpoint;
its existing logged-rep progression algorithm is unchanged. Percentage/basis, conditional/back-off, open/timed/generated rows,
ranges/variations and unknown prescription keys refuse executable repair. Known
notes/provenance and opaque extension namespaces do not grant rule support.

The source identity must resolve through the caller's catalogue (canonical aliases
or unique exact names/equipment are permitted). A known explicit different exercise
is a contradiction. A positional override cannot replace retained source anchors;
the selected session must have matching exercise coverage/order and native
count/reps/effort rows. Intentional native prescription edits require separate
correspondence review or a corrected source/native pair; fresh hashes alone do not
establish semantic agreement. Supported AMRAP floors are restored from the source;
source sample weights remain excluded from athlete starting loads.

Copied and ended/archived routines that no longer have a programme link run as
ordinary routines, retaining their configs and extensions. Their leftover continuity
key grants no programme history. A still-linked routine with a missing or ambiguous
cycle/occurrence remains blocked; frozen already-started targets keep their existing
behavior. These checks are admission safeguards, not L8 programme-fidelity or
publication approval.
