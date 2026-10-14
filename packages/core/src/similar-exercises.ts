/** The primary target muscle used by a swap picker, or an empty string. */
type SwapExercise = { tg?: unknown; id?: unknown; eq?: unknown }
export const swapMuscleOf = (ex: unknown): string =>
  ex && typeof (ex as SwapExercise).tg === 'string' ? (ex as SwapExercise).tg as string : ''

/** Same primary muscle, excluding the source; matching equipment first, stable within each half. */
export function sameMuscleFirst<T extends SwapExercise>(list: readonly (T | null | undefined)[], ex: SwapExercise | null | undefined): T[] {
  const tg = swapMuscleOf(ex)
  if (!tg) return []
  const eq = ex!.eq || ''
  return list
    .filter((e): e is T => !!e && e.tg === tg && e.id !== ex!.id)
    .sort((a, b) => Number(!!eq && b.eq === eq) - Number(!!eq && a.eq === eq))
}
