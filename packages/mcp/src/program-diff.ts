import { error } from './http-client'

type Row = Record<string, any>
export interface DiffEntry {
  kind: 'added' | 'removed' | 'changed' | 'moved'
  location: Row; field?: string; before?: unknown; after?: unknown
}
const same = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b)) return true
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => same(v, b[i]))
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const x = a as Row, y = b as Row, keys = Object.keys(x)
    return keys.length === Object.keys(y).length && keys.every(k => Object.hasOwn(y, k) && same(x[k], y[k]))
  }
  return false
}
/** Compare stable authoring identities, including explicit ordering changes. */
export function diffDefinitions(from: Row, to: Row): DiffEntry[] {
  const entries: DiffEntry[] = []
  const fields = (a: Row, b: Row, location: Row, omit: string[] = []) => {
    for (const field of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if ((omit.includes(field) && Object.hasOwn(a, field) && Object.hasOwn(b, field)) || same(a[field], b[field])) continue
      entries.push({ kind: 'changed', location, field, ...(Object.hasOwn(a, field) ? { before: a[field] } : {}), ...(Object.hasOwn(b, field) ? { after: b[field] } : {}) })
    }
  }
  const keyed = (rows: Row[], key: string): Map<string | number, { row: Row; position: number }> => {
    if (!Array.isArray(rows)) throw error('EINVAL', 'Diff requires arrays of stable authoring identities.')
    const result = new Map<string | number, { row: Row; position: number }>()
    rows.forEach((row, position) => {
      const id = row?.[key]
      if (!(typeof id === 'string' && id || typeof id === 'number' && Number.isSafeInteger(id)) || result.has(id)) throw error('EINVAL', `Diff requires unique ${key} identities; changed anonymous collections cannot be matched safely.`)
      result.set(id, { row, position })
    })
    return result
  }
  const collection = (a: Row[], b: Row[], key: string, part: string, location: Row, visit: (a: Row, b: Row, loc: Row) => void) => {
    if (same(a, b)) return
    const left = keyed(a, key), right = keyed(b, key)
    for (const id of new Set([...left.keys(), ...right.keys()])) {
      const x = left.get(id), y = right.get(id), loc = { ...location, [part]: id }
      if (!x) entries.push({ kind: 'added', location: loc, after: y!.row })
      else if (!y) entries.push({ kind: 'removed', location: loc, before: x.row })
      else {
        if (x.position !== y.position) entries.push({ kind: 'moved', location: loc, before: x.position, after: y.position })
        visit(x.row, y.row, loc)
      }
    }
  }
  fields(from, to, {}, ['weeks'])
  collection(from.weeks ?? [], to.weeks ?? [], 'index', 'week', {}, (a, b, week) => {
    fields(a, b, week, ['days'])
    collection(a.days ?? [], b.days ?? [], 'key', 'day', week, (a, b, day) => {
      fields(a, b, day, ['sessions'])
      collection(a.sessions ?? [], b.sessions ?? [], 'sessionTemplateId', 'session', day, (a, b, session) => {
        fields(a, b, session, ['routineSnapshot'])
        fields(a.routineSnapshot ?? {}, b.routineSnapshot ?? {}, session, ['ex'])
        collection(a.routineSnapshot?.ex ?? [], b.routineSnapshot?.ex ?? [], 'slotId', 'slot', session, (a, b, slot) => fields(a, b, slot))
      })
    })
  })
  return entries
}
export function conformanceDelta(from: Row, to: Row, fromDefinition?: Row, toDefinition?: Row): Row {
  const identity = (issue: Row, definition?: Row) => {
    const location = { ...issue.location }
    // Above slot level, schema issues only have paths. Resolve their ancestors
    // in the corresponding definition before replacing positional path segments.
    if (definition && typeof location.path === 'string') {
      const parts = location.path.split('/').slice(1)
      const keys: Record<string, [string, string]> = { weeks: ['week', 'index'], days: ['day', 'key'], sessions: ['session', 'sessionTemplateId'], ex: ['slot', 'slotId'] }
      let node: any = definition
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i]!, key = keys[part]
        node = node?.[part]
        if (key && /^\d+$/.test(parts[i + 1] ?? '')) {
          node = node?.[Number(parts[++i])]
          const id = node?.[key[1]]
          if (typeof id === 'string' && id || typeof id === 'number' && Number.isSafeInteger(id)) location[key[0]] = id
        }
      }
    }
    // Schema issue paths use array positions; stable location keys carry identity.
    if (typeof location.path === 'string') for (const [collection, part] of [['weeks', 'week'], ['days', 'day'], ['sessions', 'session'], ['ex', 'slot']] as const) {
      if (location[part] !== undefined) location.path = location.path.replace(new RegExp('/' + collection + '/\\d+(?=/|$)', 'g'), '/' + collection + '/*')
    }
    return JSON.stringify([issue.code, Object.entries(location).sort(([a], [b]) => a.localeCompare(b)), issue.requiredFor])
  }
  const a = new Set(from.issues.map((i: Row) => identity(i, fromDefinition))), b = new Set(to.issues.map((i: Row) => identity(i, toDefinition)))
  return { from, to, resolved: from.issues.filter((i: Row) => !b.has(identity(i, fromDefinition))), introduced: to.issues.filter((i: Row) => !a.has(identity(i, toDefinition))) }
}
