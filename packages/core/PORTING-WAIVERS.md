# Assertion waivers

- K17 ports stamp-level results; HTTP status, revision assignment and private GET field stripping remain S04 assertions. The three HTTP tests in `legacy/api/test/sync-stamps.test.js` keep their names and stamp-level cases here; nine handler-only assertions are deferred to S04. The changed-report path and private history remain covered by the port and differential tests.
- The source-identity assertion in `programme-fix1.test.js` is replaced one-for-one by preservation through the shared core prescription dependency; the server JS twin is intentionally retired (R2).

# Porting waivers

## K06 day-notes: server sync rules moved (4 assertions)

Reason: K06 day-notes: server sync-rule expects moved to day-notes.diff.test.ts (legacy/api/sync-stamps import)

`day-notes.test.ts` drops 4 `expect(` calls from its legacy twin. The server-side sync-rule
assertions (`Server.STAMPED_MAPS`, `Server.highestStamp`, `Server.stampPut`) import the legacy
server module `legacy/api/sync-stamps.js`, which core tests may not import. They live in
`day-notes.diff.test.ts`, which is the only place the rewrite imports legacy server code. The
describe/it names are unchanged.

# K03 porting waivers

English-only ruling removes the three translated-term/name/cache tests (11 assertions); canonical English and accent-insensitive custom names remain covered.

Native Android animated-WebP branch was deleted under R3; its five assertions are waived, while desktop MP4 behavior remains tested.

# Porting waivers

No waivers. Add explicit JSON waivers to scripts/public-parity-map.json for assertion drops, with reasons.

## K02 — approved English-only / en-US port

The GM ruling in DECISIONS-2026-10-12.md removes foreign locales and packs.
Only those assertions are waived; unchanged workout, rep-range, superset, week-start,
weight precision, programme target and programme UI test twins retain every assertion.

- `i18n-core.test.ts`: **44 assertions** — K02 English-only removes foreign locale derivation, picker, name-pack casing and bilingual-switch assertions.
- `i18n-plural.test.ts`: **26 assertions** — K02 English-only removes foreign CLDR plural forms and foreign-pack source inventories.
- `i18n-details-lang.test.ts`: **6 assertions** — K02 English-only replaces foreign description switching with English fallback and stale-load rejection.
- `format-ago.test.ts`: **9 assertions** — K02 English-only removes translated duration, translated set-count and German relative-date assertions.
- `format-names.test.ts`: **2 assertions** — K02 English-only removes Spanish and German translated exercise-name assertions.

`i18n-core` retains seven legacy English assertions and adds explicit English-only
configuration, stale persisted locale, placeholder and canonical-name checks.
`i18n-plural` retains English fallback, placeholder and plain-t plural checks.
`i18n-details-lang` retains the English instruction check and pins the new stale
foreign-description behavior. `format-names` checks all English accent names instead
of enumerating deleted foreign packs. Original surviving describe/it names are kept.

The GM separately moved `nav.ts` into web with injected sheet-entry/current-hash
readers (K02 owns its unchanged seven assertions). W00/W01 wire those readers.
The DOM online listener belongs to W01's i18n shell, which owns the full legacy
`i18n-details-retry.test.js` twin; K02 additionally checks its retry latch, pause and
approved `_retryDetails()` hook in `i18n-details-core.test.ts`.
The `format.diff.test.ts` oracle uses a test-only en-US locale override to compare
the unchanged formatting algorithms under the approved locale; raw en-GB dates are
intentionally not the target. All other differential functions compare raw legacy
outputs, mutations and JSON key order without normalization.

# K03 porting waivers
# Assertion waivers

## K06 day-notes: server sync rules moved (4 assertions)

Reason: K06 day-notes: server sync-rule expects moved to day-notes.diff.test.ts (legacy/api/sync-stamps import)

`day-notes.test.ts` drops 4 `expect(` calls from its legacy twin. The server-side sync-rule
assertions (`Server.STAMPED_MAPS`, `Server.highestStamp`, `Server.stampPut`) import the legacy
server module `legacy/api/sync-stamps.js`, which core tests may not import. They live in
`day-notes.diff.test.ts`, which is the only place the rewrite imports legacy server code. The
describe/it names are unchanged.

# K03 porting waivers
K13 duplicate-source recovery (GM post-parity exception, 2026-10-13): repair rejects the positional `source-N` fallback when multiple explicit source candidates match. Legacy recovered the first row even if duplicate candidates prescribed RPE 8 versus RPE 4. The port recovers neither candidate's effort and conformance retains `slot.effort`; no assertion-drop budget is used. `programme-model.diff.test.ts` records both legacy's RPE 8 result and the port's deliberate no-recovery result. Positional recovery with zero explicit candidates remains supported.

English-only ruling removes the three translated-term/name/cache tests (11 assertions); canonical English and accent-insensitive custom names remain covered.

Native Android animated-WebP branch was deleted under R3; its five assertions are waived, while desktop MP4 behavior remains tested.

K03 caller-owned index ordering (GM-approved R2 exception): after registering a custom shadow of a built-in and resetting, legacy deletes and re-appends that built-in at the end of its mutable index. Fresh indexes retain catalogue order. Direct lookups and the app's `allExercises` search path remain identical; tied searches over `Object.values(index)` may change order. The two-command shadow/reset regression and stateful differential pin this deliberate change rather than copying global mutation history.
## K15

## K15

Media deletion ruling removes the replaced-workout photos/videos carry test and its four assertions; note carry remains tested.

# Porting waivers

No waivers. Add explicit JSON waivers to scripts/public-parity-map.json for assertion drops, with reasons.

## K02 — approved English-only / en-US port

The GM ruling in DECISIONS-2026-10-12.md removes foreign locales and packs.
Only those assertions are waived; unchanged workout, rep-range, superset, week-start,
weight precision, programme target and programme UI test twins retain every assertion.

- `i18n-core.test.ts`: **44 assertions** — K02 English-only removes foreign locale derivation, picker, name-pack casing and bilingual-switch assertions.
- `i18n-plural.test.ts`: **26 assertions** — K02 English-only removes foreign CLDR plural forms and foreign-pack source inventories.
- `i18n-details-lang.test.ts`: **6 assertions** — K02 English-only replaces foreign description switching with English fallback and stale-load rejection.
- `format-ago.test.ts`: **9 assertions** — K02 English-only removes translated duration, translated set-count and German relative-date assertions.
- `format-names.test.ts`: **2 assertions** — K02 English-only removes Spanish and German translated exercise-name assertions.

`i18n-core` retains seven legacy English assertions and adds explicit English-only
configuration, stale persisted locale, placeholder and canonical-name checks.
`i18n-plural` retains English fallback, placeholder and plain-t plural checks.
`i18n-details-lang` retains the English instruction check and pins the new stale
foreign-description behavior. `format-names` checks all English accent names instead
of enumerating deleted foreign packs. Original surviving describe/it names are kept.

The GM separately moved `nav.ts` into web with injected sheet-entry/current-hash
readers (K02 owns its unchanged seven assertions). W00/W01 wire those readers.
The DOM online listener belongs to W01's i18n shell, which owns the full legacy
`i18n-details-retry.test.js` twin; K02 additionally checks its retry latch, pause and
approved `_retryDetails()` hook in `i18n-details-core.test.ts`.
The `format.diff.test.ts` oracle uses a test-only en-US locale override to compare
the unchanged formatting algorithms under the approved locale; raw en-GB dates are
intentionally not the target. All other differential functions compare raw legacy
outputs, mutations and JSON key order without normalization.

# Porting waivers

No assertion-drop waivers. Add explicit JSON waivers to scripts/public-parity-map.json for assertion drops, with reasons.

## ZIP-CRC32 — reject corrupt backup entries (K01 oracle exception)

GM ruling, 2026-10-13: `readZip` validates CRC-32 for every entry against the central-directory
checksum and throws `ZipError` with code `crc-mismatch` on mismatch, including directory and empty
entries. Legacy never checked CRC, so parseable corruption (a backup weight changing from 100 to
900) silently imported. This intentional oracle exception prevents that import; valid archive
bytes, entry payloads and the public API remain unchanged. Reads use bounded 4 MiB chunks.

Regressions: `k01.diff.test.ts` demonstrates legacy accepts the corrupted JSON while the port
rejects it and validates a byte-identical valid round trip; `zip.test.ts` covers corruption in
first/middle/last/directory entries, empty-entry CRC metadata and multi-chunk data. No legacy
tests or assertions are waived.

# Porting waivers

## K06 day-notes: server sync rules moved (4 assertions)

Reason: K06 day-notes: server sync-rule expects moved to day-notes.diff.test.ts (legacy/api/sync-stamps import)

`day-notes.test.ts` drops 4 `expect(` calls from its legacy twin. The server-side sync-rule
assertions (`Server.STAMPED_MAPS`, `Server.highestStamp`, `Server.stampPut`) import the legacy
server module `legacy/api/sync-stamps.js`, which core tests may not import. They live in
`day-notes.diff.test.ts`, which is the only place the rewrite imports legacy server code. The
describe/it names are unchanged.

# K03 porting waivers

English-only ruling removes the three translated-term/name/cache tests (11 assertions); canonical English and accent-insensitive custom names remain covered.

Native Android animated-WebP branch was deleted under R3; its five assertions are waived, while desktop MP4 behavior remains tested.

# Porting waivers

No waivers. Add explicit JSON waivers to scripts/public-parity-map.json for assertion drops, with reasons.

## K02 — approved English-only / en-US port

The GM ruling in DECISIONS-2026-10-12.md removes foreign locales and packs.
Only those assertions are waived; unchanged workout, rep-range, superset, week-start,
weight precision, programme target and programme UI test twins retain every assertion.

