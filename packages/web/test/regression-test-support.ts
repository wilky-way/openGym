import { vi } from 'vitest'
import { configureUx, createBrowserUx } from '../src/platform/ux'
import { bindUI } from '../src/components/ui'
import { useUI } from '../src/store/useUI'
import { useStore } from '../src/store/useStore'
import { createExerciseIndex } from '@opengym/core/exercises'
export function prepareExerciseSheets() {
  configureUx(createBrowserUx())
  bindUI(useUI)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-01-15T12:00:00Z'))
  useStore.setState({ index: createExerciseIndex(useStore.getState().S.customEx) })
}
