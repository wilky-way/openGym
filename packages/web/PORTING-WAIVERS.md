# Porting waivers

No waivers. Add explicit JSON waivers to scripts/public-parity-map.json for assertion drops, with reasons.

## useStore.restore.test.jsx — 85 assertions assigned outside W06

W06 helper split: only the four pure restoredStateFor cases belong here; pull/push/account/storage/quota cases belong to W07.

The exact deferred test names are recorded in the public parity map; this is a scope split, not deletion of sync coverage.

## useStore.weighin-default.test.jsx — 11 assertions assigned outside W06

W06 helper split: resetEverything and setUser cases belong to W07; fresh/restarted/restore defaults remain here.

The exact deferred test names are recorded in the public parity map; this is a scope split, not deletion of sync coverage.

## useStore.default-lang.test.jsx — 14 assertions assigned outside W06

W06 English-only ruling deletes foreign default-language behavior; the two-device polling case belongs to W07 sync.

The exact deferred test names are recorded in the public parity map; this is a scope split, not deletion of sync coverage.

## W07
- W07 default-language complement keeps the two-device polling case; W06 owns helpers and foreign-language UI is deleted. (13 assertions waived in legacy/frontend/src/store/useStore.default-lang.test.jsx).
- W07 media-deleted ruling removes all owed-media cases; opaque document fields still round-trip. (31 assertions waived in legacy/frontend/src/store/useStore.media.test.jsx).

- W07 GM safety exception: unreadable gym_state_v1 is copied verbatim before the first replacing save to gym_state_v1.corrupt-<timestamp>, capped at 5 MiB and retaining the latest via a KV pointer; copying failures and oversized records refuse the overwrite. The recovery precedes account replacement and sign-out deletions, and transient initial read failures are retried before writing. The recovery toast occurs once and later saves do not copy again (sync-corrupt.test.ts).
## W01 — approved ownership and Platform changes

- **52 assertions**: W01 defers nginx, Docker and BASE_PATH describes to W23; W01 ports app-base and transport beacon only.
- **62 assertions**: W01 ports importHevyData HTTP describe (5 assertions); all other import-hevy parser describes remain owned and ported by K07.
- **52 assertions**: W01 ports paging through whatever the server sends HTTP describe (9 assertions); all other hostile Hevy parser describes remain owned and ported by K07.

GM approved deleting api.media.test.js with media; no media API helpers are ported.
The API-base deferred describe names: the cache lifetime nginx gives an image; the exercise media; what nginx forwards to the API; the file nginx looks for under BASE_PATH; the redirects nginx sends; the web container refuses a BASE_PATH it cannot serve. W23 owns their disposition (including deleted-media assertions).

The remote configured URL is an HTTPS origin per Platform (subpaths/build constants removed); same-origin proxy mounts stay. The legacy injected fetch option is replaced by an injected Platform transport; tests keep their names and assertion counts. All activity beacon requests use same-origin keepalive transport, with remote requests returning false. No-cors probes suppress Authorization and pairing redeem sends no prior token.

English-only / en-US replaces foreign language outcomes in api.test/default-lang.test with English-only checks at the same assertion count. Audit completeness uses an independent frozen legacy server vocabulary, and source-text checks target the ported audit labels/reasons/actions rather than deleted server/password implementation; historical audit labels remain readable. The 14 deferred Hevy HTTP assertions have no drop within their owned describes.

## W08 item-8 ownership inventory

W07 already ports and inventories every surviving legacy useStore public action and its transcript twins; W08 retains those implementations and adds new library, lifecycle wrappers and activation seed seam tests.
No W08 legacy assertions are dropped. Demo and media actions remain deleted under the binding ruling.
W19 English-only ruling deletes Library locale-pack casing and Russian plural tests; catalogue counts remain, with media wording removed.

W19 media deletion waives ProgressPhotos and ProgressPhotos.compare by name; no photo gallery or comparison slider is ported.

## W07 r1 — GM local data safety exceptions

These are explicit behavior exceptions under the cross-unit local data safety rule; no assertions or twins are dropped.

- **Account switch stash:** a refused `gym_stash` write blocks the switch, retains the previous `gym_state_v1` and in-memory document under its old owner, and toasts. The legacy retry that deleted the only original to free space is removed. Since login can already have changed the HttpOnly cookie, every failed session write or ownership read revokes local authentication, cancels pending uploads and invalidates old replies; sign in again after freeing space. The existing named no-room sync-status twin now asserts this safe refusal rather than deletion to make room.
- **Stash replay:** remove a replayed stash only after `persist` reports a successful local save. Retain it after a quota refusal, even when PUT succeeds, because a running workout is device-local. The merged in-memory state still syncs and the failed save toasts.
- **Keep profile as is:** honor the kept-copy write result before replacing guest data. Failed preservation retains the local original and leaves adoption held with a retry marker when possible, retaining the original before/later split; otherwise the in-memory hold and original adoption marker survive, and a toast explains the refusal.
- **Corrupt aside keys:** allocate a free timestamp key with a numeric suffix on collisions and retries, probing before writing. Never overwrite an existing aside. Keep the original if either copy or pointer writing fails; latest-pointer cleanup happens only after both succeed.
- **Account/session isolation:** every sync pull/push and adoption captures its originating account, session epoch, server and local owner. Ignore stale success/error/conflict responses before any merge, persistence, confirmation, retry or upload; every 409 retry goes through the public push hold guard with its original tag; a sign-in, sign-out or owner notification invalidates old sessions. Adoption rechecks after each awaited response/prompt, so the before/later split never sees data injected by stale account responses. Reset/import reads and boot composition use the same guard. Unavailable ownership reads settle without issuing a request and leave an explicit sync error.

`sync-recovery.test.ts` ports the reviewer's `/tmp/w07-probes/recovery.test.ts` to safe expected outcomes, with quota-refusing injected Platform KV, successful-PUT/failed-local-save replay, timestamp and pointer collisions, delayed A→B GET, delayed PUT success/409/401/network responses, and same-account session renewal. K10 r1 null-peer and same-Reset 409 regressions are included. Existing corrupt-copy regressions still apply.

`sync-index-paths.test.ts` supplies custom dumbbell cached-volume and running-workout conversion probes for tab joins (touched/untouched), previous-account and forced sign-out stashes (both active sources), clean active-only sign-out, ordinary/preferred stash replay, Add them adoption, Keep plus later data, backup replace, and both backup merge callers. Equal-Reset offload retirement is asserted at each applicable merge; malformed stash null/undefined peers are covered by sync-recovery.
## W10 — deleted media

- W10 media deletion: Media.test.jsx is waived in full because its component and all media paths are deleted by the GM ruling. (69 legacy assertions.)
- W10 media deletion: Media.autoplay.test.jsx is waived in full because its component and all media paths are deleted by the GM ruling. (5 legacy assertions.)
- W10 media deletion: Media.thumb.test.jsx is waived in full because its component and all media paths are deleted by the GM ruling. (5 legacy assertions.)
- W10 media deletion: CustomMediaField.offline.test.jsx is waived in full because its component and all media paths are deleted by the GM ruling. (4 legacy assertions.)

Media.tsx, CustomMedia.tsx, CustomMediaField.tsx, WorkoutMedia.tsx and WorkoutThumb.tsx are intentionally absent; they serve media only. MuscleExplorer retains all non-media behavior and drops its Thumb import/render. W03 is deleted and no W03 merge is required. W10-media-deleted.test.ts checks all five modules are absent and the explorer has no thumbnail/media import.

## W10 — shared explorer cases

- W10 shared auto-more split: Library and picker cases (10 assertions) belong to W19 and W12; W10 retains the explorer automatic-paging case.
- W10 shared muscle-names split: picker/config-sheet cases (7 assertions, including deleted German behavior) belong to W12; W10 retains the English explorer target-label case.

