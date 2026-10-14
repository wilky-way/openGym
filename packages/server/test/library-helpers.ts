import type { ProgrammeDefinition } from '@opengym/contract/domain/programme-model'
import type { Environment } from '../src/config'
import { authServer, cookie } from './auth-helpers'
export const definition = (id = 'synthetic'): ProgrammeDefinition => ({ id, name: 'Synthetic authored block', unit: 'lb', goal: 'Strength', level: 'Intermediate', daysPerWeek: 1, lengthWeeks: 1, equipment: ['barbell'], licence: 'Synthetic permission', source: { kind: 'own', ref: 'Synthetic test', private: false }, endPlan: { kind: 'stop', instructions: 'End the block and review the log.' }, weeks: [{ index: 1, mode: 'train', days: [{ key: 'd1', sessions: [{ sessionTemplateId: 'main', routineSnapshot: { ex: [{ id: '0025', slotId: 'bench', role: 'main', sets: 2, reps: 5, target: { rpe: 8 }, progression: { kind: 'manual', instructions: 'Choose loads for the prescribed effort.' } }] } }] }] }] })
export function libraryServer(env: Environment = {}) {
  const h = authServer(env)
  const request = (path = '', method = 'GET', body?: unknown, uid = 'u_phone') => fetch(h.api + '/api/programmes/' + path, {
    method, headers: { ...cookie(uid), 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const put = (d = definition(), expectedVersionId: string | null = null, minLevel?: string, uid = 'u_phone') => request('library/' + d.id, 'PUT', { definition: d, expectedVersionId, ...(minLevel === undefined ? {} : { minLevel }) }, uid)
  return { ...h, request, put }
}
