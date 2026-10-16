/* Public instance configuration is identical for anonymous, cookie and bearer
   callers. Retired provider configuration must never be disclosed. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { boundPort } from './helpers.mjs';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = crypto.randomBytes(32).toString('hex');
const UID = 'u_cfg_1';

const mint = uid => {
  const payload = `${uid}:${Date.now() + 86400000}:0`;
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
};

async function startServer(t, env = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-config-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    users: [{ id: UID, name: 'C', created: new Date().toISOString() }], creds: [], subs: [], invites: []
  }));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost', INVITE_ONLY: '1', ALLOW_GUEST: '0', PASSWORD_LOGIN: '0', DEFAULT_LANG: '', MEDIA_UPLOADS: '0', ...env }
  });
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  let log = '';
  child.stdout.on('data', d => { log += d; });
  child.stderr.on('data', d => { log += d; });
  const port = await boundPort(child, () => log);
  return { api: `http://127.0.0.1:${port}`, dataDir };
}

test('GET /api/config: public flags are identical for anonymous, cookie and bearer callers', async t => {
  const h = await startServer(t);
  const config = headers => fetch(`${h.api}/api/config`, headers ? { headers } : undefined).then(r => r.json());
  const expected = { invite_only: true, allow_guest: false };
  assert.deepEqual(await config(), expected);
  assert.deepEqual(await config({ Cookie: `gymsid=${mint(UID)}` }), expected);
  assert.deepEqual(await config({ Authorization: `Bearer ${mint(UID)}` }), expected);
  assert.deepEqual(await config({ Cookie: 'gymsid=u_cfg_1:99999999999999:0.notarealmac' }), expected);
});

test('GET /api/config: password, language and media capabilities remain public', async t => {
  const h = await startServer(t, { PASSWORD_LOGIN: '1', DEFAULT_LANG: 'pt-BR', MEDIA_UPLOADS: '1' });
  const config = headers => fetch(`${h.api}/api/config`, headers ? { headers } : undefined).then(r => r.json());
  const anon = await config();
  assert.deepEqual(Object.keys(anon).sort(), ['allow_guest', 'default_lang', 'invite_only', 'media', 'password_login']);
  assert.equal(anon.invite_only, true);
  assert.equal(anon.allow_guest, false);
  assert.equal(anon.password_login, true);
  assert.equal(anon.default_lang, 'pt-BR');
  assert.ok(anon.media.imageMB > 0);
  assert.ok(anon.media.quotaMB > 0);
  assert.deepEqual(await config({ Cookie: `gymsid=${mint(UID)}` }), anon);
  assert.deepEqual(await config({ Authorization: `Bearer ${mint(UID)}` }), anon);
});

test('GET /api/config: legacy provider settings disclose nothing to any caller', async t => {
  const h = await startServer(t);
  // A data directory from an older version can retain this file after the feature is removed.
  fs.writeFileSync(path.join(h.dataDir, 'coach.json'), JSON.stringify({
    enabled: true, provider: 'compatible', baseUrl: 'https://private.example', token: 'private-provider-token'
  }));
  for (const headers of [undefined, { Cookie: `gymsid=${mint(UID)}` }, { Authorization: `Bearer ${mint(UID)}` }]) {
    const answer = await fetch(`${h.api}/api/config`, headers ? { headers } : undefined).then(r => r.json());
    assert.deepEqual(answer, { invite_only: true, allow_guest: false });
  }
});

test('GET /api/config: DEFAULT_LANG is public when set, absent when unset or malformed (#303)', async t => {
  const set = await startServer(t, { DEFAULT_LANG: 'pt-BR' });
  const anon = await fetch(`${set.api}/api/config`).then(r => r.json());
  assert.deepEqual(anon, { invite_only: true, allow_guest: false, default_lang: 'pt-BR' }, 'the sign-in screen can read it');

  const bad = await startServer(t, { DEFAULT_LANG: '<script>' });
  assert.equal('default_lang' in await fetch(`${bad.api}/api/config`).then(r => r.json()), false);

  const unset = await startServer(t, { DEFAULT_LANG: '' });
  assert.equal('default_lang' in await fetch(`${unset.api}/api/config`).then(r => r.json()), false);
});
