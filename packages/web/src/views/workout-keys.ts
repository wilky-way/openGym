import { useRef } from 'react'

interface Keyed { key: string; value: string; shape: string }
let sequence = 0
/** Ephemeral React identities survive W07 clones and permutations without writing to the document.
 * Exact matches move first. A single edited object retains its key; ambiguous duplicates on a
 * structural edit get new keys, cancelling their gestures instead of reusing another occurrence. */
export function useWorkoutKeys(items: any[], shape: (item: any) => unknown): string[] {
  const previous = useRef<Keyed[]>([])
  const before = previous.current, used = new Set<number>()
  const next = items.map(item => ({ key: '', value: JSON.stringify(item), shape: JSON.stringify(shape(item)) }))
  // One field edit may make a row byte-identical to its neighbor. Its occurrence has stayed
  // put: reserve the existing identities before exact matching can steal the neighbor's key.
  if (before.length === next.length && next.filter((item, at) => item.value !== before[at]!.value).length === 1) {
    const at = next.findIndex((item, i) => item.value !== before[i]!.value)
    if (next[at]!.shape === before[at]!.shape) {
      next.forEach((item, i) => { item.key = before[i]!.key })
      previous.current = next
      return next.map(item => item.key)
    }
  }
  // Cascade edits can change several inherited rows in one producer. A same-shape edit is
  // distinguished from an exact permutation by its value multiset, keeping typing anchored.
  const permutation = before.length === next.length && before.map(item => item.value).sort().join('\n') === next.map(item => item.value).sort().join('\n')
  if (before.length === next.length && !permutation && next.every((item, at) => item.shape === before[at]!.shape)) {
    next.forEach((item, at) => { item.key = before[at]!.key })
    previous.current = next
    return next.map(item => item.key)
  }
  for (const item of next) {
    const candidates = before.map((old, at) => old.value === item.value && !used.has(at) ? at : -1).filter(at => at >= 0)
    if (candidates.length === 1 || (candidates.length > 1 && before.length === next.length)) {
      const at = candidates[0]!
      used.add(at); item.key = before[at]!.key
    }
  }
  const unmatched = next.filter(item => !item.key)
  const remaining = before.filter((_, at) => !used.has(at))
  if (before.length === next.length && unmatched.length === 1 && remaining.length === 1 && unmatched[0]!.shape === remaining[0]!.shape) unmatched[0]!.key = remaining[0]!.key
  for (const item of next) if (!item.key) item.key = `workout-${++sequence}`
  previous.current = next
  return next.map(item => item.key)
}
