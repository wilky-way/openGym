import { readFileSync } from 'node:fs'
import { parse } from '@babel/parser'
import { expect, it } from 'vitest'

it('forwards indexes on two proven inert edges (occurrence admission and English casing)', () => {
  const stats = parse(readFileSync('src/views/Stats.tsx', 'utf8'), { sourceType:'module', plugins:['typescript','jsx'] })
  const balance = parse(readFileSync('src/views/StructuralBalance.tsx', 'utf8'), { sourceType:'module', plugins:['typescript','jsx'] })
  const edges: { name:string; args:any[] }[] = []
  function walk(n:any,parent?:any) {
    if(!n||typeof n!=='object')return
    if(Array.isArray(n)){n.forEach(x=>walk(x,parent));return}
    if(n.type==='CallExpression' && (n.callee.name==='metricEntriesForExercise' || n.callee.name==='exOr' && parent?.callee?.name==='exerciseNameClass')) edges.push({name:n.callee.name,args:n.arguments})
    for(const [k,v]of Object.entries(n))if(!['loc','comments'].includes(k))walk(v,n)
  }
  walk(stats);walk(balance)
  expect(edges.map(e=>e.name)).toEqual(['metricEntriesForExercise','exOr'])
  for(const edge of edges)expect(edge.args.at(-1)?.name,edge.name).toBe('index')
})
