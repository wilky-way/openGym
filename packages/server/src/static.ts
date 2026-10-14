import { realpathSync, statSync } from 'node:fs'
import { resolve, relative, sep, extname } from 'node:path'

/** Only public build assets; no source maps, dotfiles, directories or escaping symlinks. */
export function staticHandler(directory: string) {
  const root = realpathSync(directory)
  const allowed = new Set(['.html', '.js', '.css', '.json', '.webmanifest', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.ico', '.svg', '.woff', '.woff2', '.mp4', '.txt'])
  const blocked = (path: string) => path.split('/').some(part => part.startsWith('.') || /^(legacy|tests?|private|data|node_modules)$/i.test(part))
  return (request: Request): Response | undefined => {
    const url = new URL(request.url)
    // Preserve legacy parsing of network-path targets such as //other/api/health.
    const apiPath = new URL(url.pathname + url.search, 'http://x').pathname
    if (apiPath === '/api' || apiPath.startsWith('/api/')) return
    if (!['GET', 'HEAD'].includes(request.method)) return
    let path: string
    try { path = decodeURIComponent(url.pathname) } catch { return new Response(null, { status: 404 }) }
    if (blocked(path) || path.includes('\\') || path.includes('\0')) return new Response(null, { status: 404 })
    const candidate = resolve(root, '.' + (path === '/' ? '/index.html' : path))
    try {
      const file = realpathSync(candidate), within = relative(root, file)
      if (within.startsWith('..' + sep) || within === '..' || blocked(within.split(sep).join('/')) || !statSync(file).isFile() || !allowed.has(extname(file).toLowerCase())) return new Response(null, { status: 404 })
      const headers = new Headers({ 'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'Content-Security-Policy': "frame-ancestors 'none'" })
      headers.set('Cache-Control', /\.(js|css|json|html|webmanifest)$/i.test(file) ? 'no-cache, must-revalidate' : 'public, max-age=2592000, immutable')
      if (path.startsWith('/exercise-media/')) headers.set('Cross-Origin-Resource-Policy', 'same-origin')
      const asset = Bun.file(file)
      headers.set('Content-Type', asset.type)
      headers.set('Content-Length', String(asset.size))
      return new Response(request.method === 'HEAD' ? null : asset, { headers })
    } catch {
      if (extname(path)) return new Response(null, { status: 404 })
      return new Response(null, { status: 302, headers: { Location: '/' + url.search } })
    }
  }
}
