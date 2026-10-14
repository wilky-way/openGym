import { baseWeightFor, inventoryFor, loadKindFor, ownsPlates, plateStack } from '../plates'
import { ownedWeightsFor } from '@opengym/core/dumbbells'
import { checkedLoad, convertWeightPrecise } from './units'
import { EXIDX, type ExerciseIndex } from '../exercises'
import type { Rounding } from '../../../contract/domain/progression'
import type { Profile, Config } from '../progression'

export function chooseLoad(values: number[], value: number, mode: Rounding['mode']): number | null {
  const below = values.filter(x => x <= value).at(-1), above = values.find(x => x >= value)
  if (mode === 'down') return below ?? null
  if (mode === 'up') return above ?? null
  if (below === undefined) return above ?? null
  if (above === undefined) return below
  return value-below < above-value ? below : above
}
/** Inventory replaces the increment grid, never rounds twice. Missing directional capacity is explicit. */
export function roundLoad(value: number, from: 'lb' | 'kg', rounding: Rounding, profile: Profile & { unit: 'lb' | 'kg' }, cfg: Config, index: ExerciseIndex = EXIDX) {
  const converted = Number(convertWeightPrecise(value, from, profile.unit))
  const increment = Number(convertWeightPrecise(rounding.increment, from, profile.unit))
  const inputs: Record<string, number | string | boolean | null> = { roundedFrom: converted, inventory: false, rounding: rounding.mode, roundingIncrement: increment }
  if (from !== profile.unit) inputs.convertedFrom = `${value} ${from}`
  let values: number[] | null = null
  let smallestPair=increment
  if (rounding.usePlates) {
    values = ownedWeightsFor(profile, cfg, index)
    const kind = loadKindFor(profile, cfg, index)
    if (!values && ownsPlates(profile) && kind !== 'none') {
      const base = Number(baseWeightFor(profile, cfg.id, index)), per = kind === 'pairs' ? 2 : 1
      smallestPair=Math.min(...inventoryFor(profile).map(p=>checkedLoad(p.w*2)))
      if (!Number.isFinite(smallestPair)) smallestPair=increment
      const inv = inventoryFor(profile).map(p => ({...p, n: checkedLoad(kind === 'single' ? checkedLoad(p.n)*2 : p.n)}))
      // Enumerate quarter-unit totals using the core's finite inventory semantics, then
      // confirm the selected candidate with plateStack (which handles non-greedy stacks).
      let sums = new Set([0])
      for (const p of inv) {
        const next = new Set<number>()
        for (const s of sums) for (let n=0; n<=p.n; n++) next.add(checkedLoad(s+checkedLoad(Math.round(checkedLoad(p.w*4))*n)))
        sums=next
      }
      values = [...sums].sort((a,b)=>a-b).map(q => checkedLoad(base+checkedLoad(per*q)/4))
      const chosen = chooseLoad(values, converted, rounding.mode)
      if (chosen !== null && plateStack((chosen-base)/per, inv).missing !== 0) values=[]
    }
  }
  if (values) {
    inputs.inventory=true
    values.forEach(checkedLoad)
    const load=chooseLoad(values, converted, rounding.mode)
    const tolerance=checkedLoad(Math.max(Math.abs(converted)*0.1,smallestPair))
    if (load !== null && Math.abs(load-converted)>tolerance) {
      inputs.inventoryWarning=true;inputs.roundingTolerance=tolerance;inputs.roundedTo=load
    }
    return { load, inputs }
  }
  const steps = checkedLoad(converted/increment)
  const rounded = (rounding.mode === 'down' ? Math.floor(steps+1e-12) : rounding.mode === 'up' ? Math.ceil(steps-1e-12) : Math.floor(steps+0.5+1e-12))*increment
  return { load: Math.max(0, checkedLoad(Number(rounded.toFixed(10)))), inputs }
}
