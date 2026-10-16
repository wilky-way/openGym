# Original generic templates, version 1

These six small templates were originally authored for this repository. They are
standalone `ProgrammeDefinition` JSON files using existing exercise catalogue IDs
and the existing linear/double load engine. They are supplied under the repository's
existing [license](../../LICENSE) (`AGPL-3.0-or-later`, as declared in package.json).
No global license changes or third-party source permissions are implied.

The templates were written from scratch using the software contracts and the
5,632-entry built-in catalogue for IDs, equipment and labels. No private programme,
conversion, installed routine, workout log or personal training data was an input.
They do not reproduce a named third-party programme. Their provenance is
`source.kind: own`, `source.ref: Originally authored generic seed v1` and
`source.private: false`; no upstream source authority or source hash is asserted.

IDs are `generic-<filename-without-extension>-v1`; `version` is 1. Preserve these
IDs for identical content. A materially revised template should get a new version
and ID so that existing frozen cycles retain their content and continuity meaning.

| File | Explicit session order | Working sets per exercise | Existing load rule |
| --- | --- | --- | --- |
| [full-body.json](full-body.json) | W1 A/B/A; W2 B/A/B | 3 × 6 | linear |
| [dumbbell-only.json](dumbbell-only.json) | W1 A/B/C | 3 × 8–12 | double |
| [machines.json](machines.json) | W1 A/B/C | 3 × 8–12 | double |
| [upper-lower.json](upper-lower.json) | W1 Upper 1/Lower 1/Upper 2/Lower 2 | 3 × 8–12 | double |
| [push-pull-legs.json](push-pull-legs.json) | W1 Push/Pull/Legs | 3 × 8–12 | double |
| [simple-5x5.json](simple-5x5.json) | W1 A/B/A; W2 B/A/B | exactly 5 × 5 on every listed lift | linear |

Full body and simple 5x5 use A: barbell full squat `0043`, barbell bench press
`0025`, barbell bent over row `0027`; B: barbell deadlift `0032`, barbell standing
military press `1162`, barbell bent over row `0027`. Over the two-week block each
session appears three times. Repeat returns to A/B/A then B/A/B, preserving this
alternation across the block boundary.

Dumbbell A/B/C deliberately repeat the same four lifts: dumbbell goblet squat
`1760`, dumbbell bench press `0289`, dumbbell bent over row `0293`, dumbbell
Romanian deadlift `1459`. Machine A/B/C deliberately repeat lever chest press
`0576`, lever seated row `1350`, lever leg extension `0585`, lever seated leg curl
`0599`; all four catalogue equipment labels are `leverage machine`.

Upper sessions use bench `0025`, row `0027`, military press `1162`; lower sessions
use squat `0043`, deadlift `0032`. Push uses bench `0025`, military press `1162`;
Pull uses row `0027`, cable pulldown `0198`; Legs uses squat `0043`, dumbbell
Romanian deadlift `1459`. No cardio or conditioning sessions are included.

The order is explicit. Three sessions per week (four for upper/lower) is the
authored cadence, not a weekday appointment. Existing queue/calendar projection
places dates relative to the athlete's selected start date, cadence and finishes.
Review the displayed dates when starting. No new scheduler or automatic install
is included.

## Executed rules and first loads

There are no starting working loads, percentage prescriptions, training-max seeds
or estimated max defaults in these files. A new profile's engine preview shows
unavailable loads; Start leaves working-row weights unset. The athlete enters
each actual working load through the existing workout editor. Progression then
uses those actual completed logs. Blank logged loads do not create a load to
progress. Existing compatible cycle history may supply loads on an explicit
Repeat; importing or starting a fresh template does not import anyone's history.

Linear adds **2.5 kg** after every exposure that completes every prescribed rep
in every prescribed set. A missed rep or missing working set holds the load.
After **three consecutive unsuccessful exposures**, its stall rule resets the
last actual load to 90%, rounded to the configured grid, effective from the day
after the triggering exposure. The fixed set and rep target remains unchanged.

Double starts at **8 reps**. With the load held, a completed set of current targets
steps the target up by one rep, capped at 12. Actual reps above the current target
can move that aim further. Only **12 reps in every prescribed set** earns the
2.5 kg increase and reset to 8 reps. Missing rows cannot earn an increase. Its
stall counter counts exposures short of that **12-in-every-set ceiling**, including
successful lower rep aims. After **six consecutive such exposures**, the same
90% load reset becomes effective the next day. Thus an uninterrupted
8/9/10/11/12 build earns an increase without a premature reset. This counter does
not mean six exposures with no improvement. The reset changes load; it does not
promise an additional rep reset or an inserted deload week. A later actual load
entered by the athlete supersedes the reset suggestion.

These are the existing engine's configured success and stall rules. Stable,
template-specific per-exercise continuity keys connect repeated sessions and
explicit block repeats; they are original identifiers, not source authority.
All slots display a fixed illustrative **2 RIR** target. Logged effort does not
determine load or success for these rules, and there is no RIR-driven adaptation.

All rule increments and rounding increments are in **kg**, with nearest **2.5 kg**
rounding and `usePlates: false`. For an lb profile the existing engine converts
both the load and the grid: 2.5 kg is approximately 5.51156 lb, not 2.5 lb or 5 lb.
The template does not assert plate inventory or that this grid matches every
machine stack or dumbbell rack. Review increments against available equipment.
The single-bell goblet squat explicitly uses `dbLoad: as`: enter the actual
weight of its one bell, counted once in volume and matched to single-bell inventory
weights. Paired dumbbell bench press, two-arm bent over row and Romanian deadlift
use `dbLoad: each`: enter one bell's weight, with both bells counted in volume.
This paired meaning also applies to the dumbbell Romanian deadlift in Legs.

## Manual import using existing contracts

After the separate review and installation decision:

1. Open **Programs → Import program file** and select one individual JSON file.
   Review the import preview and instructions. These files require no exercise
   mappings or missing-prescription inputs.
2. Choose **Save program**. This uses existing `importProgramme` and
   `saveImportedProgramme` behavior, saving a definition separately from activation.
   An existing ID requires explicit replacement confirmation.
3. Open the saved programme and choose **Start this program**. Review the start
   date, cadence and unit. Finish any current workout before changing programmes.
4. Preview the sessions, then Start the queued session and enter the actual
   working loads. Finish advances the existing programme queue. At block completion,
   choose **Repeat** explicitly to continue the listed order with compatible load
   history, or choose another existing end action.

This folder is not a startup seed, a bulk-import payload or a database migration.
Nothing here calls a server or publishes to the server library. The existing
server contract can independently validate one definition using
`POST /api/programmes/validate` and store one using the version-checked
`PUT /api/programmes/library/:id` contract; these operations are not performed by
the artifact or its tests. A schema/conformance result or the import UI's label is
software validation, not a source-fidelity audit or approval to publish or install.

## Verification

`packages/core/test/generic-seeds.test.ts` reads these exact files and exercises
the production schema, progression and library validation functions, file import,
save, preview, Start entry builder, Finish serializer, queue advancement and explicit
block Repeat. Its invented logs test blank and athlete-chosen loads, fixed 5x5,
all-set/missing-row boundaries, rep stepping, stall timing, repeat continuity,
session order and kg/lb arithmetic. No private or installed data is required.
Runtime engines, max review, active-workout protection, undo and durable close
are unchanged by this data-only addition.
