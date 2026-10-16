import { vi } from 'vitest'
import { configureUx, createBrowserUx } from '../../src/platform/ux'
import { configureClientIO } from '../../src/lib/client-io'
import { createBrowserPlatform } from '../../src/platform/browser'
import { configurePlanHistorySheets } from '../../src/sheets-plan-history'
import { useUI } from '../../src/store/useUI'
import { useStore } from '../../src/store/useStore'
import { setLabel } from '@opengym/core/history'
export function setupPlanHistoryTest(): void {
  configureUx(createBrowserUx())
  configureClientIO(createBrowserPlatform())
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-16T12:00:00'))
  configurePlanHistorySheets({
    version: '1.0.0',
    exerciseHistorySheet(id) {
      useUI.getState().openSheet(() => <><h3>Exercise history</h3>{useStore.getState().S.workouts.flatMap((w: any) => w.entries.filter((e: any) => e.id === id).flatMap((e: any) => e.sets.map((s: any) => setLabel(id,s,e.target,undefined,useStore.getState().index)))).join(' · ')}</>)
    },
    repeatWorkout() { throw new Error('W14 repeat seam') },
    logPastWorkoutSheet() { throw new Error('W14 backfill seam') },
  })
}
