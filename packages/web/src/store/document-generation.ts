/** Reserve the generation before replacing bytes. A failed later write-id
 * publication must never make callbacks from the previous document valid.
 * Peers may conservatively invalidate an editor during preflight; rollback
 * restores the reservation if the primary write fails. */
export function documentGeneration(wid: string | null, cached: string | null): number | null {
  const match = /^g(\d+):/.exec(wid || '')
  const published = match ? Number(match[1]) : NaN
  const prepared = cached === null ? NaN : Number(cached)
  const generations = [published, prepared].filter(n => Number.isSafeInteger(n) && n >= 0)
  return generations.length ? Math.max(...generations) : null
}