Deferred auto-more cases by exact name: Library: the button coming into view loads the next 40; picker: the next 50, the same way; stops watching once everything is shown; without IntersectionObserver the button still loads more, and nothing breaks. Deferred muscle-names cases by exact name: picker row shows the display name, not the map id; config sheet tags read like the detail sheet, for a custom exercise and for power clean; translates them in German too — "forearm" was staying English; keeps the cardio target translated (burpee, de). German cases are deleted under English-only; W12 retains the surviving picker/config behavior.

W19 shared auto-more split: picker paging (2 assertions) belongs to W12 and muscle explorer paging (2 assertions) belongs to W10; Library paging retains all 8 assertions.

- W19 shared search-count split: Library retains all 11 static assertion sites and both Library cases; exercise picker iterations belong to W12.

- W19 shared search-clear split: Library retains all 9 static assertion sites and both Library cases; exercise picker iterations belong to W12.

- W19 shared exercise-view split: Library and Muscles retain their five cases (17 assertion sites), including the grid CSS rule; picker switching (8 sites) belongs to W12.

- W19 shared day-note split: History retains its exact named case and 4 assertion sites through the typed row seam; day/note/calendar sheets (23 sites) belong to W11-W14 and heatmap behavior (3 sites) belongs to W09.

- W19 shared unknown-exercise-ids split: Library, StructuralBalance, History and Stats retain three exact named cases, all 9 state-preservation assertion sites and Stats output; non-W19 Home/Plan/RoutineEdit/Workout/sheet/store cases and 9 assertion sites belong to W15-W18, W11-W14 and W05-W06.

## W07 r1 — GM local data safety exceptions

These are explicit behavior exceptions under the cross-unit local data safety rule; no assertions or twins are dropped.

- **Account switch stash:** a refused `gym_stash` write blocks the switch, retains the previous `gym_state_v1` and in-memory document under its old owner, and toasts. The legacy retry that deleted the only original to free space is removed. Since login can already have changed the HttpOnly cookie, every failed session write or ownership read revokes local authentication, cancels pending uploads and invalidates old replies; sign in again after freeing space. The existing named no-room sync-status twin now asserts this safe refusal rather than deletion to make room.
- **Stash replay:** remove a replayed stash only after `persist` reports a successful local save. Retain it after a quota refusal, even when PUT succeeds, because a running workout is device-local. The merged in-memory state still syncs and the failed save toasts.
- **Keep profile as is:** honor the kept-copy write result before replacing guest data. Failed preservation retains the local original and leaves adoption held with a retry marker when possible, retaining the original before/later split; otherwise the in-memory hold and original adoption marker survive, and a toast explains the refusal.
- **Corrupt aside keys:** allocate a free timestamp key with a numeric suffix on collisions and retries, probing before writing. Never overwrite an existing aside. Keep the original if either copy or pointer writing fails; latest-pointer cleanup happens only after both succeed.
- **Account/session isolation:** every sync pull/push and adoption captures its originating account, session epoch, server and local owner. Ignore stale success/error/conflict responses before any merge, persistence, confirmation, retry or upload; every 409 retry goes through the public push hold guard with its original tag; a sign-in, sign-out or owner notification invalidates old sessions. Adoption rechecks after each awaited response/prompt, so the before/later split never sees data injected by stale account responses. Reset/import reads and boot composition use the same guard. Unavailable ownership reads settle without issuing a request and leave an explicit sync error.

`sync-recovery.test.ts` ports the reviewer's `/tmp/w07-probes/recovery.test.ts` to safe expected outcomes, with quota-refusing injected Platform KV, successful-PUT/failed-local-save replay, timestamp and pointer collisions, delayed A→B GET, delayed PUT success/409/401/network responses, and same-account session renewal. K10 r1 null-peer and same-Reset 409 regressions are included. Existing corrupt-copy regressions still apply.

`sync-index-paths.test.ts` supplies custom dumbbell cached-volume and running-workout conversion probes for tab joins (touched/untouched), previous-account and forced sign-out stashes (both active sources), clean active-only sign-out, ordinary/preferred stash replay, Add them adoption, Keep plus later data, backup replace, and both backup merge callers. Equal-Reset offload retirement is asserted at each applicable merge; malformed stash null/undefined peers are covered by sync-recovery.

## W13 test ownership

- W13 defers the History noted-day view case to W18; calendar and the W09 Heatmap case remain executed here. (4 assertions.)
- W13 owns WorkoutDetail per-routine grouping; W14 owns the Add routine mid-session sheet describe. (9 assertions.)
- W13 owns the Repeat today button and sends the record plus close callback to W14's repeatWorkout through an injected service. W14 owns the repeat workflow and the sheets.repeat-workout twin.
- W13 owns the Log this workout button and sends iso/routineIds to W14's logPastWorkoutSheet through an injected service. W14 owns the sheets.missed-day twin.
- Media UI and WorkoutRow media badges are deleted by the GM ruling; sheets.workout-media is dropped. Unknown exercise IDs cross-view integration remains W23's unknown-exercise-ids twin.

## W07 r2 — durable adoption and boot recovery (GM direction)

- New ownership/session metadata requires a durable adoption marker first. If its write is refused, keep the prior guest ownership and guest flag, retain the held in-memory session/split, and refuse to release adoption until the marker can be recorded. A normal authenticated boot with an unclaimed guest copy or explicit mismatched saved-owner tag asks adoption again; malformed/incomplete/unreadable markers hold conservatively.
- Retain the pending marker through application of the decision, clearing it only after the decided local copy is durable. A refused replacement save stays held across reload. Other tabs follow the completed sign-in when the marker-cleared storage event arrives; incomplete/unreadable markers refuse peer-tab authentication and uploads.
- An unreadable-owner boot quarantines local authentication, settles `ready:true` without issuing sync requests, and toasts the storage-recovery/re-sign-in path. A boot whose own account initialization refuses also settles locally; recovered re-sign-in keeps the previous quarantined profile aside. This is the explicit GM follow-up to N1, not permission to discard it.

`sync-quota-edges.test.ts` commits the reviewer's quota-edges case 1 with safe assertions, plus the retained quota/reinit/replay fixtures and pending-prompt, Add them, malformed-marker, guest-owner-tag, refused replacement-save/reload and boot-recovery regressions. No existing twins or assertions are removed.

## W16 Programme UI

W16 defers the three Home stock-row integration cases to W23: keeps the stock today row, different-workout door and ordinary weekday routine alongside the program; keeps the logged-today tick after a program session is finished; keeps active workout Resume in the stock row even while the program is paused.

W16 defers dayOverrideSheet integration to W13: the rendered day sheet saves a program pin through the real store cleanup and can clear it; a programme day pin replaces a %s override (rest/personal).

ProgrammeToday worked-example date assertion uses Sun, Nov 1 under the binding English-only/en-US ruling (legacy en-GB Sun 1 Nov); assertion count is unchanged. W16 uses injected Platform/sheet/navigation services and W08 public activation/repeat actions; these are intentional adapter/cycle seams, not behavior waivers.


- **52 assertions**: W01 defers nginx, Docker and BASE_PATH describes to W23; W01 ports app-base and transport beacon only.
- **62 assertions**: W01 ports importHevyData HTTP describe (4 assertions); all other import-hevy parser describes remain owned and ported by K07.
- **52 assertions**: W01 ports paging through whatever the server sends HTTP describe (9 assertions); all other hostile Hevy parser describes remain owned and ported by K07.

W07 already ports and inventories every surviving legacy useStore public action and its transcript twins; W08 retains those implementations and adds new library, lifecycle wrappers and activation seed seam tests.
No W08 legacy assertions are dropped. Demo and media actions remain deleted under the binding ruling.
## W10 — deleted media

`sync-index-paths.test.ts` supplies custom dumbbell cached-volume and running-workout conversion probes for tab joins (touched/untouched), previous-account and forced sign-out stashes (both active sources), clean active-only sign-out, ordinary/preferred stash replay, Add them adoption, Keep plus later data, backup replace, and both backup merge callers. Equal-Reset offload retirement is asserted at each applicable merge; malformed stash null/undefined peers are covered by sync-recovery.

## W13 test ownership