- `i18n-core.test.ts`: **44 assertions** — K02 English-only removes foreign locale derivation, picker, name-pack casing and bilingual-switch assertions.
- `i18n-plural.test.ts`: **26 assertions** — K02 English-only removes foreign CLDR plural forms and foreign-pack source inventories.
- `i18n-details-lang.test.ts`: **6 assertions** — K02 English-only replaces foreign description switching with English fallback and stale-load rejection.
- `format-ago.test.ts`: **9 assertions** — K02 English-only removes translated duration, translated set-count and German relative-date assertions.
- `format-names.test.ts`: **2 assertions** — K02 English-only removes Spanish and German translated exercise-name assertions.

`i18n-core` retains seven legacy English assertions and adds explicit English-only
configuration, stale persisted locale, placeholder and canonical-name checks.
`i18n-plural` retains English fallback, placeholder and plain-t plural checks.
`i18n-details-lang` retains the English instruction check and pins the new stale
foreign-description behavior. `format-names` checks all English accent names instead
of enumerating deleted foreign packs. Original surviving describe/it names are kept.

The GM separately moved `nav.ts` into web with injected sheet-entry/current-hash
readers (K02 owns its unchanged seven assertions). W00/W01 wire those readers.
The DOM online listener belongs to W01's i18n shell, which owns the full legacy
`i18n-details-retry.test.js` twin; K02 additionally checks its retry latch, pause and
approved `_retryDetails()` hook in `i18n-details-core.test.ts`.
The `format.diff.test.ts` oracle uses a test-only en-US locale override to compare
the unchanged formatting algorithms under the approved locale; raw en-GB dates are
intentionally not the target. All other differential functions compare raw legacy
outputs, mutations and JSON key order without normalization.

## K03 — deliberate exception: custom ids may shadow catalogue aliases

Approved by the S08 r1 fix task and reconciled review: legacy `registerCustom`
throws when a custom id (for example `1019`) equals a non-writable hidden alias.
The server inherits that failure in `createExerciseIndex`, preventing all library
validation and publishing for the profile, even for unrelated definitions.
Skip installing alias keys owned by customs, then install the customs as ordinary
enumerable entries so semantic catalogue consumers see them. Duplicate customs
still use the last entry; all non-colliding lookups, hidden alias enumeration and
catalogue-only defaults retain legacy results. Caller snapshots remain frozen
and isolated. The follow-up below extends canonical lookup for custom shadows.
`exercises-index.test.ts` covers the collision, custom lookup/helpers, enumeration,
every other own-key lookup and reset/profile isolation; S08 has a real-TCP
validate/publish regression. This is a named oracle exception, not an assertion
waiver; no surviving legacy assertions are removed.
# Porting waivers

No waivers. Add explicit JSON waivers to scripts/public-parity-map.json for assertion drops, with reasons.


GM-directed follow-up to the custom-alias exception: canonicalExId preserves ids that the caller-owned index marks as custom, including a 1019 shadow, instead of returning the built-in alias target. Native K03 and K13 output tests pin this deliberate exception.

# Porting waivers

## K06 day-notes: server sync rules moved (4 assertions)

Reason: K06 day-notes: server sync-rule expects moved to day-notes.diff.test.ts (legacy/api/sync-stamps import)

`day-notes.test.ts` drops 4 `expect(` calls from its legacy twin. The server-side sync-rule
assertions (`Server.STAMPED_MAPS`, `Server.highestStamp`, `Server.stampPut`) import the legacy
server module `legacy/api/sync-stamps.js`, which core tests may not import. They live in
`day-notes.diff.test.ts`, which is the only place the rewrite imports legacy server code. The
describe/it names are unchanged.

# K03 porting waivers

English-only ruling removes the three translated-term/name/cache tests (11 assertions); canonical English and accent-insensitive custom names remain covered.

Native Android animated-WebP branch was deleted under R3; its five assertions are waived, while desktop MP4 behavior remains tested.

# Porting waivers

No waivers. Add explicit JSON waivers to scripts/public-parity-map.json for assertion drops, with reasons.

## K02 — approved English-only / en-US port

The GM ruling in DECISIONS-2026-10-12.md removes foreign locales and packs.
Only those assertions are waived; unchanged workout, rep-range, superset, week-start,
weight precision, programme target and programme UI test twins retain every assertion.

- `i18n-core.test.ts`: **44 assertions** — K02 English-only removes foreign locale derivation, picker, name-pack casing and bilingual-switch assertions.
- `i18n-plural.test.ts`: **26 assertions** — K02 English-only removes foreign CLDR plural forms and foreign-pack source inventories.
- `i18n-details-lang.test.ts`: **6 assertions** — K02 English-only replaces foreign description switching with English fallback and stale-load rejection.
- `format-ago.test.ts`: **9 assertions** — K02 English-only removes translated duration, translated set-count and German relative-date assertions.
- `format-names.test.ts`: **2 assertions** — K02 English-only removes Spanish and German translated exercise-name assertions.

`i18n-core` retains seven legacy English assertions and adds explicit English-only
configuration, stale persisted locale, placeholder and canonical-name checks.
`i18n-plural` retains English fallback, placeholder and plain-t plural checks.
`i18n-details-lang` retains the English instruction check and pins the new stale
foreign-description behavior. `format-names` checks all English accent names instead
of enumerating deleted foreign packs. Original surviving describe/it names are kept.

The GM separately moved `nav.ts` into web with injected sheet-entry/current-hash
readers (K02 owns its unchanged seven assertions). W00/W01 wire those readers.
The DOM online listener belongs to W01's i18n shell, which owns the full legacy
`i18n-details-retry.test.js` twin; K02 additionally checks its retry latch, pause and
approved `_retryDetails()` hook in `i18n-details-core.test.ts`.
The `format.diff.test.ts` oracle uses a test-only en-US locale override to compare
the unchanged formatting algorithms under the approved locale; raw en-GB dates are
intentionally not the target. All other differential functions compare raw legacy
outputs, mutations and JSON key order without normalization.

## K17 server stamp

- K17 ports stamp-level results; HTTP status, revision assignment and private GET field stripping remain S04 assertions. The three HTTP tests in `legacy/api/test/sync-stamps.test.js` keep their names and stamp-level cases here; nine handler-only assertions are deferred to S04. The changed-report path and private history remain covered by the port and differential tests.
- The source-identity assertion in `programme-fix1.test.js` is replaced one-for-one by preservation through the shared core prescription dependency; the server JS twin is intentionally retired (R2).
## P1 new authoring tests

P1 adds declarative progression authoring with no legacy test twin; K13 retains the complete conformance twin and differential gate.
The schema-only differential projects away the additive P1 fields/definitions; all legacy validator, conformance and repair comparisons remain unchanged.


# K03 porting waivers

English-only ruling removes the three translated-term/name/cache tests (11 assertions); canonical English and accent-insensitive custom names remain covered.

Native Android animated-WebP branch was deleted under R3; its five assertions are waived, while desktop MP4 behavior remains tested.

## K09

English-only ruling deletes the MUSCLE_NAME locale-pack test (two assertion sites); muscle metadata, loads and balance windows retain all legacy assertions.

# Porting waivers

## K06 day-notes: server sync rules moved (4 assertions)

Reason: K06 day-notes: server sync-rule expects moved to day-notes.diff.test.ts (legacy/api/sync-stamps import)

`day-notes.test.ts` drops 4 `expect(` calls from its legacy twin. The server-side sync-rule
assertions (`Server.STAMPED_MAPS`, `Server.highestStamp`, `Server.stampPut`) import the legacy
server module `legacy/api/sync-stamps.js`, which core tests may not import. They live in
`day-notes.diff.test.ts`, which is the only place the rewrite imports legacy server code. The
describe/it names are unchanged.

# K03 porting waivers

English-only ruling removes the three translated-term/name/cache tests (11 assertions); canonical English and accent-insensitive custom names remain covered.

Native Android animated-WebP branch was deleted under R3; its five assertions are waived, while desktop MP4 behavior remains tested.

# Assertion waivers

- K17 ports stamp-level results; HTTP status, revision assignment and private GET field stripping remain S04 assertions. The three HTTP tests in `legacy/api/test/sync-stamps.test.js` keep their names and stamp-level cases here; nine handler-only assertions are deferred to S04. The changed-report path and private history remain covered by the port and differential tests.
- The source-identity assertion in `programme-fix1.test.js` is replaced one-for-one by preservation through the shared core prescription dependency; the server JS twin is intentionally retired (R2).
# Porting waivers

No waivers. Add explicit JSON waivers to scripts/public-parity-map.json for assertion drops, with reasons.

## K02 — approved English-only / en-US port

The GM ruling in DECISIONS-2026-10-12.md removes foreign locales and packs.
Only those assertions are waived; unchanged workout, rep-range, superset, week-start,
weight precision, programme target and programme UI test twins retain every assertion.

- `i18n-core.test.ts`: **44 assertions** — K02 English-only removes foreign locale derivation, picker, name-pack casing and bilingual-switch assertions.
- `i18n-plural.test.ts`: **26 assertions** — K02 English-only removes foreign CLDR plural forms and foreign-pack source inventories.
- `i18n-details-lang.test.ts`: **6 assertions** — K02 English-only replaces foreign description switching with English fallback and stale-load rejection.
- `format-ago.test.ts`: **9 assertions** — K02 English-only removes translated duration, translated set-count and German relative-date assertions.
- `format-names.test.ts`: **2 assertions** — K02 English-only removes Spanish and German translated exercise-name assertions.

