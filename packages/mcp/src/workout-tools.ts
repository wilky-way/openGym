import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Tool } from './tool-types'
import { clientFor, invalidate, withToolRedaction } from './state'
import { error, type Environment, type Fetcher } from './http-client'
import { createExerciseIndex, searchExercises, type Exercise } from '@opengym/core/exercises'
import { isProgrammeDate } from '@opengym/core/programme-calendar'
import { isoOf } from '@opengym/core/format'
import { convertWeight } from '@opengym/core/units'
import { withMeaning } from '@opengym/core/dumbbells'
import { stampDeletions } from '@opengym/core/sync-merge'
import { advanceProgramme } from '@opengym/core/programme'
import { refillAfter } from '@opengym/core/rotation'
import { deleteCompletedWorkout } from '../../core/src/session-edit'
import { buildBackfillSession, fileBackfillWorkout } from '../../core/src/past-workout'
import { parseInput } from './draft-ops'

// UI set fields have no upper ceiling. MCP adds explicit safety bounds (in either unit).
const weight = z.number().finite('Weight must be finite.').min(0).max(9999, 'Weight must be at most 9999 in both the supplied and profile units.')
const setSchema = z.object({
  reps: z.number().finite().int().min(0).max(9999).optional(), seconds: z.number().finite().int().min(0).max(86400).optional(),
  weight: weight.optional(), unit: z.enum(['kg', 'lb']).optional(), done: z.boolean().default(true),
}).strict().refine(s => s.reps === undefined || s.seconds === undefined, 'Supply reps or seconds, not both.')
export const logWorkoutSchema = z.object({
  date: z.string().refine(isProgrammeDate, 'Use a valid local YYYY-MM-DD date.'),
  name: z.string().trim().min(1).max(500).optional(), routine_id: z.string().min(1).optional(),
  duration_min: z.number().min(1).max(1440).finite().default(60), notes: z.string().max(10000).optional(),
  exercises: z.array(z.object({ exercise: z.string().trim().min(1), sets: z.array(setSchema).min(1).max(1000) }).strict()).min(1).max(100),
  dry_run: z.boolean().default(true),
}).strict()
const deleteWorkoutSchema = z.object({workout_id: z.string().min(1), confirm: z.literal(true)}).strict()
// Seal the complete persisted record, including its edit stamp. Key order and omitted
// undefined values may change during JSON transport; all content changes fail closed.
function undoDigest(workout: Record<string, any>) {
  const { agentUndoDigest: _, ...record } = workout
  const canonical = (v: any): any => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => [k, canonical(v[k])])) : v
  return createHash('sha256').update(JSON.stringify(canonical(record))).digest('hex')
}
type LogInput = z.input<typeof logWorkoutSchema>
type Options = { env?: Environment; fetcher?: Fetcher; now?: number; id?: string }
// Normalized full names win; fuzzy queries never silently pick one of several matches.
const normalized = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').trim().split(/\s+/).map(w => w.length > 3 && !w.endsWith('ss') && w.endsWith('s') ? w.slice(0,-1) : w).join(' ')
export function resolveWorkoutExercise(query: string, customEx: Exercise[], customId: string, now: number) {
  const index = createExerciseIndex(customEx)
  if (Object.hasOwn(index, query)) return { exercise: index[query]!, created: false }
  const list = Object.values(index), name = normalized(query)
  const exact = list.filter(e => normalized(e.n || '') === name)
  // The catalogue has variants (smith / cross donkey kicks), but no plain floor donkey kick.
  // Only this known missing bodyweight move may be created; never invent arbitrary exercises.
  if (!exact.length && name === 'donkey kick') {
    const prior = customEx.filter(e => e.agentAlias === 'donkey kick')
    if (prior.length === 1) return { exercise: prior[0]!, created: false }
    if (!prior.length) return { exercise: { id: customId, n: 'Donkey kick (agent-created)', custom: true,
      bp: 'upper legs', tg: 'glutes', eq: 'body weight', agentAlias: 'donkey kick', _ts: now } as Exercise, created: true }
  }
  const matches = exact.length ? exact : searchExercises(list, query)
  if (matches.length === 1) return { exercise: matches[0]!, created: false }
  if (!matches.length) throw error('EXERCISE_NOT_FOUND', `No exercise matches ${JSON.stringify(query)}. Create a custom exercise in the app first.`)
  throw error('AMBIGUOUS_EXERCISE', `Choose an exercise id for ${JSON.stringify(query)}: ${JSON.stringify(matches.map((e: Exercise) => ({id:e.id,name:e.n})))}`)
}

