import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parse } from '@babel/parser'
import { DEFERRED_INVS, GOLDEN_SCENARIOS } from './index'

const LEGACY_TEST_DIR = fileURLToPath(new URL('../../fixtures/oracle/api/test/', import.meta.url))

/**
 * Disposition of each legacy API test file. `ported:` = F2 port; `golden:` = HTTP behaviour covered by recorded
 * transcripts (named scenarios; any pure-module assertions in the file stay with the named unit); `deleted:` =
 * waiver against the contract's DELETED_ROUTES; `deferred:` = owned by a later unit, which must map the names
 * before I03 can pass. A `golden:` disposition names the scenario that exercises the file's subject; it does not
 * certify each individual test in the file. Per-name verification is I03's job.
 */
export const DISPOSITIONS: Record<string, string> = {
  'server-data-rev.test.js': 'ported:packages/parity/test/server-data-rev.test.ts',
  'server-data-rev-endpoint.test.js': 'ported:packages/parity/test/server-data-rev-endpoint.test.ts',
  'server-data-wid.test.js': 'ported:packages/parity/test/server-data-wid.test.ts',
  'server-data-reset.test.js': 'ported:packages/parity/test/server-data-reset.test.ts',
  'server-bad-input.test.js': 'golden:data-shape-precedence',
  'server-body-errors.test.js': 'golden:data-shape-precedence',
  'server-db-unreadable.test.js': 'golden:data-shape-precedence',
  'server-state-cache-bounds.test.js': 'golden:data-reset-monotone; deferred:S02 (cost bounds)',
  'server-state-read-cost.test.js': 'golden:data-reset-monotone; deferred:S02 (cost bounds)',
  'durable.test.js': 'golden:data-reset-monotone (rev cache); deferred:S02 (fsync/rename durability)',
  'server-health-writable.test.js': 'golden:routes-session (health); deferred:S02 (writable=false path)',
  'server-config-session.test.js': 'golden:routes-session; deferred:S-config (env-driven config)',
  'server-token-refresh.test.js': 'deferred:S-auth (token renewal past half-life)',
  'verify-error.test.js': 'deferred:S-auth (verify error mapping)',
  'server-url.test.js': 'deferred:S-config (ORIGIN and URL building)',
  'server-cors.test.js': 'deferred:S-middleware (CORS headers; header comparison per F2 fix)',
  'rate-limit.test.js': 'deferred:S-middleware (rate buckets)',
  'server-anon-flood.test.js': 'deferred:S-middleware (rate buckets)',
  'server-first-user-admin.test.js': 'golden:routes-admin; deferred:S-admin (FIRST_USER_ADMIN env is not in the oracle allowlist)',
  'server-admin-state.test.js': 'golden:routes-admin',
  'server-admin-delete.test.js': 'golden:routes-admin',
  'server-pairing.test.js': 'golden:routes-pairing',
  'device-link.test.js': 'golden:routes-passkey-negative (refusals); deferred:S13 (positive device link; test id placeholder S13:device-link-positive)',
  'server-passkeys.test.js': 'golden:routes-passkey-negative (refusals); deferred:S13 (positive ceremony with a software authenticator; test id placeholder S13:passkey-positive-ceremony)',
  'passkeys-store.test.js': 'deferred:S-passkeys (store unit)',
  'server-presence.test.js': 'golden:routes-push-presence (activity)',
  'server-push-status.test.js': 'golden:routes-push-presence (status); deferred:S-push',
  'server-push-device.test.js': 'deferred:S-push (device-scoped delivery; no network in goldens)',
  'server-push-filter.test.js': 'deferred:S-push (delivery filter; no network in goldens)',
  'server-push-prune-save.test.js': 'deferred:S-push (pruning on 404/410; no network in goldens)',
  'server-push-allowed-private.test.js': 'deferred:S-push (private address policy)',
  'push-messages.test.js': 'deferred:S-push (message builders, pure)',
  'server-reminder.test.js': 'deferred:S-push (reminder tick)',
  'server-nudge.test.js': 'deferred:S-push (nudge)',
  'nudge.test.js': 'deferred:S-push (nudge, pure)',
  'nudge-copy.test.js': 'deferred:S-push (nudge copy, pure)',
  'server-media.test.js': 'deleted:waiver (GM media deletion; routes-media answers 404)',
  'media-damaged.test.js': 'deleted:waiver (GM media deletion; routes-media answers 404)',
  'media-gc.test.js': 'deleted:waiver (GM media deletion; routes-media answers 404)',
  'media-receive.test.js': 'deleted:waiver (GM media deletion; routes-media answers 404)',
  'media-refs.test.js': 'deleted:waiver (GM media deletion; routes-media answers 404)',
  'media-sniff.test.js': 'deleted:waiver (GM media deletion; routes-media answers 404)',
  'sync-stamps.test.js': 'deferred:K17 (pure stamping module port; F2 mapping)',
  'programme-sync.test.js': 'golden:programmes-*; deferred:K17/P-units (pure merge functions)',
  'programme-fix1.test.js': 'golden:programmes-*; deferred:K17/P-units (pure functions)',
  'programme-fix2.test.js': 'golden:programmes-*; deferred:K17/P-units (pure functions)',
  'programme-targets-compat.test.js': 'golden:programmes-restore-fields; deferred:K17/P-units (pure functions)',
  'programme-queue.test.js': 'deferred:core-queue (queue module)',
  'queue.test.js': 'deferred:core-queue (queue module)',
  'openapi-routes.test.js': 'deferred:I01 (openapi.yaml against the route table)',
  'dockerfile-copy.test.js': 'deferred:I-ops (Docker build inputs; not API behaviour)',
  'server-email.test.js': 'deleted:waiver (POST/DELETE /api/account/email removed; routes-deleted answers 404)',
  'server-password.test.js': 'deleted:waiver (password login removed; routes-deleted answers 404)',
  'password.test.js': 'deleted:waiver (password login removed)'
}

