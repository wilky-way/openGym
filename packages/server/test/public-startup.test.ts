import { test, expect } from 'bun:test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { loadConfig } from '../src/config'
import { startServer } from '../src/index'
import { scratchDir, start } from './helpers'

test.each(['0', 'false', 'NO', 'Off'])('public startup refuses DEVICE_TOKENS=%s before creating data or listening', async value => {
  const dataDir = join(scratchDir(), 'refused-public')
  const config = loadConfig({ PORT: '0', HOST: '127.0.0.1', DATA_DIR: dataDir,
    ORIGIN: 'https://gym.example', EXPOSURE: 'public', DEVICE_TOKENS: '1' })
  // Also protect callers passing a config directly, rather than going through loadConfig.
  config.deviceTokens = loadConfig({ DEVICE_TOKENS: value }).deviceTokens
  const boot: string[] = []
  let listener: ReturnType<typeof startServer> | undefined
  try {
    expect(() => { listener = startServer(config, {}, line => boot.push(line)) }).toThrow('DEVICE_TOKENS')
    expect(existsSync(dataDir)).toBe(false)
    expect(boot).toEqual([])
  } finally { await listener?.stop(true) }
})

test('public startup with device tokens remains available and invite-only', async () => {
  const h = start({ EXPOSURE: 'public', ORIGIN: 'https://gym.example', DEVICE_TOKENS: '1', INVITE_ONLY: '0' })
  expect((await fetch(h.api + '/api/health')).status).toBe(200)
  expect(await (await fetch(h.api + '/api/config')).json()).toMatchObject({ invite_only: true })
})

test('private startup still permits an explicit legacy-token rollback configuration', async () => {
  const h = start({ EXPOSURE: 'private', DEVICE_TOKENS: '0' })
  expect(h.config.deviceTokens).toBe(false)
  expect((await fetch(h.api + '/api/health')).status).toBe(200)
})
