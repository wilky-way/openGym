import { clientPlatform } from './client-io'
import { EXIDX, type ExerciseIndex } from '@opengym/core/exercises'
import { HEVY_API, parseHevyWorkouts, parseHevyRoutines, parseHevyBodyweight } from '../../../core/src/import-hevy'
interface ImportOptions { unit?: string; customEx?: unknown }
export * from '../../../core/src/import-hevy'
export interface HevyProgress { page?: number; pageCount?: number; loaded?: number; resultKey?: string; stage?: string }
class HevyApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message || `Hevy API error ${status}`)
    this.name = 'HevyApiError'
    this.status = status
  }
}

async function hevyGet(path: string, apiKey: string, params: Record<string, unknown> = {}) {
  const url = new URL(path, HEVY_API)
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== '') url.searchParams.set(k, String(v))
  }
  // Hevy publishes no rate limit, but a large account is 100+ sequential page requests; a 429
  // gets a short back-off and one more try before it surfaces as its own error kind.
  for (let attempt = 0; ; attempt++) {
    const platform = clientPlatform()
    const res = await platform.transport.fetch(url.href, { headers: { 'api-key': apiKey } })
    if (res.status === 401 || res.status === 403) {
      throw new HevyApiError(res.status, 'auth')
    }
    if (res.status === 429 && attempt < 2) {
      const after = Number(res.headers?.get?.('retry-after'))
      await new Promise(r => setTimeout(r, (after > 0 && after <= 30 ? after : 2 * (attempt + 1)) * 1000))
      continue
    }
    if (res.status === 429) throw new HevyApiError(res.status, 'rate-limit')
    if (!res.ok) throw new HevyApiError(res.status, `http ${res.status}`)
    return res.json()
  }
}

/** Page through a Hevy list endpoint. `pageSize` caps differ per resource. */
export async function fetchHevyPages(path: string, apiKey: string, {
  resultKey,
  pageSize = 10,
  onProgress,
}: {resultKey?: string; pageSize?: number; onProgress?: (progress: HevyProgress) => void} = {}) {
  const items: unknown[] = []
  let page = 1
  let pageCount = 1
  while (page <= pageCount) {
    const data = await hevyGet(path, apiKey, { page, pageSize })
    pageCount = Math.max(1, data.page_count || 1)
    const batch = data[String(resultKey)] || []
    items.push(...batch)
    onProgress && onProgress({ page, pageCount, loaded: items.length, resultKey })
    if (!batch.length) break
    page++
  }
  return items
}

export async function fetchHevyAccount(apiKey: unknown, { onProgress }: {onProgress?: (progress: HevyProgress) => void} = {}) {
  const key = String(apiKey || '').trim()
  if (!key) throw new HevyApiError(0, 'empty')

  const templates = await fetchHevyPages('/v1/exercise_templates', key, {
    resultKey: 'exercise_templates', pageSize: 100,
    onProgress: p => onProgress && onProgress({ stage: 'templates', ...p }),
  })
  const workouts = await fetchHevyPages('/v1/workouts', key, {
    resultKey: 'workouts', pageSize: 10,
    onProgress: p => onProgress && onProgress({ stage: 'workouts', ...p }),
  })
  const routines = await fetchHevyPages('/v1/routines', key, {
    resultKey: 'routines', pageSize: 10,
    onProgress: p => onProgress && onProgress({ stage: 'routines', ...p }),
  })
  let bodyMeasurements: unknown[] = []
  try {
    bodyMeasurements = await fetchHevyPages('/v1/body_measurements', key, {
      resultKey: 'body_measurements', pageSize: 10,
      onProgress: p => onProgress && onProgress({ stage: 'body', ...p }),
    })
  } catch (e) {
    // Older keys / accounts may lack measurements — workouts still import.
    if (!(e instanceof HevyApiError) || e.message === 'auth') throw e
  }
  return { templates, workouts, routines, bodyMeasurements }
}

export async function importHevyData(apiKey: unknown, { unit = 'kg', onProgress, customEx = [] }: ImportOptions & {onProgress?: (progress: HevyProgress) => void} = {}, index: ExerciseIndex = EXIDX) {
  const { templates, workouts, routines, bodyMeasurements } = await fetchHevyAccount(apiKey, { onProgress })
  onProgress && onProgress({ stage: 'parse' })
  return {
    workouts: parseHevyWorkouts(workouts, templates, { unit, customEx }, index),
    routines: parseHevyRoutines(routines, templates, { unit, customEx }, index),
    bodyweight: parseHevyBodyweight(bodyMeasurements, { unit }),
    templateCount: templates.length,
  }
}

export { HevyApiError }
