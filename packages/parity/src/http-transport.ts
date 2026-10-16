import { request as httpRequest } from 'node:http'
import type { Socket } from 'node:net'
import { decodeBytes, encodeBytes, type ParityRequest, type ParityResponse } from './types'

/** Literal loopback dialing, no proxy environment, redirects, retries or pooled sockets. */
export async function directRequest(port: number, request: ParityRequest, headers: Record<string, string> = request.headers ?? {}, authorize?: (socket: Socket) => Promise<void>): Promise<ParityResponse> {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid parity port')
  if (!request.path.startsWith('/') || request.path.startsWith('//')) throw new Error('Parity requests must use an origin-relative path')
  // Node flushes Expect headers from the constructor, before the socket callback.
  // Refuse this raw-HTTP feature before constructing any authenticated request.
  if (authorize && Object.keys(headers).some(key => key.toLowerCase() === 'expect')) throw new Error('Oracle harness rejects Expect headers before socket authorization')
  const body = request.body ? decodeBytes(request.body) : undefined
  const wireHeaders = { ...headers }
  if (body && !Object.keys(headers).some(key => ['content-length', 'transfer-encoding'].includes(key.toLowerCase()))) wireHeaders['Content-Length'] = String(body.length)
  return new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: '127.0.0.1', port, path: request.path, method: request.method, headers: wireHeaders, agent: false }, res => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)))
      res.once('error', fail)
      res.once('aborted', () => fail(new Error('Parity response aborted')))
      res.once('end', () => {
        clearTimeout(timer)
        const selected: Record<string, string[]> = {}
        for (let i = 0; i < res.rawHeaders.length; i += 2) {
          const key = res.rawHeaders[i]!.toLowerCase(), value = res.rawHeaders[i + 1]!
          if (key === 'set-cookie') (selected[key] ??= []).push(value)
          else selected[key] = [selected[key] ? `${selected[key]![0]}, ${value}` : value]
        }
        resolve({ status: res.statusCode!, headers: selected, body: encodeBytes(Buffer.concat(chunks)) })
      })
    })
    const fail = (error: Error) => { clearTimeout(timer); req.destroy(); reject(error) }
    const timer = setTimeout(() => fail(new Error('Parity HTTP request timed out')), 20000)
    req.once('error', fail)
    req.once('socket', socket => {
      socket.once('connect', () => {
        // http.request queues headers until end/write. Verify the connected peer first:
        // once connected, a port reuse cannot replace the peer of this socket.
        void (async () => {
          await authorize?.(socket)
          if (socket.destroyed) throw new Error('Parity socket closed before authorization')
          req.end(body)
        })().catch(fail)
      })
    })
  })
}
