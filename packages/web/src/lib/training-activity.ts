import { api } from './api'

/** Saved workout identity stays historical; only the editor incarnation is new. */
export const trainingIdentity = (active: any) => ({sessionId:active?.id,startedAt:active?.start,
  ...(active?.editingWorkoutId ? {editingWorkoutId:active.editingWorkoutId,editorInstanceId:active.editBase?.sheetInstanceId} : {})})

/** Call only after the owning, guarded local Save/cancel/discard succeeds. */
export function confirmTrainingClose(profileId: string | undefined, identity: ReturnType<typeof trainingIdentity>, reason: 'discarded' | 'editor-closed') {
  if (profileId) api('/api/activity',{method:'POST',body:JSON.stringify({active:false,reason,profileId,...identity})}).catch(()=>{})
}
