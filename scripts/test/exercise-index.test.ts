import {expect, it} from 'vitest'
import {exerciseIndexErrors} from '../exercise-index'

it('requires explicit exercise indices for named, aliased and namespace core calls', () => {
  for (const file of ['packages/web/src/view.tsx', 'packages/server/src/route.ts']) {
    for (const source of [
      "import {exOr} from '@opengym/core/exercises'; exOr(id)",
      "import {exOr as lookup} from '@opengym/core/exercises'; lookup(id)",
      "import * as core from '@opengym/core/exercises'; core.exOr(id)",
      "import * as core from '@opengym/core/exercises'; core['exOr'](id)",
      "import {defaultIncrement} from '@opengym/core/exercises'; defaultIncrement(id, unit)",
      "import {best1RM} from '@opengym/core/onerm'; best1RM(state, id, formula, as)",
      "import {chooseOpenSlot} from '@opengym/core/programme-open-slots'; chooseOpenSlot(state, slotIndex, id, activeId, slotId)",
      "import {validateProgression} from '@opengym/core/progression-validate'; validateProgression(def)",
      "import {exOr} from '@opengym/core/exercises'; exOr(id, undefined)",
      "import {exOr} from '@opengym/core/exercises'; exOr(id, void 0)",
    ]) expect(exerciseIndexErrors(file, source), source).toHaveLength(1)
    for (const source of [
      "import {exOr} from '@opengym/core/exercises'; exOr(id, index)",
      "import {defaultIncrement} from '@opengym/core/exercises'; defaultIncrement(id, unit, index)",
      "import {best1RM} from '@opengym/core/onerm'; best1RM(state, id, formula, as, index)",
      "import * as core from '@opengym/core/exercises'; core.exOr(id, index)",
      "import {chooseOpenSlot} from '@opengym/core/programme-open-slots'; chooseOpenSlot(state, slotIndex, id, activeId, slotId, index)",
      "import {createExerciseIndex} from '@opengym/core/exercises'; createExerciseIndex(customEx)",
      "import {estimate1RM} from '@opengym/core/onerm'; estimate1RM(weight, reps)",
    ]) expect(exerciseIndexErrors(file, source), source).toEqual([])
  }
})
it('leaves catalogue defaults valid in pure core and adversarial test fixtures', () => {
  const source = "import {exOr} from '@opengym/core/exercises'; exOr(id)"
  for (const file of ['packages/core/src/helper.ts', 'packages/web/test/helper.test.ts', 'packages/server/test/helper.test.ts']) expect(exerciseIndexErrors(file, source)).toEqual([])
})
