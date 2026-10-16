import type { Tool } from './tool-types'
import {z} from 'zod'
import {getState,getUser} from './state'
import {todayISO} from '@opengym/core/format'
import {isProgrammeDate} from '@opengym/core/programme-calendar'
import {programmePosition,getProgramme,applyProgrammeAgentAction} from '@opengym/core/programme-agent'
const date=z.string().refine(isProgrammeDate,'must be a valid YYYY-MM-DD date')
import { clientFor, currentClient, invalidate } from './state'
import { error, type Environment, type Fetcher } from './http-client'
import { createExerciseIndex } from '@opengym/core/exercises'
import { highestStamp } from '@opengym/core/server-stamp'
import { createMaxTools } from './max-tools'

export async function mutateProgramme(action: string, params: Record<string, any>, options: { fetcher?: Fetcher; env?: Environment } = {}) {
  if (action === 'set_training_max') throw error('PREVIEW_REQUIRED', 'Use set_training_max with its reviewed preview token and explicit apply:true.')
  const env = options.env ?? currentClient()?.env ?? process.env
  if (env.OPENGYM_ENABLE_PROGRAMME_WRITES !== '1') throw error('WRITES_DISABLED', 'Enable OPENGYM_ENABLE_PROGRAMME_WRITES=1 to use program actions.')
  const client = !options.env && !options.fetcher && currentClient() || clientFor({ ...env, OPENGYM_UID: env.OPENGYM_UID || getUser().id }, options.fetcher)
  await client.checkProfile()
  const got = await client.request('GET', '/api/data')
  if (!Number.isInteger(params.expectedRev) || got.rev !== params.expectedRev || (got.state?._wid || null) !== params.expectedWid) throw error('REV_CONFLICT', 'The profile changed. Read the program again before applying this action.')
  if (!got.state || !Array.isArray(got.state.routines)) throw error('NO_STATE', 'No synced profile is available for program actions.')
  if (typeof got.state._wid !== 'string' || !got.state._wid) throw error('WRITE_ID_REQUIRED', 'This profile has no write identity. Sync it through the app before using program actions.')
  const state = structuredClone(got.state), today = params.today || todayISO()
  if (action === 'activate' && !(state.programmes?.definitions || []).some((d: any) => d.id === params.programmeId)) {
    if (typeof params.programmeId !== 'string' || !/^[A-Za-z0-9._-]{1,128}$/.test(params.programmeId) || /^\.+$/.test(params.programmeId)) throw error('EINVAL', 'Invalid programme id.')
    const entry = await client.request('GET', '/api/programmes/library/' + encodeURIComponent(params.programmeId))
    if (!entry.definition || entry.definition.id !== params.programmeId || typeof entry.versionId !== 'string') throw error('API_UNAVAILABLE', 'The openGym API returned an invalid library entry.')
    state.programmes ??= { definitions: [], cycles: [] }
    state.programmes.definitions ??= []
    state.programmes.definitions.push(entry.definition)
    const prior = Math.max(highestStamp(state), state.programmes.offloaded?.[params.programmeId]?.at || 0, state.programmes.installed?.[params.programmeId]?.at || 0)
    const at = Math.max(Date.now(), prior + 1)
    if (!Number.isSafeInteger(at)) throw error('EINVAL', 'Programme install clock is exhausted.')
    state.programmes.installed = { ...state.programmes.installed, [params.programmeId]: { versionId: entry.versionId, at } }
  }
  applyProgrammeAgentAction(state, action, params, today, createExerciseIndex(state.customEx || []))
  const result = await client.request('PUT', '/api/data', { state, baseRev: got.rev, baseWid: got.state._wid })
  invalidate(client)
  if (!result || result.ok !== true || !Number.isSafeInteger(result.rev) || result.rev <= got.rev || typeof result.wid !== 'string' || !result.wid) throw error('API_UNAVAILABLE', 'The openGym API returned an invalid write acknowledgement.')
  try {
    const fresh = await client.request('GET', '/api/data')
    if (!fresh || !Number.isSafeInteger(fresh.rev) || fresh.rev < result.rev || !fresh.state || typeof fresh.state !== 'object' || Array.isArray(fresh.state) || !Array.isArray(fresh.state.routines) || typeof fresh.state._wid !== 'string' || !fresh.state._wid) throw error('API_UNAVAILABLE', 'The openGym API returned an invalid write readback.')
    return { ok: true, appliedRev: result.rev, rev: fresh.rev, position: programmePosition({ ...fresh.state, _rev: fresh.rev }, today, undefined) }
  } catch (err) { return { ok: true, appliedRev: result.rev, position: null, readbackError: (err as { code?: string }).code || 'API_UNAVAILABLE' } }
}
const withState=(handler: any)=>(p: any)=>{const S=getState();return S?handler(S,p):{error:'no synced state yet — sign in at least once from a device',unit:'kg'}}
const common={expected_rev:z.number().int().nonnegative(),expected_wid:z.string().nullable(),today:date.optional()}
const fromParams=(p: any)=>({expectedRev:p.expected_rev,expectedWid:p.expected_wid,today:p.today,cycleId:p.cycle_id,instanceId:p.instance_id,programmeId:p.programme_id,weekIndex:p.week_index,perWeek:p.per_week,tm:p.tm,existingRoutineIds:p.adopt,reason:p.reason,lift:p.lift,value:p.value,unit:p.unit})
export const PROGRAMME_TOOLS: Tool[] = [
  ...createMaxTools(),
  {name:'get_programme',description:'Includes effortScale and displayDefinition in the profile scale alongside the unchanged authored definition and cycle. Read the active program and its frozen definition, or a specific cycle/definition. Includes the synced revision for conditional actions.',schema:{cycle_id:z.string().optional(),programme_id:z.string().optional()},handler:withState((S: any,p: any)=>getProgramme(S,{cycleId:p.cycle_id,programmeId:p.programme_id}))},
  {name:'programme_position',description:'Read program week, next session/date, projected end and done/skipped adherence using the same projection as the UI. Pending dates are derived.',schema:{cycle_id:z.string().optional(),today:date.optional()},handler:withState((S: any,p: any)=>programmePosition(S,p.today || todayISO(),p.cycle_id))},
  {name:'activate_programme',description:'Activate or adopt a saved validated program using UI guards. Requires explicit write opt-in, a paired API token for this profile and the expected revision. Never replaces an active/paused cycle or a running workout.',schema:{...common,programme_id:z.string(),week_index:z.number().int().positive().optional(),per_week:z.number().int().min(1).max(7).optional(),tm:z.record(z.number().positive()).optional(),adopt:z.record(z.string()).optional()},handler:withState((S: any,p: any)=>mutateProgramme('activate',fromParams(p)))},
  {name:'shift_programme',description:'Shift the active program to tomorrow without skipping, through the same UI helper and authenticated conditional API write.',schema:{...common,cycle_id:z.string()},handler:withState((S: any,p: any)=>mutateProgramme('shift',fromParams(p)))},
  {name:'skip_programme_session',description:'Explicitly skip one pending occurrence. Finished logs win; resolved sessions are refused. Requires write opt-in, profile authentication and the expected revision.',schema:{...common,cycle_id:z.string(),instance_id:z.string(),reason:z.string().optional()},handler:withState((S: any,p: any)=>mutateProgramme('skip',fromParams(p)))},
]