/** Pure preparation; uses the same draft and finish helpers as Log a past workout in the UI. */
export function prepareLoggedWorkout(state: Record<string, any>, input: LogInput, options: {id: string; now: number}) {
  const p = parseInput(logWorkoutSchema, input) as z.output<typeof logWorkoutSchema>
  if (state.active) throw error('TRAINING_NOW', 'Finish the current workout before logging a past workout.')
  if (p.date > isoOf(new Date(options.now))) throw error('EINVAL', 'Pick a day up to today.')
  if (p.routine_id && !state.routines.some((r: any) => r.id === p.routine_id)) throw error('NOT_FOUND', 'Routine not found.')
  const next = structuredClone(state), created: Exercise[] = [], resolved: {input: string; id: string; name: string}[] = []
  next.customEx ??= []
  for (const [i, e] of p.exercises.entries()) {
    const result = resolveWorkoutExercise(e.exercise, next.customEx, `agent-${options.id}-${i}`, options.now)
    if (result.created) { next.customEx.push(result.exercise); created.push(result.exercise) }
    resolved.push({ input: e.exercise, id: result.exercise.id!, name: result.exercise.n || '' })
  }
  const index = createExerciseIndex(next.customEx)
  const active = buildBackfillSession(next, {id:options.id,iso:p.date,durationMin:p.duration_min,routineIds:p.routine_id?[p.routine_id]:[]}, index)
  if (active.start + p.duration_min * 60000 > options.now) throw error('EINVAL', 'That workout ends in the future (default local start is 18:00).')
  const planned = active.entries
  const seen = new Map<string, number>()
  const entries = p.exercises.map((e, i) => {
    const timed = e.sets.some(s => s.seconds !== undefined)
    if (timed && e.sets.some(s => s.reps !== undefined)) throw error('EINVAL', 'Use either reps or seconds consistently for each exercise.')
    const id = resolved[i]!.id, occurrence = seen.get(id) || 0
    seen.set(id, occurrence + 1)
    const template = planned.filter(entry => entry.id === id)[occurrence]
    return { ...template, id, target: withMeaning(next, {...template?.target,mode:timed ? 'time' : 'reps'}, id, index),
      ...(p.routine_id ? {rid:p.routine_id} : {}),
      sets: e.sets.map(s => ({done:s.done, w:parseInput(weight, convertWeight(s.weight ?? 0,s.unit || next.unit || 'kg',next.unit || 'kg')),
        ...(s.seconds !== undefined ? {sec:s.seconds} : s.reps !== undefined ? {r:s.reps} : {})})),
    }
  })
  const session = {...active, entries, name:p.name || active.name || 'Freestyle', note:p.notes, loggedBy:'agent'}
  const filed = fileBackfillWorkout(next.workouts || [], session, index, options.now)
  if (!filed.workout.entries?.length) throw error('EINVAL', 'At least one completed set is required.')
  if (!Number.isFinite(filed.workout.vol) || filed.workout.entries.some(e => e.topW != null && !Number.isFinite(e.topW)))
    throw error('EINVAL', 'Computed workout load and volume must be finite.')
  next.workouts = filed.workouts
  refillAfter(next, filed.workout, isoOf(new Date(options.now)), options.now)
  advanceProgramme(next, isoOf(new Date(options.now)), options.now)
  return { state: next, workout: filed.workout, resolved_exercises: resolved, created_exercises: created }
}

