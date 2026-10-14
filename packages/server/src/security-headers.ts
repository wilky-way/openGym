/** Mirrors nginx's `always` headers, including errors and standalone static serving. */
export const SECURITY_HEADERS = {
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'Content-Security-Policy': "frame-ancestors 'none'",
} as const

export function secureResponse(response: Response, path = ''): Response {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) response.headers.set(key, value)
  try { path = decodeURIComponent(path) } catch { /* malformed media suffix still receives CORP */ }
  if (path.startsWith('/exercise-media/')) response.headers.set('Cross-Origin-Resource-Policy', 'same-origin')
  return response
}

/** Config diagnostics retain host information without URL credentials/query secrets. */
export function bootAddress(rpId: string, origin: string): string {
  let publicOrigin = '[invalid]'
  try { publicOrigin = new URL(origin).origin } catch { /* fixed diagnostic */ }
  return `rpID=${/^[A-Za-z0-9.-]+$/.test(rpId) ? rpId : '[invalid]'}, origin=${publicOrigin}`
}