- W13 defers the History noted-day view case to W18; calendar and the W09 Heatmap case remain executed here. (4 assertions.)
- W13 owns WorkoutDetail per-routine grouping; W14 owns the Add routine mid-session sheet describe. (9 assertions.)
- W13 owns the Repeat today button and sends the record plus close callback to W14's repeatWorkout through an injected service. W14 owns the repeat workflow and the sheets.repeat-workout twin.
- W13 owns the Log this workout button and sends iso/routineIds to W14's logPastWorkoutSheet through an injected service. W14 owns the sheets.missed-day twin.
- Media UI and WorkoutRow media badges are deleted by the GM ruling; sheets.workout-media is dropped. Unknown exercise IDs cross-view integration remains W23's unknown-exercise-ids twin.
## W07 r2 — durable adoption and boot recovery (GM direction)

W13 post-parity safety exception (GM accepted all four inline review findings): delayed plan reads are dropped after originating-sheet dismissal, superseding selection or profile identity replacement; an import confirmation refuses a later cross-profile apply. This fixes an inherited legacy hazard and leaves the successful current-profile flow unchanged. W13-REVIEW.md records the deferred-read regressions; no assertion budget is waived for this change.

## W11 item-8 scope and English ruling

W11 r1 deliberately diverges from the unsafe oracle: refuse CSVs above 50 MiB and
Health XML above 4 GiB before reading, stream XML with bounded buffers (64 KiB
decode chunks, 64K-character tags, at most 50,000 daily weights), and abort
callbacks/confirmations after an account, profile or active-session change. Large
Health files must retain the `.xml` extension; anonymous/non-XML blobs use the
conservative CSV limit. Oversized records/output are refused with a clear toast.
Owned mutations check again inside the producer, using a private sentinel to
unwind W07 before stamping/persistence on mismatch. Every exposed surface has an
account-switch regression through real W07 actions;
the synthetic 1 GiB stream has a 64 MiB heap-growth budget. No assertions dropped.

W11 ports only menu sheet title in sheets.test.jsx; W12 owns the exercise configuration progression step describe and its 15 assertions.

The two addDeviceDataMessage foreign-pack cases retain their names and all assertion sites, now pinning English under foreign stored preferences. Starter weekdays use en-US ListFormat (Oxford comma). sheets.weighin.test.jsx drives startFlow and belongs wholly to W14; W11 directly tests the required BwSheet behavior.


## W08 item-8 ownership inventory

## W10 — deleted media

- W10 media deletion: Media.test.jsx is waived in full because its component and all media paths are deleted by the GM ruling. (69 legacy assertions.)
- W10 media deletion: Media.autoplay.test.jsx is waived in full because its component and all media paths are deleted by the GM ruling. (5 legacy assertions.)
- W10 media deletion: Media.thumb.test.jsx is waived in full because its component and all media paths are deleted by the GM ruling. (5 legacy assertions.)
- W10 media deletion: CustomMediaField.offline.test.jsx is waived in full because its component and all media paths are deleted by the GM ruling. (4 legacy assertions.)

Media.tsx, CustomMedia.tsx, CustomMediaField.tsx, WorkoutMedia.tsx and WorkoutThumb.tsx are intentionally absent; they serve media only. MuscleExplorer retains all non-media behavior and drops its Thumb import/render. W03 is deleted and no W03 merge is required. W10-media-deleted.test.ts checks all five modules are absent and the explorer has no thumbnail/media import.

## W10 — shared explorer cases

- W10 shared auto-more split: Library and picker cases (10 assertions) belong to W19 and W12; W10 retains the explorer automatic-paging case.
- W10 shared muscle-names split: picker/config-sheet cases (7 assertions, including deleted German behavior) belong to W12; W10 retains the English explorer target-label case.

Deferred auto-more cases by exact name: Library: the button coming into view loads the next 40; picker: the next 50, the same way; stops watching once everything is shown; without IntersectionObserver the button still loads more, and nothing breaks. Deferred muscle-names cases by exact name: picker row shows the display name, not the map id; config sheet tags read like the detail sheet, for a custom exercise and for power clean; translates them in German too — "forearm" was staying English; keeps the cardio target translated (burpee, de). German cases are deleted under English-only; W12 retains the surviving picker/config behavior.

## W11 item-8 scope and English ruling

W11 r1 deliberately diverges from the unsafe oracle: refuse CSVs above 50 MiB and
Health XML above 4 GiB before reading, stream XML with bounded buffers (64 KiB
decode chunks, 64K-character tags, at most 50,000 daily weights), and abort
callbacks/confirmations after an account, profile or active-session change. Large
Health files must retain the `.xml` extension; anonymous/non-XML blobs use the
conservative CSV limit. Oversized records/output are refused with a clear toast.
Owned mutations check again inside the producer, using a private sentinel to
unwind W07 before stamping/persistence on mismatch. Every exposed surface has an
account-switch regression through real W07 actions;
the synthetic 1 GiB stream has a 64 MiB heap-growth budget. No assertions dropped.

W11 ports only menu sheet title in sheets.test.jsx; W12 owns the exercise configuration progression step describe and its 15 assertions.

The two addDeviceDataMessage foreign-pack cases retain their names and all assertion sites, now pinning English under foreign stored preferences. Starter weekdays use en-US ListFormat (Oxford comma). sheets.weighin.test.jsx drives startFlow and belongs wholly to W14; W11 directly tests the required BwSheet behavior.
### W12 scope/deletion split: sheets.config-failure.test.jsx

The finish summary line case belongs to W14; W12 retains all four configuration cases. Exact allowance: 2 assertion sites; legacy 9, W12 twin 7.

### W12 scope/deletion split: sheets.custom-edit.test.jsx

The thumbnail case is deleted media; the store heals it helper case belongs to W06/W07, already covered by their heal/replace twins. W12 retains all five edit/detail/config cases. Exact allowance: 5 assertion sites; legacy 15, W12 twin 10.

### W12 scope/deletion split: sheets.swap.test.jsx

The twelve-locale coverage describe is deleted under English-only ruling; all four swap flow/wording cases remain. Exact allowance: 2 assertion sites; legacy 16, W12 twin 14.

### W12 scope/deletion split: sheets.test.jsx

Menu section describes belong to W11; W12 retains both exercise configuration progression step cases. Exact allowance: 2 assertion sites; legacy 17, W12 twin 15.

### W12 scope/deletion split: sheets.muscle-names.test.jsx

W12 retains picker/config cases; W10 owns the explorer row; both German locale cases are deleted under English-only ruling. Exact allowance: 5 assertion sites; legacy 8, W12 twin 3.

### W12 scope/deletion split: sheets.programme-fix1.test.jsx

W12 retains F1 pyramid row removal and addition; mounted RoutineEdit save/scoped snapshot roundtrip belongs to W20, F2/F3/F5/F6 to K12/K13/K10 and F4 begin/pending session to W14/W16; locale coverage is deleted. Exact allowance: 27 assertion sites; legacy 31, W12 twin 4.

### W12 scope/deletion split: auto-more.test.jsx

W12 retains picker: the next 50, the same way; W10 owns the explorer case and W19 owns all three Library cases. Exact allowance: 10 assertion sites; legacy 12, W12 twin 2.

### W12 scope/deletion split: sheets.custom-media.test.jsx

Entire media/file/link editor is deleted by GM ruling; historic opaque media and URL values survive rename with a rendered W12 custom-edit regression. No new media references are produced. Exact allowance: 29 assertion sites; legacy 33, W12 twin 4.
`sync-index-paths.test.ts` supplies custom dumbbell cached-volume and running-workout conversion probes for tab joins (touched/untouched), previous-account and forced sign-out stashes (both active sources), clean active-only sign-out, ordinary/preferred stash replay, Add them adoption, Keep plus later data, backup replace, and both backup merge callers. Equal-Reset offload retirement is asserted at each applicable merge; malformed stash null/undefined peers are covered by sync-recovery.

## W14 item-8 inventory / shared sheets tests