export interface LegacyTestName { file: string; name: string }

const UNKNOWN = Symbol('not a finite constant')
type Scope = Map<string, unknown>
type Program = ReturnType<typeof parse>['program']
type Statement = Program['body'][number]
type VariableDeclarator = Extract<Statement, { type: 'VariableDeclaration' }>['declarations'][number]
type LVal = VariableDeclarator['id']
type Expression = NonNullable<VariableDeclarator['init']>
type Node = Program | Statement | LVal | Expression

/** Evaluate only finite data used in registered titles; never execute a legacy test or its setup. */
function finite(input: unknown, scope: Scope): unknown {
  if (!input) return UNKNOWN
  const node = input as Node
  switch (node.type) {
    case 'StringLiteral': case 'NumericLiteral': case 'BooleanLiteral': return node.value
    case 'NullLiteral': return null
    case 'Identifier': return scope.has(node.name) ? scope.get(node.name) : UNKNOWN
    case 'ArrayExpression': return node.elements.map(e => finite(e, scope))
    case 'ObjectExpression': {
      const value: Record<string, unknown> = {}
      for (const p of node.properties) {
        if (p.type !== 'ObjectProperty' || p.computed) return UNKNOWN
        const key = p.key.type === 'Identifier' ? p.key.name : finite(p.key, scope)
        if (typeof key !== 'string' && typeof key !== 'number') return UNKNOWN
        value[key] = finite(p.value, scope)
      }
      return value
    }
    case 'MemberExpression': {
      const object = finite(node.object, scope)
      const key = node.computed ? finite(node.property, scope) : node.property.type === 'Identifier' ? node.property.name : UNKNOWN
      return object && typeof object === 'object' && (typeof key === 'string' || typeof key === 'number') ? (object as Record<string, unknown>)[key] : UNKNOWN
    }
    case 'ConditionalExpression': {
      const test = finite(node.test, scope)
      return test === UNKNOWN ? UNKNOWN : finite(test ? node.consequent : node.alternate, scope)
    }
    case 'TemplateLiteral': {
      let text = node.quasis[0]!.value.cooked ?? node.quasis[0]!.value.raw
      for (const [i, expression] of node.expressions.entries()) {
        const value = finite(expression, scope)
        if (value === UNKNOWN || (value !== null && typeof value === 'object')) return UNKNOWN
        text += String(value) + (node.quasis[i + 1]!.value.cooked ?? node.quasis[i + 1]!.value.raw)
      }
      return text
    }
    case 'CallExpression': {
      const callee = node.callee
      if (callee.type === 'MemberExpression' && callee.object.type === 'Identifier' && callee.object.name === 'Object' && callee.property.type === 'Identifier') {
        const value = finite(node.arguments[0], scope)
        if (!value || typeof value !== 'object') return UNKNOWN
        if (callee.property.name === 'entries') return Object.entries(value)
        if (callee.property.name === 'keys') return Object.keys(value)
        if (callee.property.name === 'values') return Object.values(value)
      }
      return UNKNOWN
    }
    default: return UNKNOWN
  }
}

