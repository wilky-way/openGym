/** Same factor as core units; unlike profile conversion this never rounds an intermediate. */
export const LB_PER_KG = 2.2046226218
export function convertWeightPrecise(value: number, from: 'lb'|'kg', to: 'lb'|'kg'): number {
  checkedLoad(value)
  return checkedLoad(from === to ? value : to === 'lb' ? value*LB_PER_KG : value/LB_PER_KG)
}

export class InvalidLoadError extends Error {
  constructor() { super('A load calculation is non-finite; correct the load inputs before prescribing weights.') }
}
export function checkedLoad(value: number): number {
  if (!Number.isFinite(value)) throw new InvalidLoadError()
  return value
}
