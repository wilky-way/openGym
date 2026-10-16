import {afterEach,expect,test} from 'vitest'
import {Client} from '@modelcontextprotocol/sdk/client/index.js'
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js'
import {createMcpServer} from '../src/index'
import {createTemplateTools} from '../src/template-tools'
import {target} from './http-helpers'
import {buildPlannedEntry} from '@opengym/core/session-start'
let api:Awaited<ReturnType<typeof target>>|undefined
afterEach(async()=>{if(api){await api.close();api=undefined}})
const state=()=>({_rev:7,_wid:'epoch',unit:'kg',routines:[{id:'old',name:'Synthetic',prog:'off',ex:[{id:'0001',sets:2,reps:5,weight:50,extension:{keep:true}}]}],workouts:[],customEx:[],week:{},dayPlan:{},exWeights:{},programmes:{cycles:[]}})
test.each([
 {pyramid:[5,5],pyramidWeight:[50,55]},
 {enginePrescription:true,pyramid:[5,5],pyramidWeight:[50,55]},
 {tm:{key:'bench',percentages:[50,55]},pyramid:[5,5]},
 {progression:{rules:['owned'],extension:{keep:true}}},
])('authoritative %j refuses a flat load change, retaining actual Start loads and extension data',async owned=>{
 const initial:any=state();Object.assign(initial.routines[0].ex[0],owned)
 // A finished cycle still supplies TM values; active programme ownership is a separate guard.
 initial.routines[0].programme={cycleId:'old-cycle'};initial.programmes.cycles=[{id:'old-cycle',status:'finished',tm:{bench:100}}]
 api=await target(initial)
 const tool=createTemplateTools({env:{...api.env,OPENGYM_ENABLE_ROUTINE_WRITES:'1'},fetcher:api.fetcher}).find(t=>t.name==='edit_routine')!
 const read=async()=>(await api!.request('GET','/api/data')).body.state
 const before=await read(),routine=before.routines[0],opened=buildPlannedEntry(before,routine.ex[0],routine,{noProg:true}).sets.map((s:{w?:number})=>s.w)
 await expect(tool.handler({routine_id:'old',exercises:[{exercise_id:'0001',sets:2,reps:5,weight:100}]})).rejects.toHaveProperty('code','UNSUPPORTED_CONFIG')
 expect(await read()).toEqual(before);expect(buildPlannedEntry(before,routine.ex[0],routine,{noProg:true}).sets.map((s:{w?:number})=>s.w)).toEqual(opened);expect(api.calls.filter(c=>c.method==='PUT')).toEqual([])
 const intent={routine_id:'old',name:'Renamed',exercises:[{exercise_id:'0001',source_index:0,sets:2,reps:5,notes:'Owner note'}]}
 const preview:any=await tool.handler(intent);expect(preview.target.ex[0]).toMatchObject({...owned,extension:{keep:true},note:'Owner note'})
 if('tm' in owned)return // A terminal cycle's normal server cleanup retires its routine link on any write.
 await tool.handler({...intent,apply:true,preview_token:preview.preview_token})
 const saved=await read();expect(buildPlannedEntry(saved,saved.routines[0].ex[0],saved.routines[0],{noProg:true}).sets.map((s:{w?:number})=>s.w)).toEqual(opened)
})
for(const carrier of ['direct','sdk'] as const) for(const diagnostic of [false,true]) test(`first ${carrier} call redacts initial and renewed credentials from ${diagnostic?'errors':'metadata'} and subsequent calls`,async()=>{
 const initial='synthetic-W36-initial-secret',renewed='synthetic-W36-renewed-secret'
 const fetcher:any=async(url:string)=>({status:200,ok:true,json:async()=>{
   if(url.endsWith('/api/me'))return {user:{id:'synthetic-profile',name:'Synthetic'},token:renewed}
   const doc:any={...state(),customEx:[{id:'custom-synthetic',n:'Synthetic '+initial+' '+renewed,custom:true,eq:'dumbbell'}]}
   if(diagnostic)Object.defineProperty(doc,'_rev',{get(){throw Object.assign(new Error('Synthetic diagnostic '+initial+' '+renewed),{code:'SYNTHETIC',detail:renewed})}})
   return {rev:7,state:doc}
 }})
 const tools=createTemplateTools({env:{OPENGYM_URL:'http://127.0.0.1:1',OPENGYM_UID:'synthetic-profile',OPENGYM_TOKEN:initial},fetcher})
 const server=createMcpServer(tools),client=new Client({name:'synthetic-client',version:'1'}),[a,b]=InMemoryTransport.createLinkedPair()
 try{
   if(carrier==='sdk'){await server.connect(a);await client.connect(b)}
   for(let call=0;call<2;call++){
     let out:any
     if(carrier==='sdk')out=await client.callTool({name:'search_exercises',arguments:{query:'Synthetic'}})
     else try{out=await tools.find(t=>t.name==='search_exercises')!.handler({query:'Synthetic'})}catch(e){out={message:(e as Error).message,...e as object}}
     const text=JSON.stringify(out);expect(text).not.toContain(initial);expect(text).not.toContain(renewed);expect(text).toContain('[redacted]')
     if(carrier==='sdk')expect(out.isError===true).toBe(diagnostic)
   }
 }finally{await client.close();await server.close()}
})
test('per-set and engine slots can reorder and retain notes, owned prescriptions and unknown extensions',async()=>{
 const initial:any=state(),first={...initial.routines[0].ex[0],pyramid:[5,5],pyramidWeight:[50,55]},second={...first,enginePrescription:true,pyramidWeight:[60,65],extension:{second:true}}
 initial.routines[0].ex=[first,second];api=await target(initial)
 const tool=createTemplateTools({env:{...api.env,OPENGYM_ENABLE_ROUTINE_WRITES:'1'},fetcher:api.fetcher}).find(t=>t.name==='edit_routine')!
 const input={routine_id:'old',exercises:[{exercise_id:'0001',source_index:1,sets:2,reps:5,notes:'Second first'},{exercise_id:'0001',source_index:0,sets:2,reps:5}]}
 const preview:any=await tool.handler(input);await tool.handler({...input,apply:true,preview_token:preview.preview_token})
 const s=(await api.request('GET','/api/data')).body.state,routine=s.routines[0]
 expect(routine.ex[0]).toMatchObject({...second,note:'Second first'});expect(routine.ex[1]).toMatchObject(first)
 expect(routine.ex.map((cfg:any)=>buildPlannedEntry(s,cfg,routine,{noProg:true}).sets.map((set:{w?:number})=>set.w))).toEqual([[60,65],[50,55]])
})
