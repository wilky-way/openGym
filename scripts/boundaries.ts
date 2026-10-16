import { createHash } from 'node:crypto'
import { readFileSync, realpathSync, readdirSync, lstatSync } from 'node:fs'
import { dirname, resolve, relative, sep } from 'node:path'
import { builtinModules, createRequire } from 'node:module'
import { parse } from '@babel/parser'
import { files } from './files'
import { resolvePackageImports, importSpecifiers } from './resolution'
import { exerciseIndexErrors } from './exercise-index'
type Node = { type?: string; name?: string; value?: unknown; loc?: { start: { line: number } }; [key: string]: unknown }
// Only these public tooling tests may import their own checker entry points.
// Production and other test origins retain the ordinary inert-root prohibition.
const checkerEntries: Record<string, readonly string[]> = {
  'packages/parity/test/public-oracle.test.ts': ['scripts/verify-public-oracle.ts'],
  'packages/parity/test/public-assertion-budget.test.ts': ['scripts/assertion-budget.ts', 'scripts/assert-count.ts'],
  'packages/parity/test/public-checks.test.ts': ['scripts/public-checks.ts', 'scripts/test-execution.ts'],
}
const checkerHelpers = new Set([
  'scripts/assertion-budget.ts', 'scripts/assert-count.ts', 'scripts/public-checks.ts',
  'scripts/verify-public-oracle.ts', 'scripts/files.ts', 'scripts/test-discovery.ts',
  'scripts/test-execution.ts', 'scripts/boundaries.ts', 'scripts/resolution.ts', 'scripts/exercise-index.ts',
])
const checkerDependencies = new Set(['vitest', '@babel/parser', 'saxes'])
const checkerDependencyRoots = new Map<string, string>()
const requireCheckerDependency = createRequire(import.meta.url)
function checkerDependency(specifier: string, target: string, importer: string): boolean {
  if (!checkerDependencies.has(specifier)) return false
  let directory = checkerDependencyRoots.get(specifier)
  if (!directory) {
    // Normal package resolution is independent of each project's TS alias map.
    const manifest = realpathSync(requireCheckerDependency.resolve(`${specifier}/package.json`))
    if ((JSON.parse(readFileSync(manifest, 'utf8')) as { name?: unknown }).name !== specifier) throw new Error(`Unexpected checker dependency identity: ${specifier}`)
    directory = dirname(manifest)
    checkerDependencyRoots.set(specifier, directory)
  }
  const canonicalTarget = realpathSync(target)
  // One full third-party declaration correction, not a general TS-alias privilege.
  const saxesDeclaration = resolve('packages/parity/types/saxes-6.0.0.d.ts')
  if (specifier === 'saxes' && importer === 'scripts/test-execution.ts' && canonicalTarget === saxesDeclaration) {
    const stat = lstatSync(saxesDeclaration)
    const manifest = JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8')) as { version?: unknown }
    const runtime = realpathSync(requireCheckerDependency.resolve('saxes'))
    return stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1
      && createHash('sha256').update(readFileSync(saxesDeclaration)).digest('hex') === '605e9d181993f79948547950d405812194981190af1c925dc48964b3a31c4fb0'
      && manifest.version === '6.0.0' && runtime.startsWith(directory + sep)
      && createHash('sha256').update(readFileSync(runtime)).digest('hex') === 'd00e2ba27ed7d6ac961d03ff14d6b8c0eb5bf063ed2c996c22c6df06ac121423'
  }
  return canonicalTarget.startsWith(directory + sep)
}
function directCheckerImport(origin: string, target: string): boolean {
  return checkerEntries[origin]?.includes(target.endsWith('.ts') ? target : `${target}.ts`) ?? false
}
function checkerEdge(origin: string, importer: string, target: string): boolean {
  if (!Object.hasOwn(checkerEntries, origin)) return false
  if (importer === origin) return checkerEntries[origin]!.includes(target)
  return checkerHelpers.has(importer) && checkerHelpers.has(target)
}
function walk(value: unknown, visit: (n: Node, parent?: Node, typeSpace?: boolean) => void, parent?: Node, typeSpace = false) {
  if (Array.isArray(value)) { for (const v of value) walk(v, visit, parent, typeSpace); return }
  if (!value || typeof value !== 'object') return
  const n = value as Node
  const runtimeTS = ['TSAsExpression', 'TSSatisfiesExpression', 'TSNonNullExpression', 'TSTypeAssertion', 'TSInstantiationExpression', 'TSParameterProperty', 'TSEnumDeclaration', 'TSEnumBody', 'TSEnumMember', 'TSModuleDeclaration', 'TSModuleBlock', 'TSExportAssignment', 'TSImportEqualsDeclaration']
  const inTypeSpace = typeSpace || !!n.type?.startsWith('TS') && !runtimeTS.includes(n.type)
  if (n.type) visit(n, parent, inTypeSpace)
  for (const [key, v] of Object.entries(n)) if (!['loc', 'start', 'end', 'comments', 'tokens'].includes(key)) walk(v, visit, n.type ? n : parent, inTypeSpace)
}
export function boundaryErrors(file: string, text: string, platformPolicy?: 'core' | 'web'): string[] {
  const errors: string[] = [], core = file.startsWith('packages/core/'), server = file.startsWith('packages/server/')
  const test = /(?:\.test\.tsx?$|\/test\/|\/vitest\.config\.ts$)/.test(file)
  const serviceWorker = file === 'packages/web/public/sw.js'
  const workerRoot = (node: Node) => node?.type === 'Identifier' && node.name === 'self'
  const web = platformPolicy === 'web' || file.startsWith('packages/web/') && !file.startsWith('packages/web/src/platform/') && !test
  const pure = platformPolicy === 'core' || core && !test
  const productionSource = !test && /^packages\/[^/]+\/src\//.test(file)
  const allowedLegacy = file.startsWith('packages/parity/') || /\.diff\.test\.tsx?$/.test(file)
  const ast = parse(text, { sourceType: 'unambiguous', allowUndeclaredExports: true, plugins: [['typescript', { dts: file.endsWith('.d.ts') }], 'jsx'] })
  errors.push(...exerciseIndexErrors(file, text, ast))
  let localIdentifiers: Set<number> | undefined
  const locallyBound = (node: Node | undefined) => {
    if (!node) return false
    localIdentifiers ??= localBindingPositions(ast)
    return localIdentifiers.has(node.start as number)
  }
  const report = (n: Node, why: string) => errors.push(`${file}:${n.loc?.start.line ?? 0}: ${why}`)
  const source = (n: Node, s: unknown) => {
    if (typeof s !== 'string') { report(n, 'non-literal import specifier is forbidden'); return }
    const target = (s.startsWith('.') || s.startsWith('/')) ? relative('.', resolve(file, '..', s)) : s
    if (!test && target === 'packages/web/public/sw.js' && !serviceWorker) report(n, 'application imports browser service-worker entry; worker privileges are entry-only')
    if (/(?:^|\/)loose(?:\.[cm]?[jt]sx?)?$/.test(target)) report(n, 'temporary loose shim must remain unused; correct the contract instead')
    const discoveryConfig = file.endsWith('/vitest.config.ts') && target === 'scripts/test-discovery'
    const publicCheckerImport = directCheckerImport(file, target)
    if (/^(?:frontend|api|mcp|web|scripts|catalogue)\//.test(target) && !discoveryConfig && !publicCheckerImport) report(n, 'package imports inert root tree')
    if ((/(?:^|\/)legacy(?:\/|$)/.test(target) || target.startsWith('packages/parity/fixtures/oracle/')) && !allowedLegacy) report(n, 'legacy import outside differential/parity tests')
    if (/(?:@capacitor\/|(?:^|\/)(?:coach[^/]*|Coach[^/]*|AdminCoach|native)(?:\/|\.|$))/.test(s)) report(n, 'retired Coach/native import')
    if (pure && (builtinModules.some(m => s === m || s.startsWith(`${m}/`)) || /^packages\/(?:server|web|mcp|parity)\//.test(target))) report(n, 'core imports platform/runtime code')
    if (pure && /^(?:react(?:-dom)?(?:\/|$)|node:|bun:|fs$|path$|https?$|@opengym\/(?:server|web|mcp|parity)(?:\/|$))/.test(s)) report(n, 'core imports platform/runtime code')
    if (!test && !file.startsWith('packages/parity/') && /(?:^|\/)test(?:\/|$)/.test(target)) report(n, 'production imports a test-only module')
  }
  walk(ast, (n, parent, typeSpace) => {
    if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(n.type ?? '') && n.source) source(n, (n.source as Node)?.value)
    if (n.type === 'ImportExpression') source(n, (n.source as Node)?.value)
    if (n.type === 'CallExpression' && ['Import', 'Identifier'].includes((n.callee as Node)?.type ?? '')) {
      const callee = n.callee as Node
      if (callee.type === 'Import' || callee.name === 'require') source(n, (n.arguments as Node[])?.[0]?.value)
    }
    if (n.type === 'TSImportType') source(n, ((n.source ?? n.argument) as Node)?.value)
    if (n.type === 'TSExternalModuleReference') source(n, (n.expression as Node)?.value)
    if (n.type === 'TSAnyKeyword' && (core || server) && !test && !text.split('\n')[(n.loc?.start.line ?? 1) - 1]?.includes('legacy-shape:')) report(n, 'any requires a legacy-shape justification')
    const domGlobals = ['window', 'document', 'navigator', 'globalThis', 'self', 'parent', 'top', 'frames', 'opener', 'location', 'history', 'crypto', 'screen', 'Audio', 'AudioContext', 'webkitAudioContext', 'Image', 'Notification', 'PushManager', 'PublicKeyCredential', 'FileReader', 'DOMParser', 'Worker', 'SharedWorker', 'BroadcastChannel', 'caches', 'customElements', 'visualViewport', 'matchMedia', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback', 'ResizeObserver', 'IntersectionObserver', 'MutationObserver', 'addEventListener', 'removeEventListener', 'dispatchEvent', 'innerHeight', 'innerWidth', 'scrollX', 'scrollY', 'devicePixelRatio']
    const platformNames = ['fetch', 'localStorage', 'sessionStorage', 'indexedDB', 'serviceWorker', ...domGlobals]
    const binding = n.type === 'VariableDeclarator' ? n.id as Node : n.type === 'AssignmentExpression' ? n.left as Node : undefined
    const value = n.type === 'VariableDeclarator' ? n.init as Node : n.type === 'AssignmentExpression' ? n.right as Node : undefined
    if (!typeSpace && (pure || productionSource) && binding?.type === 'ObjectPattern') {
      walk(binding, property => {
        if (property.type !== 'ObjectProperty') return
        const key = property.key as Node
        const name = property.computed ? staticString(key) : key?.name ?? staticString(key)
        if (name === 'require') report(n, 'non-direct require is forbidden')
        if (['eval', 'Function'].includes(name ?? '')) report(n, 'dynamic code evaluation is forbidden')
      })
    }
    // Reject capturing a global root, so aliases cannot hide later platform access.
    if (!typeSpace && web && binding && platformRoot(value as Node, locallyBound) && unwrapExpression(value)?.type === 'Identifier') report(n, 'aliased platform global must use Platform')
    if ((pure || web) && binding?.type === 'ObjectPattern' && platformRoot(value as Node, locallyBound)) {
      walk(binding, property => {
        if (property.type === 'RestElement') report(n, 'destructured platform API access')
        if (property.type !== 'ObjectProperty') return
        const key = property.key as Node
        const name = property.computed ? staticString(key) : key?.name ?? staticString(key)
        if (platformNames.includes(name ?? '') || (property.computed && name === undefined)) report(n, 'destructured platform API access')
      })
    }
    if (!typeSpace && ['MemberExpression', 'OptionalMemberExpression'].includes(n.type ?? '')) {
      const name = n.computed ? staticString(n.property as Node) : (n.property as Node)?.name
      if ((pure || productionSource) && ['require', 'eval', 'Function'].includes(name ?? '')) report(n, 'indirect loader or dynamic code is forbidden')
      if (web && !(serviceWorker && workerRoot(n.object as Node) && ['location','addEventListener','clients','registration'].includes(name??'')) && platformRoot(n.object as Node, locallyBound) && [...platformNames, 'XMLHttpRequest', 'WebSocket'].includes(name ?? '')) report(n, 'web must use Platform')
    }
    if (!typeSpace && web && ['CallExpression', 'OptionalCallExpression'].includes(n.type ?? '')) {
      const callee = unwrapExpression(n.callee as Node)
      if (['MemberExpression', 'OptionalMemberExpression'].includes(callee?.type ?? '') && (callee?.object as Node)?.name === 'Reflect' && (callee?.computed ? staticString(callee.property as Node) : (callee?.property as Node)?.name) === 'get') {
        const args = n.arguments as Node[]
        const property = staticString(args[1])
        if (platformRoot(args[0] as Node, locallyBound) && (property === undefined || [...platformNames, 'XMLHttpRequest', 'WebSocket'].includes(property))) report(n, 'reflective platform API access must use Platform')
      }
    }
    if (!typeSpace && ['MemberExpression', 'OptionalMemberExpression'].includes(n.type ?? '') && n.computed) {
      const property = staticString(n.property as Node)
      const adapterFetch = web && property === 'fetch' && platformTransport(n.object as Node)
      const globalObject = platformRoot(n.object as Node, locallyBound)
      const platformProperty = platformNames.includes(property ?? '') && (!domGlobals.includes(property ?? '') || globalObject)
      if ((pure || web) && !adapterFetch && (platformProperty || (property === undefined && globalObject))) report(n, 'computed platform API access')
    }
    if (n.type !== 'Identifier' || typeSpace) return
    if (['MemberExpression', 'OptionalMemberExpression'].includes(parent?.type ?? '') && parent?.property === n && !parent.computed) {
      if (web && n.name === 'fetch' && !platformTransport(parent.object as Node)) report(n, 'web must use Platform transport')
      return
    }
    // Property keys and import/export names are data, not platform access.
    if (['ImportSpecifier', 'ImportDefaultSpecifier', 'ImportNamespaceSpecifier', 'ExportSpecifier'].includes(parent?.type ?? '')) return
    if (['ObjectProperty', 'ObjectMethod', 'ClassMethod', 'ClassProperty', 'ClassAccessorProperty'].includes(parent?.type ?? '') && parent?.key === n && !parent.computed && !parent.shorthand) return
    if (parent?.type === 'ObjectProperty' && parent.key === n && !parent.computed && !parent.shorthand) return
    if (['TSMethodSignature', 'TSPropertySignature', 'ObjectMethod', 'ClassMethod', 'ClassProperty'].includes(parent?.type ?? '') && parent?.key === n && !parent.computed) return
    if (web && n.name === 'fetch' && ['MemberExpression', 'OptionalMemberExpression'].includes(parent?.type ?? '') && parent?.property === n && !parent.computed && platformTransport(parent.object as Node)) return
    if ((pure || productionSource) && ['eval', 'Function'].includes(n.name ?? '')) report(n, 'dynamic code evaluation is forbidden')
    if ((pure || productionSource) && n.name === 'require' && !(parent?.type === 'CallExpression' && parent.callee === n && !parent.optional)) report(n, 'non-direct require is forbidden')
    if (pure && ['window', 'document', 'navigator', 'self', 'globalThis', 'process', 'Bun', 'Deno', 'localStorage', 'sessionStorage', 'indexedDB', 'fetch', 'XMLHttpRequest', 'WebSocket'].includes(n.name ?? '')) report(n, 'core uses a platform API')
    if (web && !(serviceWorker && n.name === 'fetch') && ['localStorage', 'sessionStorage', 'indexedDB', 'fetch', 'XMLHttpRequest', 'WebSocket', 'serviceWorker'].includes(n.name ?? '') && !locallyBound(n)) report(n, 'web must use Platform')
    if (web && !(serviceWorker && ['self','location','caches'].includes(n.name??'')) && domGlobals.includes(n.name ?? '')) {
      const property = ['MemberExpression', 'OptionalMemberExpression'].includes(parent?.type ?? '') && parent?.property === n && !parent.computed
      if (!property && !locallyBound(n)) report(n, 'web DOM globals belong in src/platform/')
    }
  })
  return errors
}
/** Track lexical bindings; domain variables named history are not browser globals. */
function localBindingPositions(ast: unknown): Set<number> {
  type Scope = { parent?: Scope; names: Set<string>; functionScope?: Scope }
  const root: Scope = { names: new Set() }, entries: { node: Node; parent?: Node; scope: Scope }[] = []
  root.functionScope = root
  function bind(pattern: Node | undefined, scope: Scope) {
    if (!pattern) return
    if (pattern.type === 'Identifier') { scope.names.add(pattern.name!); return }
    if (pattern.type === 'RestElement') bind(pattern.argument as Node, scope)
    if (pattern.type === 'AssignmentPattern') bind(pattern.left as Node, scope)
    if (pattern.type === 'TSParameterProperty') bind(pattern.parameter as Node, scope)
    if (pattern.type === 'ArrayPattern') for (const element of pattern.elements as Node[]) bind(element, scope)
    if (pattern.type === 'ObjectPattern') for (const property of pattern.properties as Node[]) bind((property.type === 'RestElement' ? property.argument : property.value) as Node, scope)
  }
  function collect(value: unknown, scope: Scope, parent?: Node) {
    if (Array.isArray(value)) { for (const item of value) collect(item, scope, parent); return }
    if (!value || typeof value !== 'object') return
    const node = value as Node
    const outer = scope
    const fn = ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'ObjectMethod', 'ClassMethod', 'ClassPrivateMethod'].includes(node.type ?? '')
    if (['FunctionDeclaration', 'ClassDeclaration'].includes(node.type ?? '') && !node.declare) bind(node.id as Node, scope)
    if (fn || ['Program', 'BlockStatement', 'CatchClause', 'ForStatement', 'ForInStatement', 'ForOfStatement', 'SwitchStatement', 'ClassExpression', 'ClassBody', 'TSModuleBlock'].includes(node.type ?? '')) {
      const next: Scope = { parent: scope, names: new Set(), functionScope: scope.functionScope }
      if (fn || node.type === 'Program') next.functionScope = next
      // Body vars must not shadow globals read by default parameter initializers.
      if (node.type === 'BlockStatement' && ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'ObjectMethod', 'ClassMethod', 'ClassPrivateMethod'].includes(parent?.type ?? '')) next.functionScope = next
      scope = next
    }
    if (fn) { bind(node.id as Node, scope); for (const param of (node.params as Node[] ?? [])) bind(param, scope) }
    if (node.type === 'ClassExpression') bind(node.id as Node, scope)
    if (node.type === 'CatchClause') bind(node.param as Node, scope)
    if (node.type === 'VariableDeclarator' && !parent?.declare) bind(node.id as Node, parent?.kind === 'var' ? scope.functionScope! : scope)
    if (node.type === 'ImportDeclaration' && node.importKind !== 'type') for (const specifier of node.specifiers as Node[]) {
      if (specifier.importKind !== 'type') bind(specifier.local as Node, scope)
    }
    if (node.type) entries.push({ node, parent, scope })
    for (const [key, child] of Object.entries(node)) if (!['loc', 'start', 'end', 'comments', 'tokens'].includes(key)) collect(child, node.type === 'SwitchStatement' && key === 'discriminant' ? outer : scope, node.type ? node : parent)
  }
  collect(ast, root)
  const positions = new Set<number>()
  for (const { node, parent, scope } of entries) {
    if (node.type !== 'Identifier') continue
    if (['MemberExpression', 'OptionalMemberExpression'].includes(parent?.type ?? '') && parent?.property === node && !parent.computed) continue
    if (parent?.type === 'ObjectProperty' && parent.key === node && !parent.shorthand) continue
    for (let current: Scope | undefined = scope; current; current = current.parent) {
      if (current.names.has(node.name!)) { positions.add(node.start as number); break }
    }
  }
  return positions
}
/** Allow only the contract transport, never arbitrary .fetch properties or global aliases. */
function platformTransport(node: Node): boolean {
  if (!['MemberExpression', 'OptionalMemberExpression'].includes(node?.type ?? '')) return false
  const name = node.computed ? staticString(node.property as Node) : (node.property as Node)?.name
  return name === 'transport' && (node.object as Node)?.type === 'Identifier' && (node.object as Node)?.name === 'platform'
}
function platformRoot(node: Node, isLocal: (node: Node) => boolean): boolean {
  if (node?.type === 'Identifier') return ['window', 'globalThis', 'navigator', 'document', 'self', 'parent', 'top', 'frames', 'opener'].includes(node.name ?? '') && !isLocal(node)
  if (['TSAsExpression', 'TSSatisfiesExpression', 'TSNonNullExpression', 'TSTypeAssertion', 'TSInstantiationExpression', 'ParenthesizedExpression'].includes(node?.type ?? '')) return platformRoot(node.expression as Node, isLocal)
  return ['MemberExpression', 'OptionalMemberExpression'].includes(node?.type ?? '') && platformRoot(node.object as Node, isLocal)
}
function unwrapExpression(node: Node | undefined): Node | undefined {
  if (['TSAsExpression', 'TSSatisfiesExpression', 'TSNonNullExpression', 'TSTypeAssertion', 'TSInstantiationExpression', 'ParenthesizedExpression'].includes(node?.type ?? '')) return unwrapExpression(node?.expression as Node)
  return node
}
function staticString(node: Node | undefined): string | undefined {
  if (typeof node?.value === 'string') return node.value
  if (node?.type === 'TemplateLiteral' && !(node.expressions as Node[]).length) return ((node.quasis as Node[])[0]?.value as { cooked?: string })?.cooked
  if (node?.type === 'BinaryExpression' && node.operator === '+') {
    const left = staticString(node.left as Node), right = staticString(node.right as Node)
    if (left !== undefined && right !== undefined) return left + right
  }
  return undefined
}
// Build output is gitignored and is not source; keep src/dist and public fully checked.
export const isBoundarySource = (file: string) => /\.[cm]?[jt]sx?$/.test(file) && !/^packages\/[^/]+\/dist\//.test(file) && !file.startsWith('packages/parity/fixtures/oracle/')
export function lintBoundaries() {
  const sourceFiles = files('packages').filter(isBoundarySource)
  const errors = sourceFiles.flatMap(f => boundaryErrors(f, readFileSync(f, 'utf8')))
  if (errors.length) throw new Error(errors.join('\n'))
  for (const pkg of readdirSync('packages')) {
    const roots = sourceFiles.filter(file => file.startsWith(`packages/${pkg}/`))
    if (!roots.length) continue
    const resolutions = resolvePackageImports(pkg, roots)
    for (const root of roots) {
      const repository = realpathSync('.'), canonicalRoot = relative(repository, realpathSync(root))
      const checkerOrigin = Object.hasOwn(checkerEntries, canonicalRoot)
      const pure = root.startsWith('packages/core/') && !/(?:\.test\.tsx?$|\/test\/|\/vitest\.config\.ts$)/.test(root)
      const web = root.startsWith('packages/web/') && !root.startsWith('packages/web/src/platform/') && !/(?:\.test\.tsx?$|\/test\/|\/vitest\.config\.ts$)/.test(root)
      const allowedLegacy = root.startsWith('packages/parity/') || /\.diff\.test\.tsx?$/.test(root)
      const seen = new Set<string>()
      function reach(file: string) {
        if (seen.has(file)) return
        seen.add(file)
        if (file !== realpathSync(root) && !file.endsWith('.d.ts') && (pure || web && !relative(realpathSync('.'), file).startsWith('packages/web/src/platform/'))) errors.push(...boundaryErrors(relative(realpathSync('.'), file), readFileSync(file, 'utf8'), pure ? 'core' : 'web'))
        for (const specifier of importSpecifiers(file)) {
          const builtin = specifier.startsWith('node:') || specifier.startsWith('bun:') || builtinModules.some(name => specifier === name || specifier.startsWith(`${name}/`))
          if (builtin) { if (pure) errors.push(`${root}: core reaches platform/runtime import ${specifier} through ${relative('.', file)}`); continue }
          if (pure && /^(?:react(?:-dom)?(?:\/|$)|@opengym\/(?:server|web|mcp|parity)(?:\/|$))/.test(specifier)) errors.push(`${root}: core reaches platform/runtime import ${specifier} through ${relative('.', file)}`)
          const target = resolutions.get(`${file}\0${specifier}`)
          if (!target) { errors.push(`${root}: unresolved boundary import ${specifier} in ${relative('.', file)}`); continue }
          const path = relative(realpathSync('.'), target)
          if (path === 'packages/web/public/sw.js' && root !== path && !/(?:\.test\.tsx?$|\/test\/|\/vitest\.config\.ts$)/.test(root)) errors.push(`${root}: reaches browser service-worker entry ${path} through ${relative('.', file)}`)
          if (/(?:^|\/)loose(?:\.[cm]?[jt]sx?)?$/.test(path)) errors.push(`${root}: reaches temporary loose shim ${path}; correct the contract instead`)
          if (pure && /(?:^|\/)node_modules\/(?:react|react-dom)(?:\/|$)/.test(path)) errors.push(`${root}: core reaches platform/runtime code ${path}`)
          const discoveryConfig = root.endsWith('/vitest.config.ts') && /^scripts\/(?:test-discovery|files)\.ts$/.test(path)
          // resolvePackageImports supplies real paths, including aliases and symlink targets.
          const importer = relative(repository, file)
          const publicCheckerImport = checkerEdge(canonicalRoot, importer, path)
          if (checkerOrigin && (importer === canonicalRoot || checkerHelpers.has(importer))) {
            const dependency = checkerDependency(specifier, target, importer)
            const outside = path === '..' || path.startsWith('../')
            if (outside && !dependency) errors.push(`${root}: public checker import escapes repository: ${path}`)
            if (!outside && !dependency && !publicCheckerImport) errors.push(`${root}: import outside explicit checker helper closure: ${path}`)
          }
          if (/^(?:frontend|api|mcp|web|scripts|catalogue)\//.test(path) && !discoveryConfig && !publicCheckerImport) errors.push(`${root}: reaches inert root tree ${path}`)
          if ((/^legacy\//.test(path) || path.startsWith('packages/parity/fixtures/oracle/')) && !allowedLegacy) errors.push(`${root}: reaches legacy outside differential/parity tests: ${path}`)
          if (pure && /^packages\/(?:server|web|mcp|parity)\//.test(path)) errors.push(`${root}: core reaches platform/runtime code ${path}`)
          if (!/(?:\.test\.tsx?$|\/test\/|\/vitest\.config\.ts$)/.test(root) && !root.startsWith('packages/parity/') && /(?:^|\/)test(?:\/|$)/.test(path)) errors.push(`${root}: production reaches test-only module ${path}`)
          // Follow every in-repo edge using this origin project's actual resolution.
          if (!path.startsWith('../') && !path.includes('node_modules/') && /\.[cm]?[jt]sx?$/.test(path) && !path.startsWith('legacy/') && !path.startsWith('packages/parity/fixtures/oracle/') && !discoveryConfig) reach(target)
        }
      }
      reach(realpathSync(root))
    }
  }
  if (errors.length) throw new Error(errors.join('\n'))
  console.log('lint:boundaries: clean')
}
if (import.meta.main) lintBoundaries()
