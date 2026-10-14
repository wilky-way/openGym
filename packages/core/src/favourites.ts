// Favourite exercises: stable personal ordering, kept out of shared plan bundles.
interface FavouriteState { favEx?: unknown }
interface Identified { id?: string }
interface UsageState { routines?: { ex?: Identified[] }[]; workouts?: { entries?: Identified[] }[] }
export const favIds = (S?: FavouriteState | null): string[] => Array.isArray(S?.favEx) ? S.favEx : []
export const isFav = (S: FavouriteState | null | undefined, id?: string): boolean => favIds(S).includes(id as string)
/** Flip one exercise in a state draft. Returns true when it is a favourite afterwards. */
export function toggleFav(s: FavouriteState, id: string): boolean {
  const list = favIds(s)
  const on = !list.includes(id)
  s.favEx = on ? [...list, id] : list.filter(x => x !== id)
  return on
}
/** Stable partition; preserve the original list identity when no favourites exist. */
export function sortFavouritesFirst<T extends Identified>(list: T[], S?: FavouriteState | null): T[] {
  const fav = favIds(S)
  if (!fav.length) return list
  const set = new Set<string | undefined>(fav)
  return [...list.filter(e => set.has(e.id)), ...list.filter(e => !set.has(e.id))]
}
/** Favourites, then used exercises, then the rest, in the search's order. */
export function sortYoursFirst<T extends Identified>(list: T[], S?: FavouriteState | null, usage?: Record<string, number> | null): T[] {
  const fav = new Set<string | undefined>(favIds(S))
  const group = (e: T) => fav.has(e.id) ? 0 : usage?.[String(e.id)] ? 1 : 2
  if (!fav.size && !list.some(e => usage?.[String(e.id)])) return list
  return [0, 1, 2].flatMap(g => list.filter(e => group(e) === g))
}
/** How often each exercise occurs in a routine or logged workout. */
export function usageOf(S?: UsageState | null): Record<string, number> {
  const u: Record<string, number> = {}
  for (const r of S?.routines || []) for (const e of r.ex || []) u[String(e.id)] = (u[String(e.id)] || 0) + 1
  for (const w of S?.workouts || []) for (const e of w.entries || []) u[String(e.id)] = (u[String(e.id)] || 0) + 1
  return u
}
