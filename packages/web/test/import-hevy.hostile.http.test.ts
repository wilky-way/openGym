// @vitest-environment happy-dom
import {describe,it,expect,vi,afterEach} from 'vitest'
import {importHevyData,fetchHevyPages,parseHevyWorkouts} from '../src/lib/import-hevy'
const kg: any={unit:'kg'}
const reply: any=(body: any)=>new Response(JSON.stringify(body),{status:200})
describe('paging through whatever the server sends', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('a string where the list should be is spread into characters, which then import as nothing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply({ page_count: 1, workouts: 'hello' })))
    const items: any = await fetchHevyPages('/v1/workouts', 'k', { resultKey: 'workouts' })
    expect(items).toEqual(['h', 'e', 'l', 'l', 'o'])
    const p: any = parseHevyWorkouts(items, [], kg)
    expect(p.workouts).toEqual([])
    expect(p.skipped).toBe(5)
  })

  it('a number or an object where the list should be, or a null body, throws — the sheet turns that into a toast', async () => {
    for (const body of [{ page_count: 1, workouts: 5 }, { page_count: 1, workouts: { a: 1 } }, null]) {
      vi.stubGlobal('fetch', vi.fn(async () => reply(body)))
      await expect(fetchHevyPages('/v1/workouts', 'k', { resultKey: 'workouts' }), JSON.stringify(body)).rejects.toBeInstanceOf(TypeError)
    }
  })

  it('page_count as text or NaN, and a page count that is a lie', async () => {
    let calls: any = []
    vi.stubGlobal('fetch', vi.fn(async (url: any) => { calls.push(new URL(url).searchParams.get('page')); return reply({ page_count: '3', workouts: calls.length < 3 ? [{}] : [] }) }))
    expect(await fetchHevyPages('/v1/workouts', 'k', { resultKey: 'workouts' })).toHaveLength(2)
    expect(calls).toEqual(['1', '2', '3'])
    calls = []
    vi.stubGlobal('fetch', vi.fn(async () => { calls.push(1); return reply({ page_count: NaN, workouts: [{}] }) }))
    expect(await fetchHevyPages('/v1/workouts', 'k', { resultKey: 'workouts' })).toHaveLength(1)
    expect(calls).toHaveLength(1)
  })

  it('a template that is not an object makes the whole import fail', async () => {
    const pages: any = { exercise_templates: [null], workouts: [], routines: [], body_measurements: [] }
    vi.stubGlobal('fetch', vi.fn(async (url: any) => { const u: any = String(url); const k: any = Object.keys(pages).find((k: any) => u.includes('/v1/' + k)); return reply({ page_count: 1, [k]: pages[k] }) }))
    await expect(importHevyData('k', kg)).rejects.toBeInstanceOf(TypeError)
  })
})


import { beforeEach as beforeClientEach } from 'vitest'
import { configureTestClient } from './client-fixture'
beforeClientEach(() => configureTestClient())
