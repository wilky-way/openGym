import { realpathSync, statSync } from 'node:fs'
import { resolve, relative, sep, extname } from 'node:path'
import { secureResponse } from './security-headers'

/** Only public build assets; no source maps, dotfiles, directories or escaping symlinks. */
export function staticHandler(directory: string, basePath = '') {
  const root = realpathSync(directory)
  const allowed = new Set(['.html', '.js', '.css', '.json', '.webmanifest', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.ico', '.svg', '.woff', '.woff2', '.mp4', '.txt'])
  const blocked = (path: string) => path.split('/').some(part => part.startsWith('.') || /^(legacy|tests?|private|data|node_modules)$/i.test(part))
  return (request: Request): Response | undefined => {
    const url = new URL(request.url)
    if (basePath && url.pathname === basePath) return secureResponse(new Response(null, { status: 302, headers: { Location: basePath + '/' + url.search } }))
    if (basePath && !url.pathname.startsWith(basePath + '/')) return secureResponse(new Response(null, { status: 404 }))
    const target = url.pathname.slice(basePath.length)
    // Preserve S01's legacy parsing of network-path targets at the root.
    const apiPath = new URL(target + url.search, 'http://x').pathname
    if (apiPath === '/api' || apiPath.startsWith('/api/')) return
    if (request.method === 'OPTIONS') return
    if (!['GET', 'HEAD'].includes(request.method)) return secureResponse(new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } }), target)
    let path: string
    try { path = decodeURIComponent(target) } catch { return secureResponse(new Response(null, { status: 404 })) }
    const respond = (body: BodyInit | null, init: ResponseInit = {}) => secureResponse(new Response(body, init), path)
    if (blocked(path) || path.includes('\\') || path.includes('\0') || path.includes('//') || /%2f/i.test(target)) return respond(null, { status: 404 })
    // Catalogue-only media. Custom uploads and arbitrary files never become media routes.
    if (path.toLowerCase().startsWith('/exercise-media/') && !/^\/exercise-media\/(still\/\d{4,5}\.webp|clip\/\d{4,5}\.mp4)$/.test(path)) return respond(null, { status: 404 })
    const candidate = resolve(root, '.' + (path === '/' ? '/index.html' : path))
    try {
      const file = realpathSync(candidate), within = relative(root, file), info = statSync(file)
      if (within.startsWith('..' + sep) || within === '..' || blocked(within.split(sep).join('/')) || !info.isFile() || !allowed.has(extname(file).toLowerCase())) return respond(null, { status: 404 })
      const headers = new Headers()
      headers.set('Cache-Control', /\.(js|css|json|html|webmanifest)$/i.test(file) ? 'no-cache, must-revalidate' : 'public, max-age=2592000, immutable')
      const etag = `W/"${info.size}-${info.mtimeMs}"`
      headers.set('ETag', etag)
      headers.set('Last-Modified', info.mtime.toUTCString())
      if ((request.headers.get('if-none-match') || '').split(',').some(tag => tag.trim() === etag || tag.trim() === '*')) return respond(null, { status: 304, headers })
      const asset = Bun.file(file)
      headers.set('Content-Type', asset.type)
      headers.set('Content-Length', String(asset.size))
      headers.set('Accept-Ranges', 'bytes')
      // A single range covers exercise video seeking. Multiple ranges use the full response.
      const range = request.headers.get('range')
      const ifRange = request.headers.get('if-range')
      const match = range && /^bytes=(\d*)-(\d*)$/.exec(range)
      if (request.method === 'GET' && match && (!ifRange || ifRange === info.mtime.toUTCString())) {
        const start = match[1] ? Number(match[1]) : Math.max(0, asset.size - Number(match[2]))
        const end = match[1] && match[2] ? Math.min(asset.size - 1, Number(match[2])) : asset.size - 1
        if ((!match[1] && !Number(match[2])) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= asset.size) {
          headers.set('Content-Range', `bytes */${asset.size}`); headers.delete('Content-Length')
          return respond(null, { status: 416, headers })
        }
        headers.set('Content-Range', `bytes ${start}-${end}/${asset.size}`)
        headers.set('Content-Length', String(end - start + 1))
        return respond(asset.slice(start, end + 1), { status: 206, headers })
      }
      // Bun also recognizes its file-backed stream and applies Range itself.
      // A regular stream keeps the full-body fallback independent of that path.
      if (request.method === 'HEAD') return respond(null, { headers })
      const reader=asset.stream().getReader()
      const body=new ReadableStream({
        async pull(controller) {
          const chunk=await reader.read()
          if (chunk.done) controller.close(); else controller.enqueue(chunk.value)
        },
        cancel(reason) { return reader.cancel(reason) },
      })
      return respond(body, { headers })
    } catch {
      if (extname(path)) return respond(null, { status: 404 })
      return respond(null, { status: 302, headers: { Location: basePath + '/' + url.search } })
    }
  }
}
