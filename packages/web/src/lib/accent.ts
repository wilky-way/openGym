// Pure accent helpers are shared with core; DOM application belongs in web.
export * from '../../../core/src/accent'
import { CUSTOM, DEFAULT_ACCENT, customAccentVars } from '../../../core/src/accent'
import { ACCENTS } from '../../../core/src/format'

const CUSTOM_VARS = ['--acc', '--acc-2', '--on-acc', '--knob-ring']

/**
 * Puts the accent on the page root: a preset by `data-accent` (index.css does the rest), the
 * user's colour as inline custom properties for the resolved `theme`. `value` is accentValue's.
 */
export function applyAccent(el: HTMLElement, value: unknown, theme: string) {
  // Logbook owns its palette. Keep synced choices intact, but never let inline custom colours
  // override the measured claret/rose tokens.
  if (el.dataset.skin === 'logbook') {
    delete el.dataset.accent
    for (const k of CUSTOM_VARS) el.style.removeProperty(k)
    return
  }
  const vars = customAccentVars(value, theme)
  if (vars) {
    el.dataset.accent = CUSTOM
    for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v)
    return
  }
  el.dataset.accent = typeof value === 'string' && Object.hasOwn(ACCENTS, value) ? value : DEFAULT_ACCENT
  for (const k of CUSTOM_VARS) el.style.removeProperty(k)
}