function bind(pattern: LVal, value: unknown, scope: Scope): void {
  if (pattern.type === 'Identifier') scope.set(pattern.name, value)
  else if (pattern.type === 'ArrayPattern') pattern.elements.forEach((p, i) => { if (p) bind(p as LVal, Array.isArray(value) ? value[i] : UNKNOWN, scope) })
  else if (pattern.type === 'ObjectPattern') for (const p of pattern.properties) {
    if (p.type === 'ObjectProperty' && p.key.type === 'Identifier') bind(p.value as LVal, value && typeof value === 'object' ? (value as Record<string, unknown>)[p.key.name] : UNKNOWN, scope)
  }
}

/** Unknown syntax containing a registration must never silently disappear from the map. */
function rejectWrappedRegistration(input: unknown): void {
  if (!input || typeof input !== 'object') return
  if (Array.isArray(input)) { input.forEach(rejectWrappedRegistration); return }
  const node = input as { type?: string; name?: string; callee?: unknown; loc?: { start: { line: number } }; [key: string]: unknown }
  if (node.type === 'CallExpression' || node.type === 'OptionalCallExpression') {
    const directCallee = node.callee as typeof node | undefined
    if (directCallee?.type === 'MemberExpression' && (directCallee.object as typeof node)?.type === 'Identifier' && (directCallee.object as typeof node).name === 'test' && !directCallee.computed && (directCallee.property as typeof node)?.type === 'Identifier' && ['before', 'after', 'beforeEach', 'afterEach'].includes((directCallee.property as typeof node).name ?? '')) {
      rejectWrappedRegistration(node.arguments)
      return
    }
    let callee = directCallee
    while (callee?.type === 'MemberExpression' || callee?.type === 'OptionalMemberExpression') callee = callee.object as typeof node
    if (callee?.type === 'Identifier' && ['test', 'it', 'describe'].includes(callee.name ?? '')) throw new Error(`api-test-map: unrecognised wrapped registration at line ${node.loc?.start.line}`)
  }
  for (const [key, value] of Object.entries(node)) if (key !== 'loc') rejectWrappedRegistration(value)
}

/** Expand finite for-of products and template titles; unresolved registered titles fail closed. */
export function registeredTestNames(source: string, constants: Record<string, unknown> = {}): string[] {
  const names: string[] = []
  const root = new Map(Object.entries(constants))
  const visit = (node: Node, scope: Scope): void => {
    if (node.type === 'Program' || node.type === 'BlockStatement') {
      const local = new Map(scope)
      for (const statement of node.body) visit(statement, local)
      return
    }
    if (node.type === 'VariableDeclaration') {
      for (const d of node.declarations) {
        rejectWrappedRegistration(d.id)
        rejectWrappedRegistration(d.init)
        // Fixture-backed bindings are supplied from their source JSON rather than evaluated I/O.
        if (d.id.type === 'Identifier' && root.has(d.id.name)) continue
        if (d.id.type === 'ObjectPattern' && d.id.properties.some(p => p.type === 'ObjectProperty' && p.value.type === 'Identifier' && root.has(p.value.name))) continue
        bind(d.id, finite(d.init, scope), scope)
      }
      return
    }
    if (node.type === 'ForOfStatement') {
      rejectWrappedRegistration(node.left)
      rejectWrappedRegistration(node.right)
      const values = finite(node.right, scope)
      if (!Array.isArray(values) || node.left.type !== 'VariableDeclaration') throw new Error('api-test-map: loop is not a finite for-of')
      for (const value of values) {
        const local = new Map(scope)
        bind(node.left.declarations[0]!.id, value, local)
        visit(node.body, local)
      }
      return
    }
    if (node.type === 'CallExpression' && node.callee.type === 'Identifier') {
      if (node.callee.name === 'test' || node.callee.name === 'it') {
        // Argument expressions execute while registering. Nested registrations,
        // including ones in callbacks we do not enumerate, must fail closed.
        for (const arg of node.arguments) rejectWrappedRegistration(arg)
        const title = finite(node.arguments[0], scope)
        if (typeof title !== 'string') throw new Error(`api-test-map: unresolved title at line ${node.loc?.start.line}`)
        names.push(title)
        return // Test callbacks are checked for hidden registrations, never executed.
      }
      if (node.callee.name === 'describe') {
        let callbacks = 0
        for (const arg of node.arguments) {
          if (arg.type === 'ArrowFunctionExpression' || arg.type === 'FunctionExpression') {
            callbacks++
            rejectWrappedRegistration(arg.params)
            visit(arg.body, new Map(scope))
          } else rejectWrappedRegistration(arg)
        }
        if (callbacks !== 1) throw new Error(`api-test-map: unrecognised describe callback at line ${node.loc?.start.line}`)
        return
      }
    }
    if (node.type === 'ExpressionStatement') { visit(node.expression, scope); return }
    if (node.type === 'ExportNamedDeclaration' && node.declaration) { visit(node.declaration, scope); return }
    rejectWrappedRegistration(node)
  }
  visit(parse(source, { sourceType: 'module' }).program, root)
  return names
}

