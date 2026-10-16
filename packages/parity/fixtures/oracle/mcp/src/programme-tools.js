import {z} from 'zod'
import {getState,getUser} from './state.js'
import {todayISO} from '../../frontend/src/lib/format.js'
import {isProgrammeDate} from '../../frontend/src/lib/programme-calendar.js'
import {programmePosition,getProgramme,applyProgrammeAgentAction} from '../../frontend/src/lib/programme-agent.js'
const date=z.string().refine(isProgrammeDate,'must be a valid YYYY-MM-DD date')
// Renewed credentials live only in memory and are discarded when endpoint/profile/config changes.
let credential = null
const error=(code,message)=>Object.assign(new Error(message),{code})

// File reads stay read-only. Opt-in actions always use the API's authenticated revision gate.
export async function mutateProgramme(action,params,{fetcher=globalThis.fetch,env=process.env}={}) {
  if(env.OPENGYM_ENABLE_PROGRAMME_WRITES!=='1')throw error('WRITES_DISABLED','Enable OPENGYM_ENABLE_PROGRAMME_WRITES=1 to use program actions.')
  if(!env.OPENGYM_TOKEN || !env.OPENGYM_URL)throw error('CONFIG_REQUIRED','Program actions need OPENGYM_URL and OPENGYM_TOKEN.')
  let url
  try {url=new URL(env.OPENGYM_URL)}catch{throw error('CONFIG_REQUIRED','OPENGYM_URL is invalid.')}
  if(url.username || url.password || url.search || url.hash || !['http:','https:'].includes(url.protocol) || url.protocol==='http:' && !['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw error('CONFIG_REQUIRED','Use HTTPS or a loopback HTTP API URL without credentials or query parameters.')
  const base=url.href.replace(/\/$/,'')
  const profile=getUser().id, configured=env.OPENGYM_TOKEN
  if(!credential || credential.base!==base || credential.profile!==profile || credential.configured!==configured) credential={base,profile,configured,token:configured}
  const session=credential
  let token=session.token
  const request=async(method,path,body)=>{
    let res
    try{res=await fetcher(base+path,{method,headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(15000)})}catch{throw error('API_UNAVAILABLE','The openGym API could not be reached.')}
    if(res.status===409)throw error('REV_CONFLICT','The profile changed. Read the program again before applying this action.')
    if(!res.ok)throw error('API_REFUSED',`The openGym API refused the request (${res.status}).`)
    try{return await res.json()}catch{throw error('API_UNAVAILABLE','The openGym API returned an invalid response.')}
  }
  const me=await request('GET','/api/me')
  if(me.user?.id!==profile)throw error('PROFILE_MISMATCH','The API token belongs to a different profile than this MCP reader.')
  if(typeof me.token==='string' && me.token) {token=me.token;session.token=me.token}
  const got=await request('GET','/api/data')
  if(!Number.isInteger(params.expectedRev) || got.rev!==params.expectedRev || (got.state?._wid || null)!==params.expectedWid)throw error('REV_CONFLICT','The profile changed. Read the program again before applying this action.')
  if(!got.state || !Array.isArray(got.state.routines))throw error('NO_STATE','No synced profile is available for program actions.')
  if(typeof got.state._wid!=='string' || !got.state._wid)throw error('WRITE_ID_REQUIRED','This profile has no write identity. Sync it through the app before using program actions.')
  const state=structuredClone(got.state),today=params.today || todayISO()
  applyProgrammeAgentAction(state,action,params,today)
  const result=await request('PUT','/api/data',{state,baseRev:got.rev,baseWid:got.state._wid})
  try {
    const fresh=await request('GET','/api/data')
    return {ok:true,appliedRev:result.rev,rev:fresh.rev,position:programmePosition({...fresh.state,_rev:fresh.rev},today)}
  } catch(err) {return {ok:true,appliedRev:result.rev,position:null,readbackError:err.code || 'API_UNAVAILABLE'}}
}
const withState=handler=>p=>{const S=getState();return S?handler(S,p):{error:'no synced state yet — sign in at least once from a device',unit:'kg'}}
const common={expected_rev:z.number().int().nonnegative(),expected_wid:z.string().nullable(),today:date.optional()}
const fromParams=p=>({expectedRev:p.expected_rev,expectedWid:p.expected_wid,today:p.today,cycleId:p.cycle_id,instanceId:p.instance_id,programmeId:p.programme_id,weekIndex:p.week_index,perWeek:p.per_week,tm:p.tm,existingRoutineIds:p.adopt,reason:p.reason})
export const PROGRAMME_TOOLS=[
  {name:'get_programme',description:'Includes effortScale and displayDefinition in the profile scale alongside the unchanged authored definition and cycle. Read the active program and its frozen definition, or a specific cycle/definition. Includes the synced revision for conditional actions.',schema:{cycle_id:z.string().optional(),programme_id:z.string().optional()},handler:withState((S,p)=>getProgramme(S,{cycleId:p.cycle_id,programmeId:p.programme_id}))},
  {name:'programme_position',description:'Read program week, next session/date, projected end and done/skipped adherence using the same projection as the UI. Pending dates are derived.',schema:{cycle_id:z.string().optional(),today:date.optional()},handler:withState((S,p)=>programmePosition(S,p.today || todayISO(),p.cycle_id))},
  {name:'activate_programme',description:'Activate or adopt a saved validated program using UI guards. Requires explicit write opt-in, a paired API token for this profile and the expected revision. Never replaces an active/paused cycle or a running workout.',schema:{...common,programme_id:z.string(),week_index:z.number().int().positive().optional(),per_week:z.number().int().min(1).max(7).optional(),tm:z.record(z.number().positive()).optional(),adopt:z.record(z.string()).optional()},handler:withState((S,p)=>mutateProgramme('activate',fromParams(p)))},
  {name:'shift_programme',description:'Shift the active program to tomorrow without skipping, through the same UI helper and authenticated conditional API write.',schema:{...common,cycle_id:z.string()},handler:withState((S,p)=>mutateProgramme('shift',fromParams(p)))},
  {name:'skip_programme_session',description:'Explicitly skip one pending occurrence. Finished logs win; resolved sessions are refused. Requires write opt-in, profile authentication and the expected revision.',schema:{...common,cycle_id:z.string(),instance_id:z.string(),reason:z.string().optional()},handler:withState((S,p)=>mutateProgramme('skip',fromParams(p)))},
]