- W14 deletes the media replacement hint case under the binding media-deleted ruling; all backfill date, duration, layout and session assertions remain. (2 assertion sites deferred/deleted.)
- W14 ports Add routine mid-session; the WorkoutDetail per-routine grouping describe and its assertions belong to W13. (5 assertion sites deferred/deleted.)
- W14 ports the during-workout session note case; the two WorkoutDetail history-note cases belong to W13. (2 assertion sites deferred/deleted.)
- W14 ports F4 beginWorkout future-start guard; ExConfig F1 cases belong to W12, pending button to W17, English locale exception to W12, deload to K12 and import to W11. (28 assertion sites deferred/deleted.)

The backfill layout CSS twin checks W14’s copied row-layout subset in sheets-d.css; W23 reconciles it into the global stylesheet. No DOM or browser behavior is mocked in mounted note/start/finish/edit sheet cases; W11-owned dialogs and weigh-in are bound via test services until real sheet composition.

- W14 ports supplied-day backfill and finish cases through logPastWorkoutSheet directly; the DayOverride offer visibility case belongs to W13. (6 assertion sites deferred.)

- W14 ports the unknown-exercise starting/finishing preservation case and all its kept-state assertions; the other shared cases belong to K03 (placeholder), W18 (four running layouts), W19 (history/stats/library/structural balance), W20 (plan/routine editor), W23 (Home), W12/W13 (exercise/history/workout detail sheets), and W07 (persist/merge/adopt). (7 assertion sites deferred; Workout render belongs to W18 and the W14 case drives the real store lifecycle directly.)

## W14 r1 deliberate data-safety divergence

The GM's Sheet target re-validation and updater-abort rules supersede frozen legacy for stale start, repeat, backfill, note, rename, add-routine, edit-exit/delete, completion and finish callbacks. These actions bind account id, profile reset marker and active-session/workout identity (plus a distinct editor instance); entry/set note targets have independent row ids because exercise ids can repeat. Mismatches toast and throw a private sentinel inside the updater before any stamp or persistence; stale exit callbacks no longer navigate. Delete also rechecks emptiness, start requires its own logged-session replacement confirm, backfill/repeat refuse an active session, and finish's producer refuses an existing history id. The affected twins retain their assertion counts and note this deliberate divergence; workout-sheet-targets.test.tsx adds real-store/durable-byte regressions. Superset's routine edit and external discard callback retain their public seams: W14 validates before calling them, and W20/W23 own the captured routine/discard target and updater check at those callback implementations.

## W10 — deleted media

- W10 media deletion: Media.test.jsx is waived in full because its component and all media paths are deleted by the GM ruling. (69 legacy assertions.)
- W10 media deletion: Media.autoplay.test.jsx is waived in full because its component and all media paths are deleted by the GM ruling. (5 legacy assertions.)
- W10 media deletion: Media.thumb.test.jsx is waived in full because its component and all media paths are deleted by the GM ruling. (5 legacy assertions.)
- W10 media deletion: CustomMediaField.offline.test.jsx is waived in full because its component and all media paths are deleted by the GM ruling. (4 legacy assertions.)

## W13 test ownership

- W13 defers the History noted-day view case to W18; calendar and the W09 Heatmap case remain executed here. (4 assertions.)
- W13 owns WorkoutDetail per-routine grouping; W14 owns the Add routine mid-session sheet describe. (9 assertions.)
- W13 owns the Repeat today button and sends the record plus close callback to W14's repeatWorkout through an injected service. W14 owns the repeat workflow and the sheets.repeat-workout twin.
- W13 owns the Log this workout button and sends iso/routineIds to W14's logPastWorkoutSheet through an injected service. W14 owns the sheets.missed-day twin.
- Media UI and WorkoutRow media badges are deleted by the GM ruling; sheets.workout-media is dropped. Unknown exercise IDs cross-view integration remains W23's unknown-exercise-ids twin.
## W07 r2 — durable adoption and boot recovery (GM direction)

- New ownership/session metadata requires a durable adoption marker first. If its write is refused, keep the prior guest ownership and guest flag, retain the held in-memory session/split, and refuse to release adoption until the marker can be recorded. A normal authenticated boot with an unclaimed guest copy or explicit mismatched saved-owner tag asks adoption again; malformed/incomplete/unreadable markers hold conservatively.
- Retain the pending marker through application of the decision, clearing it only after the decided local copy is durable. A refused replacement save stays held across reload. Other tabs follow the completed sign-in when the marker-cleared storage event arrives; incomplete/unreadable markers refuse peer-tab authentication and uploads.
- An unreadable-owner boot quarantines local authentication, settles `ready:true` without issuing sync requests, and toasts the storage-recovery/re-sign-in path. A boot whose own account initialization refuses also settles locally; recovered re-sign-in keeps the previous quarantined profile aside. This is the explicit GM follow-up to N1, not permission to discard it.

`sync-quota-edges.test.ts` commits the reviewer's quota-edges case 1 with safe assertions, plus the retained quota/reinit/replay fixtures and pending-prompt, Add them, malformed-marker, guest-owner-tag, refused replacement-save/reload and boot-recovery regressions. No existing twins or assertions are removed.

## W07 carrier integration follow-ups (W00/W04/W05)

All existing KEEP mappings and assertion counts remain. W00 lexical binding tracking preserves the foundation parent/top/frames/opener roots; type-only imports never bind runtime globals, with new regressions. The Platform README documents the approved localStorage-backed device-token/XSS boundary. W04 re-exports pure accent helpers from native core and retains DOM applyAccent plus its reviewed Logbook exception in web; existing accent maths/DOM/sync twins exercise the shared implementation. W05 Icon and both legacy-glyph dictionary lookups use Object.hasOwn, rejecting inherited prototype names rather than rendering invalid React children; direct render and saved-glyph regressions fail before and pass after the guard. These are named GM-required integration fixes, not assertion-count waivers.

## W09 integration: invalid and large chart bounds

GM FIT follow-up (W09 6eec2563): empty or non-finite primary/series data renders the existing empty state rather than NaN SVG coordinates. Bounds are scanned with two-argument min/max, preserving valid-chart arithmetic while avoiding the million-point spread limit. `LineChart.bounds.test.tsx` covers the actual component, including a million-point render; original LineChart KEEP tests remain intact.
W13 post-parity safety exception (GM accepted all four inline review findings): delayed plan reads are dropped after originating-sheet dismissal, superseding selection or profile identity replacement; an import confirmation refuses a later cross-profile apply. This fixes an inherited legacy hazard and leaves the successful current-profile flow unchanged. W13-REVIEW.md records the deferred-read regressions; no assertion budget is waived for this change.

## W22 Settings B

W07 already ports and inventories every surviving legacy useStore public action and its transcript twins; W08 retains those implementations and adds new library, lifecycle wrappers and activation seed seam tests.
No W08 legacy assertions are dropped. Demo and media actions remain deleted under the binding ruling.
## W10 — deleted media

`sync-index-paths.test.ts` supplies custom dumbbell cached-volume and running-workout conversion probes for tab joins (touched/untouched), previous-account and forced sign-out stashes (both active sources), clean active-only sign-out, ordinary/preferred stash replay, Add them adoption, Keep plus later data, backup replace, and both backup merge callers. Equal-Reset offload retirement is asserted at each applicable merge; malformed stash null/undefined peers are covered by sync-recovery.

## W15 auth + sync UI

- W15 removes the two password owner-proof scenarios and the current-wrong password assertion; all passkey ceremonies and device-link cases remain, dates use en-US, and unknown auth errors use safe fixed text.
- W15 deletes media properties from OwedSheet; the JSON backup case and all non-media auth/refusal/retry assertions from the mixed legacy file remain.
- W15 deletes the single demo-only banner scenario because demo builds are deleted; all network/auth/hold/grace/settings scenarios remain.
- W15 deletes password sign-in and registration, retaining the no-password baseline and adding a regression that legacy password_login never enables password UI.

Unknown authentication errors are deliberately shown with fixed safe text so a server/browser error cannot expose a bearer credential.
## W07 r2 — durable adoption and boot recovery (GM direction)

## W21 settings A

