import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { assertCount, loadPublicParityMap } from './assert-count'
import { run } from './files'
import { discoverTests } from './test-discovery'
import { passingVitestTests, requireExecutedTests } from './test-execution'
import { verifyFrozenPublicOracle } from './verify-public-oracle'
import { lintBoundaries } from './boundaries'

export const PUBLIC_PACKAGES = ['contract', 'core', 'web', 'server', 'mcp', 'parity'] as const
export const PUBLIC_TIMEZONES = ['America/Chicago', 'UTC'] as const
export interface ExtraGate { id: string; argv: string[]; gap?: string }
export const EXTRA_GATES: ExtraGate[] = [
  { id: "public-corpus-loopback", argv: ["mise", "exec", "node@22", "--", "node", "--test", "--test-concurrency=1", "scripts/test/corpus-loopback.test.mjs"] },
  {
    "id": "F1",
    "argv": [
      "bun",
      "run",
      "gen:model",
      "--check"
    ]
  },
  {
    "id": "F1",
    "argv": [
      "bun",
      "run",
      "gen:core-api",
      "--check"
    ]
  },
  {
    "id": "K01",
    "argv": [
      "bun",
      "scripts/catalogue/build.mjs",
      "--rewrite",
      "--check"
    ]
  },
  {
    "id": "K10",
    "argv": [
      "bun",
      "--bun",
      "vitest",
      "run",
      "--root",
      "packages/core",
      "test/accent.diff.test.ts",
      "--maxWorkers=1"
    ]
  },
  {
    "id": "F2",
    "argv": [
      "bun",
      "packages/parity/test/oracle-gate.ts"
    ]
  },
  {
    "id": "K12",
    "argv": [
      "bun",
      "--bun",
      "vitest",
      "run",
      "--root",
      "packages/core",
      "test/programme-open-slots.diff.test.ts",
      "--maxWorkers=1"
    ]
  },
  {
    "id": "K14",
    "argv": [
      "bun",
      "--bun",
      "vitest",
      "run",
      "--root",
      "packages/core",
      "test/workout-controls.diff.test.ts",
      "--maxWorkers=1"
    ]
  },
  {
    "id": "K14",
    "argv": [
      "bun",
      "--bun",
      "vitest",
      "run",
      "--root",
      "packages/core",
      "test/similar-exercises.diff.test.ts",
      "--maxWorkers=1"
    ]
  },
  {
    "id": "P3",
    "argv": [
      "bun",
      "scripts/assert-stall-golden-enabled.ts"
    ]
  },
  {
    "id": "S13",
    "argv": [
      "bun",
      "test",
      "packages/server/test/passkey-transcripts.test.ts",
      "packages/server/test/passkey-positive.diff.test.ts"
    ]
  },
  {
    "id": "S04",
    "argv": [
      "bun",
      "scripts/s04-enospc.ts"
    ],
    "gap": "ENOSPC RAM-disk resource proof is separately scheduled; unavailable here."
  },
  {
    "id": "S09",
    "argv": [
      "bun",
      "test",
      "packages/server/test/migration-parity.test.ts"
    ]
  },
  {
    "id": "S05",
    "argv": [
      "bun",
      "test",
      "packages/server/test/push-security.test.ts",
      "packages/server/test/notifications.diff.test.ts",
      "packages/server/test/server-reminder.test.ts",
      "packages/server/test/server-nudge.test.ts",
      "packages/server/test/notification-lifecycle.test.ts"
    ]
  },
  {
    "id": "S05",
    "argv": [
      "bun",
      "install",
      "--frozen-lockfile",
      "--cwd",
      "legacy/api"
    ],
    "gap": "Matching read-only oracle dependencies must be provisioned and verified separately; this gate never installs packages."
  },
  {
    "id": "S05",
    "argv": [
      "bun",
      "test",
      "scripts/parity/S05-record.diff.test.ts"
    ]
  },
  {
    "id": "S05",
    "argv": [
      "bun",
      "build",
      "--compile",
      "packages/server/src/index.ts",
      "--outfile",
      ".gate/S05-server"
    ]
  },
  {
    "id": "S05",
    "argv": [
      "bun",
      "test",
      "packages/server/test/push-security.test.ts",
      "packages/server/test/notifications.diff.test.ts",
      "packages/server/test/server-reminder.test.ts",
      "packages/server/test/server-nudge.test.ts"
    ]
  },
  {
    "id": "S11",
    "argv": [
      "bun",
      "audit"
    ],
    "gap": "Dependency advisory audit requires a separately scheduled network check."
  },
  {
    "id": "S11",
    "argv": [
      "bun",
      "test",
      "packages/server/test/hardening.test.ts"
    ]
  },
  {
    "id": "P6",
    "argv": [
      "env",
      "TZ=America/Chicago",
      "bun",
      "test",
      "./packages/mcp/acceptance/progression-http.acceptance.test.ts"
    ]
  },
  {
    "id": "P6",
    "argv": [
      "env",
      "TZ=UTC",
      "bun",
      "test",
      "./packages/mcp/acceptance/progression-http.acceptance.test.ts"
    ]
  },
  {
    "id": "W05",
    "argv": [
      "bun",
      "--bun",
      "vitest",
      "run",
      "--root",
      "packages/web",
      "test/icon-inherited.test.tsx",
      "--maxWorkers=1"
    ]
  },
  {
    "id": "W09",
    "argv": [
      "bun",
      "--bun",
      "vitest",
      "run",
      "--root",
      "packages/web",
      "test/LineChart.bounds.test.tsx",
      "--maxWorkers=1"
    ]
  },
  {
    "id": "P7",
    "argv": [
      "env",
      "TZ=America/Chicago",
      "bun",
      "test",
      "packages/web/acceptance/P7-preview.acceptance.test.ts"
    ]
  },
  {
    "id": "P7",
    "argv": [
      "env",
      "TZ=UTC",
      "bun",
      "test",
      "packages/web/acceptance/P7-preview.acceptance.test.ts"
    ]
  },
  {
    "id": "W23",
    "argv": [
      "bun",
      "run",
      "--cwd",
      "packages/web",
      "build"
    ]
  },
  {
    "id": "I01",
    "argv": [
      "bun",
      "packages/parity/e2e/I01.mjs"
    ],
    "gap": "Production browser differential/build/interruption requires separately granted resources."
  },
  {
    "id": "I01",
    "argv": [
      "bun",
      "packages/parity/e2e/interruption.mjs"
    ],
    "gap": "Production browser differential/build/interruption requires separately granted resources."
  },
  {
    "id": "I03",
    "argv": [
      "bun",
      "run",
      "build:server"
    ]
  },
  {
    "id": "I03",
    "argv": [
      "bun",
      "scripts/i03-perf.ts",
      "--prepare"
    ],
    "gap": "Quiet-host measured performance is separately scheduled; preparation is not a measurement."
  },
  {
    "id": "I02",
    "argv": [
      "bun",
      "packages/parity/e2e/I02-assert.mjs"
    ],
    "gap": "New measured I02 cutover/auth/cache/rollback/container receipts are required; synthetic checker inputs are not integration proof."
  },
  {
    "id": "public-docs",
    "argv": [
      "bun",
      "scripts/gen-mcp-tools.ts",
      "--check"
    ]
  },
  {
    "id": "public-core-api",
    "argv": [
      "bun",
      "scripts/gen-core-api.ts",
      "--check"
    ]
  },
  {
    "id": "public-model",
    "argv": [
      "bun",
      "scripts/gen-model.ts",
      "--check"
    ]
  }
]

