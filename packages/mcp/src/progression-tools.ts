import { z } from 'zod'
import { createExerciseIndex } from '@opengym/core/exercises'
import { validateProgression } from '@opengym/core/progression-validate'
import type { EvaluateResult, Why, ApplyResult } from '../../contract/domain/progression'
import { DraftStore, authoringDirectory, checkedJSON } from './draft-store'
import { libraryId } from './authoring-tools'
import { parseInput } from './draft-ops'
import { currentClient, getState, invalidate, withRemoteState, redactToolCredentials, withToolRedaction } from './state'
import { error, type Environment, type Fetcher } from './http-client'
import type { Tool } from './tool-types'

const key = z.string().min(1).max(128)
const weeks = z.array(z.number().int().min(1).max(64)).min(1).max(64)
const source = z.union([
  z.object({ definition: z.record(z.unknown()) }).strict(),
  z.object({ definitionId: libraryId, versionId: key.optional() }).strict(),
  z.object({ draft_id: key }).strict(),
])
const whySummary = (why: Why[]) => why.map(({ ruleId, kind, text }) => ({ ruleId, kind, text }))
/** Keep every load and its explanation together; inputs and the TM timeline are full-only. */
export function progressionSummary(result: EvaluateResult) {
  return { weeks: result.weeks.map(w => ({ index: w.index, slots: w.slots.map(s => ({
    ref: s.ref, exerciseId: s.exerciseId, why: whySummary(s.why),
    sets: s.sets.map(set => ({ ...set, why: whySummary(set.why) })),
  })) })), warnings: result.warnings }
}
function bounded(value: unknown): unknown {
  value = redactToolCredentials(value)
  // Never silently drop a prescribed load or its Why to fit a summary.
  if (Buffer.byteLength(JSON.stringify(value)) > 128 * 1024) throw error('TOO_LARGE', 'Progression output exceeds 128 KiB. Request fewer weeks or use full:true.')
  return value
}
function applySummary(result: ApplyResult, dryRun: boolean) {
  const view = redactToolCredentials({ ...result, dry_run: dryRun, changed: result.changed.map(c => ({ ...c, why: whySummary(c.why) })) })
  if (Buffer.byteLength(JSON.stringify(view)) <= 128 * 1024) return view
  const cap = <T,>(rows: T[], limit: number): T[] => {
    const kept: T[] = []; let bytes = 0
    for (const row of rows) { const size = Buffer.byteLength(JSON.stringify(row)); if (bytes + size > limit) break; kept.push(row); bytes += size }
    return kept
  }
  // An acknowledged write must always report success and its committed revision.
  const changed = cap(view.changed,80 * 1024), warnings = cap(view.warnings,32 * 1024)
  return { ...view, changed, warnings, totalChanges: view.changed.length, totalWarnings: view.warnings.length,
    changedTruncated: changed.length < view.changed.length, warningsTruncated: warnings.length < view.warnings.length }
}
export function createProgressionTools(options: { env?: Environment; fetcher?: Fetcher } = {}): Tool[] {
  const env = () => options.env ?? process.env
  const remote = <T,>(run: () => Promise<T>) => withRemoteState(run, options)
  const draft = (id: string) => {
    const store = new DraftStore(authoringDirectory(env()))
    try { return store.get(id) } finally { store.close() }
  }
  const tool = (name: string, description: string, schema: z.ZodRawShape, run: (p: any) => any): Tool => ({
    name, description, schema, withRedaction: run => withToolRedaction(run, options), handler: (p = {}) => withToolRedaction(() => run(parseInput(z.object(schema).strict(), p)), options),
  })
  return [
    tool('validate_progression', 'Pure progression validation for JSON or a local draft; programme_id reads the authenticated HTTP profile/library. No writes.', {
      definition: z.unknown().optional(), draft_id: key.optional(), programme_id: libraryId.optional(),
    }, async p => {
      if (['definition', 'draft_id', 'programme_id'].filter(k => Object.hasOwn(p, k)).length !== 1) throw error('EINVAL', 'Supply exactly one definition, draft_id or programme_id.')
      if (p.draft_id) {
        const d = draft(p.draft_id)
        return bounded(validateProgression(d.definition, createExerciseIndex(d.customEx ?? [])))
      }
      if (p.programme_id) return remote(async () => {
        const state = getState()
        const definition = state?.programmes?.definitions?.find((d: any) => d.id === p.programme_id) ??
          (await currentClient()!.request<any>('GET', '/api/programmes/library/' + encodeURIComponent(p.programme_id))).definition
        return bounded(currentClient()!.redactCredentials(validateProgression(definition, createExerciseIndex(state?.customEx ?? []))))
      })
      checkedJSON(p.definition)
      return bounded(validateProgression(p.definition, createExerciseIndex()))
    }),
    tool('preview_progression', 'Preview via HTTP, with every prescribed load and summarised Why. full:true includes all inputs and the TM timeline. A draft source uses {draft_id}; no state writes.', {
      source, cycle_id: key.optional(), weeks, as_of: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      hypothetical_logs: z.array(z.record(z.unknown())).max(1000).optional(), full: z.boolean().optional(),
    }, async p => {
      const resolved = 'draft_id' in p.source ? { definition: draft(p.source.draft_id).definition } : p.source
      checkedJSON(resolved); if (p.hypothetical_logs) checkedJSON(p.hypothetical_logs)
      return remote(async () => {
        // The progression lookup seam does not mount library storage.
        // Resolve library/historical sources over HTTP, then send the immutable JSON.
        let httpSource = resolved
        if ('definitionId' in resolved) {
          const installed = getState()?.programmes?.definitions?.find((d: any) => d.id === resolved.definitionId &&
            (resolved.versionId === undefined || (d.authoring?.versionId ?? d.versionId) === resolved.versionId))
          const snapshot = p.cycle_id && getState()?.programmes?.cycles?.find((c: any) => c.id === p.cycle_id)?.snapshot
          const definition = installed ?? (snapshot?.id === resolved.definitionId && resolved.versionId === undefined ? snapshot :
            (await currentClient()!.request<any>('GET','/api/programmes/library/' + encodeURIComponent(resolved.definitionId) +
              (resolved.versionId === undefined ? '' : '?version=' + encodeURIComponent(resolved.versionId)))).definition)
          httpSource = { definition }
        }
        const result = await currentClient()!.request<EvaluateResult>('POST', '/api/progression/preview', {
          source: httpSource, weeks: p.weeks, ...(p.cycle_id === undefined ? {} : { cycleId: p.cycle_id }),
          ...(p.as_of === undefined ? {} : { asOf: p.as_of }), ...(p.hypothetical_logs === undefined ? {} : { hypotheticalLogs: p.hypothetical_logs }),
        })
        return p.full ? result : bounded(progressionSummary(result))
      })
    }),
    tool('apply_progression', 'Dry run by default. A write needs dry_run:false, confirm:true, both authoring/write env gates, and confirmNoActiveSession:true from the human. Inventory-adjustment warnings require separate explicit confirmInventoryAdjustment:true; never retry or auto-confirm a 409/422.', {
      cycle_id: key, weeks, expected_rev: z.number().int().nonnegative(), expected_wid: key.nullable(),
      dry_run: z.boolean().optional(), confirm: z.boolean().optional(), confirmNoActiveSession: z.literal(true),
      confirmInventoryAdjustment: z.boolean().optional(), full: z.boolean().optional(),
    }, async p => {
      const dryRun = p.dry_run !== false
      if (!dryRun) {
        if (p.confirm !== true) throw error('EINVAL', 'Applying requires confirm:true and dry_run:false.')
        if (env().OPENGYM_ENABLE_PROGRAMME_AUTHORING !== '1' || env().OPENGYM_ENABLE_PROGRAMME_WRITES !== '1') throw error('WRITES_DISABLED', 'Enable OPENGYM_ENABLE_PROGRAMME_AUTHORING=1 and OPENGYM_ENABLE_PROGRAMME_WRITES=1 to apply.')
      }
      return remote(async () => {
        const client = currentClient()!
        const result = await client.request<ApplyResult>('POST', '/api/progression/apply', {
          cycleId: p.cycle_id, weeks: p.weeks, expectedRev: p.expected_rev, expectedWid: p.expected_wid,
          confirmNoActiveSession: p.confirmNoActiveSession, dryRun,
          ...(p.confirmInventoryAdjustment === undefined ? {} : { confirmInventoryAdjustment: p.confirmInventoryAdjustment }),
        })
        if (!dryRun) invalidate(client)
        return p.full ? { ...result, dry_run: dryRun } : applySummary(result,dryRun)
      })
    }),
  ]
}
