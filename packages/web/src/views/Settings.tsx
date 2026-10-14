import { SOURCE_URL } from '../lib/source'
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useLocation, Navigate } from 'react-router-dom'
import { useStore, DEF } from '../store/useStore'
import { useUI } from '../store/useUI'
import { ux } from '../platform/ux'
import { clientPlatform } from '../lib/client-io'
import { t, tn, dateLocale } from '../lib/i18n'
import { PAGES, ROOT_GROUPS, pageVisible, searchSettings } from './settings-pages'
import SettingsA from './SettingsA'
import SettingsB, { SETTINGS_B_PAGES } from './SettingsB'
import { Section, Row, SearchField } from '../components/ui'
import Icon from '../components/Icon'
import { pushSupported } from '../lib/push'
import { webauthnOK, IS_ANDROID } from '../lib/api'
import { wakeLockSupported } from '../lib/wakelock'
import { vibrateSupported, playOnSilentSupported } from '../lib/sound'
import { scheduleModeOf } from '@opengym/core/rotation'
import { weekStartOf, SUNDAY } from '@opengym/core/format'
import { fmtRest } from '../lib/duration'
import { appVersion } from '../lib/build'
const standalone = () => {
 try { const win=ux().window; return !!(win?.matchMedia?.('(display-mode: standalone)').matches || (win?.navigator as Navigator & {standalone?:boolean})?.standalone === true) } catch { return false }
}
let lastQuery: {q: string; key: string | null} = {q:'', key:null}
const shortWeekday = (day: number) => new Intl.DateTimeFormat(dateLocale(), {weekday:'short'}).format(new Date(2024,0,day===0?7:1))
export function SettingsRoute() {
 const {page} = useParams(), loc = useLocation(), user = useStore(s=>s.user)
 if (page && (!Object.hasOwn(PAGES,page) || !pageVisible(PAGES[page]!.parent || page,{user}))) return <Navigate to="/settings" replace />
 return <Settings key={page || 'root'} page={page || null} find={loc.state?.find || null} via={loc.state?.via || null} />
}
export default function Settings({page=null,find=null,via=null}: {page?:string|null;find?:string|null;via?:string|null}) {
 const nav=useNavigate(), S=useStore(s=>s.S), user=useStore(s=>s.user), sync=useStore(s=>s.sync), toast=useUI(s=>s.toast)
 const body=useRef<HTMLDivElement>(null), canVibrate=vibrateSupported()
  // A search hit: scroll its row (or button) into view and flash it once. A row that shows only
  // once the page has heard back from the server (web push, the passkey list) is waited for a
  // moment; still missing, the hit's `via` row, if it names one, is flashed instead, with a word
  // on why.
  useEffect(() => {
    if (!find || !body.current) return
    const el = body.current
    const named = (label: string) => [...el.querySelectorAll('.lrow')].find(r => r.querySelector('.lrow-t')?.textContent === label)
      || [...el.querySelectorAll('.btn')].find(b => b.textContent?.trim() === label)
    let tm: ReturnType<typeof setTimeout> | undefined
    const flash = (row: Element) => {
      row.classList.add('sp-flash')
      if (typeof row.scrollIntoView === 'function') row.scrollIntoView({ block: 'center' })
      tm = setTimeout(() => row.classList.remove('sp-flash'), 1900)
    }
    const row = named(t(find))
    if (row) { flash(row); return () => clearTimeout(tm) }
    let done = false
    const mo = (ux().window as (Window & typeof globalThis) | null)?.MutationObserver ? new (ux().window as Window & typeof globalThis).MutationObserver(() => {
      const r = named(t(find))
      if (r && !done) { done = true; mo?.disconnect(); clearTimeout(wait); flash(r) }
    }) : null
    mo?.observe(el, { childList: true, subtree: true })
    const wait = setTimeout(() => {
      if (done) return
      done = true; mo?.disconnect()
      const r = via && named(t(via))
      if (r) { flash(r); toast(t('Turn on push notifications first.')) }
    }, 1500)
    return () => { done = true; mo?.disconnect(); clearTimeout(wait); clearTimeout(tm) }
  }, [find])

 const ctx={user,wakeOK:wakeLockSupported(),sound:!!S.sound,playOnSilent:playOnSilentSupported(),canVibrate,vibrate:S.vibrate!==false,profiles:(S.equipProfiles||[]).length>0,pushOK:pushSupported(),reminderOn:!!S.reminder?.on,nudge:!!S.reminder?.nudge,synced:!!sync,installTip:!standalone(),androidWeb:IS_ANDROID,webauthn:webauthnOK()}
 const mode=scheduleModeOf(S), layout=['list','compact','focus'].includes(S.workoutView)?S.workoutView:'cards'
 const layoutLabel=({cards:t('Cards'),list:t('List'),compact:t('Compact'),focus:t('Focus')} as Record<string,string>)[layout]
 const activeProfile=(S.equipProfiles||[]).find((p:any)=>p.id===S.activeEquipId)
 const themeLabel=({dark:t('Dark'),light:t('Light'),system:t('System')} as Record<string,string>)[S.theme||'dark']||t('Dark')
 const preview: Record<string,()=>string>={
 workout:()=> (S.restSec>0?t('{0} rest',fmtRest(S.restSec)):t('No rest timer'))+' · '+layoutLabel,
 alerts:()=>[S.sound?t('Sound'):null,canVibrate&&S.vibrate!==false?t('Vibrate'):null,S.timerFlash?t('Flash'):null].filter(Boolean).join(' · ')||t('Silent'),
 reminders:()=>S.reminder?.on?(S.reminder.time||DEF.reminder?.time||''):t('Off'),
 plan:()=>(mode==='rotation'?t('Rotation'):t('Fixed Week'))+' · '+shortWeekday(weekStartOf(S)===SUNDAY?0:1),
 units:()=>(S.unit||'kg')+' · English', equipment:()=>S.equipFilterOn&&activeProfile?activeProfile.name:t('Everything'),look:()=>themeLabel+' · Logbook', data:()=>'',about:()=> 'v'+appVersion() }
 const open=(id:string)=>nav('/settings/'+id)
 const back=()=>{const up=page&&PAGES[page]?.parent?'/settings/'+PAGES[page]!.parent:'/settings';if ((ux().window?.history.state?.idx||0)>0) nav(-1);else nav(up,{replace:true})}
 if (page && Object.hasOwn(PAGES,page)) return <div className="narrow" ref={body}><div className="sp-nav"><button className="sp-back" onClick={back}><Icon name="chevronLeft"/><span>{PAGES[page]!.parent?t(PAGES[PAGES[page]!.parent!]!.title):t('Settings')}</span></button><h1 className="sp-title">{t(PAGES[page]!.title)}</h1></div>{(SETTINGS_B_PAGES as readonly string[]).includes(page)?<SettingsB page={page as any}/> :page==='about'?<>
      <Section><Row icon="info" iconTint="var(--grey)" title={t('Version')} value={'v'+appVersion()}/><Row icon="code" title={t('Build')} value={clientPlatform().info.buildSha}/></Section>
      {ctx.installTip&&<Section title={t('Tip')}><Row icon="share" iconTint="var(--blue)" title={IS_ANDROID?t('In Chrome: ⋮ menu → Add to Home screen'):t('In Safari: Share → Add to Home Screen')} subtitle={t('to install openGym as a full-screen app.')+' '+(user?t('Your data syncs with your profile. Sign in anywhere and it’s there.'):t('Guest data stays on this device, so export a backup now and then!'))}/></Section>}
      <div className="dim small sp-version">
        openGym v{appVersion()} · {t('free & open source (AGPL v3)')}<br/>
        <a href={SOURCE_URL} target="_blank" rel="noopener">{t('Source code')}</a><br/>
        Exercise media © Aliaksandr Makatserchyk, <a href="https://gymvisual.com/" target="_blank" rel="noopener">Gym visual</a>, gymvisual.com.
        Media licensed for use in openGym only; see <a href={SOURCE_URL + '/blob/main/NOTICE.md'} target="_blank" rel="noopener">NOTICE.md</a>
      </div>
    </>:<SettingsA page={page}/>}</div>
 return <SettingsRoot ctx={ctx} preview={preview} open={open} user={user} sync={sync} home={()=>nav('/home')} go={(hit:any)=>nav('/settings/'+hit.page,hit.isPage?undefined:{state:hit.via?{find:hit.title,via:hit.via}:{find:hit.title}})}/>
}
function SettingsRoot({ ctx, preview, open, user, sync, home, go }: any) {
  // The router's key for this history entry (what useLocation().key reads), taken once.
  const [key] = useState(() => ux().window!.history.state?.key || null)
  const [q, setQ] = useState(() => (key && lastQuery.key === key ? lastQuery.q : ''))
  const set = (v: any) => { lastQuery = { q: v, key }; setQ(v) }
  const hits = q.trim() ? searchSettings(q, ctx) : null
  // The account card: who this is, and the one line that matters about it.
  const acct = user ? {
      title: user.name || t('Account'),
      sub: sync && sync.status && sync.status !== 'ok' ? t('Sync needs a look') : t('Account, devices and sync'),
    }
    : { title: t('Guest'), sub: t('Your data lives on this device. Sign in to sync.') }
  const initial = user ? String(user.name || '?').trim().charAt(0).toUpperCase() : null
  return <div className="narrow">
    <div className="sp-nav">
      <button className="sp-back" onClick={home} aria-label={t('Home')}><Icon name="chevronLeft" /><span>{t('Home')}</span></button>
    </div>
    <h1 className="sp-root-title">{t('Settings')}</h1>
    <div className="sp-search">
      <SearchField value={q} onChange={(e: any) => set(e.target.value)} onClear={() => set('')}
        placeholder={t('Search…')} aria-label={t('Search settings')} inputMode="search" enterKeyHint="search" autoComplete="off" />
    </div>
    {hits ? (hits.length ? <Section title={tn('{0} result', '{0} results', hits.length)}>
      {hits.slice(0, 40).map((h: any) => (
        <Row key={h.page + ':' + h.title} icon={h.icon} iconTint={h.tint} title={h.label} subtitle={h.trail} accessory="chevron" onClick={() => go(h)} />
      ))}
    </Section> : <div className="sp-empty">{t('No setting matches “{0}”.', q.trim())}</div>) : <>
      <Section>
        <button className="lrow tap sp-acct" onClick={() => open('account')}>
          <span className={'sp-avatar' + (initial ? ' on' : '')} aria-hidden="true">{initial || <Icon name="personCircle" />}</span>
          <span className="lrow-m"><span className="lrow-t">{acct.title}</span><span className="lrow-s">{acct.sub}</span></span>
          <Icon name="chevronRight" className="lrow-c" />
        </button>
      </Section>
      {ROOT_GROUPS.map((g: any) => g.filter((id: any) => pageVisible(id, ctx))).filter((g: any) => g.length).map((g: any) => (
        <Section key={g[0]}>
          {g.map((id: any) => <Row key={id} icon={PAGES[id]!.icon} iconTint={PAGES[id]!.tint} title={t(PAGES[id]!.title)}
            value={preview[id]?.() || null} accessory="chevron" onClick={() => open(id)} className="sp-root-row" />)}
        </Section>
      ))}
      <div className="dim small sp-version">openGym v{appVersion()} · {clientPlatform().info.buildSha}</div>
    </>}
  </div>
}