`i18n-core` retains seven legacy English assertions and adds explicit English-only
configuration, stale persisted locale, placeholder and canonical-name checks.
`i18n-plural` retains English fallback, placeholder and plain-t plural checks.
`i18n-details-lang` retains the English instruction check and pins the new stale
foreign-description behavior. `format-names` checks all English accent names instead
of enumerating deleted foreign packs. Original surviving describe/it names are kept.

The GM separately moved `nav.ts` into web with injected sheet-entry/current-hash
readers (K02 owns its unchanged seven assertions). W00/W01 wire those readers.
The DOM online listener belongs to W01's i18n shell, which owns the full legacy
`i18n-details-retry.test.js` twin; K02 additionally checks its retry latch, pause and
approved `_retryDetails()` hook in `i18n-details-core.test.ts`.
The `format.diff.test.ts` oracle uses a test-only en-US locale override to compare
the unchanged formatting algorithms under the approved locale; raw en-GB dates are
intentionally not the target. All other differential functions compare raw legacy
outputs, mutations and JSON key order without normalization.
## K09

English-only ruling deletes the MUSCLE_NAME locale-pack test (two assertion sites); muscle metadata, loads and balance windows retain all legacy assertions.

# K03 porting waivers

English-only ruling removes the three translated-term/name/cache tests (11 assertions); canonical English and accent-insensitive custom names remain covered.

Native Android animated-WebP branch was deleted under R3; its five assertions are waived, while desktop MP4 behavior remains tested.

## K07 — parser / HTTP ownership split

K07 defers the importHevyData HTTP describe (5 assertions) to W01, which owns the Hevy fetch and authentication surface.

K07 defers the paging through whatever the server sends HTTP describe (9 assertions) to W01, which owns Hevy pagination and malformed HTTP response handling.

The GM approved the split by describe name; the AST count corrects the initial paging estimate from 7 to 9. All remaining parser describes, names and assertions port unchanged. W01 must map and run these two deferred describes before integration.

# Porting waivers

## K06 day-notes: server sync rules moved (4 assertions)

Reason: K06 day-notes: server sync-rule expects moved to day-notes.diff.test.ts (legacy/api/sync-stamps import)

`day-notes.test.ts` drops 4 `expect(` calls from its legacy twin. The server-side sync-rule
assertions (`Server.STAMPED_MAPS`, `Server.highestStamp`, `Server.stampPut`) import the legacy
server module `legacy/api/sync-stamps.js`, which core tests may not import. They live in
`day-notes.diff.test.ts`, which is the only place the rewrite imports legacy server code. The
describe/it names are unchanged.

# K03 porting waivers

English-only ruling removes the three translated-term/name/cache tests (11 assertions); canonical English and accent-insensitive custom names remain covered.

Native Android animated-WebP branch was deleted under R3; its five assertions are waived, while desktop MP4 behavior remains tested.

# Porting waivers

## K06 day-notes: server sync rules moved (4 assertions)

Reason: K06 day-notes: server sync-rule expects moved to day-notes.diff.test.ts (legacy/api/sync-stamps import)

`day-notes.test.ts` drops 4 `expect(` calls from its legacy twin. The server-side sync-rule
assertions (`Server.STAMPED_MAPS`, `Server.highestStamp`, `Server.stampPut`) import the legacy
server module `legacy/api/sync-stamps.js`, which core tests may not import. They live in
`day-notes.diff.test.ts`, which is the only place the rewrite imports legacy server code. The
describe/it names are unchanged.

# K03 porting waivers

English-only ruling removes the three translated-term/name/cache tests (11 assertions); canonical English and accent-insensitive custom names remain covered.

Native Android animated-WebP branch was deleted under R3; its five assertions are waived, while desktop MP4 behavior remains tested.

# Porting waivers
## K03 — deliberate exception: custom ids may shadow catalogue aliases

Approved by the S08 r1 fix task and reconciled review: legacy `registerCustom`
throws when a custom id (for example `1019`) equals a non-writable hidden alias.
The server inherits that failure in `createExerciseIndex`, preventing all library
validation and publishing for the profile, even for unrelated definitions.
Skip installing alias keys owned by customs, then install the customs as ordinary
enumerable entries so semantic catalogue consumers see them. Duplicate customs
still use the last entry; all non-colliding lookups, hidden alias enumeration and
catalogue-only defaults retain legacy results. Caller snapshots remain frozen
and isolated. The integration follow-up makes `canonicalExId` preserve caller-owned
custom alias shadows while retaining default catalogue alias mapping.
`exercises-index.test.ts` covers the collision, custom lookup/helpers, enumeration,
every other own-key lookup and reset/profile isolation; S08 has a real-TCP
validate/publish regression. This is a named oracle exception, not an assertion
waiver; no surviving legacy assertions are removed.


## K02 — approved English-only / en-US port

The GM ruling in DECISIONS-2026-10-12.md removes foreign locales and packs.
Only those assertions are waived; unchanged workout, rep-range, superset, week-start,
weight precision, programme target and programme UI test twins retain every assertion.

- `i18n-core.test.ts`: **44 assertions** — K02 English-only removes foreign locale derivation, picker, name-pack casing and bilingual-switch assertions.
- `i18n-plural.test.ts`: **26 assertions** — K02 English-only removes foreign CLDR plural forms and foreign-pack source inventories.
- `i18n-details-lang.test.ts`: **6 assertions** — K02 English-only replaces foreign description switching with English fallback and stale-load rejection.
- `format-ago.test.ts`: **9 assertions** — K02 English-only removes translated duration, translated set-count and German relative-date assertions.
- `format-names.test.ts`: **2 assertions** — K02 English-only removes Spanish and German translated exercise-name assertions.

`i18n-core` retains seven legacy English assertions and adds explicit English-only
configuration, stale persisted locale, placeholder and canonical-name checks.
`i18n-plural` retains English fallback, placeholder and plain-t plural checks.
`i18n-details-lang` retains the English instruction check and pins the new stale
foreign-description behavior. `format-names` checks all English accent names instead
of enumerating deleted foreign packs. Original surviving describe/it names are kept.

The GM separately moved `nav.ts` into web with injected sheet-entry/current-hash
readers (K02 owns its unchanged seven assertions). W00/W01 wire those readers.
The DOM online listener belongs to W01's i18n shell, which owns the full legacy
`i18n-details-retry.test.js` twin; K02 additionally checks its retry latch, pause and
approved `_retryDetails()` hook in `i18n-details-core.test.ts`.
The `format.diff.test.ts` oracle uses a test-only en-US locale override to compare
the unchanged formatting algorithms under the approved locale; raw en-GB dates are
intentionally not the target. All other differential functions compare raw legacy
outputs, mutations and JSON key order without normalization.
# K14 porting waivers

English-only ruling deletes active-workout move locale-pack coverage (8 assertions); the move behavior and English source labels are retained.

K14 integration restores an explicit English passthrough check for both `Move up`
and `Move down`; the eight deleted foreign-pack assertions remain waived.
The previously unowned F1-declared `active-exercise-swap` helper is now ported in
K14's integration follow-up, with its complete legacy twin and a seeded native
differential. It preserves caller-owned active-workout mutations and return values.

# K03 porting waivers

## K15

# Porting waivers


## K02 — approved English-only / en-US port

The GM ruling in DECISIONS-2026-10-12.md removes foreign locales and packs.
Only those assertions are waived; unchanged workout, rep-range, superset, week-start,
weight precision, programme target and programme UI test twins retain every assertion.

- `i18n-core.test.ts`: **44 assertions** — K02 English-only removes foreign locale derivation, picker, name-pack casing and bilingual-switch assertions.
- `i18n-plural.test.ts`: **26 assertions** — K02 English-only removes foreign CLDR plural forms and foreign-pack source inventories.
- `i18n-details-lang.test.ts`: **6 assertions** — K02 English-only replaces foreign description switching with English fallback and stale-load rejection.
- `format-ago.test.ts`: **9 assertions** — K02 English-only removes translated duration, translated set-count and German relative-date assertions.
- `format-names.test.ts`: **2 assertions** — K02 English-only removes Spanish and German translated exercise-name assertions.

`i18n-core` retains seven legacy English assertions and adds explicit English-only
configuration, stale persisted locale, placeholder and canonical-name checks.
`i18n-plural` retains English fallback, placeholder and plain-t plural checks.
`i18n-details-lang` retains the English instruction check and pins the new stale
foreign-description behavior. `format-names` checks all English accent names instead
of enumerating deleted foreign packs. Original surviving describe/it names are kept.

The GM separately moved `nav.ts` into web with injected sheet-entry/current-hash
readers (K02 owns its unchanged seven assertions). W00/W01 wire those readers.
The DOM online listener belongs to W01's i18n shell, which owns the full legacy
`i18n-details-retry.test.js` twin; K02 additionally checks its retry latch, pause and
approved `_retryDetails()` hook in `i18n-details-core.test.ts`.
The `format.diff.test.ts` oracle uses a test-only en-US locale override to compare
the unchanged formatting algorithms under the approved locale; raw en-GB dates are
intentionally not the target. All other differential functions compare raw legacy
outputs, mutations and JSON key order without normalization.


## K09

English-only ruling deletes the MUSCLE_NAME locale-pack test (two assertion sites); muscle metadata, loads and balance windows retain all legacy assertions.

OM online listener belongs to W01's i18n shell, which owns the full legacy
`i18n-details-retry.test.js` twin; K02 additionally checks its retry latch, pause and
approved `_retryDetails()` hook in `i18n-details-core.test.ts`.
The `format.diff.test.ts` oracle uses a test-only en-US locale override to compare
the unchanged formatting algorithms under the approved locale; raw en-GB dates are
intentionally not the target. All other differential functions compare raw legacy
outputs, mutations and JSON key order without normalization.
# K14 porting waivers

English-only ruling deletes active-workout move locale-pack coverage (8 assertions); the move behavior and English source labels are retained.
## K09