- W21 deletes media exports, uploads and sweeping; JSON and ZIP state import, conflict confirmation and reset delegation remain under their original test names.
- W21 owns settings search and its pure index tests; W23 owns root/router/page flash and wheel DOM cases (62 assertions), and English-only removes locale-pack cases (8 assertions).
- W21 retains the accent search assertion; W22 retains the two Logbook palette preservation cases (5 assertions).
- W21 retains the two Account guest-footer cases (3 assertions); W22 retains Show connection status and Look guest-footer cases (10 assertions).

Media metadata and unknown document keys still round-trip verbatim in JSON backups; deleted binary-media upload/export rows do not return even for old documents. All destructive and async callbacks deliberately abort stale account/profile/target actions via a sentinel inside the real W07 updater, with byte-preserving A→B regressions; these are the binding sheet-safety exceptions. The malformed-server recovery exception removes only gym_server_url synchronously after an owner/target-checked confirm, preserving every other durable key. The device bearer token remains in browser localStorage (XSS-readable), through the frozen Platform key/value adapter; no token is rendered or logged.

- W21 deletes password rows and login/registration ceremonies; passkey, guest and direct re-sign-in baselines remain under the original four names.

W21 also carries the GM-approved W15 r1 repairs in separate W07/W15 commits: the final sign-out clear now fences the real updater draft and durable primary/WID/owner tuple against edits saved during logout (the three inherited RM schedules, an inside-updater switch, delayed peer storage events and failed primary/WID writes), and passive tabs recover only after fresh durable proof of a pre-exchange cancel or explicitly non-carrier-changing completion, with stable owner/user/server/adoption and no handover. Every new ceremony invalidates the old completion proof. The ordinary followSignIn server-base requirement is unchanged. Passkey DELETE never ends a device session, so only that flow opts into carrierUnchanged; normal refusals preserve auth and show the legacy error plus the GM-required toast. The current-device POST /api/account/devices/revoke path and default carrier-changing quarantine remain intact. Original passkey-refusal twin names/assertion counts are retained with the documented toast exception. Guarding the queued removal renderer also guards owner proof before dispatch under a changed account/profile.


## W07 r2 — durable adoption and boot recovery (GM direction)

## W16 Programme UI

W16 defers the three Home stock-row integration cases to W23: keeps the stock today row, different-workout door and ordinary weekday routine alongside the program; keeps the logged-today tick after a program session is finished; keeps active workout Resume in the stock row even while the program is paused.

W16 defers dayOverrideSheet integration to W13: the rendered day sheet saves a program pin through the real store cleanup and can clear it; a programme day pin replaces a %s override (rest/personal).

ProgrammeToday worked-example date assertion uses Sun, Nov 1 under the binding English-only/en-US ruling (legacy en-GB Sun 1 Nov); assertion count is unchanged. W16 uses injected Platform/sheet/navigation services and W08 public activation/repeat actions; these are intentional adapter/cycle seams, not behavior waivers.


- **52 assertions**: W01 defers nginx, Docker and BASE_PATH describes to W23; W01 ports app-base and transport beacon only.
- **62 assertions**: W01 ports importHevyData HTTP describe (4 assertions); all other import-hevy parser describes remain owned and ported by K07.
- **52 assertions**: W01 ports paging through whatever the server sends HTTP describe (9 assertions); all other hostile Hevy parser describes remain owned and ported by K07.

W07 already ports and inventories every surviving legacy useStore public action and its transcript twins; W08 retains those implementations and adds new library, lifecycle wrappers and activation seed seam tests.
No W08 legacy assertions are dropped. Demo and media actions remain deleted under the binding ruling.
## W10 — deleted media

W13 post-parity safety exception (GM accepted all four inline review findings): delayed plan reads are dropped after originating-sheet dismissal, superseding selection or profile identity replacement; an import confirmation refuses a later cross-profile apply. This fixes an inherited legacy hazard and leaves the successful current-profile flow unchanged. W13-REVIEW.md records the deferred-read regressions; no assertion budget is waived for this change.

The two addDeviceDataMessage foreign-pack cases retain their names and all assertion sites, now pinning English under foreign stored preferences. Starter weekdays use en-US ListFormat (Oxford comma). sheets.weighin.test.jsx drives startFlow and belongs wholly to W14; W11 directly tests the required BwSheet behavior.


## W08 item-8 ownership inventory

## W10 — deleted media

### W12 scope/deletion split: sheets.config-failure.test.jsx

Entire media/file/link editor is deleted by GM ruling; historic opaque media and URL values survive rename with a rendered W12 custom-edit regression. No new media references are produced. Exact allowance: 29 assertion sites; legacy 33, W12 twin 4.

## W14 item-8 inventory / shared sheets tests

- W14 deletes the media replacement hint case under the binding media-deleted ruling; all backfill date, duration, layout and session assertions remain. (2 assertion sites deferred/deleted.)
- W14 ports Add routine mid-session; the WorkoutDetail per-routine grouping describe and its assertions belong to W13. (5 assertion sites deferred/deleted.)
- W14 ports the during-workout session note case; the two WorkoutDetail history-note cases belong to W13. (2 assertion sites deferred/deleted.)
- W14 ports F4 beginWorkout future-start guard; ExConfig F1 cases belong to W12, pending button to W17, English locale exception to W12, deload to K12 and import to W11. (28 assertion sites deferred/deleted.)

The backfill layout CSS twin checks W14’s copied row-layout subset in sheets-d.css; W23 reconciles it into the global stylesheet. No DOM or browser behavior is mocked in mounted note/start/finish/edit sheet cases; W11-owned dialogs and weigh-in are bound via test services until real sheet composition.

- W14 ports supplied-day backfill and finish cases through logPastWorkoutSheet directly; the DayOverride offer visibility case belongs to W13. (6 assertion sites deferred.)

- W14 ports the unknown-exercise starting/finishing preservation case and all its kept-state assertions; the other shared cases belong to K03 (placeholder), W18 (four running layouts), W19 (history/stats/library/structural balance), W20 (plan/routine editor), W23 (Home), W12/W13 (exercise/history/workout detail sheets), and W07 (persist/merge/adopt). (7 assertion sites deferred; Workout render belongs to W18 and the W14 case drives the real store lifecycle directly.)

## W14 r1 deliberate data-safety divergence

The GM's Sheet target re-validation and updater-abort rules supersede frozen legacy for stale start, repeat, backfill, note, rename, add-routine, edit-exit/delete, completion and finish callbacks. These actions bind account id, profile reset marker and active-session/workout identity (plus a distinct editor instance); entry/set note targets have independent row ids because exercise ids can repeat. Mismatches toast and throw a private sentinel inside the updater before any stamp or persistence; stale exit callbacks no longer navigate. Delete also rechecks emptiness, start requires its own logged-session replacement confirm, backfill/repeat refuse an active session, and finish's producer refuses an existing history id. The affected twins retain their assertion counts and note this deliberate divergence; workout-sheet-targets.test.tsx adds real-store/durable-byte regressions. Superset's routine edit and external discard callback retain their public seams: W14 validates before calling them, and W20/W23 own the captured routine/discard target and updater check at those callback implementations.

## W22 Settings B

- W22 accent search case belongs to W21 settings search; W22 retains both Logbook preservation cases. Budget: 1.
- W22 account guest-footer cases belong to W21; W22 retains connection-toggle and Look guest-footer cases. Budget: 3.
- W22 exercise animations are deleted with media by GM ruling; replacement asserts the control and writes are absent. Budget: 7.
- W22 owns Settings week-start cases; all Plan week-start and combined-day cases belong to W20. Budget: 10.

English-only: language and translated-name controls removed; saved locale fields are untouched. Media deleted: exercise animation/drawing controls removed; stored fields stay verbatim. The effort help no longer claims progression ignores effort because the rewrite progression engine consumes it.

## W07 r2 — durable adoption and boot recovery (GM direction)

GM FIT follow-up: ProgrammeToday direct Start validates its render-captured ProgrammeTarget before delegating to startFlow or navigating. Actual stale-account button regression fails on incoming code and passes with the guard; current-account Start remains valid. W16 documentInstance increments at initializeStore/successful replaceState are retained outside the saved document.
## W22 r1 — sheet owner/target safety exception

