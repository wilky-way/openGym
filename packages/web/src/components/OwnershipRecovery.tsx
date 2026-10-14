import {useState} from 'react'
import {useStore} from '../store/useStore'
import {useUI} from '../store/useUI'
import {t} from '../lib/i18n'
import {Button} from './ui'
/** The saved copy stays untouched until an explicit, current recovery choice. */
export default function OwnershipRecovery() {
  const recovery = useStore(s => s.sync?.recovery)
  const [busy,setBusy] = useState(false)
  const recover = async (choice: 'keep' | 'signout') => {
    if (busy || !recovery) return
    setBusy(true)
    try {
      const accepted = await useStore.getState().recoverOwnership(choice,recovery.fingerprint)
      if (!accepted) useUI.getState().toast(t('The saved copy changed. Open this recovery screen again.'))
    } catch (error) {useUI.getState().toast(error instanceof Error ? t(error.message) : t('Your saved copy is kept. Try again.'))}
    finally {setBusy(false)}
  }
  return <section className="card" role="alert" aria-label={t('Recover saved copy')}>
    <h2>{t('Your saved copy needs a choice')}</h2>
    <p>{t('Your data is still on this device. Nothing will sync until you choose how to continue.')}</p>
    <p>{t('Keep this device’s copy separately and use your signed-in profile, or sign out with a copy kept on this device.')}</p>
    <Button disabled={busy} onClick={()=>recover('keep')}>{t('Keep this device’s copy')}</Button>
    <Button disabled={busy} onClick={()=>recover('signout')}>{t('Sign out')}</Button>
  </section>
}
