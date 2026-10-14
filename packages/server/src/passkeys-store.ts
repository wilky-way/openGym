export interface PasskeyRecord {
  id: string; userId?: string; publicKey: string; counter?: number; transports?: unknown;
  created?: string; lastUsed?: string; name?: unknown
}
export interface PasskeyDb { creds?: PasskeyRecord[] }
export const MAX_PASSKEYS = 20;
export const NAME_MAX = 40;

// A label someone typed: control characters out, runs of whitespace folded, capped. Empty means
// no name, and the app shows a numbered "Passkey n" instead.
//
// Invisible format characters go too. The device redeeming a code names its own passkey, and the
// owner and the admin read that name: a right-to-left override (U+202E) turns the rest of it
// around, so a passkey could be made to read like another one. The two joiners stay, since emoji
// sequences and several scripts (Devanagari and Arabic among them) need them to render.
export const passkeyName = (v: unknown): string => (typeof v === 'string' ? v : '')
  .replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/(?![\u200c\u200d])\p{Cf}/gu, '')
  .replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);

// `transports` comes from the browser that made the passkey, which is to say from the request. It
// is handed back to browsers as a hint, so only a short list of short words is kept.
const transportsOf = (v: unknown): string[] => (Array.isArray(v) ? v.filter(x => typeof x === 'string' && x.length <= 16).slice(0, 8) : []);

// What the owner sees of their passkeys: never the public key, which nothing on screen needs.
export function listPasskeys(db: PasskeyDb, userId: string) {
  return (db.creds || [])
    .filter(c => c.userId === userId)
    .map(c => ({
      id: c.id,
      name: typeof c.name === 'string' && c.name ? c.name : null,
      // Passkeys made before these fields existed have neither; the list leaves the line out.
      created: c.created || null,
      lastUsed: c.lastUsed || null,
      transports: transportsOf(c.transports)
    }));
}

export function addPasskeyRecord(db: PasskeyDb, userId: string, cred: PasskeyRecord, now = Date.now()) {
  db.creds = db.creds || [];
  if (db.creds.some(c => c.id === cred.id)) return { error: 'credential already registered', code: 'credential-exists' as const };
  if (db.creds.filter(c => c.userId === userId).length >= MAX_PASSKEYS) {
    return { error: `a profile can have at most ${MAX_PASSKEYS} passkeys`, code: 'passkey-limit' as const };
  }
  const row: PasskeyRecord = {
    id: cred.id,
    userId,
    publicKey: cred.publicKey,
    counter: cred.counter || 0,
    transports: transportsOf(cred.transports),
    created: cred.created || new Date(now).toISOString()
  };
  const name = passkeyName(cred.name);
  if (name) row.name = name;
  db.creds.push(row);
  return { ok: true as const, row: row! };
}

export function renamePasskeyRecord(db: PasskeyDb, userId: string, credId: string, name: unknown) {
  const row = (db.creds || []).find(c => c.id === credId && c.userId === userId);
  if (!row) return { error: 'passkey not found', code: 'not-found' as const };
  const clean = passkeyName(name);
  if (clean) row.name = clean; else delete row.name;
  return { ok: true as const, row: row! };
}

// Why removing `credId` would be refused, or null when it could go: not this profile's, or its
// last way in — the last passkey goes only while something else (`otherWays`) can still sign it
// in. On its own so server.js can ask before it asks the owner for proof, and again, through
// removePasskeyRecord, once the proof is in.
export function passkeyRemovalRefused(db: PasskeyDb, userId: string, credId: string, otherWays = 0) {
  const creds = db.creds || [];
  if (!creds.some(c => c.id === credId && c.userId === userId)) return { error: 'passkey not found', code: 'not-found' as const };
  const mine = creds.filter(c => c.userId === userId).length;
  if (mine - 1 + otherWays < 1) return { error: 'this passkey is the only way into this profile', code: 'last-way-in' as const };
  return null;
}

export function removePasskeyRecord(db: PasskeyDb, userId: string, credId: string, otherWays = 0) {
  const refused = passkeyRemovalRefused(db, userId, credId, otherWays);
  if (refused) return refused;
  const i = db.creds!.findIndex(c => c.id === credId && c.userId === userId);
  const [row] = db.creds!.splice(i, 1);
  return { ok: true as const, row: row! };
}