English-only ruling deletes the MUSCLE_NAME locale-pack test (two assertion sites); muscle metadata, loads and balance windows retain all legacy assertions.
No assertion-drop waivers. Add explicit JSON waivers to scripts/public-parity-map.json for assertion drops, with reasons.

## ZIP-CRC32 — reject corrupt backup entries (K01 oracle exception)

No assertion-drop waivers. Add explicit JSON waivers to scripts/public-parity-map.json for assertion drops, with reasons.

## ZIP-CRC32 — reject corrupt backup entries (K01 oracle exception)

GM ruling, 2026-10-13: `readZip` validates CRC-32 for every entry against the central-directory
checksum and throws `ZipError` with code `crc-mismatch` on mismatch, including directory and empty
entries. Legacy never checked CRC, so parseable corruption (a backup weight changing from 100 to
900) silently imported. This intentional oracle exception prevents that import; valid archive
bytes, entry payloads and the public API remain unchanged. Reads use bounded 4 MiB chunks.

Regressions: `k01.diff.test.ts` demonstrates legacy accepts the corrupted JSON while the port
rejects it and validates a byte-identical valid round trip; `zip.test.ts` covers corruption in
first/middle/last/directory entries, empty-entry CRC metadata and multi-chunk data. No legacy
tests or assertions are waived.

## P2 — authored progression engine
New declarative progression engine; legacy routine progression remains owned and parity-tested by K08.
P2 has no legacy twin; its acceptance is the hand-computed tables, replay/rounding regressions,
1,000 shuffled-key determinism runs and mutation probes in progression-engine.test.ts.
# P3 new-only progression handlers

New declarative rpe-load, amrap-tm and stall handlers; K08 owns legacy routine progression twins and K09 owns core onerm twins.
P3's explicit `legacyTests` inventory is empty; no retained legacy test is waived or remapped.
Core estimate1RM behavior stays unchanged and is checked for every formula by P3 goldens.

# K03 porting waivers

English-only ruling removes the three translated-term/name/cache tests (11 assertions); canonical English and accent-insensitive custom names remain covered.

Native Android animated-WebP branch was deleted under R3; its five assertions are waived, while desktop MP4 behavior remains tested.

## P1 new authoring tests

P1 adds declarative progression authoring with no legacy test twin; K13 retains the complete conformance twin and differential gate.
The schema-only differential projects away the additive P1 fields/definitions; all legacy validator, conformance and repair comparisons remain unchanged.


# K03 porting waivers

English-only ruling removes the three translated-term/name/cache tests (11 assertions); canonical English and accent-insensitive custom names remain covered.

Native Android animated-WebP branch was deleted under R3; its five assertions are waived, while desktop MP4 behavior remains tested.

## K09

English-only ruling deletes the MUSCLE_NAME locale-pack test (two assertion sites); muscle metadata, loads and balance windows retain all legacy assertions.

# Porting waivers
# K03 porting waivers

## K06 day-notes: server sync rules moved (4 assertions)

Reason: K06 day-notes: server sync-rule expects moved to day-notes.diff.test.ts (legacy/api/sync-stamps import)

`day-notes.test.ts` drops 4 `expect(` calls from its legacy twin. The server-side sync-rule
assertions (`Server.STAMPED_MAPS`, `Server.highestStamp`, `Server.stampPut`) import the legacy
server module `legacy/api/sync-stamps.js`, which core tests may not import. They live in
`day-notes.diff.test.ts`, which is the only place the rewrite imports legacy server code. The
describe/it names are unchanged.

English-only ruling removes the three translated-term/name/cache tests (11 assertions); canonical English and accent-insensitive custom names remain covered.

Native Android animated-WebP branch was deleted under R3; its five assertions are waived, while desktop MP4 behavior remains tested.

## K15

Media deletion ruling removes the replaced-workout photos/videos carry test and its four assertions; note carry remains tested.
# Porting waivers

No waivers. Add explicit JSON waivers to scripts/public-parity-map.json for assertion drops, with reasons.

## K02 — approved English-only / en-US port

The GM ruling in DECISIONS-2026-10-12.md removes foreign locales and packs.
Only those assertions are waived; unchanged workout, rep-range, superset, week-start,
weight precision, programme target and programme UI test twins retain every assertion.

- `i18n-core.test.ts`: **44 assertions** — K02 English-only removes foreign locale derivation, picker, name-pack casing and bilingual-switch assertions.
- `i18n-plural.test.ts`: **26 assertions** — K02 English-only removes foreign CLDR plural forms and foreign-pack source inventories.
- `i18n-details-lang.test.ts`: **6 assertions** — K02 English-only replaces foreign description switching with English fallback and stale-load rejection.
- `format-ago.test.ts`: **9 assertions** — K02 English-only removes translated duration, translated set-count and German relative-date assertions.
- `format-names.test.ts`: **2 assertions** — K02 English-only removes Spanish and German translated exercise-name assertions.

`i18n-core` retains seven legacy English assertions and adds explicit English-only
configuration, stale persisted locale, placeholder and canonical-name checks.
`i18n-plural` retains English fallback, placeholder and plain-t plural checks.
`i18n-details-lang` retains the English instruction check and pins the new stale
foreign-description behavior. `format-names` checks all English accent names instead
of enumerating deleted foreign packs. Original surviving describe/it names are kept.

The GM separately moved `nav.ts` into web with injected sheet-entry/current-hash
readers (K02 owns its unchanged seven assertions). W00/W01 wire those readers.
The DOM online listener belongs to W01's i18n shell, which owns the full legacy
`i18n-details-retry.test.js` twin; K02 additionally checks its retry latch, pause and
approved `_retryDetails()` hook in `i18n-details-core.test.ts`.
The `format.diff.test.ts` oracle uses a test-only en-US locale override to compare
the unchanged formatting algorithms under the approved locale; raw en-GB dates are
intentionally not the target. All other differential functions compare raw legacy
outputs, mutations and JSON key order without normalization.

# Porting waivers

No assertion-drop waivers. Add explicit JSON waivers to scripts/public-parity-map.json for assertion drops, with reasons.

## ZIP-CRC32 — reject corrupt backup entries (K01 oracle exception)

GM ruling, 2026-10-13: `readZip` validates CRC-32 for every entry against the central-directory
checksum and throws `ZipError` with code `crc-mismatch` on mismatch, including directory and empty
entries. Legacy never checked CRC, so parseable corruption (a backup weight changing from 100 to
900) silently imported. This intentional oracle exception prevents that import; valid archive
bytes, entry payloads and the public API remain unchanged. Reads use bounded 4 MiB chunks.

Regressions: `k01.diff.test.ts` demonstrates legacy accepts the corrupted JSON while the port
rejects it and validates a byte-identical valid round trip; `zip.test.ts` covers corruption in
first/middle/last/directory entries, empty-entry CRC metadata and multi-chunk data. No legacy
tests or assertions are waived.
# Assertion waivers

- K17 ports stamp-level results; HTTP status, revision assignment and private GET field stripping remain S04 assertions. The three HTTP tests in `legacy/api/test/sync-stamps.test.js` keep their names and stamp-level cases here; nine handler-only assertions are deferred to S04. The changed-report path and private history remain covered by the port and differential tests.
- The source-identity assertion in `programme-fix1.test.js` is replaced one-for-one by preservation through the shared core prescription dependency; the server JS twin is intentionally retired (R2).
# Porting waivers

## K07 — parser / HTTP ownership split

K07 defers the importHevyData HTTP describe (5 assertions) to W01, which owns the Hevy fetch and authentication surface.

K07 defers the paging through whatever the server sends HTTP describe (9 assertions) to W01, which owns Hevy pagination and malformed HTTP response handling.

The GM approved the split by describe name; the AST count corrects the initial paging estimate from 7 to 9. All remaining parser describes, names and assertions port unchanged. W01 must map and run these two deferred describes before integration.
No assertion-drop waivers. Add explicit JSON waivers to scripts/public-parity-map.json for assertion drops, with reasons.

Regressions: `k01.diff.test.ts` demonstrates legacy accepts the corrupted JSON while the port
rejects it and validates a byte-identical valid round trip; `zip.test.ts` covers corruption in
first/middle/last/directory entries, empty-entry CRC metadata and multi-chunk data. No legacy
tests or assertions are waived.

## K09

English-only ruling deletes the MUSCLE_NAME locale-pack test (two assertion sites); muscle metadata, loads and balance windows retain all legacy assertions.
# K14 porting waivers

English-only ruling deletes active-workout move locale-pack coverage (8 assertions); the move behavior and English source labels are retained.


# K03 porting waivers
# Assertion waivers

K13 duplicate-source recovery (GM post-parity exception, 2026-10-13): repair rejects the positional `source-N` fallback when multiple explicit source candidates match. Legacy recovered the first row even if duplicate candidates prescribed RPE 8 versus RPE 4. The port recovers neither candidate's effort and conformance retains `slot.effort`; no assertion-drop budget is used. `programme-model.diff.test.ts` records both legacy's RPE 8 result and the port's deliberate no-recovery result. Positional recovery with zero explicit candidates remains supported.

K03 caller-owned index ordering (GM-approved R2 exception): after registering a custom shadow of a built-in and resetting, legacy deletes and re-appends that built-in at the end of its mutable index. Fresh indexes retain catalogue order. Direct lookups and the app's `allExercises` search path remain identical; tied searches over `Object.values(index)` may change order. The two-command shadow/reset regression and stateful differential pin this deliberate change rather than copying global mutation history.

## K03 — deliberate exception: custom ids may shadow catalogue aliases

