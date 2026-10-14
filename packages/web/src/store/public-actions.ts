import { convertWeightPrecise } from '@opengym/core/progression-engine/units'
import { captureProgrammeTarget, updateProgramme, type ProgrammeTarget } from '../lib/programme-target'
import type { Platform } from '@opengym/contract/platform/adapters'
import type { LibraryEntry } from '@opengym/contract/http/api'
import type { DefinitionProgression } from '@opengym/contract/domain/progression'
import type { ExerciseIndex } from '@opengym/core/exercises'
import { createExerciseIndex } from '@opengym/core/exercises'
import { highestStamp } from '@opengym/core/sync-merge'
import { startProgramme, switchProgramme, endProgramme, resumeProgramme } from '@opengym/core/programme-lifecycle'
import { pause } from '@opengym/core/programme'
import { repeatProgrammeWeek as repeatWeek } from '@opengym/core/programme-today'
import { finishProgrammeBlock as finishBlock } from '@opengym/core/programme-rollover'
import type { ActivationOptions, ProgrammeDefinition, ProgrammeCycle, ProgrammeState } from '@opengym/core/programme-engine-types'
import { createProgrammeLibrary, LibraryError, type LibraryVersion } from '../lib/programme-library'
import { clone, useStore, type StoreState, type StoreDocument } from './useStore'

