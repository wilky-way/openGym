// Scan source and built assets across the repository, including files without a known extension.
import {it,expect} from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
const root=fileURLToPath(new URL('../../',import.meta.url))
function files(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>['node_modules','.git'].includes(e.name)?[]:e.isDirectory()?files(path.join(dir,e.name)):e.isFile()?[path.join(dir,e.name)]:[])}
function violations(dir){
 const found=[]
 for(const file of files(dir)){
  if(/^(?:bbm|sbs)-/i.test(path.basename(file)))found.push(file)
  const bytes=fs.readFileSync(file)
  if(bytes.includes(0))continue
  let text
  try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes)}catch{continue}
  const privateId=/["'](?:bbm|sbs)-[a-z0-9][a-z0-9-]+["']/i
  const names=/(?:BBM (?:Beginner|Bridge|Hypertrophy|Powerbuilding|Strengthlifting|Titan)|SBS (?:Strength|Hypertrophy|Reps to Failure))/
  const schema=/["']block_type["']\s*:/.test(text) && /["']progression_scripts["']\s*:/.test(text)
  if(privateId.test(text) || names.test(text) || schema)found.push(file)
 }
 return found
}
it('contains no private library payloads in source, fixtures, public or built assets',()=>{expect(violations(root)).toEqual([])})
it('detects schema payloads in any text file anywhere in the repository and build',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'opengym-asset-guard-'))
 try{
  for(const file of ['frontend/public/template.txt','frontend/dist/template.txt','api/fixture.dat','mcp/payload','docs/example.md','library.data']){
   const target=path.join(dir,file);fs.mkdirSync(path.dirname(target),{recursive:true})
   fs.writeFileSync(target,JSON.stringify({weeks:[{['block'+'_type']:'train'}],rules:{['progression'+'_scripts']:[]}}))
  }
  expect(violations(dir)).toHaveLength(6)
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
})
