import {useStore,type StoreDocument} from '../store/useStore'
import {useUI} from '../store/useUI'
import {clientPlatform} from './client-io'
import {guardedStoreUpdate} from './guarded-update'
import {trainingIdentity,confirmTrainingClose} from './training-activity'

const frame=(state=useStore.getState())=>JSON.stringify([state.user?.id,state.user?.profileId,state.documentInstance,
  state.S.profileId,state.S.resetAt,state.S.unit,state.S.activeEquipId])
let epoch=0
useStore.subscribe((next,previous)=>{if(frame(next)!==frame(previous))epoch++})

/** Current localStorage path only: the primary write must succeed before closing
 * the editor, showing success or sending the captured owning-device close. */
export function closeTrainingLocally(valid:(draft:StoreDocument)=>boolean,mutate:(draft:StoreDocument)=>void,
  reason:'discarded'|'editor-closed',onStale:()=>void):boolean {
  const initial=useStore.getState(),owner=initial.user,identity=trainingIdentity(initial.S.active)
  const opened=epoch,context=frame(initial),endpoint=clientPlatform().server.baseUrl()
  const applied=guardedStoreUpdate(valid,mutate,{onStale,update:(producer,push)=>{
    try {
      const result=useStore.getState().update(producer,push,{durable:true}) as {accepted?:boolean;localDurability?:string}|false|undefined
      return result && result.accepted===true && result.localDurability==='saved' ? result : false
    }catch(error){
      if((error as {code?:string})?.code!=='LOCAL_DURABILITY_REQUIRED')throw error
      useUI.getState().toast('Could not save this change on the device. Keep the workout open and retry or export it.')
      return false
    }
  }})
  if(!applied)return false
  // Store subscribers can open another editor or replace the owner synchronously
  // during publication. Never close that newer incarnation or show old success.
  const current=useStore.getState()
  try {
    if(opened!==epoch || context!==frame(current) || current.user!==owner || current.S.active!==null ||
      endpoint!==clientPlatform().server.baseUrl() || current.validateWorkoutOwner?.()!==true){onStale();return false}
  }catch{onStale();return false}
  confirmTrainingClose(owner?.id,identity,reason)
  return true
}
