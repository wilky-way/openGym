// Node 22 --import preload. Date construction/Date.now are pinned; timers stay real.
const NativeDate = Date;
let now = Number(process.env.PARITY_NOW);
if (!Number.isFinite(now)) throw new Error('PARITY_NOW must be finite');
globalThis.Date = new Proxy(NativeDate, {
  construct(target, args, newTarget) { return Reflect.construct(target, args.length ? args : [now], newTarget); },
  apply() { return new NativeDate(now).toString(); },
  get(target, key) { return key === 'now' ? () => now : Reflect.get(target, key); }
});
process.on('message', message => {
  if (message?.type !== 'parity-clock' || !Number.isFinite(message.now)) return;
  now = message.now;
  process.send?.({ type: 'parity-clock', id: message.id, now });
});
