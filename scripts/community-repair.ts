import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { createExerciseIndex } from '../packages/core/src/exercises'
import { applyCommunityRepair, planCommunityRepair, type CommunityRepairPlan, type CommunitySource, type CommunityRepairOptions } from '../packages/core/src/community-conversion'
import type { OpenGymProgrammeDefinition } from '../packages/contract/domain/programme-model.generated'

interface Input {
  definition: OpenGymProgrammeDefinition
  source: CommunitySource
  options?: CommunityRepairOptions
  customEx?: Parameters<typeof createExerciseIndex>[0]
}
function readJson(path: string): unknown {
  if (!statSync(path).isFile() || statSync(path).size>5*1024*1024) throw new Error('Expected a JSON file no larger than 5 MiB.')
  return JSON.parse(readFileSync(path,'utf8'))
}
/** Offline only. plan defaults to stdout; apply creates a NEW file, never an API write. */
export function communityRepairCli(args: string[]): void {
  const [mode,inputPath,manifestPath,outputPath]=args
  if (!inputPath || args.some(arg=>arg.startsWith('--')) || !(mode==='plan' && args.length>=2 && args.length<=3 || mode==='apply' && args.length===4)) {
    throw new Error('Usage: community-repair.ts plan INPUT.json [NEW-MANIFEST.json] | apply INPUT.json MANIFEST.json NEW-DEFINITION.json')
  }
  const input=readJson(inputPath) as Input
  if (!input || typeof input!=='object' || !input.definition || !input.source || !Array.isArray(input.source.weeks)) throw new Error('Input needs definition and source.weeks.')
  const index=createExerciseIndex(input.customEx ?? [])
  const result=mode==='plan' ? planCommunityRepair(input.definition,input.source,input.options,index) :
    applyCommunityRepair(input.definition,input.source,readJson(manifestPath!) as CommunityRepairPlan,input.options,index)
  const text=JSON.stringify(result,null,2)+'\n', output=mode==='plan'?manifestPath:outputPath
  if (output) writeFileSync(output,text,{flag:'wx',mode:0o600})
  else process.stdout.write(text)
}
if (import.meta.main) {
  try {communityRepairCli(process.argv.slice(2))}
  catch(error) {console.error(error instanceof Error ? error.message : String(error));process.exitCode=1}
}
