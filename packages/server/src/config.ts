import { LIMITS } from '@opengym/contract/http/api'

export type Environment = Readonly<Record<string, string | undefined>>
const enabled = (value: string | undefined) => /^(1|true|yes|on)$/i.test(value ?? '')
const notDisabled = (value: string | undefined) => !/^(0|false|no|off)$/i.test(value ?? '')
const number = (value: string | undefined, fallback: number, min: number) => Math.max(min, +(value || fallback) || fallback)

export interface ServerConfig {
  port: number; host: string; dataDir: string; staticDir?: string
  rpId: string; origin: string; rpName: string; secure: boolean
  setupToken?: string; adminUids: readonly string[]; inviteOnly: boolean; firstUserAdmin: boolean; allowGuest: boolean
  defaultLang: string; trustProxy: boolean; sessionDays: number
  deviceTokens: boolean; offloadRule: boolean; exposure: 'private' | 'public'
  bodyTimeoutMs: number; headersTimeoutMs: number; maxBodyBytes: number
  vapidSubject: string; allowedPrivateIps: string; reminderTickMs: number; stateCacheTtlMs: number
  audit: { enabled: boolean; max: number; days: number; ip: 'off' | 'net' | 'full' }
}

/** Config stays independent of storage; deleted features have no runtime knobs. */
export function loadConfig(env: Environment = process.env, args: readonly string[] = [], warn: (message: string) => void = console.warn): ServerConfig {
  const flags: Record<string, string> = {}
  const names = new Set(['data-dir', 'port', 'host', 'static-dir'])
  for (let i = 0; i < args.length; i++) {
    const argument = args[i]!
    const stripped = argument.replace(/^--/, '')
    const equals = stripped.indexOf('=')
    const name = equals < 0 ? stripped : stripped.slice(0, equals)
    const inline = equals < 0 ? undefined : stripped.slice(equals + 1)
    if (!argument.startsWith('--') || !names.has(name!)) throw new Error('unknown server flag')
    const value = inline ?? args[++i]
    if (!value || value.startsWith('--')) throw new Error(`missing value: --${name}`)
    flags[name!] = value
  }
  const port = +(flags.port ?? (env.PORT || 3000))
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT must be an integer between 0 and 65535')
  const origin = env.ORIGIN || 'http://localhost:8080'
  const exposure = env.EXPOSURE || 'private'
  if (exposure !== 'private' && exposure !== 'public') throw new Error('EXPOSURE must be private or public')
  const firstUserAdmin = enabled(env.FIRST_USER_ADMIN)
  const deviceTokens = enabled(env.DEVICE_TOKENS ?? '1')
  if (exposure === 'public') {
    if (!deviceTokens) throw new Error('EXPOSURE=public requires DEVICE_TOKENS enabled')
    if (firstUserAdmin) throw new Error('FIRST_USER_ADMIN is forbidden with EXPOSURE=public')
    if (!/^https:\/\//i.test(origin)) throw new Error('EXPOSURE=public requires HTTPS ORIGIN (TLS at the edge)')
  }
  const setupToken = (env.SETUP_TOKEN || '').toUpperCase()
  if (setupToken && !/^[A-Z0-9_-]{32,128}$/.test(setupToken)) throw new Error('SETUP_TOKEN must be 32–128 letters, digits, underscore or hyphen')
  const language = (env.DEFAULT_LANG || '').trim()
  const validLanguage = /^[A-Za-z]{2,3}([-_][A-Za-z0-9]{2,8})?$/.test(language)
  if (language && !validLanguage) warn('DEFAULT_LANG is not a valid language tag — ignored')
  return {
    port, host: flags.host || env.HOST || '0.0.0.0', dataDir: flags['data-dir'] || env.DATA_DIR || '/data',
    staticDir: flags['static-dir'] || env.STATIC_DIR || undefined,
    rpId: env.RP_ID || 'localhost', origin, rpName: env.RP_NAME || 'openGym', secure: /^https:\/\//i.test(origin),
    adminUids: (env.ADMIN_UIDS || '').split(',').map(value => value.trim()).filter(Boolean),
    setupToken: setupToken || undefined,
    inviteOnly: exposure === 'public' || notDisabled(env.INVITE_ONLY), firstUserAdmin, allowGuest: notDisabled(env.ALLOW_GUEST),
    defaultLang: validLanguage ? language : '', trustProxy: enabled(env.TRUST_PROXY),
    sessionDays: number(env.SESSION_DAYS, LIMITS.sessionDaysDefault, 1), deviceTokens,
    offloadRule: enabled(env.OFFLOAD_RULE), exposure,
    bodyTimeoutMs: number(env.BODY_TIMEOUT_MS, LIMITS.bodyTimeoutMs, 50),
    headersTimeoutMs: LIMITS.headersTimeoutMs, maxBodyBytes: LIMITS.maxBodyBytes,
    vapidSubject: env.VAPID_SUBJECT || (/^https:\/\//i.test(origin) ? origin : 'mailto:admin@localhost'),
    allowedPrivateIps: env.ALLOWED_PRIVATE_IPS || '', reminderTickMs: Math.max(50, +(env.REMINDER_TICK_MS || 10000)),
    stateCacheTtlMs: number(env.STATE_CACHE_TTL_MS, 600000, 50),
    audit: { enabled: notDisabled(env.AUDIT_LOG), max: Math.max(0, +(env.AUDIT_MAX || 5000) || 0), days: Math.max(0, +(env.AUDIT_DAYS || 90) || 0),
      ip: /^full$/i.test(env.AUDIT_IP || '') ? 'full' : /^(1|true|yes|on|net)$/i.test(env.AUDIT_IP || '') ? 'net' : 'off' },
  }
}