/** Every registered `test`/`it` title, including finite loop cases, in file order. */
export function legacyTestNames(): LegacyTestName[] {
  const out: LegacyTestName[] = []
  for (const file of readdirSync(LEGACY_TEST_DIR).filter(f => f.endsWith('.test.js')).sort()) {
    const source = readFileSync(`${LEGACY_TEST_DIR}${file}`, 'utf8')
    const constants: Record<string, unknown> = {}
    if (file === 'media-refs.test.js') constants.cases = JSON.parse(readFileSync(`${LEGACY_TEST_DIR}fixtures/media-refs.json`, 'utf8')).referencedHashes
    // Resolve imported literal constants from their module AST (e.g. MAX_PASSKEYS), without running it.
    for (const node of parse(source, { sourceType: 'module' }).program.body) if (node.type === 'ImportDeclaration' && node.source.value.startsWith('.')) {
      const imported = parse(readFileSync(new URL(node.source.value, `file://${LEGACY_TEST_DIR}${file}`), 'utf8'), { sourceType: 'module' })
      const declarations = imported.program.body.flatMap(n => n.type === 'ExportNamedDeclaration' && n.declaration?.type === 'VariableDeclaration' ? n.declaration.declarations : [])
      for (const spec of node.specifiers) if (spec.type === 'ImportSpecifier') {
        const name = spec.imported.type === 'Identifier' ? spec.imported.name : spec.imported.value
        const d = declarations.find((d: VariableDeclarator) => d.id.type === 'Identifier' && d.id.name === name)
        const value = finite(d?.init as Expression | undefined, new Map())
        if (value !== UNKNOWN) constants[spec.local.name] = value
      }
    }
    for (const name of registeredTestNames(source, constants)) out.push({ file, name })
  }
  return out
}

/**
 * Single owner for every client-only INV: the client unit whose differential test must cover it. Test ids are
 * placeholders until the owning unit lands its tests.
 */
export const CLIENT_INV_OWNERS: Record<number, { owner: string; testId: string }> = {
  19: { owner: 'K10 client sync', testId: 'K10:inv-19-tie-break' },
  22: { owner: 'K10 client sync', testId: 'K10:inv-22-added-back' },
  23: { owner: 'K10 client sync', testId: 'K10:inv-23-causal-lift' },
  24: { owner: 'K10 client sync', testId: 'K10:inv-24-entry-merge' },
  25: { owner: 'K10 client sync', testId: 'K10:inv-25-undo-markers' },
  26: { owner: 'K10 client sync', testId: 'K10:inv-26-stamped-maps' },
  27: { owner: 'K10 client sync', testId: 'K10:inv-27-settings-plan-days' },
  28: { owner: 'K10 client sync', testId: 'K10:inv-28-routine-order' },
  29: { owner: 'K10 client sync', testId: 'K10:inv-29-weigh-ins' },
  30: { owner: 'K10 client sync', testId: 'K10:inv-30-exweights' },
  31: { owner: 'K10 client sync (deleted media waiver)', testId: 'waiver:INV-31-media-deleted' },
  32: { owner: 'K10 client sync', testId: 'K10:inv-32-units' },
  33: { owner: 'K10 client sync', testId: 'K10:inv-33-reset-merge' },
  34: { owner: 'K10 client sync', testId: 'K10:inv-34-merge-states-purity' },
  35: { owner: 'K10 client sync', testId: 'K10:inv-35-accent-sanitise' },
  50: { owner: 'K04 programme client copy', testId: 'K04:inv-50-source-identity' },
  51: { owner: 'W07 sync engine', testId: 'W07:inv-51-tab-base-rev' },
  53: { owner: 'W07 sync engine', testId: 'W07:inv-53-forced-replace' },
  54: { owner: 'W07 sync engine', testId: 'W07:inv-54-one-put-in-flight' },
  55: { owner: 'W07 sync engine', testId: 'W07:inv-55-rewind-merge' },
  56: { owner: 'W07 sync engine', testId: 'W07:inv-56-adopt-only-when-clean' },
  57: { owner: 'W07 sync engine', testId: 'W07:inv-57-non-json-2xx' },
  58: { owner: 'W07 sync engine', testId: 'W07:inv-58-sign-in-hold' },
  59: { owner: 'W07 sync engine', testId: 'W07:inv-59-sign-in-prefer' },
  60: { owner: 'W07 sync engine', testId: 'W07:inv-60-sign-out-stash' },
  61: { owner: 'W07 sync engine', testId: 'W07:inv-61-storage-full' },
  62: { owner: 'W07 sync engine', testId: 'W07:inv-62-tabs-join' },
  63: { owner: 'K10 client sync (sync-legacy)', testId: 'K10:inv-63-legacy-fingerprint' },
  64: { owner: 'K10 client sync (stampReplace)', testId: 'K10:inv-64-backup-restore' }
}

