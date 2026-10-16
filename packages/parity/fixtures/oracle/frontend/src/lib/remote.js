import { pairRedeem, setRemoteAuth } from './api.js'

// Accepts what someone actually types: bare host, no scheme, trailing slash, stray whitespace.
// Defaults to https:// (self-hosting docs already push for HTTPS; the one exception, localhost,
// still parses fine without a scheme). Returns null for anything that isn't a usable URL at all.
export function normalizeServerUrl(raw) {
  const s = String(raw || '').trim()
  if (!s) return null
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : 'https://' + s
  try {
    const u = new URL(withScheme)
    if (!u.hostname) return null
    return u.origin
  } catch (e) { return null }
}

export { looksLocal } from './api.js'

// Host-independent pairing helpers. The host owns persistence of its connection.
export function forgetRemote() { setRemoteAuth('', null) }

export function renewToken(remote, token) {
  setRemoteAuth(remote.base, token)
}

export async function connect(rawUrl, code) {
  const base = normalizeServerUrl(rawUrl)
  if (!base) throw new Error('Enter a valid server address')
  const { token, user } = await pairRedeem(base, String(code || '').trim())
  setRemoteAuth(base, token)
  return user
}