export function requirePublicReport(report: string, kind: 'vitest' | 'server', label: string): number {
  const data = kind === 'server' ? JSON.parse(report) as Record<string, unknown> | null : null
  if (kind === 'server' && (!data || Array.isArray(data) || data.success === false || data.status === 'failed' || ['numFailedTests', 'numFailedTestSuites', 'numRuntimeErrorTestSuites', 'failures', 'errors'].some(key => key in data && data[key] !== 0))) throw new Error(`${label}: malformed or failed server execution report`)
  const passing = kind === 'vitest' ? passingVitestTests(report) : data?.passing
  if (typeof passing !== 'number') throw new Error(`${label}: missing executed test count`)
  requireExecutedTests(true, passing, label)
  return passing
}
/** Deliberately fail if unavailable resources leave an explicit gate unproved. */
export function requireCompleteExtras(gates: ExtraGate[]) {
  const gaps = gates.filter(gate => gate.gap)
  if (gaps.length) throw new Error(`Public proof gaps remain:\n${gaps.map(g => `${g.id}: ${g.gap}`).join('\n')}`)
}
function diskFloor() {
  const output = execFileSync('df', ['-k', '.'], { encoding: 'utf8' })
  const available = Number(output.trim().split('\n').at(-1)!.trim().split(/\s+/)[3])
  console.log(output.trim())
  if (!Number.isFinite(available) || available / 1048576 < 90) throw new Error('Public checks require at least 90 GiB available')
}
async function checkedRun(argv: string[], cwd = '.', env: Record<string, string> = {}) {
  diskFloor()
  await run(argv, cwd, env)
}
function sealReports() {
  for (const entry of readdirSync('.gate/public', { withFileTypes: true })) if (entry.isFile()) chmodSync(resolve('.gate/public', entry.name), 0o600)
}
export async function publicChecks(id = '--all') {
  const units = loadPublicParityMap()
  if (id !== '--all' && !Object.hasOwn(units, id)) throw new Error(`Unknown public mapping group: ${id}`)
  if (Bun.version !== '1.4.1') throw new Error('Public checks require Bun 1.4.1 first in child PATH')
  if (execFileSync('bun', ['--version'], { encoding: 'utf8' }).trim() !== '1.4.1') throw new Error('Child PATH must select Bun 1.4.1')
  process.umask(0o022)
  diskFloor()
  mkdirSync('.gate/public', { recursive: true, mode: 0o700 })
  chmodSync('.gate/public', 0o700)
  const summary = resolve('.gate/public/summary.json')
  rmSync(summary, { force: true })
  verifyFrozenPublicOracle(); lintBoundaries()
  for (const key of id === '--all' ? Object.keys(units) : [id]) assertCount(key)
  const evidence: { package: string; TZ: string; passing: number; report: string }[] = []
  for (const pkg of PUBLIC_PACKAGES) {
    await checkedRun(['bun', 'x', '--no-install', 'tsc', '-p', `packages/${pkg}`])
    if (!discoverTests(`packages/${pkg}`).length) throw new Error(`${pkg}: no discovered tests`)
    for (const TZ of PUBLIC_TIMEZONES) {
      const report = resolve(`.gate/public/${pkg}-${TZ.replace('/', '-')}.json`)
      rmSync(report, { force: true })
      await checkedRun(pkg === 'server' ? ['bun', 'run', 'test'] : ['bun', 'run', 'test', '--maxWorkers=1', '--reporter=json', `--outputFile=${report}`], `packages/${pkg}`, { TZ, GATE_TEST_REPORT: report, GATE_PERF: '0' })
      sealReports()
      evidence.push({ package: pkg, TZ, report, passing: requirePublicReport(readFileSync(report, 'utf8'), pkg === 'server' ? 'server' : 'vitest', pkg) })
    }
  }
  for (const TZ of PUBLIC_TIMEZONES) {
    const report = resolve(`.gate/public/foundation-${TZ.replace('/', '-')}.json`)
    rmSync(report, { force: true })
    await checkedRun(['bun', '--bun', 'vitest', 'run', '--config', 'scripts/vitest.config.ts', '--maxWorkers=1', '--reporter=json', `--outputFile=${report}`], '.', { TZ })
    sealReports()
    evidence.push({ package: 'foundation', TZ, report, passing: requirePublicReport(readFileSync(report, 'utf8'), 'vitest', 'foundation') })
  }
  const extras: { id: string; TZ?: string; status: string; gap?: string }[] = []
  for (const gate of EXTRA_GATES) {
    if (gate.gap) { extras.push({ id: gate.id, status: 'UNPROVED', gap: gate.gap }); continue }
    for (const TZ of PUBLIC_TIMEZONES) {
      await checkedRun(gate.argv, '.', { TZ })
      extras.push({ id: gate.id, TZ, status: 'PASS' })
    }
  }
  writeFileSync(summary, JSON.stringify({ status: EXTRA_GATES.some(g => g.gap) ? 'INCOMPLETE' : 'PASS', evidence, extras }, null, 2) + '\n', { mode: 0o600 })
  requireCompleteExtras(EXTRA_GATES)
  console.log('Public checks: PASS (six packages, foundation, both timezones and all explicit extras)')
}
if (import.meta.main) {
  if (process.argv[2] === '--list') console.log(JSON.stringify({ packages: PUBLIC_PACKAGES, timezones: PUBLIC_TIMEZONES, extras: EXTRA_GATES }, null, 2))
  else await publicChecks(process.argv[2] ?? '--all')
}
