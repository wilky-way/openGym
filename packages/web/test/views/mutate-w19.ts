import { parse } from '@babel/parser'
import { readFileSync, writeFileSync } from 'node:fs'
const paths = ['Stats', 'Library', 'StructuralBalance'].map(n => `packages/web/src/views/${n}.tsx`)
// Refuse to call an already-failing baseline a killed mutation.
const baseline = Bun.spawnSync(['bun', '--bun', 'vitest', 'run', 'test/views/W19.index.test.tsx', 'test/views/Library.index.test.tsx', '--reporter=dot'], {cwd:'packages/web',stdout:'pipe',stderr:'pipe'})
if (baseline.exitCode) throw new Error('W19 mutation baseline failed: '+baseline.stdout.toString()+baseline.stderr.toString())
const results: { file: string; line: number; callee: string; killed: boolean; status: number; inertKilled?: boolean; inert?: string }[] = []
for (const file of paths) {
  const source = readFileSync(file, 'utf8')
  const calls: any[] = []
  function walk(n: any) {
    if (!n || typeof n !== 'object') return
    if (Array.isArray(n)) { n.forEach(walk); return }
    if (n.type === 'CallExpression' && n.arguments.at(-1)?.name === 'index') calls.push(n)
    for (const [k, v] of Object.entries(n)) if (!['loc', 'comments'].includes(k)) walk(v)
  }
  walk(parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] }))
  try {
    for (const call of calls) {
      const arg = call.arguments.at(-1), prev = call.arguments.at(-2)
      writeFileSync(file, source.slice(0, prev.end) + source.slice(arg.end))
      const test = file.includes('Library') ? 'test/views/Library.index.test.tsx' : 'test/views/W19.index.test.tsx'
      const proc = Bun.spawn(['bun', '--bun', 'vitest', 'run', test, '--reporter=dot'], { cwd: 'packages/web', stdout: 'pipe', stderr: 'pipe' })
      const [out, err, status] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
      const row = { file, line: call.loc.start.line, callee: call.callee.name, killed: status !== 0, status }
      const inert = call.callee.name === 'metricEntriesForExercise' ? 'The index is only used when rows are empty to admit positive bestWeightForEntry records; without completed rows both assisted and ordinary paths use the same positive topW fallback.' : file.includes('StructuralBalance') && call.callee.name === 'exOr' && call.arguments[0]?.name === 'exId' ? 'English-only exerciseNameClass always returns capitalize; exOr cannot change this class.' : undefined
      if (inert) {
        if (status !== 0) throw new Error('An inert edge unexpectedly affected output: '+JSON.stringify(row))
        const ast = Bun.spawn(['bun','--bun','vitest','run','test/views/W19.index-inert.test.ts','--reporter=dot'], {cwd:'packages/web',stdout:'pipe',stderr:'pipe'})
        const [ao,ae,ac] = await Promise.all([new Response(ast.stdout).text(),new Response(ast.stderr).text(),ast.exited])
        Object.assign(row,{inert,inertKilled:ac!==0})
        writeFileSync(`.gate/W19-mutation-${results.length+1}-inert.log`,ao+ae)
        if (!ac) throw new Error('Inert forwarding AST did not detect deleted index')
      }
      results.push(row); console.log(JSON.stringify(row))
      writeFileSync(`.gate/W19-mutation-${results.length}.log`, out + err)
      writeFileSync(file, source)
    }
  } finally { writeFileSync(file, source) }
}
writeFileSync('.gate/W19-mutations.json', JSON.stringify(results, null, 2)+'\n')
