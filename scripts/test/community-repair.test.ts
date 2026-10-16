import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { communityRepairCli } from '../community-repair'
import { importProgramme } from '../../packages/core/src/programme-import'

const dirs:string[]=[]
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();for(const d of dirs.splice(0))rmSync(d,{recursive:true,force:true})})
function files(script='lp(5lb)') {
  const dir=mkdtempSync(join(tmpdir(),'community-repair-'));dirs.push(dir)
  const source={id:'synthetic-cli',name:'Synthetic CLI',unit:'lb',length_weeks:1,rules:{frequency:1},source:{kind:'own',ref:'Synthetic',private:false},weeks:[{n:1,days:[{n:1,kind:'lift',exercises:[{id:'0025',slot:'bench',name:'Synthetic bench',sets:[{count:2,reps:5,weight:999,rpe:8}],rules:[{kind:'progress',script}]}]}]}]}
  const input=join(dir,'input.json'), manifest=join(dir,'manifest.json'), output=join(dir,'output.json')
  writeFileSync(input,JSON.stringify({source,definition:importProgramme(source).definition}))
  return {input,manifest,output,before:readFileSync(input,'utf8')}
}
it('default dry run prints a plan without mutation or network access',()=>{
  const f=files(),stdout=vi.spyOn(process.stdout,'write').mockReturnValue(true)
  const network=vi.fn(()=>{throw new Error('network forbidden')});vi.stubGlobal('fetch',network)
  communityRepairCli(['plan',f.input])
  expect(JSON.parse(String(stdout.mock.calls[0]![0])).status).toBe('reviewable')
  expect(readFileSync(f.input,'utf8')).toBe(f.before);expect(existsSync(f.manifest)).toBe(false);expect(existsSync(f.output)).toBe(false);expect(network).not.toHaveBeenCalled()
})
it('apply creates only a new local definition and refuses existing outputs',()=>{
  const f=files();communityRepairCli(['plan',f.input,f.manifest]);communityRepairCli(['apply',f.input,f.manifest,f.output])
  expect(JSON.parse(readFileSync(f.output,'utf8')).weeks).toHaveLength(1)
  expect(()=>communityRepairCli(['apply',f.input,f.manifest,f.output])).toThrow()
  expect(()=>communityRepairCli(['plan',f.input,f.input])).toThrow()
  expect(readFileSync(f.input,'utf8')).toBe(f.before)
})
it('blocked, modified and stale manifests cannot produce an applied file',()=>{
  const blocked=files('custom() { sets += 1 }');communityRepairCli(['plan',blocked.input,blocked.manifest])
  expect(()=>communityRepairCli(['apply',blocked.input,blocked.manifest,blocked.output])).toThrow('blocked');expect(existsSync(blocked.output)).toBe(false)
  const f=files();communityRepairCli(['plan',f.input,f.manifest]);const plan=JSON.parse(readFileSync(f.manifest,'utf8'));plan.definition.name='tamper';writeFileSync(f.manifest,JSON.stringify(plan))
  expect(()=>communityRepairCli(['apply',f.input,f.manifest,f.output])).toThrow('differs');expect(existsSync(f.output)).toBe(false)
  const input=JSON.parse(f.before);input.source.name='changed';writeFileSync(f.input,JSON.stringify(input))
  expect(()=>communityRepairCli(['apply',f.input,f.manifest,f.output])).toThrow('Stale')
})
it('rejects API flags and malformed inputs before any output write',()=>{
  const f=files();expect(()=>communityRepairCli(['apply',f.input,'--url','https://invalid.example'])).toThrow('Usage')
  writeFileSync(f.input,'{}');expect(()=>communityRepairCli(['plan',f.input,f.manifest])).toThrow('Input needs');expect(existsSync(f.manifest)).toBe(false)
})
it('forwards a caller custom catalogue through CLI plan and guarded local apply',()=>{
  const f=files(), input=JSON.parse(f.before), custom={id:'synthetic-cli-custom',n:'Synthetic custom press',eq:'machine'}
  input.customEx=[custom]
  input.definition.weeks[0].days[0].sessions[0].routineSnapshot.ex[0].id=custom.id
  input.source.weeks[0].days[0].exercises[0].id=custom.id
  writeFileSync(f.input,JSON.stringify(input))
  communityRepairCli(['plan',f.input,f.manifest]);expect(JSON.parse(readFileSync(f.manifest,'utf8')).status).toBe('reviewable')
  communityRepairCli(['apply',f.input,f.manifest,f.output])
  expect(JSON.parse(readFileSync(f.output,'utf8')).weeks[0].days[0].sessions[0].routineSnapshot.ex[0].id).toBe(custom.id)
})
it.each([{until_rpe:9},{pct:.9}])('fresh unsupported source %j cannot use a newly computed manifest to create output',row=>{
  const f=files(),input=JSON.parse(f.before)
  Object.assign(input.source.weeks[0].days[0].exercises[0].sets[0],row)
  writeFileSync(f.input,JSON.stringify(input));communityRepairCli(['plan',f.input,f.manifest])
  expect(JSON.parse(readFileSync(f.manifest,'utf8')).status).toBe('blocked')
  expect(()=>communityRepairCli(['apply',f.input,f.manifest,f.output])).toThrow('blocked');expect(existsSync(f.output)).toBe(false)
})
