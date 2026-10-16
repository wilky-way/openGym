// Synthetic Node oracle only: match the client address family and identify this run.
import { Server } from 'node:http';
const nonce = process.env.PARITY_ORACLE_NONCE;
if (!nonce) throw new Error('PARITY_ORACLE_NONCE is required');
const listen = Server.prototype.listen;
Server.prototype.listen = function (...args) {
  if (typeof args[0] === 'number' && typeof args[1] !== 'string') {
    args.splice(1, 0, '127.0.0.1');
  } else if (args[0] && typeof args[0] === 'object' && 'port' in args[0] && !args[0].host) {
    args[0] = { ...args[0], host: '127.0.0.1' };
  }
  return Reflect.apply(listen, this, args);
};
const emit = Server.prototype.emit;
Server.prototype.emit = function (event, ...args) {
  if (event === 'request') args[1].setHeader('X-Parity-Oracle-Nonce', nonce);
  return Reflect.apply(emit, this, [event, ...args]);
};

// Authenticate accepted TCP connections over the private parent/child IPC channel,
// before the parent releases any HTTP headers or synthetic credentials.
const connections = new Set();
const pending = new Set();
const owns = message => [...connections].some(socket => !socket.destroyed && socket.remoteAddress === '127.0.0.1' && socket.remotePort === message.clientPort && socket.localPort === message.serverPort);
const answer = (entry, owned) => {
  clearTimeout(entry.timer);
  pending.delete(entry);
  process.send?.({ type: 'parity-peer', id: entry.message.id, owned });
};
const networkEmit = Server.prototype.emit;
Server.prototype.emit = function (event, ...args) {
  if (event === 'connection') {
    const socket = args[0];
    connections.add(socket);
    socket.once('close', () => connections.delete(socket));
    for (const entry of pending) if (owns(entry.message)) answer(entry, true);
  }
  return Reflect.apply(networkEmit, this, [event, ...args]);
};
process.on('message', message => {
  if (message?.type !== 'parity-peer') return;
  // IPC may arrive before the accept event even though the parent's connect fired.
  // Wait for that event, without sending any HTTP bytes, before rejecting the peer.
  const entry = { message, timer: null };
  if (owns(message)) answer(entry, true);
  else {
    entry.timer = setTimeout(() => answer(entry, false), 1000);
    pending.add(entry);
  }
});