Approved by the S08 r1 fix task and reconciled review: legacy `registerCustom`
throws when a custom id (for example `1019`) equals a non-writable hidden alias.
The server inherits that failure in `createExerciseIndex`, preventing all library
validation and publishing for the profile, even for unrelated definitions.
Skip installing alias keys owned by customs, then install the customs as ordinary
enumerable entries so semantic catalogue consumers see them. Duplicate customs
still use the last entry; all non-colliding lookups, hidden alias enumeration and
catalogue-only defaults retain legacy results. Caller snapshots remain frozen
and isolated. The follow-up below extends canonical lookup for custom shadows.
`exercises-index.test.ts` covers the collision, custom lookup/helpers, enumeration,
every other own-key lookup and reset/profile isolation; S08 has a real-TCP
validate/publish regression. This is a named oracle exception, not an assertion
waiver; no surviving legacy assertions are removed.



GM-directed follow-up to the custom-alias exception: canonicalExId preserves ids that the caller-owned index marks as custom, including a 1019 shadow, instead of returning the built-in alias target. Native K03 and K13 output tests pin this deliberate exception.

## K17 server stamp

- K17 ports stamp-level results; HTTP status, revision assignment and private GET field stripping remain S04 assertions. The three HTTP tests in `legacy/api/test/sync-stamps.test.js` keep their names and stamp-level cases here; nine handler-only assertions are deferred to S04. The changed-report path and private history remain covered by the port and differential tests.
- The source-identity assertion in `programme-fix1.test.js` is replaced one-for-one by preservation through the shared core prescription dependency; the server JS twin is intentionally retired (R2).
## P1 new authoring tests

P1 adds declarative progression authoring with no legacy test twin; K13 retains the complete conformance twin and differential gate.
The schema-only differential projects away the additive P1 fields/definitions; all legacy validator, conformance and repair comparisons remain unchanged.


# K03 porting waivers

English-only ruling deletes the MUSCLE_NAME locale-pack test (two assertion sites); muscle metadata, loads and balance windows retain all legacy assertions.

The GM separately moved `nav.ts` into web with injected sheet-entry/current-hash
readers (K02 owns its unchanged seven assertions). W00/W01 wire those readers.
The DOM online listener belongs to W01's i18n shell, which owns the full legacy
`i18n-details-retry.test.js` twin; K02 additionally checks its retry latch, pause and
approved `_retryDetails()` hook in `i18n-details-core.test.ts`.
The `format.diff.test.ts` oracle uses a test-only en-US locale override to compare
the unchanged formatting algorithms under the approved locale; raw en-GB dates are
intentionally not the target. All other differential functions compare raw legacy
outputs, mutations and JSON key order without normalization.
## K09

# K03 porting waivers

English-only ruling removes the three translated-term/name/cache tests (11 assertions); canonical English and accent-insensitive custom names remain covered.

## K09
The GM approved the split by describe name; the AST count corrects the initial paging estimate from 7 to 9. All remaining parser describes, names and assertions port unchanged. W01 must map and run these two deferred describes before integration.

# Porting waivers
## K03 — deliberate exception: custom ids may shadow catalogue aliases

Approved by the S08 r1 fix task and reconciled review: legacy `registerCustom`
throws when a custom id (for example `1019`) equals a non-writable hidden alias.
The server inherits that failure in `createExerciseIndex`, preventing all library
validation and publishing for the profile, even for unrelated definitions.
Skip installing alias keys owned by customs, then install the customs as ordinary
enumerable entries so semantic catalogue consumers see them. Duplicate customs
still use the last entry; all non-colliding lookups, hidden alias enumeration and
catalogue-only defaults retain legacy results. Caller snapshots remain frozen
and isolated. The integration follow-up makes `canonicalExId` preserve caller-owned
custom alias shadows while retaining default catalogue alias mapping.
`exercises-index.test.ts` covers the collision, custom lookup/helpers, enumeration,
every other own-key lookup and reset/profile isolation; S08 has a real-TCP
validate/publish regression. This is a named oracle exception, not an assertion
waiver; no surviving legacy assertions are removed.


## K02 — approved English-only / en-US port

The GM separately moved `nav.ts` into web with injected sheet-entry/current-hash
readers (K02 owns its unchanged seven assertions). W00/W01 wire those readers.
The DOM online listener belongs to W01's i18n shell, which owns the full legacy
`i18n-details-retry.test.js` twin; K02 additionally checks its retry latch, pause and
approved `_retryDetails()` hook in `i18n-details-core.test.ts`.
The `format.diff.test.ts` oracle uses a test-only en-US locale override to compare
the unchanged formatting algorithms under the approved locale; raw en-GB dates are
intentionally not the target. All other differential functions compare raw legacy
outputs, mutations and JSON key order without normalization.
# K14 porting waivers

English-only ruling deletes active-workout move locale-pack coverage (8 assertions); the move behavior and English source labels are retained.

K14 integration restores an explicit English passthrough check for both `Move up`
and `Move down`; the eight deleted foreign-pack assertions remain waived.
The previously unowned F1-declared `active-exercise-swap` helper is now ported in
K14's integration follow-up, with its complete legacy twin and a seeded native
differential. It preserves caller-owned active-workout mutations and return values.

English-only ruling deletes the MUSCLE_NAME locale-pack test (two assertion sites); muscle metadata, loads and balance windows retain all legacy assertions.
Native Android animated-WebP branch was deleted under R3; its five assertions are waived, while desktop MP4 behavior remains tested.

# K16 porting waivers

English-only ruling removes plan-print translated-name casing and German body-part translation assertions; English print casing and separate body-part spacing remain covered.

English-only ruling removes workout-text language-pack casing tests; canonical English exercise names remain covered in the text twin.

The print iframe and its printPlan export move to W13 by the execution row. Canvas drawing moves to web/src/lib/workout-card.ts by the GM ruling; K16 supplies it for W13 alongside the pure core model/layout/colors. No legacy test assertions cover the renderer; new web tests exercise its drawing operations.

## K16 r1: untrusted shared-plan safety exceptions (review-approved)

The frozen legacy oracle accepts hostile imports. The following deliberate exceptions apply
only to import/merge; valid exports and ordinary legacy plans retain their JSON bytes/key order,
unit conversions and prescription behavior (the seeded K16 differential remains unchanged).

- **Week prototype:** parse/merge copy only own `0`–`6` weekday keys into a fresh ordinary
  object. Values must be null, a nonempty string id, or an array of string ids; invalid values
  and nonstring elements are dropped. Merge replaces the week object rather than invoking
  setters on imported keys. Nonweekday keys, including `__proto__`, never survive.
- **Inherited ids:** routine/custom/exercise ids must be nonempty strings. Built-in/index ids
  and their canonical alias targets must be own properties; a missing/inherited alias target
  leaves the original own id intact. Custom/routine remapping uses `Map`. Undeclared inherited ids
  (`constructor`, `toString`, `__proto__`) are dropped. Explicitly declared string ids with
  those names remain supported safely; every remapped reference is a real imported string id.
- **Resource limits:** string input is capped at **1,048,576 UTF-8 bytes (1 MiB)** before
  `JSON.parse` (also checked by code-unit length first to avoid allocating a huge encoder
  buffer). A quote/escape-aware preflight caps **32 container levels**, **16,384 UTF-16 code
  units per string/key**, **4,096 entries per array**, **256 properties per object**, and
  **100,000 JSON tokens (containers, keys and scalar values)** before decode. Syntax remains
  JSON.parse's responsibility. The decoded-object path also bounds depth, all strings/keys,
  arrays/properties (including nonenumerable fields, nonstandard prototypes, and up to 256
  named properties on arrays), 100,000 values, and 1 MiB accumulated UTF-8 string/key payload,
  including
  unknown retained metadata. Cycles fail at the depth bound. Before normalization/mutation,
  both paths cap **256 routines**, **2,048 custom exercises**, **128 exercises per routine**,
  **8,192 exercises total**, and **256 routine references per weekday**. Over-limit input
  throws `code: 'plan-limit'`; it is rejected, never truncated. These caps exceed a practical
  weekly plan by a wide margin while bounding allocation and traversal. A 2 MiB note and
  10,000-deep metadata fail before JSON decoding, and also fail on direct object imports.

**W13 obligation:** enforce `File.size <= 1,048,576` **before** `File.text()`/FileReader/platform
file-read allocation, then retain K16's post-read UTF-8/preflight checks. The core codec receives
an already-read string, so it cannot cap the original file allocation. This follow-up is carried
in the K16 r1 RESULT for CROSS-UNIT-NOTES and W13; K16 does not edit W13's file reader.

Regressions: `core/test/plan-share-hostile.test.ts` (week contents AND prototype, direct merge,
own-index checks, string-only ids, safe declared magic-name remaps, each cap, decode-not-called
checks, huge Unicode input, escaped delimiter/string handling, cycles, named array metadata,
nonenumerable/inherited consumed fields, inherited alias targets, and recipient immutability
on resource failure). Existing legacy twins and seeded deep/JSON-string comparisons are retained.

# K03 porting waivers

English-only ruling removes the three translated-term/name/cache tests (11 assertions); canonical English and accent-insensitive custom names remain covered.
No assertion-drop waivers. Add explicit JSON waivers to scripts/public-parity-map.json for assertion drops, with reasons.

Native Android animated-WebP branch was deleted under R3; its five assertions are waived, while desktop MP4 behavior remains tested.

## P1 new authoring tests


# K03 porting waivers

English-only ruling removes the three translated-term/name/cache tests (11 assertions); canonical English and accent-insensitive custom names remain covered.

Native Android animated-WebP branch was deleted under R3; its five assertions are waived, while desktop MP4 behavior remains tested.

