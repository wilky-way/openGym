import { useState } from 'react'
import type { Exercise } from '@opengym/core/exercises'
import { imgSrc, gifSrc, isVideoSrc, isCustomEx, figureOf } from '@opengym/core/exercises'
import { useStore } from '../store/useStore'
import { t, exerciseNameFor } from '../lib/i18n'
import Icon from './Icon'

export interface MediaProps { ex: Exercise; id?: string; compact?: boolean; minimizable?: boolean }

// Custom exercises never name files in the shipped catalogue, even if an old backup has img/gif.
export default function Media(props: MediaProps) {
  const index = useStore(s => s.index)
  const body = useStore(s => figureOf(s.S))
  return isCustomEx(props.ex, index) ? null : <BuiltinMedia key={`${props.ex.id}:${body}`} {...props} body={body} />
}

function BuiltinMedia({ ex, id, compact, minimizable, body }: MediaProps & { body: string }) {
  const [playing, setPlaying] = useState(true)
  const [failed, setFailed] = useState<'clip' | 'all' | null>(null)
  const gifSize = useStore(s => s.S.gifSize)
  const update = useStore(s => s.update)
  if (!ex.gif || (minimizable && gifSize === 'off')) return null
  const mini = minimizable && gifSize === 'mini'
  const showClip = playing && failed === null
  const onError = () => setFailed(showClip && ex.img ? 'clip' : 'all')
  const onTap = () => { if (failed) { setFailed(null); setPlaying(true) } else setPlaying(p => !p) }
  return <div className={'exmedia' + (compact ? ' compact' : '') + (mini ? ' mini' : '') + (failed === 'all' ? ' broken' : '')} id={id}>
    <button type="button" className="exmedia-play" onClick={onTap} aria-label={t(failed ? 'Retry' : playing ? 'tap to pause' : 'tap to play')}>
      {failed === 'all' ? <div className="exmedia-x"><Icon name="dumbbell" /></div>
        : showClip && isVideoSrc(gifSrc(ex, body))
          ? <video ref={autoplayMuted} className="catvid" src={gifSrc(ex, body)} poster={ex.img ? imgSrc(ex, body) : undefined} autoPlay muted loop playsInline disablePictureInPicture aria-label={exerciseNameFor(ex)} onError={onError} />
          : <img decoding="async" draggable={false} src={showClip ? gifSrc(ex, body) : imgSrc(ex, body)} alt={exerciseNameFor(ex)} onError={onError} />}
      {!mini && !failed && <span className="gifhint"><Icon name={playing ? 'pause' : 'play'} />{t(playing ? 'tap to pause' : 'tap to play')}</span>}
    </button>
    {minimizable && <button type="button" className="giftoggle" onClick={() => update(s => { s.gifSize = mini ? 'full' : 'mini' })}><Icon name={mini ? 'expand' : 'minimize'} />{t(mini ? 'Expand' : 'Minimize')}</button>}
  </div>
}

// Android WebView needs the muted attribute as well as React's muted property for autoplay.
export function autoplayMuted(el: HTMLVideoElement | null): void {
  if (!el) return
  el.muted = true
  el.defaultMuted = true
  el.setAttribute('muted', '')
  void el.play()?.catch(() => {})
}

export function Thumb({ ex }: { ex: Exercise }) {
  const index = useStore(s => s.index)
  const body = useStore(s => figureOf(s.S))
  const [broken, setBroken] = useState<string | null>(null)
  if (isCustomEx(ex, index)) return null
  const src = ex.img ? imgSrc(ex, body) : null
  return !src || broken === src
    ? <div className="thumb thumb-x"><Icon name="dumbbell" /></div>
    : <img className="thumb" loading="lazy" decoding="async" draggable={false} src={src} alt="" onError={() => setBroken(src)} />
}

export function WorkoutThumb({ ex, onExpand }: { ex: Exercise; onExpand: () => void }) {
  const index = useStore(s => s.index)
  if (isCustomEx(ex, index) || !ex.gif) return null
  return <button type="button" className="wthumb" onClick={onExpand} aria-label={t('Expand')}><Thumb ex={ex} /><span className="wthumb-x"><Icon name="expand" /></span></button>
}