Per the binding Sheet target re-validation, Sheet rule extension, Guard at the updater, and Updater abort pattern rulings, equipment deletion and fixed-week confirmation reject changed accounts/profiles/targets. The same exception applies to both duration Done callbacks, both unit-menu choices, the rest-sound sheet, and all four SelectRow chooser callbacks. Stale callbacks toast and abort inside the W07 producer, leaving the saved document byte-identical; legacy allowed these writes to hit the new owner. Same-account twins retain their assertion budgets and behavior. New real-W07 tests live in `SettingsB.account-guards.test.tsx`; no oracle source or W07 updater is changed.

## W17 test ownership and safety exceptions

- W17 defers timed callback rebinding (11 assertions), one-time hint scheduling (9) and Cards outer swipe (1) to W18, and deletes the foreign-pack copy-verb case (2) under the English-only ruling.
- W17 owns incline controls; W18 owns the one added-row grade inheritance assertion.
- W17 owns saved-editor plate suppression; W18 owns the one Editing a saved workout header assertion.

W17 keeps display and set-input behavior in isolated component fixtures; W18 owns the full ActiveWorkout shell and timed callbacks. Stale account/profile/session/editor/row actions abort with the W17 private updater sentinel before W07 stamps or persists. Undo uses an opaque occurrence token instead of an exercise-id fallback, retaining unknown row identity fields. These are binding GM safety exceptions; no owned assertion is dropped. Media renders are deleted. Workout settings forwards its guarded updater to the W22 effort control and preserves unknown wc keys.

W17 splits the shared Workout component twin: W18 owns shell, parent lifecycle, timers and navigation assertions listed in W17-INVENTORY; foreign-language packs and media-render cases are deleted under the binding rulings.

W17 owns the progression switch, marker and Undo component cases; W18 owns the twenty parent Exercise settings, rebuild and swap assertions listed in W17-INVENTORY.

W17 deletes animation-size controls with media, retaining historic gifSize untouched. The split twin retains its assertion count by asserting absence and preservation. Its updater preserves the legacy push=true default. English-only removes two Arabic-pack reference assertions and two German-pack tag assertions; English reference isolation remains.

W17 deletes animation-size controls with media, retaining historic gifSize untouched. The split twin retains its assertion count by asserting absence and preservation. Its updater preserves the legacy push=true default. English-only removes two Arabic-pack reference assertions and two German-pack tag assertions; English reference isolation remains.


W19 English-only ruling deletes Library locale-pack casing and Russian plural tests; catalogue counts remain, with media wording removed.

W19 media deletion waives ProgressPhotos and ProgressPhotos.compare by name; no photo gallery or comparison slider is ported.
## W10 — deleted media

W19 shared auto-more split: picker paging (2 assertions) belongs to W12 and muscle explorer paging (2 assertions) belongs to W10; Library paging retains all 8 assertions.

- W19 shared search-count split: Library retains all 11 static assertion sites and both Library cases; exercise picker iterations belong to W12.

- W19 shared search-clear split: Library retains all 9 static assertion sites and both Library cases; exercise picker iterations belong to W12.

- W19 shared exercise-view split: Library and Muscles retain their five cases (17 assertion sites), including the grid CSS rule; picker switching (8 sites) belongs to W12.

- W19 shared day-note split: History retains its exact named case and 4 assertion sites through the typed row seam; day/note/calendar sheets (23 sites) belong to W11-W14 and heatmap behavior (3 sites) belongs to W09.

- W19 shared unknown-exercise-ids split: Library, StructuralBalance, History and Stats retain three exact named cases, all 9 state-preservation assertion sites and Stats output; non-W19 Home/Plan/RoutineEdit/Workout/sheet/store cases and 9 assertion sites belong to W15-W18, W11-W14 and W05-W06.
## W07 r1 — GM local data safety exceptions

## W19 r1 — stale measurement and balance callbacks (GM safety exception)

Measurement delete, log/edit Save, measurement management writes and Structural Balance's deferred exercise picker capture account/profile/target on open and reject stale callbacks inside the store updater with a toast. A caught sentinel aborts before W07's unconditional stamping and persistence, so the original document and its saved bytes stay unchanged. Historic measurement entries have no id; deletion/edit use the complete captured row identity rather than date alone, rejecting even same-date/same-timestamp replacement rows. An account/profile/unit transition epoch also rejects A → B → A callbacks. This deliberately fixes inherited data-loss behavior under the sheet rules; no legacy twins or assertions are dropped. The real W07 peer-tab adoption and persistence regressions are in `test/views/W19.account-switch.test.tsx`, alongside same-account positive cases.

Successful measurement writes also preserve unknown extension keys on measurement rows, nested custom readings and custom field definitions around canonical normalization, as required by the binding edit-save rule. The existing edit test now asserts preservation of `opaque` instead of its deletion, retaining its assertion budget; new store-backed Save/management cases verify edited and untouched readings. Known field normalization and one-entry-per-day behavior are unchanged. The pure core normalizer and its legacy differentials remain untouched.


- **52 assertions**: W01 defers nginx, Docker and BASE_PATH describes to W23; W01 ports app-base and transport beacon only.
- **62 assertions**: W01 ports importHevyData HTTP describe (4 assertions); all other import-hevy parser describes remain owned and ported by K07.
- **52 assertions**: W01 ports paging through whatever the server sends HTTP describe (9 assertions); all other hostile Hevy parser describes remain owned and ported by K07.

## W20 scope and safety exceptions

- W20 removes the three assertion sites for the deleted foreign locale-pack inventory; accessible names and focus behavior remain tested with English under a foreign preference. (3 assertion sites.)
- W20 owns the Plan week-start and combined-day cases; W22 owns the Settings week-start cases. (6 assertion sites.)
- W20 owns F1 mounted RoutineEdit scoped Save; W12 owns F1 pyramid metadata, W14 owns beginWorkout, and the remaining programme cases stay with their respective owners. (28 assertion sites.)

W20 uses the binding account/profile/target/editor re-validation rule and its private sentinel inside each producer. Unknown slot keys survive configuration Save; canonical fields still clear as in the legacy sheet. Media thumbnails and the unused demo import are deleted. Foreign stored language preferences use English labels. Plan view persistence uses the injected Platform KV. The test-only animation stub models completion because happy-dom 21 implements animations that its fake clock does not complete. The stylesheet is limited to the two views plus the pre-existing desktop list rule the grip twin checks; W23 reconciles it into the full stylesheet. No remaining view assertions are dropped.


- **52 assertions**: W01 defers nginx, Docker and BASE_PATH describes to W23; W01 ports app-base and transport beacon only.
- **62 assertions**: W01 ports importHevyData HTTP describe (4 assertions); all other import-hevy parser describes remain owned and ported by K07.
- **52 assertions**: W01 ports paging through whatever the server sends HTTP describe (9 assertions); all other hostile Hevy parser describes remain owned and ported by K07.

## W18

W18 saved-workout photo and video editing is deleted under the GM media ruling; all non-media editor cases remain. Assertion budget: 1.

W18 foreign-locale removal copy is deleted under the English-only GM ruling; English removal and safety cases remain. Assertion budget: 3.

W18 foreign-locale and workout thumbnail/media cases are deleted under the English-only and media GM rulings; English behavior remains. Assertion budget: 3.

W18 foreign-locale and workout thumbnail/media cases are deleted under the English-only and media GM rulings; English behavior remains. Assertion budget: 8.

W18 owns the four-site History noted untrained-day case; other sheets.day-note cases are W13-owned and covered there. Assertion budget: 26.

W18 deliberate safety exceptions: every parent-owned delayed/async action aborts in W07’s producer before stamping or persistence when its account/profile/session/editor/occurrence changed. The superset removal chooser captures before selection, not after it; fixtures flush intentional changes before opening. Timed row owners refresh only through guarded edits and explicit copy/delete/Undo/warmup shifts. Opaque config fields survive Save; canonical field deletions remain effective. W16 documentInstance replacement is a GM-assigned integration follow-up: W18 consumes the optional seam and carries a gated regression, without merging W16 locally.