## P2 — authored progression engine
New declarative progression engine; legacy routine progression remains owned and parity-tested by K08.
P2 has no legacy twin; its acceptance is the hand-computed tables, replay/rounding regressions,
1,000 shuffled-key determinism runs and mutation probes in progression-engine.test.ts.
# P3 new-only progression handlers

New declarative rpe-load, amrap-tm and stall handlers; K08 owns legacy routine progression twins and K09 owns core onerm twins.
P3's explicit `legacyTests` inventory is empty; no retained legacy test is waived or remapped.
Core estimate1RM behavior stays unchanged and is checked for every formula by P3 goldens.

## K14 partial-limb swap safety exception

GM ruling, 2026-10-13: a completed left or right limb is logged work even while the aggregate row remains unchecked. Active-exercise swap uses workout-model.hasCompletedWork, requests confirmation, and inserts the replacement while preserving the original limb data. The inherited legacy helper replaced and deleted that partial result. This is an explicit safety exception; ordinary scalar-row parity and group/routine metadata behavior remain unchanged. active-exercise-swap.test.ts covers both limbs, standalone/grouped keep/detach, and neither-limb-complete behavior; no assertion-drop budget is used.

## P4 — new-only progression volume and preview

New declarative volume-ramp, scheduled-deload and multi-week hypothetical preview. Legacy routine progression stays owned and parity-tested by K08; core muscles is consumed unchanged from K03.

P4 has no legacy test twin: its explicit `legacyTests: []` inventory covers only new engine behavior.
The synthetic fixtures contain explicit fields and hand-computed tables, not captured engine output.


## K09

English-only ruling deletes the MUSCLE_NAME locale-pack test (two assertion sites); muscle metadata, loads and balance windows retain all legacy assertions.

Regressions: `k01.diff.test.ts` demonstrates legacy accepts the corrupted JSON while the port
rejects it and validates a byte-identical valid round trip; `zip.test.ts` covers corruption in
first/middle/last/directory entries, empty-entry CRC metadata and multi-chunk data. No legacy
tests or assertions are waived.
# Assertion waivers

- K17 ports stamp-level results; HTTP status, revision assignment and private GET field stripping remain S04 assertions. The three HTTP tests in `legacy/api/test/sync-stamps.test.js` keep their names and stamp-level cases here; nine handler-only assertions are deferred to S04. The changed-report path and private history remain covered by the port and differential tests.
- The source-identity assertion in `programme-fix1.test.js` is replaced one-for-one by preservation through the shared core prescription dependency; the server JS twin is intentionally retired (R2).

## P5 new endpoints and activation seed
New progression HTTP endpoints and activation TM seed resolver; S04 owns legacy data route twins.

# Porting waivers

## K06 day-notes: server sync rules moved (4 assertions)

Reason: K06 day-notes: server sync-rule expects moved to day-notes.diff.test.ts (legacy/api/sync-stamps import)

`day-notes.test.ts` drops 4 `expect(` calls from its legacy twin. The server-side sync-rule
assertions (`Server.STAMPED_MAPS`, `Server.highestStamp`, `Server.stampPut`) import the legacy
server module `legacy/api/sync-stamps.js`, which core tests may not import. They live in
`day-notes.diff.test.ts`, which is the only place the rewrite imports legacy server code. The
describe/it names are unchanged.

# K03 porting waivers

English-only ruling removes the three translated-term/name/cache tests (11 assertions); canonical English and accent-insensitive custom names remain covered.

Native Android animated-WebP branch was deleted under R3; its five assertions are waived, while desktop MP4 behavior remains tested.

# Porting waivers

No waivers. Add explicit JSON waivers to scripts/public-parity-map.json for assertion drops, with reasons.

## K02 — approved English-only / en-US port

The GM ruling in DECISIONS-2026-10-12.md removes foreign locales and packs.
Only those assertions are waived; unchanged workout, rep-range, superset, week-start,
weight precision, programme target and programme UI test twins retain every assertion.

- `i18n-core.test.ts`: **44 assertions** — K02 English-only removes foreign locale derivation, picker, name-pack casing and bilingual-switch assertions.
- `i18n-plural.test.ts`: **26 assertions** — K02 English-only removes foreign CLDR plural forms and foreign-pack source inventories.
- `i18n-details-lang.test.ts`: **6 assertions** — K02 English-only replaces foreign description switching with English fallback and stale-load rejection.
- `format-ago.test.ts`: **9 assertions** — K02 English-only removes translated duration, translated set-count and German relative-date assertions.
- `format-names.test.ts`: **2 assertions** — K02 English-only removes Spanish and German translated exercise-name assertions.

`i18n-core` retains seven legacy English assertions and adds explicit English-only
configuration, stale persisted locale, placeholder and canonical-name checks.
`i18n-plural` retains English fallback, placeholder and plain-t plural checks.
`i18n-details-lang` retains the English instruction check and pins the new stale
foreign-description behavior. `format-names` checks all English accent names instead
of enumerating deleted foreign packs. Original surviving describe/it names are kept.

The GM separately moved `nav.ts` into web with injected sheet-entry/current-hash
readers (K02 owns its unchanged seven assertions). W00/W01 wire those readers.
The DOM online listener belongs to W01's i18n shell, which owns the full legacy
`i18n-details-retry.test.js` twin; K02 additionally checks its retry latch, pause and
approved `_retryDetails()` hook in `i18n-details-core.test.ts`.
The `format.diff.test.ts` oracle uses a test-only en-US locale override to compare
the unchanged formatting algorithms under the approved locale; raw en-GB dates are
intentionally not the target. All other differential functions compare raw legacy
outputs, mutations and JSON key order without normalization.

# Porting waivers

The GM approved the split by describe name; the AST count corrects the initial paging estimate from 7 to 9. All remaining parser describes, names and assertions port unchanged. W01 must map and run these two deferred describes before integration.
No assertion-drop waivers. Add explicit JSON waivers to scripts/public-parity-map.json for assertion drops, with reasons.

## ZIP-CRC32 — reject corrupt backup entries (K01 oracle exception)

GM ruling, 2026-10-13: `readZip` validates CRC-32 for every entry against the central-directory
checksum and throws `ZipError` with code `crc-mismatch` on mismatch, including directory and empty
entries. Legacy never checked CRC, so parseable corruption (a backup weight changing from 100 to
900) silently imported. This intentional oracle exception prevents that import; valid archive
bytes, entry payloads and the public API remain unchanged. Reads use bounded 4 MiB chunks.

Regressions: `k01.diff.test.ts` demonstrates legacy accepts the corrupted JSON while the port
rejects it and validates a byte-identical valid round trip; `zip.test.ts` covers corruption in
first/middle/last/directory entries, empty-entry CRC metadata and multi-chunk data. No legacy
tests or assertions are waived.


## K12 — programme-open-slots explicit catalogue follow-up

GM assigned the missing F1-declared runtime helper to integration. chooseOpenSlot requires a caller-owned ExerciseIndex and forwards it to canonicalExId and buildPlannedEntry; it has no global catalogue default. Known-exercise validation uses that index, preserving K03's approved custom alias-shadow exception. Stale identities and logged aggregate/limb rows remain no-ops; later unresolved slot propagation uses the existing programme-edit port. The frozen source has no standalone KEEP test file: a new direct legacy-helper differential records outcomes and full state mutations (1,000 seeded cases), plus scoped snapshot propagation and caller-index regressions. Three independent index-removal mutants are detected. No assertion budget waived or legacy source changed.

## K14 integration follow-up: workout-controls

GM assigned the declaration-only pure workout-controls helper to integration for W20. Native source retains the frozen defaults, saved own enumerable overrides, unknown keys and shallow reference semantics. A direct legacy differential is an additional test (1,000 gate runs, PARITY_RUNS nightly), since this helper has no separate legacy test inventory; K14 KEEP mappings and assertion counts are unchanged. No behavior or assertion-count waiver is introduced. ExerciseIndex is not applicable: this helper performs no exercise lookup.


- K17 ports stamp-level results; HTTP status, revision assignment and private GET field stripping remain S04 assertions. The three HTTP tests in `legacy/api/test/sync-stamps.test.js` keep their names and stamp-level cases here; nine handler-only assertions are deferred to S04. The changed-report path and private history remain covered by the port and differential tests.
- The source-identity assertion in `programme-fix1.test.js` is replaced one-for-one by preservation through the shared core prescription dependency; the server JS twin is intentionally retired (R2).

K03 caller-owned index ordering (GM-approved R2 exception): after registering a custom shadow of a built-in and resetting, legacy deletes and re-appends that built-in at the end of its mutable index. Fresh indexes retain catalogue order. Direct lookups and the app's `allExercises` search path remain identical; tied searches over `Object.values(index)` may change order. The two-command shadow/reset regression and stateful differential pin this deliberate change rather than copying global mutation history.
## K15

Approved by the S08 r1 fix task and reconciled review: legacy `registerCustom`
throws when a custom id (for example `1019`) equals a non-writable hidden alias.
The server inherits that failure in `createExerciseIndex`, preventing all library
validation and publishing for the profile, even for unrelated definitions.
Skip installing alias keys owned by customs, then install the customs as ordinary
enumerable entries so semantic catalogue consumers see them. Duplicate customs
still use the last entry; all non-colliding lookups, hidden alias enumeration and
catalogue-only defaults retain legacy results. Caller snapshots remain frozen
and isolated. The follow-up below extends canonical lookup for custom shadows.
`exercises-index.test.ts` covers the collision, custom lookup/helpers, enumeration,
every other own-key lookup and reset/profile isolation; S08 has a real-TCP
validate/publish regression. This is a named oracle exception, not an assertion
waiver; no surviving legacy assertions are removed.
# Porting waivers


GM-directed follow-up to the custom-alias exception: canonicalExId preserves ids that the caller-owned index marks as custom, including a 1019 shadow, instead of returning the built-in alias target. Native K03 and K13 output tests pin this deliberate exception.


