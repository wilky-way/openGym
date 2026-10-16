// Test-only preload for the bounded synthetic request recorder and its Node children.
import { Server } from 'node:net'
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const expected = realpathSync(fileURLToPath(new URL('../packages/parity/fixtures/oracle/api/', import.meta.url)))
if (process.env.OPENGYM_CORPUS_HARNESS !== 'synthetic-node-recording-v1' || realpathSync(process.cwd()) !== expected) {
  throw new Error('Corpus loopback preload requires the owned synthetic oracle API context')
}
const loopback = host => {
  if (host === undefined || host === null) return '127.0.0.1'
  if (host !== '127.0.0.1' && host !== '::1') throw new Error('Corpus listeners must use literal loopback only')
  return host
}
const port = value => {
  if (!Number.isInteger(value) || value < 0 || value > 65535) throw new Error('Corpus listeners require an explicit TCP port')
  return value
}
const listen = Server.prototype.listen
Server.prototype.listen = function (...args) {
  if (typeof args[0] === 'number') {
    port(args[0])
    if (typeof args[1] === 'string' || args.length > 1 && args[1] == null) args[1] = loopback(args[1])
    else if (args[1] === undefined || typeof args[1] === 'function' || typeof args[1] === 'number') args.splice(1, 0, '127.0.0.1')
    else throw new Error('Unsupported corpus TCP listen overload')
  } else if (args[0] && typeof args[0] === 'object') {
    const options = args[0]
    if ('fd' in options || 'path' in options || !('port' in options)) throw new Error('Corpus listeners refuse fd/path and non-TCP forms')
    args[0] = {...options, port:port(options.port), host:loopback(options.host)}
  } else throw new Error('Corpus listeners require an explicit TCP port')
  return Reflect.apply(listen, this, args)
}