/** Manual TMs use the profile unit unless the caller supplies their source unit. */
export interface PublicActivationOptions extends ActivationOptions { tmUnit?: 'kg' | 'lb' }
export interface SeedInput {
  state: ProgrammeState
  definition: ProgrammeDefinition
  options: ActivationOptions
  index: ExerciseIndex
}
export interface PublicActionServices {
  platform: Platform
  toast(message: string): void
  /** Shared activation-time resolver: prior history only, never a live-cycle refresh. */
  materializeTmSeed?(input: SeedInput): Record<string, number>
}
/** Compose around sync store's existing update; this module never creates another persistence engine. */
export function createPublicActions(get: () => StoreState, services: PublicActionServices) {
  const library = createProgrammeLibrary(services.platform, () => get().user?.id ?? null, undefined, services.toast)
  const target = () => captureProgrammeTarget(services.platform, get)
  const update = (mutate: (draft: StoreDocument) => unknown, valid = target()) => {
    if (!updateProgramme(mutate, valid, get)) throw new Error(get().S.active ? 'Finish the current workout before changing the program.' : 'The account, profile or workout changed. Open the program again.')
  }
  const report = (error: unknown): never => {
    try { services.toast(error instanceof Error ? error.message : 'Could not activate the program.') } catch { /* keep the original failure */ }
    throw error
  }
  const seed = (state: ProgrammeState, definition: ProgrammeDefinition, input: PublicActivationOptions, index: ExerciseIndex) => {
    // The resolver consumes definition-unit numbers. Normalize only supplied TMs;
    // authored fixed and history-derived seeds already carry their own units.
    const { tmUnit = state.unit === 'kg' ? 'kg' : 'lb', ...activation } = input
    const options: ActivationOptions = { ...activation, ...(input.tm ? {tm: inUnit(input.tm, tmUnit, definition.unit)} : {}) }
    const seeds = (definition as ProgrammeDefinition & DefinitionProgression).tmSeeds
    if (!seeds && !Object.keys(options.tm ?? {}).length) return undefined
    if (services.materializeTmSeed) {
      const result = services.materializeTmSeed({ state: clone(state), definition: clone(definition), options: clone(options), index })
      if (!result || Object.values(result).some(value => !Number.isFinite(value) || value <= 0)) throw new Error('Training max seeds must be positive finite values.')
      return clone(result)
    }
    if (Object.values(seeds ?? {}).some(value => 'fromE1rm' in value)) throw new Error('This program needs training max history that is unavailable on this device.')
    const result: Record<string, number> = Object.create(null)
    for (const [lift, value] of Object.entries(seeds ?? {})) {
      if ('value' in value) {
        if (value.unit !== definition.unit) throw new Error('Training max seed units must match the program.')
        result[lift] = value.value
      }
    }
    Object.assign(result, options.tm ?? {})
    if (Object.values(result).some(value => !Number.isFinite(value) || value <= 0)) throw new Error('Training max seeds must be positive finite values.')
    return result
  }
  const inUnit = (tm: Record<string, number>, from: 'kg' | 'lb', to: 'kg' | 'lb') =>
    Object.fromEntries(Object.entries(tm).map(([lift, value]) => [lift, convertWeightPrecise(value, from, to)]))
  const activateDraft = (draft: StoreDocument, definition: ProgrammeDefinition, options: PublicActivationOptions, currentCycleId?: string, entry?: LibraryEntry) => {
    const state = draft as ProgrammeState
    const index = createExerciseIndex(state.customEx)
    const tmSeed = seed(state, definition, options, index)
    const opts = tmSeed ? { ...options, tm: inUnit(tmSeed, definition.unit, draft.unit === 'kg' ? 'kg' : 'lb') } : options
    const cycle = currentCycleId !== undefined
      ? switchProgramme(state, currentCycleId, definition, opts, index)
      : startProgramme(state, definition, opts, index)
    if (tmSeed) {cycle.tmSeed = clone(tmSeed); cycle.tmUnit = draft.unit === 'kg' ? 'kg' : 'lb'}
    if (entry) {
      const programmes = state.programmes!
      const at = Math.max(Date.now(), highestStamp(draft) + 1,
        programmes.offloaded?.[definition.id]?.at ?? 0, programmes.installed?.[definition.id]?.at ?? 0) + 1
      if (!Number.isSafeInteger(at)) throw new Error('Program installation clock is exhausted.')
      programmes.installed = { ...programmes.installed, [definition.id]: { versionId: entry.versionId, at } }
    }
    return cycle
  }
  const activateLocal = (definition: ProgrammeDefinition, options: PublicActivationOptions, currentCycleId?: string, valid = target()) => {
    let result: ProgrammeCycle | undefined
    try { update(draft => { result = activateDraft(draft, clone(definition), clone(options), currentCycleId) }, valid) }
    catch (error) { return report(error) }
    return result!
  }
  // A new lap is an activation: rematerialize history-derived seeds before the
  // Lifecycle draft transition, while fixed/manual seeds carry the athlete's current TM.
  const prepareRepeat = (draft: StoreDocument, cycleId: string, options: ActivationOptions) => {
    const cycle = draft.programmes?.cycles.find((c: ProgrammeCycle) => c.id === cycleId) as ProgrammeCycle | undefined
    if (!cycle) throw new Error('The program changed. Review your choice again.')
    const definition = clone(cycle.snapshot)
    definition.weeks = definition.weeks.filter(w => !w.weekId)
    const seeds = (definition as ProgrammeDefinition & DefinitionProgression).tmSeeds
    // Mutable TM caches follow the profile; frozen seeds always use snapshot.unit.
    const profileUnit = draft.unit === 'kg' ? 'kg' : 'lb'
    const cacheUnit = cycle.tmUnit === 'kg' || cycle.tmUnit === 'lb' ? cycle.tmUnit : profileUnit
    const fixed = inUnit(Object.fromEntries(Object.entries(cycle.tm ?? {}).filter(([lift]) => !seeds?.[lift] || !('fromE1rm' in seeds[lift]!))), cacheUnit, definition.unit)
    const index = createExerciseIndex(draft.customEx)
    const tmSeed = seed(draft as ProgrammeState, definition, { ...options, tmUnit: definition.unit, ...(Object.keys(fixed).length ? {tm:fixed} : {}) }, index)
    const priorTm = cycle.tm === undefined ? undefined : clone(cycle.tm)
    if (tmSeed) cycle.tm = inUnit(tmSeed, definition.unit, profileUnit)
    const restorePrior = () => {
      const archived = draft.programmes.cycles.find((c: ProgrammeCycle) => c.id === cycleId) as ProgrammeCycle
      if (priorTm === undefined) delete archived.tm
      else archived.tm = priorTm
    }
    return { index, seeded: tmSeed !== undefined, restorePrior }
  }
  return {
    repeatProgrammeWeek(cycleId: string, today: string, options: {weekId?: string} = {}, valid = target()) {
      let result: ReturnType<typeof repeatWeek> | undefined
      try { update(draft => {
        const { index, seeded, restorePrior } = prepareRepeat(draft, cycleId, {today})
        result = repeatWeek(draft as ProgrammeState, cycleId, today, options, index)
        restorePrior()
        if (result && seeded) {
          const cycle = result as ProgrammeCycle
          cycle.tmSeed = inUnit(cycle.tm ?? {}, draft.unit === 'kg' ? 'kg' : 'lb', cycle.snapshot.unit)
          cycle.tmUnit = draft.unit === 'kg' ? 'kg' : 'lb'
        }
      }, valid) } catch (error) { return report(error) }
      return result!
    },
    finishProgrammeBlock(cycleId: string, choice: string, options: {today?: string} = {}, valid = target()) {
      let result: ReturnType<typeof finishBlock> | undefined
      try { update(draft => {
        const { index, seeded, restorePrior } = choice === 'repeat' ? prepareRepeat(draft, cycleId, options) : {index:createExerciseIndex(draft.customEx),seeded:false,restorePrior:()=>{}}
        result = finishBlock(draft, cycleId, choice, options, index)
        restorePrior()
        if (result && seeded) {
          const cycle = result as ProgrammeCycle
          cycle.tmSeed = inUnit(cycle.tm ?? {}, draft.unit === 'kg' ? 'kg' : 'lb', cycle.snapshot.unit)
          cycle.tmUnit = draft.unit === 'kg' ? 'kg' : 'lb'
        }
      }, valid) } catch (error) { return report(error) }
      return result!
    },
    listProgrammeLibrary: () => library.list(),
    getLibraryProgramme: (id: string, versionId?: LibraryVersion) => library.get(id, versionId),
    startProgramme: (definition: ProgrammeDefinition, options: PublicActivationOptions = {}, valid?: ProgrammeTarget) => activateLocal(definition, options, undefined, valid),
    switchProgramme: (cycleId: string, definition: ProgrammeDefinition, options: PublicActivationOptions = {}, valid?: ProgrammeTarget) => activateLocal(definition, options, cycleId, valid),
    async activateLibraryProgramme(id: string, options: PublicActivationOptions = {}, versionId?: LibraryVersion, currentCycleId?: string, valid = target()) {
      const opts = clone(options)
      try {
        const entry = await library.get(id, versionId)
        if (entry.level === 'Invalid') throw new LibraryError('This program is invalid and cannot be activated.', 'invalid-programme')
        let result: ProgrammeCycle | undefined
        update(draft => { result = activateDraft(draft, entry.definition as unknown as ProgrammeDefinition, opts, currentCycleId, entry) }, valid)
        return result!
      } catch (error) { return report(error) }
    },
    endProgramme(cycleId: string, options: ActivationOptions = {}, valid = target()) {
      let result: ProgrammeCycle | undefined
      update(draft => { result = endProgramme(draft as ProgrammeState, cycleId, options) }, valid)
      return result!
    },
    pauseProgramme(cycleId: string, options: ActivationOptions = {}, valid = target()) {
      let result = false
      update(draft => { result = pause(draft as ProgrammeState, cycleId, options.today) }, valid)
      return result!
    },
    resumeProgramme(cycleId: string, options: ActivationOptions = {}, valid = target()) {
      let result = false
      update(draft => { result = resumeProgramme(draft as ProgrammeState, cycleId, options) }, valid)
      return result!
    },
  }
}
export type PublicActions = ReturnType<typeof createPublicActions>
export function initializePublicActions(services: PublicActionServices): PublicActions {
  const actions = createPublicActions(useStore.getState, services)
  useStore.setState(actions)
  return actions
}