# Porting waivers

OM online listener belongs to W01's i18n shell, which owns the full legacy
`i18n-details-retry.test.js` twin; K02 additionally checks its retry latch, pause and
approved `_retryDetails()` hook in `i18n-details-core.test.ts`.
The `format.diff.test.ts` oracle uses a test-only en-US locale override to compare
the unchanged formatting algorithms under the approved locale; raw en-GB dates are
intentionally not the target. All other differential functions compare raw legacy
outputs, mutations and JSON key order without normalization.
# K14 porting waivers

English-only ruling deletes active-workout move locale-pack coverage (8 assertions); the move behavior and English source labels are retained.
## K09

The GM approved the split by describe name; the AST count corrects the initial paging estimate from 7 to 9. All remaining parser describes, names and assertions port unchanged. W01 must map and run these two deferred describes before integration.
English-only ruling deletes the MUSCLE_NAME locale-pack test (two assertion sites); muscle metadata, loads and balance windows retain all legacy assertions.
No assertion-drop waivers. Add explicit JSON waivers to scripts/public-parity-map.json for assertion drops, with reasons.

## P2 — authored progression engine
New declarative progression engine; legacy routine progression remains owned and parity-tested by K08.
P2 has no legacy twin; its acceptance is the hand-computed tables, replay/rounding regressions,
1,000 shuffled-key determinism runs and mutation probes in progression-engine.test.ts.
# P3 new-only progression handlers

## P2 — authored progression engine
New declarative progression engine; legacy routine progression remains owned and parity-tested by K08.
P2 has no legacy twin; its acceptance is the hand-computed tables, replay/rounding regressions,
1,000 shuffled-key determinism runs and mutation probes in progression-engine.test.ts.

## P5 new endpoints and activation seed
New progression HTTP endpoints and activation TM seed resolver; S04 owns legacy data route twins.

GM assigned the declaration-only pure workout-controls helper to integration for W20. Native source retains the frozen defaults, saved own enumerable overrides, unknown keys and shallow reference semantics. A direct legacy differential is an additional test (1,000 gate runs, PARITY_RUNS nightly), since this helper has no separate legacy test inventory; K14 KEEP mappings and assertion counts are unchanged. No behavior or assertion-count waiver is introduced. ExerciseIndex is not applicable: this helper performs no exercise lookup.

## Integration pure core gaps: accent and similar-exercises

GM approved splitting accent (2026-10-13): core/accent contains cleanHex, sanitizeAccent and pure colour helpers; the frozen core-api/accent applyAccent declaration is implemented only in W04 web because R1 forbids DOM in core. Frozen declarations are unchanged. W04's existing accent KEEP mapping remains with web, whose pure exports will re-export this shared implementation at integration; the reviewed own-preset lookup and Logbook DOM behavior remain unchanged. Additional core twins compare cleanHex/sanitizeAccent and colour maths directly to legacy, with no assertion waiver. Similar-exercises has no standalone legacy test inventory; its added direct twin preserves exact primary-muscle filtering, stable equipment grouping, exclusions and shallow references. W12 sheet KEEP mappings remain unchanged. Neither module performs exercise catalogue lookups; explicit ExerciseIndex is not applicable.
## K09

English-only ruling deletes the MUSCLE_NAME locale-pack test (two assertion sites); muscle metadata, loads and balance windows retain all legacy assertions.
# Porting waivers

The GM approved the split by describe name; the AST count corrects the initial paging estimate from 7 to 9. All remaining parser describes, names and assertions port unchanged. W01 must map and run these two deferred describes before integration.
No assertion-drop waivers. Add explicit JSON waivers to scripts/public-parity-map.json for assertion drops, with reasons.

English-only ruling deletes the MUSCLE_NAME locale-pack test (two assertion sites); muscle metadata, loads and balance windows retain all legacy assertions.
# K14 porting waivers
# K16 porting waivers

English-only ruling removes plan-print translated-name casing and German body-part translation assertions; English print casing and separate body-part spacing remain covered.

English-only ruling removes workout-text language-pack casing tests; canonical English exercise names remain covered in the text twin.

The print iframe and its printPlan export move to W13 by the execution row. Canvas drawing moves to web/src/lib/workout-card.ts by the GM ruling; K16 supplies it for W13 alongside the pure core model/layout/colors. No legacy test assertions cover the renderer; new web tests exercise its drawing operations.

## K16 r1: untrusted shared-plan safety exceptions (review-approved)

The frozen legacy oracle accepts hostile imports. The following deliberate exceptions apply
only to import/merge; valid exports and ordinary legacy plans retain their JSON bytes/key order,
unit conversions and prescription behavior (the seeded K16 differential remains unchanged).

- **Week prototype:** parse/merge copy only own `0`–`6` weekday keys into a fresh ordinary
  object. Values must be null, a nonempty string id, or an array of string ids; invalid values
  and nonstring elements are dropped. Merge replaces the week object rather than invoking
  setters on imported keys. Nonweekday keys, including `__proto__`, never survive.
- **Inherited ids:** routine/custom/exercise ids must be nonempty strings. Built-in/index ids
  and their canonical alias targets must be own properties; a missing/inherited alias target
  leaves the original own id intact. Custom/routine remapping uses `Map`. Undeclared inherited ids
  (`constructor`, `toString`, `__proto__`) are dropped. Explicitly declared string ids with
  those names remain supported safely; every remapped reference is a real imported string id.
- **Resource limits:** string input is capped at **1,048,576 UTF-8 bytes (1 MiB)** before
  `JSON.parse` (also checked by code-unit length first to avoid allocating a huge encoder
  buffer). A quote/escape-aware preflight caps **32 container levels**, **16,384 UTF-16 code
  units per string/key**, **4,096 entries per array**, **256 properties per object**, and
  **100,000 JSON tokens (containers, keys and scalar values)** before decode. Syntax remains
  JSON.parse's responsibility. The decoded-object path also bounds depth, all strings/keys,
  arrays/properties (including nonenumerable fields, nonstandard prototypes, and up to 256
  named properties on arrays), 100,000 values, and 1 MiB accumulated UTF-8 string/key payload,
  including
  unknown retained metadata. Cycles fail at the depth bound. Before normalization/mutation,
  both paths cap **256 routines**, **2,048 custom exercises**, **128 exercises per routine**,
  **8,192 exercises total**, and **256 routine references per weekday**. Over-limit input
  throws `code: 'plan-limit'`; it is rejected, never truncated. These caps exceed a practical
  weekly plan by a wide margin while bounding allocation and traversal. A 2 MiB note and
  10,000-deep metadata fail before JSON decoding, and also fail on direct object imports.

**W13 obligation:** enforce `File.size <= 1,048,576` **before** `File.text()`/FileReader/platform
file-read allocation, then retain K16's post-read UTF-8/preflight checks. The core codec receives
an already-read string, so it cannot cap the original file allocation. This follow-up is carried
in the K16 r1 RESULT for CROSS-UNIT-NOTES and W13; K16 does not edit W13's file reader.

Regressions: `core/test/plan-share-hostile.test.ts` (week contents AND prototype, direct merge,
own-index checks, string-only ids, safe declared magic-name remaps, each cap, decode-not-called
checks, huge Unicode input, escaped delimiter/string handling, cycles, named array metadata,
nonenumerable/inherited consumed fields, inherited alias targets, and recipient immutability
on resource failure). Existing legacy twins and seeded deep/JSON-string comparisons are retained.
# K14 porting waivers

English-only ruling deletes active-workout move locale-pack coverage (8 assertions); the move behavior and English source labels are retained.


English-only ruling deletes the MUSCLE_NAME locale-pack test (two assertion sites); muscle metadata, loads and balance windows retain all legacy assertions.


English-only ruling deletes the MUSCLE_NAME locale-pack test (two assertion sites); muscle metadata, loads and balance windows retain all legacy assertions.
# K14 porting waivers

English-only ruling deletes active-workout move locale-pack coverage (8 assertions); the move behavior and English source labels are retained.


K03 caller-owned index ordering (GM-approved R2 exception): after registering a custom shadow of a built-in and resetting, legacy deletes and re-appends that built-in at the end of its mutable index. Fresh indexes retain catalogue order. Direct lookups and the app's `allExercises` search path remain identical; tied searches over `Object.values(index)` may change order. The two-command shadow/reset regression and stateful differential pin this deliberate change rather than copying global mutation history.

Approved by the S08 r1 fix task and reconciled review: legacy `registerCustom`
throws when a custom id (for example `1019`) equals a non-writable hidden alias.
The server inherits that failure in `createExerciseIndex`, preventing all library
validation and publishing for the profile, even for unrelated definitions.
Skip installing alias keys owned by customs, then install the customs as ordinary
enumerable entries so semantic catalogue consumers see them. Duplicate customs
still use the last entry; all non-colliding lookups, hidden alias enumeration and
catalogue-only defaults retain legacy results. Caller snapshots remain frozen
and isolated. The follow-up below extends canonical lookup for custom shadows.
`exercises-index.test.ts` covers the collision, custom lookup/helpers, enumeration,
every other own-key lookup and reset/profile isolation; S08 has a real-TCP
validate/publish regression. This is a named oracle exception, not an assertion
waiver; no surviving legacy assertions are removed.



GM-directed follow-up to the custom-alias exception: canonicalExId preserves ids that the caller-owned index marks as custom, including a 1019 shadow, instead of returning the built-in alias target. Native K03 and K13 output tests pin this deliberate exception.


