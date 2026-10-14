export interface DeviceLink { h: string; userId: string; exp: number; created: number }
export interface LinkDb { deviceLinks?: DeviceLink[] }
import crypto from 'node:crypto';

// Long enough to walk to the other device, find the camera and sign in; short enough that a code
// photographed off a screen is dead by the time anyone could use it.
export const DEVICE_LINK_TTL_MS = 10 * 60 * 1000;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const LENGTH = 12;

export function makeLinkCode() {
  // 256 is a multiple of 32, so the modulo is unbiased.
  const raw = Array.from(crypto.randomBytes(LENGTH), b => ALPHABET[b % ALPHABET.length]).join('');
  return raw.slice(0, 4) + '-' + raw.slice(4, 8) + '-' + raw.slice(8);
}
// Dashes, spaces and case are how a person types it, not part of it.
const clean = (code: unknown) => (typeof code === 'string' ? code : '').toUpperCase().replace(/[^A-Z0-9]/g, '');
export const hashLinkCode = (code: unknown): string => crypto.createHash('sha256').update('opengym-link:' + clean(code)).digest('hex');

function prune(db: LinkDb, now: number) {
  db.deviceLinks = (db.deviceLinks || []).filter(l => l && typeof l.h === 'string' && l.exp > now);
}

// → { code, link }. The code is returned once and never stored.
export function createDeviceLink(db: LinkDb, userId: string, now = Date.now(), ttlMs = DEVICE_LINK_TTL_MS) {
  prune(db, now);
  db.deviceLinks = db.deviceLinks!.filter(l => l.userId !== userId);
  const code = makeLinkCode();
  const link = { h: hashLinkCode(code), userId, exp: now + ttlMs, created: now };
  db.deviceLinks!.push(link);
  return { code, link };
}

// The live link a code belongs to, or null — a wrong code, a used one and an expired one all look
// the same from outside. Finding a link does not use it up; burnDeviceLink does.
export function findDeviceLink(db: LinkDb, code: unknown, now = Date.now()) {
  prune(db, now);
  if (clean(code).length !== LENGTH) return null;
  const h = Buffer.from(hashLinkCode(code), 'hex');
  return db.deviceLinks!.find(l => {
    const stored = Buffer.from(l.h, 'hex');
    return stored.length === h.length && crypto.timingSafeEqual(stored, h);
  }) || null;
}

export function burnDeviceLink(db: LinkDb, link: DeviceLink) {
  db.deviceLinks = (db.deviceLinks || []).filter(l => l !== link);
}

// Every unused link of a profile, for the moments its sessions end: an unused link is a way in
// waiting to be taken, like a pairing code. Says whether anything went, so a caller can skip a save.
export function dropDeviceLinks(db: LinkDb, userId: string) {
  const before = (db.deviceLinks || []).length;
  db.deviceLinks = (db.deviceLinks || []).filter(l => l.userId !== userId);
  return db.deviceLinks!.length !== before;
}