async function mutateWorkout(action: 'log' | 'delete', params: Record<string, any>, options: Options) {
  const p = action === 'log' ? parseInput(logWorkoutSchema, params) : parseInput(deleteWorkoutSchema, params)
  const dryRun = action === 'log' && 'dry_run' in p && p.dry_run
  const env = options.env ?? process.env
  if (!dryRun && env.OPENGYM_ENABLE_PROGRAMME_WRITES !== '1') throw error('WRITES_DISABLED', 'Enable OPENGYM_ENABLE_PROGRAMME_WRITES=1 to write workout history.')
  const client = clientFor(env, options.fetcher), id = options.id ?? randomUUID(), now = options.now ?? Date.now()
  try {
    await client.checkProfile()
    for (let attempt = 0; attempt < 3; attempt++) {
      const got = await client.request('GET', '/api/data')
      if (!Number.isSafeInteger(got.rev) || got.rev < 0 || !got.state || !Array.isArray(got.state.routines) || !Array.isArray(got.state.workouts)) throw error('NO_STATE', 'No valid synced profile is available.')
      if (got.state.active) throw error('TRAINING_NOW', 'Finish the current workout first.')
      let next: any, result: any
      if (action === 'log') {
        const built = prepareLoggedWorkout(got.state, p as LogInput, {id,now})
        next = built.state
        built.workout.agentUndoDigest = undoDigest(built.workout)
        result = {workout:built.workout,resolved_exercises:built.resolved_exercises,created_exercises:built.created_exercises}
      } else {
        const d = p as z.infer<typeof deleteWorkoutSchema>
        const workout = got.state.workouts.find((w: any) => w.id === d.workout_id)
        if (!workout) throw error('NOT_FOUND', 'Workout not found.')
        if (workout.loggedBy !== 'agent') throw error('NOT_AGENT_WORKOUT', 'Only agent-created workouts can be deleted through MCP.')
        if (typeof workout.agentUndoDigest !== 'string' || workout.agentUndoDigest !== undoDigest(workout))
          throw error('WORKOUT_MODIFIED', 'Undo requires an unmodified agent-created workout. Delete this workout in the app instead.')
        next = structuredClone(got.state)
        deleteCompletedWorkout(next, next.workouts.find((w: any) => w.id === d.workout_id), createExerciseIndex(next.customEx || []))
        advanceProgramme(next, isoOf(new Date(now)), now)
        stampDeletions(got.state, next, now)
        result = {workout_id:d.workout_id,deleted:true}
      }
      if (dryRun) return client.redactCredentials({dry_run:true,...result})
      if (typeof got.state._wid !== 'string' || !got.state._wid) throw error('WRITE_ID_REQUIRED', 'Sync the profile through the app before writing history.')
      try {
        const ack = await client.request('PUT', '/api/data', {state:next,baseRev:got.rev,baseWid:got.state._wid})
        invalidate(client)
        if (ack?.ok !== true || !Number.isSafeInteger(ack.rev) || ack.rev <= got.rev || typeof ack.wid !== 'string' || !ack.wid) throw error('API_UNAVAILABLE', 'Invalid write acknowledgement; inspect history before retrying.')
        return client.redactCredentials({dry_run:false,...result,appliedRev:ack.rev})
      } catch (err) {
        // Rebuild from the newly authenticated profile snapshot; never replay an old whole document.
        if ((err as {status?:number}).status !== 409 || attempt === 2) throw err
        await client.checkProfile()
      }
    }
    throw error('REV_CONFLICT', 'The profile kept changing. Try again.')
  } catch (failure) {
    if (failure instanceof Error) {
      const safe = client.redactCredentials({...failure,message:failure.message,name:failure.name})
      throw Object.assign(new Error(safe.message),safe)
    }
    throw client.redactCredentials(failure)
  }
}

export function createWorkoutTools(options: Options = {}): Tool[] {
  return [
    {name:'log_workout',description:'Log a past local-date workout; defaults to dry_run:true with the exact record and resolved ids. Explicit dry_run:false plus the programme write env gate commits. Freestyle has no programme effect; never touches an active workout.',schema:logWorkoutSchema.shape,handler:(p: Record<string, any>)=>mutateWorkout('log',p,options)},
    {name:'delete_workout',description:'Undo an agent-logged workout with confirm:true and the write env gate. Only unchanged records sealed by this tool can be undone. Refuses server-visible active workouts; phone-local drafts cannot be detected.',schema:deleteWorkoutSchema.shape,handler:(p: Record<string, any>)=>mutateWorkout('delete',p,options)},
  ].map(tool => ({...tool,withRedaction:run=>withToolRedaction(run,options),handler:p=>withToolRedaction(()=>tool.handler(p),options)}))
}
