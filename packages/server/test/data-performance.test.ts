import { test, expect } from 'bun:test'
import os from 'node:os'
import { heapStats } from 'bun:jsc'
import { dataServer, dataHeaders, CLOCK } from './data-helpers'
import { startOracle, mintSession } from '../../parity/src/oracle'
import { syntheticProfile } from '../../parity/src/synthetic'

test('durable PUT p99 is within 10% of legacy and below 50 ms at 1,040 synthetic workouts', async () => {
  const phases: Record<string, number[]> = {}, samples: number[] = [], legacySamples: number[] = []
  const h = dataServer(['u1'], { observe: (phase, ms) => (phases[phase] ??= []).push(ms) })
  const profile = syntheticProfile(20261013, { users: 1, workouts: 0, now: CLOCK })
  // Both targets start without a document and receive identical request bytes.
  profile.docs = {}
  const oracle = await startOracle(profile)
  const cores = os.cpus().length, loadBefore = os.loadavg()[0]!, heapBefore = heapStats()
  const targets = [
    { url: h.api, headers: dataHeaders('u1'), samples },
    { url: oracle.baseUrl, headers: { Cookie: `gymsid=${mintSession(profile.db.users[0]!.id, CLOCK)}`, 'Content-Type': 'application/json' }, samples: legacySamples },
  ]
  let seed = 20261013
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32 }
  const workouts = Array.from({ length: 1040 }, (_, i) => ({
    id: `synthetic_w_${i}`, d: new Date(CLOCK - (1040 - i) * 86400000).toISOString().slice(0, 10), name: 'Synthetic training', start: CLOCK - i * 86400000, end: CLOCK - i * 86400000 + 3600000,
    entries: Array.from({ length: 5 }, (_, j) => ({ id: `synthetic_ex_${j}`, sets: Array.from({ length: 3 }, () => ({ r: 5 + Math.floor(random() * 5), w: 20 + Math.floor(random() * 40) * 2.5, done: true })) })),
  }))
  const state = { workouts, routines: [], _ts: CLOCK, unit: 'kg' }
  try {
    for (let i = 0; i < 220; i++) {
      // Interleave and alternate order to share the same host/disk window.
      // Client encoding is outside endpoint latency; both use the same bytes
      // and fresh connections to avoid Bun pooling a stopped oracle's port.
      const body = JSON.stringify({ state, stamped: true, baseRev: i })
      for (const target of i % 2 ? targets.toReversed() : targets) {
        const begin = performance.now()
        const response = await fetch(target.url + '/api/data', { method: 'PUT', headers: target.headers, body, keepalive: false })
        await response.arrayBuffer()
        const elapsed = performance.now() - begin
        expect(response.status).toBe(200)
        if (i >= 20) target.samples.push(elapsed)
      }
    }
    const distribution = (values: number[]) => {
      const sorted = values.toSorted((a, b) => a - b)
      return { p50_ms: sorted[99]!, p95_ms: sorted[189]!, p99_ms: sorted[197]!, max_ms: sorted.at(-1)! }
    }
    const current = distribution(samples), legacy = distribution(legacySamples), loadAfter = os.loadavg()[0]!
    const phaseNames = Object.keys(phases).filter(name => name !== 'service_total')
    const residual = phases.service_total!.map((total, i) => total - phaseNames.reduce((sum, name) => sum + phases[name]![i]!, 0))
    console.log(JSON.stringify({ benchmark: 'S04 same-window durable HTTP PUT', acceptance: 'new p99 <= legacy p99 * 1.1 AND new p99 < 50 ms', workouts: 1040, bytes: Buffer.byteLength(JSON.stringify(state)), samples: samples.length, warmup: 20, current, legacy, ratio: current.p99_ms / legacy.p99_ms, timezone: process.env.TZ, cores, load_1m_before: loadBefore, load_1m_after: loadAfter, host: Math.max(loadBefore, loadAfter) < cores ? 'quiet-host' : 'loaded-host', samples_ms: { current: samples, legacy: legacySamples } }))
    console.log(JSON.stringify({ phases: Object.fromEntries(Object.entries({ ...phases, service_unattributed: residual }).map(([name, times]) => [name, distribution(times.slice(20))])), heap: { before: { heapSize: heapBefore.heapSize, objectCount: heapBefore.objectCount }, after: { heapSize: heapStats().heapSize, objectCount: heapStats().objectCount } } }))
    expect(current.p99_ms).toBeLessThanOrEqual(legacy.p99_ms * 1.1)
    expect(current.p99_ms).toBeLessThan(50)
  } finally { await oracle.stop() }
}, 60000)
