// @vitest-environment happy-dom
import {describe,it,expect,vi,afterEach} from 'vitest'
import {importHevyData} from '../src/lib/import-hevy'
const TEMPLATES: any = [
  {
    id: '3303376C', title: 'Elliptical Trainer', type: 'distance_duration',
    primary_muscle_group: 'cardio', secondary_muscle_groups: [], equipment: 'machine', is_custom: false,
  },
  {
    id: '4E5257DE', title: 'Lat Pulldown - Close Grip (Cable)', type: 'weight_reps',
    primary_muscle_group: 'lats', secondary_muscle_groups: [], equipment: 'machine', is_custom: false,
  },
  {
    id: 'DEADBEEF', title: 'My Invented Landmine Twist', type: 'weight_reps',
    primary_muscle_group: 'abdominals', secondary_muscle_groups: [], equipment: 'other', is_custom: true,
  },
  {
    id: '99D5F10E', title: 'Ab Wheel', type: 'reps_only',
    primary_muscle_group: 'abdominals', secondary_muscle_groups: [], equipment: 'other', is_custom: false,
  },
]

const WORKOUT: any = {
  id: 'w1',
  title: 'Oberkörper 2',
  start_time: '2026-08-25T10:10:24+00:00',
  end_time: '2026-08-25T11:10:08+00:00',
  exercises: [
    {
      index: 0,
      title: 'Crosstrainer', // localized — must NOT drive the match
      exercise_template_id: '3303376C',
      sets: [{
        index: 0, type: 'normal', weight_kg: null, reps: null,
        distance_meters: 480, duration_seconds: 180, rpe: null,
      }],
    },
    {
      index: 1,
      title: 'Latzug - Enger Griff (Kabel)',
      exercise_template_id: '4E5257DE',
      sets: [
        { index: 0, type: 'warmup', weight_kg: 25, reps: 15, distance_meters: null, duration_seconds: null, rpe: null },
        { index: 1, type: 'normal', weight_kg: 52, reps: 15, distance_meters: null, duration_seconds: null, rpe: 8 },
        { index: 2, type: 'normal', weight_kg: 52, reps: 10, distance_meters: null, duration_seconds: null, rpe: null },
      ],
    },
    {
      index: 2,
      title: 'Meine Eigenkreation',
      exercise_template_id: 'DEADBEEF',
      sets: [
        { index: 0, type: 'normal', weight_kg: 20, reps: 12, distance_meters: null, duration_seconds: null, rpe: null },
      ],
    },
  ],
}

describe('importHevyData', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('pages templates and workouts, never persists the key', async () => {
    const calls: any = []
    vi.stubGlobal('fetch', vi.fn(async (url: any, opts: any) => {
      calls.push({ url: String(url), key: opts.headers.get('api-key') })
      const u: any = String(url)
      if (u.includes('/exercise_templates')) {
        return { ok: true, status: 200, json: async () => ({ page: 1, page_count: 1, exercise_templates: TEMPLATES }) }
      }
      if (u.includes('/workouts')) {
        return { ok: true, status: 200, json: async () => ({ page: 1, page_count: 1, workouts: [WORKOUT] }) }
      }
      if (u.includes('/routines')) {
        return { ok: true, status: 200, json: async () => ({ page: 1, page_count: 1, routines: [] }) }
      }
      if (u.includes('/body_measurements')) {
        return { ok: true, status: 200, json: async () => ({ page: 1, page_count: 1, body_measurements: [] }) }
      }
      return { ok: false, status: 404, json: async () => ({}) }
    }))

    const result: any = await importHevyData('test-key-not-stored', { unit: 'kg' })
    expect(result.workouts.workouts).toHaveLength(1)
    expect(result.routines.routines).toHaveLength(0)
    expect(result.bodyweight.bodyweight).toHaveLength(0)
    expect(calls.every((c: any) => c.key === 'test-key-not-stored')).toBe(true)
  })

  it('surfaces a refused key as HevyApiError auth', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })))
    await expect(importHevyData('bad')).rejects.toMatchObject({ name: 'HevyApiError', message: 'auth' })
  })
})


import { beforeEach as beforeClientEach } from 'vitest'
import { configureTestClient } from './client-fixture'
beforeClientEach(() => configureTestClient())