W18 deliberate safety exceptions: every parent-owned delayed/async action aborts in W07’s producer before stamping or persistence when its account/profile/session/editor/occurrence changed. The superset removal chooser captures before selection, not after it; fixtures flush intentional changes before opening. Timed row owners refresh only through guarded edits and explicit copy/delete/Undo/warmup shifts. Opaque config fields survive Save; canonical field deletions remain effective. W16 documentInstance replacement is a GM-assigned integration follow-up: W18 consumes the optional seam and carries a gated regression, without merging W16 locally.


## W07 carrier integration follow-ups (W00/W04/W05)


## P7 item-8 inventory

New read-only declarative prescription displays; W16 owns ProgrammeToday/Programs legacy twins and W18 owns ExerciseBlock/Workout legacy twins, all retained unchanged.
No legacy assertions or safety guards are dropped. Native details expands without a document write. P7 introduces no writer, sheet, gesture or activation path.


GM FIT follow-up (W09 6eec2563): empty or non-finite primary/series data renders the existing empty state rather than NaN SVG coordinates. Bounds are scanned with two-argument min/max, preserving valid-chart arithmetic while avoiding the million-point spread limit. `LineChart.bounds.test.tsx` covers the actual component, including a million-point render; original LineChart KEEP tests remain intact.
W13 post-parity safety exception (GM accepted all four inline review findings): delayed plan reads are dropped after originating-sheet dismissal, superseding selection or profile identity replacement; an import confirmation refuses a later cross-profile apply. This fixes an inherited legacy hazard and leaves the successful current-profile flow unchanged. W13-REVIEW.md records the deferred-read regressions; no assertion budget is waived for this change.
## W14 r1 deliberate data-safety divergence

## W14 D1 integration: captured account/profile decisions

GM direction from the W18 review: final Finish/save/discard producers retain an account/profile transition epoch and both document/user profileId markers. Same-account profile replacement and A-to-B-to-A adoption invalidate old decisions despite identical session/editor fields. New real-W07 regressions retain in-memory JSON and durable KV bytes, including replacement injected at the producer; ordinary editor/logging mutations preserve their existing controls. No assertion-budget reduction.


Entire media/file/link editor is deleted by GM ruling; historic opaque media and URL values survive rename with a rendered W12 custom-edit regression. No new media references are produced. Exact allowance: 29 assertion sites; legacy 33, W12 twin 4.
`sync-index-paths.test.ts` supplies custom dumbbell cached-volume and running-workout conversion probes for tab joins (touched/untouched), previous-account and forced sign-out stashes (both active sources), clean active-only sign-out, ordinary/preferred stash replay, Add them adoption, Keep plus later data, backup replace, and both backup merge callers. Equal-Reset offload retirement is asserted at each applicable merge; malformed stash null/undefined peers are covered by sync-recovery.
## W10 — deleted media

GM FIT follow-up (W09 6eec2563): empty or non-finite primary/series data renders the existing empty state rather than NaN SVG coordinates. Bounds are scanned with two-argument min/max, preserving valid-chart arithmetic while avoiding the million-point spread limit. `LineChart.bounds.test.tsx` covers the actual component, including a million-point render; original LineChart KEEP tests remain intact.
W13 post-parity safety exception (GM accepted all four inline review findings): delayed plan reads are dropped after originating-sheet dismissal, superseding selection or profile identity replacement; an import confirmation refuses a later cross-profile apply. This fixes an inherited legacy hazard and leaves the successful current-profile flow unchanged. W13-REVIEW.md records the deferred-read regressions; no assertion budget is waived for this change.
## W14 r1 deliberate data-safety divergence

GM direction from the W18 review: final Finish/save/discard producers retain an account/profile transition epoch and both document/user profileId markers. Same-account profile replacement and A-to-B-to-A adoption invalidate old decisions despite identical session/editor fields. New real-W07 regressions retain in-memory JSON and durable KV bytes, including replacement injected at the producer; ordinary editor/logging mutations preserve their existing controls. No assertion-budget reduction.
## W16 Programme UI

## W16 F7 integration: direct Start owner

GM FIT follow-up: ProgrammeToday direct Start validates its render-captured ProgrammeTarget before delegating to startFlow or navigating. Actual stale-account button regression fails on incoming code and passes with the guard; current-account Start remains valid. W16 documentInstance increments at initializeStore/successful replaceState are retained outside the saved document.


## W23 composition

W23 removes the password-reset ceremony, password flags and sign-in email display under the passkey-only ruling; the no-password and no-address baselines remain.

W23 owns nginx, Docker and BASE_PATH twins; W01 retains app-base and beacon (14 assertions), while the S11 pinned dist container and R3 removed upload location replace source assertions.

W23 retains root, router, row flash and wheel DOM twins; W21 owns the remaining pure search cases and English-only removes locale-pack coverage; removed exercise animation UI is asserted absent.

W23 retains the three Home stock-row integration cases (9 assertions); W16 retains all other ProgrammeToday cases.

W23 retains F4 pending session Start (2 assertions); W12, W14, W16 and W20 retain their explicitly split other programme-fix1 cases, and English-only removes the locale-pack case.


GM FIT follow-up: ProgrammeToday direct Start validates its render-captured ProgrammeTarget before delegating to startFlow or navigating. Actual stale-account button regression fails on incoming code and passes with the guard; current-account Start remains valid. W16 documentInstance increments at initializeStore/successful replaceState are retained outside the saved document.
## W22 r1 — sheet owner/target safety exception

W18 deliberate safety exceptions: every parent-owned delayed/async action aborts in W07’s producer before stamping or persistence when its account/profile/session/editor/occurrence changed. The superset removal chooser captures before selection, not after it; fixtures flush intentional changes before opening. Timed row owners refresh only through guarded edits and explicit copy/delete/Undo/warmup shifts. Opaque config fields survive Save; canonical field deletions remain effective. W16 documentInstance replacement is a GM-assigned integration follow-up: W18 consumes the optional seam and carries a gated regression, without merging W16 locally.


W07 already ports and inventories every surviving legacy useStore public action and its transcript twins; W08 retains those implementations and adds new library, lifecycle wrappers and activation seed seam tests.
No W08 legacy assertions are dropped. Demo and media actions remain deleted under the binding ruling.
W19 English-only ruling deletes Library locale-pack casing and Russian plural tests; catalogue counts remain, with media wording removed.

GM FIT follow-up: ProgrammeToday direct Start validates its render-captured ProgrammeTarget before delegating to startFlow or navigating. Actual stale-account button regression fails on incoming code and passes with the guard; current-account Start remains valid. W16 documentInstance increments at initializeStore/successful replaceState are retained outside the saved document.
## W22 r1 — sheet owner/target safety exception

W18 deliberate safety exceptions: every parent-owned delayed/async action aborts in W07’s producer before stamping or persistence when its account/profile/session/editor/occurrence changed. The superset removal chooser captures before selection, not after it; fixtures flush intentional changes before opening. Timed row owners refresh only through guarded edits and explicit copy/delete/Undo/warmup shifts. Opaque config fields survive Save; canonical field deletions remain effective. W16 documentInstance replacement is a GM-assigned integration follow-up: W18 consumes the optional seam and carries a gated regression, without merging W16 locally.
## W19 r1 — stale measurement and balance callbacks (GM safety exception)

Successful measurement writes also preserve unknown extension keys on measurement rows, nested custom readings and custom field definitions around canonical normalization, as required by the binding edit-save rule. The existing edit test now asserts preservation of `opaque` instead of its deletion, retaining its assertion budget; new store-backed Save/management cases verify edited and untouched readings. Known field normalization and one-entry-per-day behavior are unchanged. The pure core normalizer and its legacy differentials remain untouched.


W07 already ports and inventories every surviving legacy useStore public action and its transcript twins; W08 retains those implementations and adds new library, lifecycle wrappers and activation seed seam tests.
No W08 legacy assertions are dropped. Demo and media actions remain deleted under the binding ruling.
W19 English-only ruling deletes Library locale-pack casing and Russian plural tests; catalogue counts remain, with media wording removed.

