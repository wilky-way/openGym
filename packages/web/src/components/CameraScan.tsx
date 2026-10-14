import { camera } from '../platform/camera'
import { useEffect, useRef, useState } from 'react'
import { t } from '@opengym/core/i18n-core'
import { decodeSource } from '../lib/scan-web'
import { Button } from '../components/ui'

// Live camera scanner for the browser/PWA (the app build uses ML Kit's own UI instead — see
// lib/scan.js). Opens the rear camera into a <video>, decodes a frame every ~150 ms until a QR
// shows up, then hands { value, fmt } to onFound. Cancel (or unmount) stops the camera.
//
// Errors are shown in place rather than thrown: a denied permission or a browser without
// getUserMedia leaves the sheet up with a message, and the add-card form underneath still offers
// photo import and typing.
export default function CameraScan({ onFound, onCancel }: { onFound: (code: { value: string; fmt: string }) => void; onCancel: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<'denied' | 'unavailable' | null>(null)

  useEffect(() => {
    let stream: MediaStream | null = null, timer: ReturnType<typeof setTimeout> | null = null, done = false
    const stop = () => {
      done = true
      if (timer) clearTimeout(timer)
      if (stream) stream.getTracks().forEach(tr => tr.stop())
    }
    ;(async () => {
      if (!camera().supported()) { setError('unavailable'); return }
      try {
        stream = await camera().open()
      } catch (e) {
        const name = e && typeof e === 'object' && 'name' in e ? e.name : null
        setError(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unavailable')
        return
      }
      if (done) { stream.getTracks().forEach(tr => tr.stop()); return }
      const v = videoRef.current
      if (!v) return
      v.srcObject = stream
      try { await v.play() } catch (e) { /* autoplay policies; the loop below waits for frames */ }
      const tick = async () => {
        if (done) return
        if (v.readyState >= 2) {
          let code = null
          try { code = await decodeSource(v) } catch (e) { /* keep trying */ }
          if (code && !done) { stop(); onFound(code); return }
        }
        timer = setTimeout(tick, 150)
      }
      tick()
    })()
    return stop
  }, [onFound])

  return <>
    <h3>{t('Scan')}</h3>
    {error
      ? <div className="muted small" style={{ marginBottom: 16, lineHeight: 1.5 }}>
          {error === 'denied'
            ? t('Camera access was denied. Allow it in your browser and try again.')
            : t('No camera available here. Import a photo or type the code instead.')}
        </div>
      : <>
          <div className="cam-wrap">
            {/* playsInline keeps iOS from going full-screen; muted satisfies autoplay rules. */}
            <video ref={videoRef} playsInline muted autoPlay />
            <div className="cam-frame" aria-hidden="true" />
          </div>
          <div className="muted small" style={{ textAlign: 'center', margin: '12px 0 16px' }}>{t('Point the camera at the QR code')}</div>
        </>}
    <Button variant="tinted" onClick={onCancel}>{t('Cancel')}</Button>
  </>
}
