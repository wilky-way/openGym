import type { getProgramme, programmePosition } from '../src/programme-agent'
import type { shiftPreview } from '../src/programme-today'
import type { materializeWeek } from '../src/programme'
type IsAny<T> = 0 extends (1 & T) ? true : false
type Typed<T extends false> = T
type View = ReturnType<typeof getProgramme>
type Position = Extract<ReturnType<typeof programmePosition>, {cycleId: string}>
type DisplayWeekIsTyped = Typed<IsAny<NonNullable<View['displayDefinition']>['weeks'][number]>>
type DisplaySlotIsTyped = Typed<IsAny<NonNullable<View['displayDefinition']>['weeks'][number]['days'][number]['sessions'][number]['routineSnapshot']['ex'][number]>>
type EffortIsTyped = Typed<IsAny<View['effortScale']>>
type PositionIsTyped = Typed<IsAny<NonNullable<Position['next']>['date']>>
type TMsAreTyped = Typed<IsAny<NonNullable<Position['next']>['missingTMs'][number]>>
type ShiftIsTyped = Typed<IsAny<ReturnType<typeof shiftPreview>['before']['occurrences'][number]>>
type RoutineIsTyped = Typed<IsAny<ReturnType<typeof materializeWeek>['routines'][number]>>

import type { ProgrammeImportPreview } from '../src/programme-import'
type PreviewSlot = NonNullable<ProgrammeImportPreview['definition']>['weeks'][number]['days'][number]['sessions'][number]['routineSnapshot']['ex'][number]
type PreviewIdIsTyped = Typed<IsAny<PreviewSlot['id']>>
type IncludesNull<T extends true> = T
type UnresolvedIdIsNullable = IncludesNull<null extends PreviewSlot['id'] ? true : false>
function previewConsumer(slot: PreviewSlot) {
  if(slot.id !== undefined) {
    // @ts-expect-error A preview can still contain an unresolved null id.
    slot.id.toUpperCase()
  }
  if(typeof slot.id === 'string')slot.id.toUpperCase()
}