- W19 shared unknown-exercise-ids split: Library, StructuralBalance, History and Stats retain three exact named cases, all 9 state-preservation assertion sites and Stats output; non-W19 Home/Plan/RoutineEdit/Workout/sheet/store cases and 9 assertion sites belong to W15-W18, W11-W14 and W05-W06.

Successful measurement writes also preserve unknown extension keys on measurement rows, nested custom readings and custom field definitions around canonical normalization, as required by the binding edit-save rule. The existing edit test now asserts preservation of `opaque` instead of its deletion, retaining its assertion budget; new store-backed Save/management cases verify edited and untouched readings. Known field normalization and one-entry-per-day behavior are unchanged. The pure core normalizer and its legacy differentials remain untouched.
## W21 settings A

W21 also carries the GM-approved W15 r1 repairs in separate W07/W15 commits: the final sign-out clear now fences the real updater draft and durable primary/WID/owner tuple against edits saved during logout (the three inherited RM schedules, an inside-updater switch, delayed peer storage events and failed primary/WID writes), and passive tabs recover only after fresh durable proof of a pre-exchange cancel or explicitly non-carrier-changing completion, with stable owner/user/server/adoption and no handover. Every new ceremony invalidates the old completion proof. The ordinary followSignIn server-base requirement is unchanged. Passkey DELETE never ends a device session, so only that flow opts into carrierUnchanged; normal refusals preserve auth and show the legacy error plus the GM-required toast. The current-device POST /api/account/devices/revoke path and default carrier-changing quarantine remain intact. Original passkey-refusal twin names/assertion counts are retained with the documented toast exception. Guarding the queued removal renderer also guards owner proof before dispatch under a changed account/profile.


W07 already ports and inventories every surviving legacy useStore public action and its transcript twins; W08 retains those implementations and adds new library, lifecycle wrappers and activation seed seam tests.
No W08 legacy assertions are dropped. Demo and media actions remain deleted under the binding ruling.
W19 English-only ruling deletes Library locale-pack casing and Russian plural tests; catalogue counts remain, with media wording removed.

Unknown authentication errors are deliberately shown with fixed safe text so a server/browser error cannot expose a bearer credential.
## W07 r2 — durable adoption and boot recovery (GM direction)
The two addDeviceDataMessage foreign-pack cases retain their names and all assertion sites, now pinning English under foreign stored preferences. Starter weekdays use en-US ListFormat (Oxford comma). sheets.weighin.test.jsx drives startFlow and belongs wholly to W14; W11 directly tests the required BwSheet behavior.

All existing KEEP mappings and assertion counts remain. W00 lexical binding tracking preserves the foundation parent/top/frames/opener roots; type-only imports never bind runtime globals, with new regressions. The Platform README documents the approved localStorage-backed device-token/XSS boundary. W04 re-exports pure accent helpers from native core and retains DOM applyAccent plus its reviewed Logbook exception in web; existing accent maths/DOM/sync twins exercise the shared implementation. W05 Icon and both legacy-glyph dictionary lookups use Object.hasOwn, rejecting inherited prototype names rather than rendering invalid React children; direct render and saved-glyph regressions fail before and pass after the guard. These are named GM-required integration fixes, not assertion-count waivers.
- W14 ports supplied-day backfill and finish cases through logPastWorkoutSheet directly; the DayOverride offer visibility case belongs to W13. (6 assertion sites deferred.)

W21 also carries the GM-approved W15 r1 repairs in separate W07/W15 commits: the final sign-out clear now fences the real updater draft and durable primary/WID/owner tuple against edits saved during logout (the three inherited RM schedules, an inside-updater switch, delayed peer storage events and failed primary/WID writes), and passive tabs recover only after fresh durable proof of a pre-exchange cancel or explicitly non-carrier-changing completion, with stable owner/user/server/adoption and no handover. Every new ceremony invalidates the old completion proof. The ordinary followSignIn server-base requirement is unchanged. Passkey DELETE never ends a device session, so only that flow opts into carrierUnchanged; normal refusals preserve auth and show the legacy error plus the GM-required toast. The current-device POST /api/account/devices/revoke path and default carrier-changing quarantine remain intact. Original passkey-refusal twin names/assertion counts are retained with the documented toast exception. Guarding the queued removal renderer also guards owner proof before dispatch under a changed account/profile.
## W20 scope and safety exceptions

W20 uses the binding account/profile/target/editor re-validation rule and its private sentinel inside each producer. Unknown slot keys survive configuration Save; canonical fields still clear as in the legacy sheet. Media thumbnails and the unused demo import are deleted. Foreign stored language preferences use English labels. Plan view persistence uses the injected Platform KV. The test-only animation stub models completion because happy-dom 21 implements animations that its fake clock does not complete. The stylesheet is limited to the two views plus the pre-existing desktop list rule the grip twin checks; W23 reconciles it into the full stylesheet. No remaining view assertions are dropped.


## W07 carrier integration follow-ups (W00/W04/W05)

All existing KEEP mappings and assertion counts remain. W00 lexical binding tracking preserves the foundation parent/top/frames/opener roots; type-only imports never bind runtime globals, with new regressions. The Platform README documents the approved localStorage-backed device-token/XSS boundary. W04 re-exports pure accent helpers from native core and retains DOM applyAccent plus its reviewed Logbook exception in web; existing accent maths/DOM/sync twins exercise the shared implementation. W05 Icon and both legacy-glyph dictionary lookups use Object.hasOwn, rejecting inherited prototype names rather than rendering invalid React children; direct render and saved-glyph regressions fail before and pass after the guard. These are named GM-required integration fixes, not assertion-count waivers.


## P7 item-8 inventory

New read-only declarative prescription displays; W16 owns ProgrammeToday/Programs legacy twins and W18 owns ExerciseBlock/Workout legacy twins, all retained unchanged.
No legacy assertions or safety guards are dropped. Native details expands without a document write. P7 introduces no writer, sheet, gesture or activation path.

## W24 — deliberate new feature

W24 is a new read-only session/day preview feature beyond legacy parity; W16 and W20 retain their legacy test inventories, with the Plan day-row assertion updated for the explicit Preview affordance.
No assertions are dropped; the planned day still opens its assignment picker, and now has one Preview button. Programme week rows open a read-only preview; their separate Edit action retains the routine editor. Calendar/Today Start sheets are unchanged.

## I03 integration safety exceptions

The shared guarded-update sentinel aborts before W07 stamping/persistence, preserves target-specific checks, propagates unrelated errors, and suppresses an outer save for nested actions. Settings B uses the shared sheet owner including the server and document generation. Print srcdoc prepends a restrictive CSP. Health imports stream-validate full XML, including trailing input, with a pinned Saxes 6 runtime facade (its upstream unconstrained generic declarations fail TS 7; app strict checking is unchanged). Active programme TM editing is removed per the GM: a read-only effective number/unit/source replaces an input that the progression engine ignored; initial activation inputs still materialize seeds. P7 display strings use t(), engine replay is memoized, cancelled committed swipes report a toast, and W24 preview-only zero-load/rest wording is corrected. Every original assertion budget remains; new regressions are additive.

### I03 inventory

Final integration pass reuses every release-unit twin and adds safety regressions; no existing assertion budget is reduced. Performance is prepared here and measured only in a GM-approved quiet window.

## I03 RM fence safety follow-ups (GM assigned 2026-10-14)

F-1 partial owner/tag boots are held for explicit copy-preserving recovery; automatic navigation is limited once per durable fingerprint with a sessionStorage proof. Existing guest empty-tag and untagged legacy boots remain valid. F-2 queued carrier PUTs re-snapshot after a same-owner document replacement. F-3 context-free legacy gym_work records are discarded because their document/entry ownership is unverifiable; legitimate timer reload twins retain every duration/handler assertion using a current startWork-generated identity proof. Native I03 regressions pin the real bootstrap/quota, visible recovery, asynchronous carrier and guest replacement cases; no assertion budget or source skip changes.
