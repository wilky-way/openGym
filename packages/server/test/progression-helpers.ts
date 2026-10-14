import { request } from 'node:http'
import { dataServer, dataHeaders, CLOCK } from './data-helpers'
import { syntheticProgramme, syntheticSlot } from '../../core/test/fixtures/synthetic-programme'
export function fixture(): any {
  const d=syntheticProgramme(); d.lengthWeeks=2
  d.weeks.push({...structuredClone(d.weeks[0]),index:2})
  d.tmSeeds={bench:{value:100,unit:'lb'}}
  d.progressionRules=[{id:'pct',kind:'percentage',ref:{lift:'bench',basis:'tm'},rounding:{increment:5,mode:'nearest',usePlates:false},weeks:{'1':[{pct:0.8,reps:5},{pct:0.9,reps:5}],'2':[{pct:0.8,reps:5},{pct:0.9,reps:5}]}}]
  for(const w of d.weeks) {const s=syntheticSlot({...d,weeks:[w]});s.tm={key:'bench',percentages:[0.8,0.9],reference:'tm'};s.progression.rules=['pct']}
  return {unit:'lb',effortScale:'rir',_rev:4,_wid:'read1',workouts:[{id:'old',d:'2026-01-01',start:1,entries:[]}],customEx:[],routines:d.weeks.map((w:any)=>({id:`r${w.index}`,programme:{cycleId:'c',instanceId:`o${w.index}`,weekIndex:w.index},ex:structuredClone(w.days[0].sessions[0].routineSnapshot.ex).map((e:any)=>({...e,pyramid:[5,5]}))})),programmes:{version:1,fork:'opengym/1',definitions:[d],cycles:[{id:'c',programmeId:d.id,status:'active',snapshot:d,tmSeed:{bench:100},cadence:{perWeek:1},startsOn:'2026-01-05',notBefore:null,weekIndex:1,week1StartDate:'2026-01-05',since:10,occurrences:d.weeks.map((w:any)=>({instanceId:`o${w.index}`,routineId:`r${w.index}`,weekIndex:w.index,dayKey:'d1',sessionTemplateId:'main',date:w.index===1 ? '2026-01-05' : '2026-01-12',status:'pending'}))}]}}
}
export const applyBody={cycleId:'c',weeks:[2],expectedRev:4,expectedWid:'read1',confirmNoActiveSession:true}
export function progressionServer() {
  // dataServer composes production routes; inject deterministic progression services there.
  const live={active:false}; const h=dataServer(['u1'],{}, {now:()=>CLOCK,today:()=> '2026-01-05',livePresence:()=>live.active ? {name:"Training",updatedAt:CLOCK} : null})
  h.plant(fixture())
  const call=(method:string,endpoint:string,body?:unknown,headers:Record<string,string>=dataHeaders('u1'))=>new Promise<{status:number;body:any}>((resolve,reject)=> {
    const req=request(h.api+endpoint,{method,headers,agent:false},res=>{let text='';res.on('data',b=>text+=b);res.on('end',()=>{try {resolve({status:res.statusCode!,body:JSON.parse(text)})} catch(error){reject(error)}})})
    req.on('error',reject);req.end(body===undefined ? undefined : JSON.stringify(body))
  })
  return {...h,call,live}
}
