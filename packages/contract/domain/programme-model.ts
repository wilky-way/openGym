/**
 * Programme model — the structural truth is `programme-model.schema.json` (copied verbatim from
 * the frozen takeover oracle @ bda93c10 (including effort-scale), generated there from frontend/src/lib/programme-model-schema.js
 * by scripts/programmes/write-model-schema.mjs). `programme-model.generated.d.ts` is
 * json-schema-to-typescript output; it passes `tsc --strict`.
 *
 * Two shapes exist on purpose:
 *  - `ProgrammeDefinition` (this file): what the LIBRARY stores and what PUT /api/programmes/library
 *    accepts. Must validate against the schema (level >= Valid).
 *  - `state-doc.ts` `ProgrammeDefinition`: the tolerant reader for definitions/snapshots already
 *    inside the state doc (cycle.snapshot, installed definitions). Legacy data may not be schema-valid;
 *    the doc must round-trip it untouched. Never validate-and-reject on the sync path.
 *
 * Unit C1 regenerates the generated file in the build (`bun run gen:model`) after adding `$defs`
 * references for `target` and `progression` so they become named types; the generated output is
 * then checked in and a drift check (`--check`) runs in CI. Until then these aliases are frozen.
 *
 * Conformance (programme-conformance.js on the same branch): levels Invalid → Valid → Complete → Ready;
 * issue codes include `slot.effort`, `slot.progression`, `metadata.*`, `review.*` (~18 total).
 * The TS port must produce identical `{level, issues}` for every fixture (differential gate, EXECUTION §4).
 */
export type {
  OpenGymProgrammeDefinition as ProgrammeDefinition,
  Week as ProgrammeWeekModel,
  Day as ProgrammeDayModel,
  Session as ProgrammeSessionModel,
  Slot as ProgrammeSlotModel,
} from './programme-model.generated'
