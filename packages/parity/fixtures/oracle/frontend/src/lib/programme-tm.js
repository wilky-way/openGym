// Percentage prescriptions are resolved on Start in the profile's unit, never auto-progressed.
import { weightIncrement, snapWeight } from './progression.js'
import { dropGrid } from './plates.js'
export function programmeTMConfig(S, cfg, routine) {
  if (!cfg.tm) return cfg
  const cycle = S.programmes?.cycles?.find(c => c.id === routine?.programme?.cycleId)
  const tm = Number(cycle?.tm?.[cfg.tm.key || cfg.id])
  const percentages = cfg.tm.percentages
  if (!Array.isArray(percentages) || percentages.length !== cfg.pyramid?.length || percentages.some(p => !Number.isFinite(p) || p <= 0)) throw new Error('Invalid percentage prescription')
  if (!Number.isFinite(tm) || tm <= 0) return { ...cfg, prog:'off' }
  const grid = dropGrid(S, cfg), step = weightIncrement(cfg, S.unit)
  const weights = percentages.map(p => typeof grid === 'function' ? grid(tm * p / 100) : snapWeight(tm * p / 100, step))
  return { ...cfg, prog:'off', weight:weights[0], pyramidWeight:weights }
}
export function missingProgrammeTMs(S, routine) {
  const cycle = S.programmes?.cycles?.find(c => c.id === routine?.programme?.cycleId)
  return [...new Set((routine?.ex || []).filter(e => e.tm && !(Number(cycle?.tm?.[e.tm.key || e.id]) > 0)).map(e => e.tm.key || e.id))]
}
