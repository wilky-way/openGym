import { test, expect } from 'bun:test'
import { loadConfig } from '../src/config'

test('environment defaults, boolean polarity, numbers and CLI overrides', () => {
  const config = loadConfig({})
  expect(config).toMatchObject({ port: 3000, host: '0.0.0.0', dataDir: '/data', rpId: 'localhost', origin: 'http://localhost:8080', rpName: 'openGym', allowGuest: true, inviteOnly: true, firstUserAdmin: false, deviceTokens: true, offloadRule: false, sessionDays: 90, headersTimeoutMs: 60000, bodyTimeoutMs: 300000, maxBodyBytes: 5242880 })
  expect(loadConfig({ PORT: '90', HOST: 'env', DATA_DIR: '/env', STATIC_DIR: '/env-static' }, ['--port=0', '--host', '127.0.0.1', '--data-dir', '/tmp/synthetic', '--static-dir=/tmp/dist'])).toMatchObject({ port: 0, host: '127.0.0.1', dataDir: '/tmp/synthetic', staticDir: '/tmp/dist' })
  for (const yes of ['1', 'true', 'YES', 'On']) expect(loadConfig({ INVITE_ONLY: yes, FIRST_USER_ADMIN: yes, TRUST_PROXY: yes, DEVICE_TOKENS: yes, OFFLOAD_RULE: yes })).toMatchObject({ inviteOnly: true, firstUserAdmin: true, trustProxy: true, deviceTokens: true, offloadRule: true })
  for (const no of ['0', 'false', 'NO', 'Off']) expect(loadConfig({ ALLOW_GUEST: no, AUDIT_LOG: no })).toMatchObject({ allowGuest: false, audit: { enabled: false } })
  expect(loadConfig({ SESSION_DAYS: '-1', BODY_TIMEOUT_MS: '1', STATE_CACHE_TTL_MS: '-1', AUDIT_MAX: '0', AUDIT_DAYS: '0', ADMIN_UIDS: ' a, ,b ', AUDIT_IP: 'net' })).toMatchObject({ sessionDays: 1, bodyTimeoutMs: 50, stateCacheTtlMs: 50, adminUids: ['a', 'b'], audit: { max: 0, days: 0, ip: 'net' } })
  expect(() => loadConfig({ PORT: 'NaN' })).toThrow('PORT')
  expect(() => loadConfig({}, ['--unknown'])).toThrow('unknown server flag')
  expect(() => loadConfig({}, ['--port'])).toThrow('missing value')
})
test('public exposure requires edge TLS, forces invites and refuses first-user admin', () => {
  expect(() => loadConfig({ EXPOSURE: 'public' })).toThrow('HTTPS')
  expect(() => loadConfig({ EXPOSURE: 'public', ORIGIN: 'https://gym.example', FIRST_USER_ADMIN: 'yes' })).toThrow('FIRST_USER_ADMIN')
  expect(() => loadConfig({ EXPOSURE: 'typo' })).toThrow('EXPOSURE')
  expect(loadConfig({ EXPOSURE: 'public', ORIGIN: 'https://gym.example', INVITE_ONLY: '0' })).toMatchObject({ inviteOnly: true, firstUserAdmin: false, trustProxy: false, secure: true })
})

test('CLI values preserve equals signs; empty PORT and mixed-case HTTPS retain legacy semantics', () => {
  expect(loadConfig({}, ['--data-dir=/tmp/a=b', '--static-dir=/tmp/c=d'])).toMatchObject({ dataDir: '/tmp/a=b', staticDir: '/tmp/c=d' })
  expect(loadConfig({ PORT: '' }).port).toBe(3000)
  expect(loadConfig({ PORT: '0' }).port).toBe(0)
  expect(loadConfig({ ORIGIN: 'HTTPS://gym.example' })).toMatchObject({ secure: true, vapidSubject: 'HTTPS://gym.example' })
  expect(loadConfig({ ORIGIN: 'HTTPS://gym.example', EXPOSURE: 'public' }).inviteOnly).toBe(true)
})

test('device tokens default on and public exposure refuses every explicit disabling value', () => {
  for (const value of [undefined, '1', 'true', 'YES', 'On']) {
    expect(loadConfig({ DEVICE_TOKENS: value }).deviceTokens).toBe(true)
    expect(loadConfig({ EXPOSURE: 'public', ORIGIN: 'https://gym.example', DEVICE_TOKENS: value }).deviceTokens).toBe(true)
  }
  for (const value of ['0', 'false', 'NO', 'Off', '', 'typo']) {
    expect(loadConfig({ DEVICE_TOKENS: value }).deviceTokens).toBe(false)
    expect(() => loadConfig({ EXPOSURE: 'public', ORIGIN: 'https://gym.example', DEVICE_TOKENS: value })).toThrow('DEVICE_TOKENS')
  }
})
