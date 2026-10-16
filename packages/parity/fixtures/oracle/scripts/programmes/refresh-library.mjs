#!/usr/bin/env node
// Prepare an export for review; intentionally has no network or live-write capability.
import {readFileSync,readdirSync,writeFileSync} from 'node:fs'
import {resolve,join} from 'node:path'
import {assertOutsideRepository,writeOutsideRepository} from './output-guard.mjs'
import {refreshProgrammeDefinitions} from '../../frontend/src/lib/programme-refresh.js'
const args=process.argv.slice(2), options={}
for(let i=0;i<args.length;i+=2) {
  if(args[i]==='--repair'){options.repair=true;i--;continue}
  if(!['--state','--library','--out','--mappings','--prescriptions','--decisions'].includes(args[i]) || !args[i+1]) throw new Error('Usage: node scripts/programmes/refresh-library.mjs --state EXPORT.json [--library DIRECTORY] [--out NEW-EXPORT.json] [--mappings FILE.json] [--prescriptions FILE.json] [--decisions FILE.json] [--repair]')
  options[args[i].slice(2)]=args[i+1]
}
if(!options.state) throw new Error('--state is required; no live API is used.')
if(options.out)assertOutsideRepository(options.out)
if(options.out && resolve(options.out)===resolve(options.state)) throw new Error('Output must be a new file, separate from the original export.')
const read=p=>JSON.parse(readFileSync(p,'utf8'))
const original=read(options.state)
const envelope=['state','data'].find(k=>original[k] && typeof original[k]==='object' && !Array.isArray(original[k]))
const state=envelope?original[envelope]:original
const files=options.library?readdirSync(options.library).filter(n=>n.endsWith('.json')).sort().map(filename=>({filename,raw:read(join(options.library,filename))})):[]
const result=refreshProgrammeDefinitions(state,files,{repair:options.repair===true,mappings:options.mappings?read(options.mappings):{},prescriptions:options.prescriptions?read(options.prescriptions):{},decisions:options.decisions?read(options.decisions):{}})
if(options.out) writeOutsideRepository(options.out,JSON.stringify(envelope?{...original,[envelope]:result.state}:result.state,null,2)+'\n')
console.log(JSON.stringify({mode:options.out?'prepared-file':'dry-run',repair:options.repair===true?'on: unprotected stored definitions are repaired in place':'off: stored definitions without a source file are left as they are (pass --repair to repair them)',...result.report},null,2))
