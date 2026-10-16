import { programmeModelSchema } from '../packages/core/src/programme-model-schema'
import { compile } from 'json-schema-to-typescript'
import { readFileSync, writeFileSync } from 'node:fs'
const root = 'packages/contract/domain/'
const schema = JSON.parse(JSON.stringify(programmeModelSchema))
const schemaText=JSON.stringify(schema,null,2)+'\n'
const publicSchema = 'docs/programme-model.schema.json'
if (process.argv.includes('--check')) {
  if (readFileSync(publicSchema, 'utf8') !== schemaText) throw new Error('Public programme schema drift: bun run gen:model')
} else writeFileSync(publicSchema, schemaText)
if(process.argv.includes('--check')) {
  if(readFileSync(`${root}programme-model.schema.json`,'utf8')!==schemaText)throw new Error('Programme schema drift: bun run gen:model')
} else writeFileSync(`${root}programme-model.schema.json`,schemaText)
// GM ruling: transform only a clone for named declarations, never the frozen schema.
const model = structuredClone(schema)
const slot = model.$defs.slot.properties
slot.target = { anyOf: [{ $ref: '#/$defs/target' }, { type: 'null' }] }
slot.setTargets.items = { anyOf: [{ $ref: '#/$defs/target' }, { type: 'null' }] }
slot.progression = { anyOf: [{ $ref: '#/$defs/progression' }, { type: 'null' }] }
model.$defs.target.title = 'ProgrammeTarget'
model.$defs.progression.title = 'ProgrammeProgression'
for (const [name, input] of [['programme-model.generated.d.ts', schema], ['programme-model.named.generated.d.ts', model]] as const) {
  const output = await compile(input, 'OpenGymProgrammeDefinition', { unknownAny: true, unreachableDefinitions: true })
  const target = `${root}${name}`
  if (process.argv.includes('--check')) {
    if (readFileSync(target, 'utf8') !== output) throw new Error(`Model types drift: ${name}: bun run gen:model`)
  } else { writeFileSync(target, output); console.log(`Generated ${target}`) }
}
if (process.argv.includes('--check')) console.log('gen:model --check: both outputs byte-identical')
