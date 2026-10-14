import { describe, expect, it } from 'vitest'
import { PAGES, ROOT_GROUPS, searchSettings, pageTrail, fold } from '../src/views/settings-pages'
const guestWeb = { user:null, pushOK:false }
describe('searchSettings', () => {
  const tr = (s: string) => s
  it('matches titles, synonyms and pages, ignoring case and accents', () => {
    expect(searchSettings('Vibrate', guestWeb, tr).map(h => h.title)).toEqual(['Vibrate'])
    expect(searchSettings('buzz', guestWeb, tr).map(h => h.title)).toEqual(['Vibrate'])
    expect(searchSettings('pounds', guestWeb, tr).map(h => h.title)).toEqual(['Weight unit'])
    expect(searchSettings('dark mode', guestWeb, tr).map(h => h.title)).toEqual(['Theme'])
    expect(searchSettings('gif', guestWeb, tr).map(h => h.title)).not.toContain('Exercise animations')
    expect(searchSettings('RÉST TIMER', guestWeb, tr)[0]!.title).toBe('Rest timer')
    expect(fold('Thème')).toBe('theme')
  })

  it('pages are hits too, and a title starting with the query comes first', () => {
    const hits = searchSettings('units', guestWeb, tr)
    expect(hits[0]!).toMatchObject({ title: 'Units & language', isPage: true, page: 'units' })
    expect(searchSettings('rest', guestWeb, tr).slice(0, 2).map(h => h.title)).toEqual(['Rest timer', 'Rest-pause rest'])
  })

  it('names Fine-tuning under Workout, and keeps to the rows this device shows', () => {
    expect(pageTrail('advanced', tr)).toBe('Workout › Fine-tuning')
    expect(searchSettings('overtime', guestWeb, tr)[0]!.trail).toBe('Workout › Fine-tuning')
    expect(searchSettings('nudge', guestWeb, tr)).toEqual([])                              // no Reminders for a web guest
    expect(searchSettings('nudge', { ...guestWeb, user: { id: 'u' } }, tr)).toEqual([])         // no push in this browser
    expect(searchSettings('nudge', { ...guestWeb, user: { id: 'u' }, pushOK: true }, tr)).toEqual([])   // the reminder is off
    expect(searchSettings('nudge', { ...guestWeb, user: { id: 'u' }, pushOK: true, reminderOn: true }, tr).map(h => h.title)).toEqual(['Nudge me when I skip a planned workout'])
    expect(searchSettings('   ', guestWeb, tr)).toEqual([])
  })

  it('searches in the app language as well', () => {
    const de: Record<string,string> = { Vibrate: 'Vibration', 'Timer alerts': 'Timer-Hinweise', Settings: 'Einstellungen' }
    const hits = searchSettings('vibration', guestWeb, s => de[s] || s)
    expect(hits[0]!).toMatchObject({ title: 'Vibrate', label: 'Vibration', trail: 'Timer-Hinweise' })
  })

  it('English words match from the start of a word only, so "ton" never finds "buttons"', async () => {
    // The translator is injected; no removed locale pack is loaded.
    const tr = (title: string) => title.includes('buttons') ? 'Controls' : title
    const titles = searchSettings('ton', guestWeb, tr).map(h => h.title)
    expect(titles).not.toContain('Weight and reps buttons')
    expect(titles).not.toContain('Superset buttons in the exercise header')
    expect(searchSettings('tone', { ...guestWeb, user: { id: 'u' }, pushOK: true, reminderOn: true, nudge: true }, s => s).map(h => h.title)).toContain('Nudge tone')
    expect(searchSettings('json', guestWeb, s => s).map(h => h.title)).toContain('Export backup (JSON)')
  })
})

it('the root groups only name real pages', () => { for (const group of ROOT_GROUPS) for (const id of group) expect(PAGES[id], id).toBeTruthy() })
it('finds the effort tracking switch in Settings search', () => { expect(searchSettings("Don't track effort", guestWeb).map(x => x.title)).toContain("Don't track effort") })
it('does not send search users to an absent picker', () => { for (const q of ['custom color','picker','hex']) expect(searchSettings(q, {}).map(h => h.title)).not.toContain('Accent color') })
  it('finds the rows that used to be missing', () => {
    const tr = (s: string) => s
    const web = { ...guestWeb, user: { id: 'u' }, synced: true, installTip: true, pushOK: true, reminderOn: true, nudge: true }
    expect(searchSettings('reminder time', web, tr).map(h => h.title)).toEqual(['Reminder time'])
    expect(searchSettings('tone', web, tr).map(h => h.title)).toContain('Nudge tone')
    expect(searchSettings('test notification', web, tr).map(h => h.title)).toEqual(['Send test notification'])
    expect(searchSettings('server', web, tr).map(h => h.title)).toContain('Sync now')
    expect(searchSettings('sync', web, tr).map(h => h.title)).toContain('Sync now')
    expect(searchSettings('loop', web, tr).map(h => h.title)).toContain('How you train')
    expect(searchSettings('swipe', web, tr)[0]!.title).toBe('Swipe actions')
    expect(searchSettings('gesture', web, tr).map(h => h.title)).toEqual(['Swipe actions'])
    expect(searchSettings('home screen', web, tr).map(h => h.title)).toEqual(['In Safari: Share → Add to Home Screen'])
    expect(searchSettings('install', { ...web, androidWeb: true }, tr).map(h => h.title)).toEqual(['In Chrome: ⋮ menu → Add to Home screen'])
  })
