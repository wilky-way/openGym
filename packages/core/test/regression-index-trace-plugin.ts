import { parse } from '@babel/parser'
import type { Plugin } from 'vite'
import calls from './regression-index-calls.json'

// Observes executed call sites, including private helpers, without replacing any
// exercise predicate or changing its result. Runtime source/production is untouched.
export function indexTrace(): Plugin {
  return {
    name: 'progression-index-call-observer', enforce: 'pre',
    transform(code, id) {
      const file = id.split('/').at(-1)
      if (!id.includes('/core/src/') || !calls.some(row => row.file === file)) return
      const ast = parse(code, { sourceType: 'module', plugins: ['typescript'] })
      const edits: { start: number; end: number; replacement: string }[] = []
      function walk(node: unknown): void {
        if (!node || typeof node !== 'object') return
        const n = node as Record<string, any>
        if (n.type === 'CallExpression' && n.callee.type === 'Identifier') {
          const row = calls.find(row => row.file === file && row.line === n.loc.start.line && row.name === n.callee.name)
          if (row) edits.push({ start: n.start, end: n.callee.end, replacement: `__indexTrace(${JSON.stringify(row.site)}, ${n.callee.name}` })
        }
        for (const v of Object.values(n)) if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') walk(v)
      }
      walk(ast.program)
      for (const edit of edits.sort((a, b) => b.start - a.start)) code = code.slice(0, edit.start) + edit.replacement + code.slice(edit.end)
      // Replace the original opening parenthesis with a comma; the original args
      // are evaluated once and passed unchanged to the real callee.
      code = code.replace(/(__indexTrace\("[^"]+", \w+)\(/g, '$1, ')
      return { code: `import { traceIndexCall as __indexTrace } from ${JSON.stringify(new URL('./regression-index-trace.ts', import.meta.url).pathname)};\n` + code, map: null }
    },
  }
}