/** Every INV-1..64 with exactly one owner: the golden scenarios that exercise it, or its client unit. */
export function invOwnerRows(): { inv: number; owner: string; testId: string }[] {
  const wire = new Map<number, string[]>()
  for (const scenario of GOLDEN_SCENARIOS) for (const inv of scenario.invs) wire.set(inv, [...(wire.get(inv) ?? []), scenario.id])
  return Array.from({ length: 64 }, (_, i) => i + 1).map(inv => {
    const scenarios = wire.get(inv)
    if (scenarios && inv in CLIENT_INV_OWNERS) throw new Error(`INV-${inv} has two owners`)
    if (scenarios) return { inv, owner: `F3 golden: ${scenarios.join(', ')}`, testId: `golden:${scenarios[0]}` }
    const client = CLIENT_INV_OWNERS[inv]
    if (!client || !(inv in DEFERRED_INVS)) throw new Error(`INV-${inv} has no owner`)
    return { inv, owner: client.owner, testId: client.testId }
  })
}

const cell = (text: string) => text.replace(/\|/g, '\\|')

/** The committed api-test-map.md, rendered from the legacy names and the disposition table. */
export function renderApiTestMap(): string {
  const names = legacyTestNames()
  const files = new Set(names.map(n => n.file))
  const unknown = [...files].filter(f => !(f in DISPOSITIONS))
  if (unknown.length) throw new Error(`api-test-map: no disposition for ${unknown.join(', ')}`)
  const rows = names.map(n => `| ${cell(n.file)} | ${cell(n.name)} | ${cell(DISPOSITIONS[n.file]!)} |`)
  return [
    '# Legacy API test map (F3)',
    '',
    'Generated by `packages/parity/src/golden/api-test-map.ts` from `legacy/api/test/*.test.js`; the drift check in',
    '`packages/parity/test/golden.test.ts` fails if this file is stale. Every legacy test name appears once, with its',
    'disposition. A `golden:` entry names the scenario that exercises the file\'s subject, not each test in it; per-name',
    'verification and finer targets are I03\'s job. Pure-module assertions are deferred to their named unit.',
    '',
    `Legacy test names: ${names.length} in ${files.size} files.`,
    '',
    '| Legacy file | Test name | Disposition |',
    '| --- | --- | --- |',
    ...rows,
    '',
    '## INV-1..64 owners',
    '',
    'Each invariant has exactly one owner: an F3 golden scenario for wire-observable behaviour, or the client unit whose',
    'differential test covers the algorithm. Test ids in the client rows are placeholders until the owning unit lands them.',
    '',
    '| INV | Owner | Test id |',
    '| --- | --- | --- |',
    ...invOwnerRows().map(r => `| INV-${r.inv} | ${cell(r.owner)} | ${cell(r.testId)} |`),
    '',
    '## Waivers',
    '',
    '- Passkey positive ceremony (`server-passkeys.test.js`, `device-link.test.js` success paths): waived to S13, the auth',
    '  unit that already owns transcripts with a software authenticator. Replay needs derived requests, a cross-unit change',
    '  to the transcript format, so it is not built in F3. Test ids: `S13:passkey-positive-ceremony`, `S13:device-link-positive`.',
    ''
  ].join('\n')
}
