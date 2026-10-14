import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { build, defineConfig, type Plugin } from 'vite'
import { fileURLToPath } from 'node:url'
import { lazyAssets, stampSw } from './scripts/sw-stamp'
const backend=process.env.API_TARGET || 'http://127.0.0.1:3000'
const apiOrigin=process.env.API_ORIGIN || 'http://localhost:8080'
// Bundle only the Platform-owned theme bootstrap into a parser-blocking head script.
// It runs before the main module and CSS can paint the wrong saved/system theme.
let prepaintCode:Promise<string>|undefined
const prepaint:Plugin={name:'opengym-prepaint',transformIndexHtml:{order:'pre',async handler(){
 prepaintCode??=build({configFile:false,logLevel:'silent',root:fileURLToPath(new URL('.',import.meta.url)),build:{write:false,emptyOutDir:false,minify:true,lib:{entry:fileURLToPath(new URL('./src/platform/prepaint.ts',import.meta.url)),formats:['iife'],name:'openGymPrepaint'}}}).then(result=>{
  const outputs=Array.isArray(result)?result:[result]
  for(const output of outputs)if('output' in output)for(const item of output.output)if(item.type==='chunk')return item.code
  throw new Error('Prepaint build produced no script')
 })
 return [{tag:'script',children:await prepaintCode,injectTo:'head'}]
}}}
const media=process.env.MEDIA_TARGET
const catalogueMedia:Plugin={name:'opengym-catalogue-media',configureServer(server){
 if(media)return
 const dirs:Record<string,[string,string]>={'/exercise-media/still/':['still','.webp'],'/exercise-media/clip/':['clip','.mp4']}
 const root=resolve(fileURLToPath(new URL('.',import.meta.url)),'../../catalogue/media')
 server.middlewares.use((req,res,next)=>{
  const prefix=Object.keys(dirs).find(p=>req.url?.startsWith(p));if(!prefix)return next()
  const [dir,ext]=dirs[prefix]!
  const name=decodeURIComponent(req.url!.slice(prefix.length).split('?')[0]!),file=join(root,dir,name)
  if(!/^\d{4,5}\.(webp|mp4)$/.test(name)||!name.endsWith(ext)||!existsSync(file)){res.statusCode=404;res.end();return}
  res.setHeader('Content-Type',ext==='.mp4'?'video/mp4':'image/webp');res.end(readFileSync(file))
 })
}}
const umamiSrc=process.env.VITE_UMAMI_SRC,umamiId=process.env.VITE_UMAMI_ID
const umami:Plugin={name:'opengym-umami',transformIndexHtml(){if(!umamiSrc||!umamiId)return;return [{tag:'script',attrs:{defer:true,src:umamiSrc,'data-website-id':umamiId},injectTo:'head'}]}}
const sha=process.env.APP_BUILD || execFileSync('git',['rev-parse','--short=10','HEAD'],{encoding:'utf8'}).trim()
let outDir='', lazy: string[]=[]
const swStamp={name:'opengym-sw-stamp',apply:'build' as const,
 configResolved(config: {root:string;build:{outDir:string}}){outDir=resolve(config.root,config.build.outDir)},
 generateBundle(_:unknown,bundle:Parameters<typeof lazyAssets>[0]) { lazy = lazyAssets(bundle) },
 closeBundle(){const html=join(outDir,'index.html'),sw=join(outDir,'sw.js');if(!existsSync(html)||!existsSync(sw))return;const stamp=createHash('sha256').update(readFileSync(html)).digest('hex').slice(0,10);writeFileSync(sw, stampSw(readFileSync(sw, 'utf8'), { stamp, lazy, buildSha:sha }))}}
export default defineConfig({define:{__APP_VERSION__:JSON.stringify('1.4.1'),__BUILD_SHA__:JSON.stringify(sha)},plugins:[prepaint,umami,swStamp,catalogueMedia],base:'./',
 server:{fs:{allow:['../..']},proxy:{'/api':{target:backend,changeOrigin:true,headers:{Origin:apiOrigin}},...(media?{'/exercise-media':{target:media,changeOrigin:true}}:{})}},build:{chunkSizeWarningLimit:1500}})
