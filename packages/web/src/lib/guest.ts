/** An unavailable config never locks a local athlete out. */
export const guestAllowed = (config?: Record<string, unknown> | null) => config?.allow_guest !== false
