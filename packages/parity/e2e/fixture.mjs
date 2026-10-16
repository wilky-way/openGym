// Entirely synthetic. No seed or private exercise/programme data is imported.
export const NOW = Date.parse('2026-10-12T17:00:00Z')
export const definition = {
  id: 'i01-synthetic', name: 'I01 synthetic strength', unit: 'kg', goal: 'Strength',
  level: 'Intermediate', daysPerWeek: 1, lengthWeeks: 2, equipment: ['barbell'],
  licence: 'Synthetic permission', source: { kind: 'library', ref: 'I01 synthetic fixture', private: false },
  endPlan: { kind: 'stop', instructions: 'Review the synthetic log.' },
  weeks: [1, 2].map(index => ({ index, mode: 'train', days: [{ key: 'd1', sessions: [{
    sessionTemplateId: 'main', routineSnapshot: { name: 'I01 bench', ex: [{
      id: '0025', slotId: 'bench', role: 'main', sets: 1, reps: 5, weight: 40, prog: 'off',
      target: { rpe: 8 }, progression: { kind: 'manual', instructions: 'Choose the load.' },
    }] },
  }] }] })),
}
export const fixture = {
  unit: 'kg', weighIn: false, restSec: 0, sound: true, theme: 'dark',
  routines: [{ id: 'i01-routine', name: 'I01 offline workout', ex: [{ id: '0025', sets: 1, reps: 5, weight: 40, prog: 'off' }] }],
  week: { 1: 'i01-routine' }, dayPlan: {}, workouts: [], bodyweight: [], active: null,
  programmes: { version: 1, fork: 'wilky/1', definitions: [definition], cycles: [] },
  futureTop: { preserved: true, ordered: ['synthetic', 'unknown'] },
}
