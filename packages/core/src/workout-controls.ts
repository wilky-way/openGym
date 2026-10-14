// Optional control groups shown alongside workout sets.
export const WC_DEFAULT = Object.freeze({
  steppers: true,
  setShortcuts: false,
  pairButtons: false,
  exerciseButtons: false,
  exerciseChips: true,
  swipeSets: true,
} as const)

/** Retain the saved document's own values, including unknown passthrough controls. */
export function workoutControls(S: unknown): Record<string, unknown> {
  const saved = S && (S as { readonly wc?: unknown }).wc
  return { ...WC_DEFAULT, ...((saved || {}) as object) }
}
