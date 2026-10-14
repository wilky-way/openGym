/** Session-scoped proof is recorded before navigation; unavailable storage means stay in-app. */
export function claimBrowserRecoveryReload(fingerprint: string): boolean {
  try {
    if (typeof window === 'undefined') return false
    const storage = window.sessionStorage, key = 'gym_ownership_reload_attempts'
    const values: unknown = JSON.parse(storage.getItem(key) || '[]')
    if (!Array.isArray(values) || !values.every(value => typeof value === 'string')) return false
    if (values.includes(fingerprint)) return false
    const next = JSON.stringify([...values, fingerprint])
    storage.setItem(key, next)
    return storage.getItem(key) === next
  } catch { return false }
}