- K17 ports stamp-level results; HTTP status, revision assignment and private GET field stripping remain S04 assertions. The three HTTP tests in `legacy/api/test/sync-stamps.test.js` keep their names and stamp-level cases here; nine handler-only assertions are deferred to S04. The changed-report path and private history remain covered by the port and differential tests.
- The source-identity assertion in `programme-fix1.test.js` is replaced one-for-one by preservation through the shared core prescription dependency; the server JS twin is intentionally retired (R2).
## K07 — parser / HTTP ownership split

The GM approved the split by describe name; the AST count corrects the initial paging estimate from 7 to 9. All remaining parser describes, names and assertions port unchanged. W01 must map and run these two deferred describes before integration.


## ZIP-CRC32 — reject corrupt backup entries (K01 oracle exception)
# Porting waivers

English-only ruling deletes the MUSCLE_NAME locale-pack test (two assertion sites); muscle metadata, loads and balance windows retain all legacy assertions.
# K16 porting waivers

English-only ruling deletes the MUSCLE_NAME locale-pack test (two assertion sites); muscle metadata, loads and balance windows retain all legacy assertions.
# K14 porting waivers
No assertion-drop waivers. Add explicit JSON waivers to scripts/public-parity-map.json for assertion drops, with reasons.

GM assigned the declaration-only pure workout-controls helper to integration for W20. Native source retains the frozen defaults, saved own enumerable overrides, unknown keys and shallow reference semantics. A direct legacy differential is an additional test (1,000 gate runs, PARITY_RUNS nightly), since this helper has no separate legacy test inventory; K14 KEEP mappings and assertion counts are unchanged. No behavior or assertion-count waiver is introduced. ExerciseIndex is not applicable: this helper performs no exercise lookup.


K03 caller-owned index ordering (GM-approved R2 exception): after registering a custom shadow of a built-in and resetting, legacy deletes and re-appends that built-in at the end of its mutable index. Fresh indexes retain catalogue order. Direct lookups and the app's `allExercises` search path remain identical; tied searches over `Object.values(index)` may change order. The two-command shadow/reset regression and stateful differential pin this deliberate change rather than copying global mutation history.


English-only ruling deletes the MUSCLE_NAME locale-pack test (two assertion sites); muscle metadata, loads and balance windows retain all legacy assertions.
# K14 porting waivers


# K03 porting waivers
# Assertion waivers

K03 caller-owned index ordering (GM-approved R2 exception): after registering a custom shadow of a built-in and resetting, legacy deletes and re-appends that built-in at the end of its mutable index. Fresh indexes retain catalogue order. Direct lookups and the app's `allExercises` search path remain identical; tied searches over `Object.values(index)` may change order. The two-command shadow/reset regression and stateful differential pin this deliberate change rather than copying global mutation history.


- K17 ports stamp-level results; HTTP status, revision assignment and private GET field stripping remain S04 assertions. The three HTTP tests in `legacy/api/test/sync-stamps.test.js` keep their names and stamp-level cases here; nine handler-only assertions are deferred to S04. The changed-report path and private history remain covered by the port and differential tests.
- The source-identity assertion in `programme-fix1.test.js` is replaced one-for-one by preservation through the shared core prescription dependency; the server JS twin is intentionally retired (R2).


# Porting waivers

GM approved splitting accent (2026-10-13): core/accent contains cleanHex, sanitizeAccent and pure colour helpers; the frozen core-api/accent applyAccent declaration is implemented only in W04 web because R1 forbids DOM in core. Frozen declarations are unchanged. W04's existing accent KEEP mapping remains with web, whose pure exports will re-export this shared implementation at integration; the reviewed own-preset lookup and Logbook DOM behavior remain unchanged. Additional core twins compare cleanHex/sanitizeAccent and colour maths directly to legacy, with no assertion waiver. Similar-exercises has no standalone legacy test inventory; its added direct twin preserves exact primary-muscle filtering, stable equipment grouping, exclusions and shallow references. W12 sheet KEEP mappings remain unchanged. Neither module performs exercise catalogue lookups; explicit ExerciseIndex is not applicable.


Regressions: `core/test/plan-share-hostile.test.ts` (week contents AND prototype, direct merge,
own-index checks, string-only ids, safe declared magic-name remaps, each cap, decode-not-called
checks, huge Unicode input, escaped delimiter/string handling, cycles, named array metadata,
nonenumerable/inherited consumed fields, inherited alias targets, and recipient immutability
on resource failure). Existing legacy twins and seeded deep/JSON-string comparisons are retained.
English-only ruling deletes the MUSCLE_NAME locale-pack test (two assertion sites); muscle metadata, loads and balance windows retain all legacy assertions.
# K14 porting waivers

English-only ruling deletes active-workout move locale-pack coverage (8 assertions); the move behavior and English source labels are retained.


Regressions: `core/test/plan-share-hostile.test.ts` (week contents AND prototype, direct merge,
own-index checks, string-only ids, safe declared magic-name remaps, each cap, decode-not-called
checks, huge Unicode input, escaped delimiter/string handling, cycles, named array metadata,
nonenumerable/inherited consumed fields, inherited alias targets, and recipient immutability
on resource failure). Existing legacy twins and seeded deep/JSON-string comparisons are retained.
English-only ruling deletes the MUSCLE_NAME locale-pack test (two assertion sites); muscle metadata, loads and balance windows retain all legacy assertions.
# K14 porting waivers


Regressions: `core/test/plan-share-hostile.test.ts` (week contents AND prototype, direct merge,
own-index checks, string-only ids, safe declared magic-name remaps, each cap, decode-not-called
checks, huge Unicode input, escaped delimiter/string handling, cycles, named array metadata,
nonenumerable/inherited consumed fields, inherited alias targets, and recipient immutability
on resource failure). Existing legacy twins and seeded deep/JSON-string comparisons are retained.
English-only ruling deletes the MUSCLE_NAME locale-pack test (two assertion sites); muscle metadata, loads and balance windows retain all legacy assertions.
# K14 porting waivers

English-only ruling deletes active-workout move locale-pack coverage (8 assertions); the move behavior and English source labels are retained.


Regressions: `core/test/plan-share-hostile.test.ts` (week contents AND prototype, direct merge,
own-index checks, string-only ids, safe declared magic-name remaps, each cap, decode-not-called
checks, huge Unicode input, escaped delimiter/string handling, cycles, named array metadata,
nonenumerable/inherited consumed fields, inherited alias targets, and recipient immutability
on resource failure). Existing legacy twins and seeded deep/JSON-string comparisons are retained.
English-only ruling deletes the MUSCLE_NAME locale-pack test (two assertion sites); muscle metadata, loads and balance windows retain all legacy assertions.
# K14 porting waivers


- K17 ports stamp-level results; HTTP status, revision assignment and private GET field stripping remain S04 assertions. The three HTTP tests in `legacy/api/test/sync-stamps.test.js` keep their names and stamp-level cases here; nine handler-only assertions are deferred to S04. The changed-report path and private history remain covered by the port and differential tests.
- The source-identity assertion in `programme-fix1.test.js` is replaced one-for-one by preservation through the shared core prescription dependency; the server JS twin is intentionally retired (R2).
# Assertion waivers

## ZIP-CRC32 — reject corrupt backup entries (K01 oracle exception)
# Porting waivers

English-only ruling removes the three translated-term/name/cache tests (11 assertions); canonical English and accent-insensitive custom names remain covered.
No assertion-drop waivers. Add explicit JSON waivers to scripts/public-parity-map.json for assertion drops, with reasons.
## K03 — deliberate exception: custom ids may shadow catalogue aliases

Regressions: `core/test/plan-share-hostile.test.ts` (week contents AND prototype, direct merge,
own-index checks, string-only ids, safe declared magic-name remaps, each cap, decode-not-called
checks, huge Unicode input, escaped delimiter/string handling, cycles, named array metadata,
nonenumerable/inherited consumed fields, inherited alias targets, and recipient immutability
on resource failure). Existing legacy twins and seeded deep/JSON-string comparisons are retained.
English-only ruling deletes the MUSCLE_NAME locale-pack test (two assertion sites); muscle metadata, loads and balance windows retain all legacy assertions.
# K14 porting waivers

English-only ruling deletes active-workout move locale-pack coverage (8 assertions); the move behavior and English source labels are retained.
# K14 porting waivers
No assertion-drop waivers. Add explicit JSON waivers to scripts/public-parity-map.json for assertion drops, with reasons.

GM assigned the declaration-only pure workout-controls helper to integration for W20. Native source retains the frozen defaults, saved own enumerable overrides, unknown keys and shallow reference semantics. A direct legacy differential is an additional test (1,000 gate runs, PARITY_RUNS nightly), since this helper has no separate legacy test inventory; K14 KEEP mappings and assertion counts are unchanged. No behavior or assertion-count waiver is introduced. ExerciseIndex is not applicable: this helper performs no exercise lookup.


## I03 additive integration helpers

`preserveWarmupMetadata` extracts W17's existing web-owned work-only key list into pure core without changing its clearing or future-key preservation behavior. `convertStateUnit` updates an existing `cycle.tmUnit` label when converting its mutable TM cache; legacy cycles without that additive label retain their exact old shape. Frozen `tmSeed` and snapshot.unit are never converted by a profile unit change. Public repeats convert mutable profile cache values to definition units for seed materialization, then expose the cache in profile units; seed units remain the immutable snapshot unit. Quarter-unit rounding inherited from the legacy mutable cache remains documented and is bounded by physical-load regressions in both directions. No legacy assertion budget is changed.

## W30 new community tooling

W30 adds opt-in community conversion and repeat/load continuity with synthetic behavioral coverage; ordinary programme and session behavior remains under the existing legacy differential suites.

No legacy assertions are removed or waived. Repeat/restart ancestry markers and session
materialization are opt-in through source-slot continuity parameters; ordinary
engine-free definitions retain the legacy behavior.
