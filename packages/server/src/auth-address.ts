import { isIPv6 } from 'node:net'
import type { ServerConfig } from './config'
function ipv6Groups(v: string): number[] | null {
  if (!isIPv6(v)) return null
  let s = v.replace(/%.*$/, '')
  const m4 = /:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(s)
  if (m4) {
    const [a = 0, b = 0, c = 0, d = 0] = m4[1]!.split('.').map(Number)
    s =
      s.slice(0, -m4[1]!.length) +
      ((a << 8) | b).toString(16) +
      ':' +
      ((c << 8) | d).toString(16)
  }
  const [head, tail = ''] = s.split('::'),
    groups = head ? head.split(':') : [],
    rest = tail ? tail.split(':') : []
  if (s.includes('::')) while (groups.length + rest.length < 8) groups.push('0')
  return groups.concat(rest).map((x) => parseInt(x, 16))
}
export function limitAddress(
  request: Request,
  config: Pick<ServerConfig, 'trustProxy'>,
  socket = '',
): string {
  let raw = socket
  if (config.trustProxy) {
    const xff = (request.headers.get('x-forwarded-for') || '')
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean)
    raw =
      (request.headers.get('cf-connecting-ip') || '').trim() ||
      xff.at(-1) ||
      (request.headers.get('x-real-ip') || '').trim() ||
      socket
  }
  raw = raw.replace(/^\[|\]$/g, '')
  const g = ipv6Groups(raw.toLowerCase())
  if (g) {
    if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff)
      return `${g[6]! >> 8}.${g[6]! & 255}.${g[7]! >> 8}.${g[7]! & 255}`
    return (
      g
        .slice(0, 4)
        .map((x) => x.toString(16))
        .join(':') + '::/64'
    )
  }
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(raw) ? raw : 'unknown'
}

/** Audit IP retention follows legacy net/full modes; proxy fields require explicit trust. */
export function clientIp(
  request: Request,
  config: Pick<ServerConfig, 'trustProxy' | 'audit'>,
  socket = '',
): string | null {
  if (config.audit.ip === 'off') return null
  let raw = socket.replace(/^::ffff:/, '').trim()
  if (config.trustProxy)
    raw =
      (request.headers.get('cf-connecting-ip') || '').trim() ||
      (request.headers.get('x-forwarded-for') || '').split(',')[0]!.trim() ||
      (request.headers.get('x-real-ip') || '').trim() ||
      raw
  const ip = raw.replace(/^\[|\]$/g, '').slice(0, 45)
  if (!/^[0-9a-fA-F:.]{3,45}$/.test(ip)) return null
  if (config.audit.ip === 'full') return ip
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip))
    return ip.replace(/\.\d{1,3}$/, '.0/24')
  const g = ip.split(':').filter(Boolean).slice(0, 3).join(':')
  return g ? g + '::/48' : null
}
