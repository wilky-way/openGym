import { clientPlatform } from './client-io'
export function matchLocale(tag?: unknown): 'en' | null { return typeof tag === 'string' && /^en(?:-|$)/i.test(tag.trim().replace(/_/g, '-')) ? 'en' : null }
export function autoLang(state: {langAuto?: boolean; lang?: unknown} | null | undefined, _config?: unknown, _langs?: unknown): 'en' | null { return state?.langAuto === true ? 'en' : null }
export function rememberDefaultLang(_config?: unknown): void { try { clientPlatform().kv.set('gym_default_lang', 'en') } catch {} }
export function effectiveLang(_state?: unknown, _config?: unknown, _langs?: unknown): 'en' { return 'en' }
export function browserLangs(): string[] { return ['en'] }
