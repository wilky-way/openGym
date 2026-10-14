/**
 * Programme model: programme-model.schema.json defines validated library definitions,
 * including effort-scale. programme-model.generated.d.ts contains the generated types.
 *
 * Two shapes exist on purpose:
 *  - `ProgrammeDefinition` (this file): what the LIBRARY stores and what PUT /api/programmes/library
 *    accepts. Must validate against the schema (level >= Valid).
 *  - `state-doc.ts` `ProgrammeDefinition`: the tolerant reader for definitions/snapshots already
 *    inside the state doc (cycle.snapshot, installed definitions). Legacy data may not be schema-valid;
 *    the doc must round-trip it untouched. Never validate-and-reject on the sync path.
 *
 * Generated types are derived from the schema after updating its definitions.
 * references for `target` and `progression` so they become named types; the generated output is
 * then checked in and a drift check (`--check`) runs in CI. Until then these aliases are frozen.
 *
 * Conformance (programme-conformance.js on the same branch): levels Invalid → Valid → Complete → Ready;
 * issue codes include `slot.effort`, `slot.progression`, `metadata.*`, `review.*` (~18 total).
 * The TS port must produce identical `{level, issues}` for every fixture.
 */
export type {
  OpenGymProgrammeDefinition as ProgrammeDefinition,
  Week as ProgrammeWeekModel,
  Day as ProgrammeDayModel,
  Session as ProgrammeSessionModel,
  Slot as ProgrammeSlotModel,
} from './programme-model.generated'
