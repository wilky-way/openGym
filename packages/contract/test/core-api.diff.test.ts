import { expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { parse } from '@babel/parser'
it('programme schema includes the frozen oracle effort-scale fields verbatim', () => {
  const actual = readFileSync(new URL('../domain/programme-model.schema.json', import.meta.url), 'utf8')
  // P1 adds closed authoring rules, without changing the oracle surface.
  const surface=JSON.parse(actual), oracle=JSON.parse(readFileSync(new URL('../../../packages/parity/fixtures/oracle/docs/programme-model.schema.json', import.meta.url), 'utf8'))
  delete surface.$defs.slot.properties.nativePrescription; // W41 additive closed source goals.
  delete surface.properties.maxBasis; // W29 additive verified max basis.
  delete surface.properties.progressionRules;delete surface.properties.tmSeeds
  delete surface.$defs.progression.properties.rules;delete surface.$defs.progression.properties.onStall
  for(const branch of surface.$defs.slot.properties.progression.anyOf)if(branch.properties) {delete branch.properties.rules;delete branch.properties.onStall}
  for(const name of Object.keys(surface.$defs))if(!Object.hasOwn(oracle.$defs,name))delete surface.$defs[name]
  expect(JSON.stringify(surface,null,2)+'\n').toBe(JSON.stringify(oracle,null,2)+'\n')
  const fields = JSON.parse(actual).$defs.slot.properties
  expect(fields.generatedRules).toBeDefined()
  expect(fields.authoredInstructions).toBeDefined()
  expect(fields.noteKind).toBeDefined()
})
it('native source goals remain a separately asserted closed additive schema', () => {
  const schema=JSON.parse(readFileSync(new URL('../domain/programme-model.schema.json',import.meta.url),'utf8'))
  const native=schema.$defs.slot.properties.nativePrescription
  expect(native).toMatchObject({type:'object',additionalProperties:false,required:['version','variantKey','source','sets']})
  expect(native.properties.version).toEqual({const:1})
  expect(native.properties.source.additionalProperties).toBe(false)
  const row=native.properties.sets.items
  expect(row).toMatchObject({type:'object',additionalProperties:false,required:['sourceTemplateId','reps']})
  for(const key of ['reps','effort','percentage'])expect(row.properties[key].additionalProperties).toBe(false)
  expect(row.properties.reps.properties.kind.enum).toEqual(['fixed','range','amrap'])
  expect(row.properties.effort.properties.maxExclusive).toEqual({type:'boolean'})
  expect(row.properties.percentage.properties.role.enum).toEqual(['prescribed','guide'])
  expect(row.properties.percentage.properties.basis.enum).toEqual(['1rm','tm','e1rm'])
})
function exportsOf(source: string): string[] {
  const ast = parse(source, {sourceType:'module',plugins:['typescript','jsx']})
  const found: string[] = []
  for (const node of ast.program.body) {
    if (node.type === 'ExportDefaultDeclaration') found.push('default')
    if (node.type !== 'ExportNamedDeclaration') continue
    for (const spec of node.specifiers) found.push(spec.exported.type === 'Identifier' ? spec.exported.name : spec.exported.value)
    const decl = node.declaration
    if (decl?.type === 'VariableDeclaration') for (const d of decl.declarations) if (d.id.type === 'Identifier') found.push(d.id.name)
    if (decl && ['FunctionDeclaration','TSDeclareFunction','ClassDeclaration'].includes(decl.type) && 'id' in decl && decl.id?.type === 'Identifier') found.push(decl.id.name)
  }
  return found.sort()
}
it('every legacy lib module retains all export names in the frozen declarations', () => {
  const legacy = new URL('../../../packages/parity/fixtures/oracle/frontend/src/lib/', import.meta.url)
  const source = readdirSync(legacy).filter(f=>f.endsWith('.js')&&!f.includes('.test.'))
  expect(source).toHaveLength(133)
  for (const file of source) {
    const dts = new URL(`../core-api/${file.replace(/\.js$/,'.d.ts')}`,import.meta.url)
    const expected = exportsOf(readFileSync(new URL(file,legacy),'utf8'))
    if (file === 'exercises.js') expected.push('createExerciseIndex') // GM-approved R2 explicit index API.
    expect(exportsOf(readFileSync(dts,'utf8')),file).toEqual(expected.sort())
  }
})
