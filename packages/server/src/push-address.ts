import net from 'node:net'
import dns from 'node:dns'
import https from 'node:https'
import { parse as parseUrl } from 'node:url'

/** The lookup attached to the socket, never a preflight DNS resolution. */
export function createPushGuard(raw = '', warn: (message: string) => void = console.warn,
  lookup: typeof dns.lookup = dns.lookup) {
const ALLOWED_PRIVATE_IPS = parseAllowedPrivateIps(raw, warn)
function parseAllowedPrivateIps(raw: string, warn: (message: string) => void) {
  const list = new net.BlockList();
  for (const entry of String(raw || '').split(/[\s,]+/).filter(Boolean)) {
    const [from = "", to] = entry.split('-');
    const [addr = "", prefix] = entry.split('/');
    const family = net.isIPv6(addr) || net.isIPv6(from) ? 'ipv6' : 'ipv4';
    try {
      if (to !== undefined) list.addRange(from, to, family);
      else if (prefix !== undefined && /^\d{1,3}$/.test(prefix)) list.addSubnet(addr, +prefix, family);
      else if (net.isIP(entry)) list.addAddress(entry, family);
      else throw new Error('not an address, range or CIDR block');
    } catch {
      warn('ALLOWED_PRIVATE_IPS entry is not a valid address, range or CIDR block — ignored');
    }
  }
  return list;
}


function isAllowedPrivateAddr(v: string) {
  const family = net.isIPv6(v) ? 'ipv6' : net.isIPv4(v) ? 'ipv4' : null;
  return family !== null && ALLOWED_PRIVATE_IPS.check(v.replace(/%.*$/, ''), family);
}

function isPrivateAddr(ip: string) {
  const v = String(ip).toLowerCase();
  if (isAllowedPrivateAddr(v)) return false;
  const m4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(v);
  if (m4) {
    const a = +m4[1]!, b = +m4[2]!;
    if (a === 0 || a === 10 || a === 127) return true;            // this-network, private, loopback
    if (a === 169 && b === 254) return true;                      // link-local (cloud metadata)
    if (a === 172 && b >= 16 && b <= 31) return true;             // private
    if (a === 192 && b === 168) return true;                      // private
    if (a === 192 && b === 0) return true;                        // 192.0.0.0/24, 192.0.2.0/24
    if (a === 100 && b >= 64 && b <= 127) return true;            // CGNAT
    if (a >= 224) return true;                                    // multicast + reserved
    return false;
  }
  // IPv6 is judged on its eight groups, never on the text: the same address arrives as
  // `::ffff:127.0.0.1` from dns.lookup, as `::ffff:7f00:1` from new URL, and in whatever
  // spelling a caller chose, and a rule keyed to one spelling misses the others.
  const g = ipv6Groups(v);
  if (!g) return false;
  if (g.slice(0, 5).every(x => x === 0) && g[5]! === 0xffff) {     // IPv4-mapped IPv6
    return isPrivateAddr(`${g[6]! >> 8}.${g[6]! & 255}.${g[7]! >> 8}.${g[7]! & 255}`);
  }
  if (g.slice(0, 7).every(x => x === 0) && g[7]! <= 1) return true; // unspecified, loopback
  if ((g[0]! & 0xffc0) === 0xfe80) return true;                    // link-local fe80::/10
  if ((g[0]! & 0xfe00) === 0xfc00) return true;                    // unique local fc00::/7
  if ((g[0]! & 0xffc0) === 0xfec0) return true;                    // deprecated site-local fec0::/10
  if ((g[0]! & 0xff00) === 0xff00) return true;                    // multicast, including link/site-local scopes
  if (g[0] === 0x64 && g[1] === 0xff9b && g[2] === 1) return true; // local-use translation 64:ff9b:1::/48
  return false;
}

// The eight 16-bit groups of an IPv6 literal in any textual form — compressed, zero-padded,
// upper-case, with a dotted IPv4 tail — or null when the string is not one.
function ipv6Groups(v: string): number[] | null {
  if (!net.isIPv6(v)) return null;
  let s = v.replace(/%.*$/, '');                                  // zone id
  const m4 = /:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(s);
  if (m4) {
    const [a = 0, b = 0, c = 0, d = 0] = m4[1]!.split('.').map(Number);
    s = s.slice(0, -m4[1]!.length) + ((a << 8) | b).toString(16) + ':' + ((c << 8) | d).toString(16);
  }
  const [head, tail = ''] = s.split('::');
  const groups = head ? head.split(':') : [];
  const rest = tail ? tail.split(':') : [];
  if (s.includes('::')) while (groups.length + rest.length < 8) groups.push('0');
  return groups.concat(rest).map(x => parseInt(x, 16));
}

// Same shape as dns.lookup, so https.Agent can use it directly.
const guardedLookup: net.LookupFunction = (hostname, options, cb) => {
  // Always inspect the entire answer, including when the caller asks for one address.
  lookup(hostname, { ...options, all: true }, (err, address) => {
    if (err) return cb(err, '', 0);
    if (!address.length || address.some(a => !net.isIP(a.address) || isPrivateAddr(a.address))) {
      return cb(blocked(hostname), '', 0);
    }
    if (options.all) cb(null, address);
    else cb(null, address[0]!.address, address[0]!.family);
  });
};
function blocked(host: string) {
  return Object.assign(new Error('refusing to connect to a private address: ' + host), { code: 'EPUSHBLOCKED' });
}
class PushAgent extends https.Agent {
  override createConnection(options: https.RequestOptions,
    callback?: Parameters<https.Agent['createConnection']>[1]) {
    const host = String(options.host || options.hostname || '').replace(/^\[|\]$/g, '');
    // Literal IPs bypass Node's lookup hook. Normalize alternate numeric spellings here too,
    // so this guard holds even when a caller bypasses endpoint validation completely.
    let canonical: string;
    try { canonical = new URL(`https://${host.includes(':') ? `[${host}]` : host}`).hostname.replace(/^\[|\]$/g, ''); }
    catch { canonical = ''; }
    if (!canonical || (net.isIP(canonical) && isPrivateAddr(canonical))) {
      const socket = new net.Socket();
      process.nextTick(() => socket.destroy(blocked(host)));
      return socket;
    }
    // Force our lookup even if request options provide another one. Each DNS answer is
    // checked in the socket's lookup and handed straight to connect, without re-resolution.
    const socket = super.createConnection({ ...options, host: canonical, lookup: guardedLookup }, callback) as net.Socket;
    socket.prependOnceListener('connect', () => {
      const peer = socket.remoteAddress;
      if (!peer || !net.isIP(peer) || isPrivateAddr(peer)) socket.destroy(blocked(peer || host));
    });
    return socket;
  }
}
const PUSH_AGENT = new PushAgent({ lookup: guardedLookup, keepAlive: false });

// Cheap pre-check so a bad endpoint is refused at subscribe time with a useful message, rather
// than silently never delivering. For a hostname PUSH_AGENT is what actually enforces the address
// rule for both hostnames and literal addresses at connection time.
function pushEndpointError(raw: unknown): string | null {
  let u;
  try { u = new URL(String(raw || '')); } catch { return 'endpoint is not a valid URL'; }
  if (u.protocol !== 'https:') return 'endpoint must be an https:// URL';
  if (u.username || u.password) return 'endpoint must not carry credentials';
  // web-push parses URLs with legacy url.parse. Reject ambiguity before transport, and
  // sendPush supplies only u.href so path/host normalization cannot change its destination.
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (/^[0-9.]+$/.test(host) || host.includes(':')) {
    if (isPrivateAddr(host)) return 'endpoint must not point at a private address';
  }
  try {
    if (parseUrl(String(raw)).hostname?.replace(/^\[|\]$/g, '') !== host
      || parseUrl(u.href).hostname?.replace(/^\[|\]$/g, '') !== host) return 'endpoint has an ambiguous hostname';
  } catch { return 'endpoint is not a valid URL'; }
  return null;
}


return { isPrivateAddr, pushEndpointError, guardedLookup, agent: PUSH_AGENT }
}
