type Value = null | boolean | number | string | Value[] | { [key: string]: Value }
/** Only the named nondeterminism is removed. Unknown fields, array order, exercise
 * ids, prescriptions, history, active sessions and every reference remain compared. */
export function normalizeE2E(document: Value, options: { preActivation?: boolean } = {}): Value {
  const aliases = new Map<string, string>()
  const prefix = Date.parse('2026-10-12T17:00:00Z').toString(36)
  const generated = new RegExp(prefix + '[a-z0-9]{5}', 'g')
  const replace = (text: string) => text.replace(generated, id => {
    if (!aliases.has(id)) aliases.set(id, `generated-${aliases.size + 1}`)
    return aliases.get(id)!
  })
  const recordPath = (path: string[]) => path[0] === 'programmes' && (
    path.length === 1 || path[1] === 'definitions' && path.length === 3 ||
    path[1] === 'cycles' && (path.length === 3 || path.length === 4 && path[3] === 'snapshot' || path.length === 5 && path[3] === 'occurrences'))
  function visit(value: Value, path: string[]): Value {
    if (typeof value === 'string') return replace(value)
    const parent = path.slice(0, -1)
    if (typeof value === 'number' && (parent.join('.') === 'edited' || parent.at(-1) === '_f' && recordPath(parent.slice(0, -1)))) return '<stamp>'
    if (!value || typeof value !== 'object') return value
    if (Array.isArray(value)) return value.map((v, i) => visit(v, [...path, String(i)]))
    const result: Record<string, Value> = {}
    for (const [key, child] of Object.entries(value)) {
      // Server-only transport metadata is not user document content.
      if (path.length === 0 && ['_rev', '_wid', '_wids', '_prior', '_unstamped'].includes(key)) continue
      // Stamps describe merge/write provenance. Installation creates different
      // per-field stamps from the oracle's initial API-written definition.
      const syntheticSnapshot = path[0] === 'programmes' && path[1] === 'cycles' && path.length === 4 && path[3] === 'snapshot' && value.id === 'i01-synthetic'
      // A snapshot cloned from the oracle's initially API-stamped definition has
      // stamps, while the identical S08 body is unstamped. Only this fixture seam.
      if (syntheticSnapshot && ['_ts', '_f'].includes(key)) continue
      if (path.join('.') === 'programmes' && key === '_f' && child && typeof child === 'object' && !Array.isArray(child)) {
        const other = Object.fromEntries(Object.entries(child).filter(([field]) => field !== 'installed'))
        if (Object.keys(other).length) result[key] = visit(other, [...path, key])
        continue
      }
      if (path.join('.') === 'programmes' && key === '_ts' && value.installed && value._f && typeof value._f === 'object' && !Array.isArray(value._f) && Object.keys(value._f).every(field => field === 'installed')) continue
      if (key === '_ts' && path.length === 0) continue
      if (key === '_ts' && recordPath(path) && typeof child === 'number') { result[key] = '<stamp>'; continue }
      if (key === '_ts' && typeof child === 'number' && ['routines', 'workouts'].includes(path[0] ?? '') && path.length === 2) {
        result[key] = '<stamp>'
        continue
      }
      // S08 library installation is new, approved by GM for this baseline.
      if (path.join('.') === 'programmes' && key === 'installed' && child && typeof child === 'object' && !Array.isArray(child)) {
        const other = Object.fromEntries(Object.entries(child).filter(([id]) => id !== 'i01-synthetic'))
        if (Object.keys(other).length) result[key] = visit(other, [...path, key])
        continue
      }
      if (options.preActivation && path.join('.') === 'programmes' && key === 'definitions' && Array.isArray(child)) {
        result[key] = visit(child.filter(d => !d || typeof d !== 'object' || Array.isArray(d) || d.id !== 'i01-synthetic'), [...path, key])
        continue
      }
      result[replace(key)] = visit(child, [...path, key])
    }
    return result
  }
  return visit(document, [])
}

export function e2eDifferences(left: Value, right: Value, path = '$'): string[] {
  if (Object.is(left, right)) return []
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object' || Array.isArray(left) !== Array.isArray(right)) return [path]
  const a = left as Record<string, Value>, b = right as Record<string, Value>
  const differences: string[] = []
  if (!Array.isArray(left) && Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(k => Object.hasOwn(b, k)) && Object.keys(a).join('\0') !== Object.keys(b).join('\0')) differences.push(`${path}.<key-order>`)
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (!Object.hasOwn(a, key) || !Object.hasOwn(b, key)) differences.push(`${path}.${key}`)
    else differences.push(...e2eDifferences(a[key]!, b[key]!, `${path}.${key}`))
  }
  return differences
}
