import { mkdirSync, writeFileSync, readFileSync, realpathSync, existsSync, lstatSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from '@babel/parser'

// TS 7 exposes no stable JS resolveModuleName API. Its compiler trace uses the real
// inherited TS paths, workspace exports, extensions and package conditions instead.
export function resolvePackageImports(pkg: string, sourceFiles: string[]): Map<string, string> {
  mkdirSync('.gate', { recursive: true })
  const config = resolve('.gate', `boundary-${pkg}.json`)
  writeFileSync(config, JSON.stringify({ extends: resolve('packages', pkg, 'tsconfig.json'), compilerOptions: { allowJs: true, checkJs: false, noCheck: true, noEmit: true }, files: sourceFiles.map(file => resolve(file)), include: [], exclude: [] }))
  const compiler = fileURLToPath(new URL('./bin/tsc', import.meta.resolve('typescript/package.json')))
  const child = Bun.spawnSync(['bun', compiler, '-p', config, '--traceResolution'], { stdout: 'pipe', stderr: 'pipe' })
  if (child.exitCode !== 0) throw new Error(`TypeScript boundary resolution failed (${pkg}): ${new TextDecoder().decode(child.stderr)} ${new TextDecoder().decode(child.stdout)}`)
  const trace = new TextDecoder().decode(child.stdout), resolutions = new Map<string, string>()
  const queries = new Map<string, { file: string; specifier: string }>()
  let file = '', specifier = ''
  for (const line of trace.split('\n')) {
    const start = /^======== Resolving module '([^']+)' from '([^']+)'/.exec(line)
    if (start) { specifier = start[1]!; file = start[2]!; queries.set(`${realpathSync(file)}\0${specifier}`, { file, specifier }) }
    const end = /^======== Module name '([^']+)' was successfully resolved to '([^']+)'/.exec(line)
    if (end && end[1] === specifier) resolutions.set(`${realpathSync(file)}\0${specifier}`, realpathSync(end[2]!))
  }
  // SQL text and CSS side-effect imports embed real assets; TS resolves declarations rather
  // than their runtime bytes. Keep the real asset target so boundary policy still applies.
  for (const [key, { file, specifier }] of queries) {
    if (!/\.(sql|css)$/.test(specifier) || !/^\.\.?\//.test(specifier)) continue
    const asset = resolve(dirname(file), specifier)
    if (!existsSync(asset) || !lstatSync(asset).isFile()) {
      resolutions.delete(key) // A declaration cannot authorize a missing runtime asset.
      continue
    }
    const target = realpathSync(asset)
    const packageRoot = realpathSync(resolve('packages', pkg)) + '/'
    if (!specifier.endsWith('.css') || target.startsWith(packageRoot)) resolutions.set(key, target)
    else resolutions.delete(key) // Directory symlinks cannot authorize escaped runtime bytes.
  }
  return resolutions
}
export function importSpecifiers(file: string): string[] {
  const ast = parse(readFileSync(file, 'utf8'), { sourceType: 'unambiguous', allowUndeclaredExports: true, plugins: [['typescript', { dts: file.endsWith('.d.ts') }], 'jsx'] })
  const found: string[] = []
  function visit(value: unknown) {
    if (Array.isArray(value)) { value.forEach(visit); return }
    if (!value || typeof value !== 'object') return
    const node = value as Record<string, unknown>
    let specifier: unknown
    if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration', 'ImportExpression', 'TSImportType'].includes(String(node.type))) specifier = node.source ?? node.argument
    if (node.type === 'TSExternalModuleReference') specifier = node.expression
    if (node.type === 'CallExpression' && ['require', 'Import'].includes(String((node.callee as { name?: string; type?: string })?.name ?? (node.callee as { type?: string })?.type))) specifier = (node.arguments as unknown[])?.[0]
    const text = (specifier as { value?: unknown } | undefined)?.value
    if (typeof text === 'string') found.push(text)
    for (const [key, child] of Object.entries(node)) if (!['loc', 'comments', 'tokens'].includes(key)) visit(child)
  }
  visit(ast)
  return found
}
