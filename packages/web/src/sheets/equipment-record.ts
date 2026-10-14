import type { StoreDocument } from '../store/useStore'
import type { FormEvent } from 'react'

/** Keep opaque fields when legacy equipment helpers rebuild one stamped record. */
export function preserveEquipmentRecord(existing: StoreDocument | undefined, next: StoreDocument, key: string, resetPlates = false): StoreDocument {
  const record = existing?.[key]
  const opaque = record && typeof record === 'object' && !Array.isArray(record)
    ? Object.fromEntries(Object.entries(record).filter(([field]) => !resetPlates || !(Number(field) > 0)))
    : {}
  return { ...next, [key]: { ...opaque, ...next[key] } }
}

/** Match the inventory's practical weight bound; reject before invoking any producer. */
export const validEquipmentNumber = (value: number): boolean => Number.isFinite(value) && value >= 0 && value <= 9999

/** NumberField drops minus signs; reject signed/overflow input before its normalization. */
export function rejectInvalidEquipmentInput(event: FormEvent, reject: () => void): void {
  const raw = (event.target as HTMLInputElement).value.trim().replace(/,/g, '.')
  if (!raw || raw === '.') return
  const value = Number(raw)
  if (/[-−]/.test(raw) || (!Number.isNaN(value) && !validEquipmentNumber(value)) || /^(?:[+]?Infinity|NaN)$/i.test(raw)) {
    event.stopPropagation()
    reject()
  }
}
