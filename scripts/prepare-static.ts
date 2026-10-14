import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

// Only application-licensed catalogue media, with its notice. No uploads/data.
const destination=resolve('packages/web/dist/exercise-media')
if (!existsSync('packages/web/dist/index.html')) throw new Error('Build the web app first.')
mkdirSync(destination,{recursive:true})
for (const name of ['still','clip']) cpSync(resolve('catalogue/media',name),resolve(destination,name),{recursive:true})
cpSync(resolve('catalogue/media/NOTICE.md'),resolve(destination,'NOTICE.txt'))
console.log('Prepared licensed catalogue media for the direct static server.')
