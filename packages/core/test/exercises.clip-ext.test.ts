import { afterEach, describe, expect, it, vi } from 'vitest'

// The Android release shows its animations as animated WebP images (VITE_CLIP_EXT=webp); every
// other build keeps the MP4 loops.
describe('gifSrc and VITE_CLIP_EXT', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })
  const ex = { id: '0025', img: '0025.webp', gif: '0025.mp4', fv: '9025' }

  it('names MP4 loops by default', async () => {
    const { gifSrc, isVideoSrc } = await import('../src/exercises')
    expect(gifSrc(ex, 'male')).toBe('exercise-media/clip/0025.mp4')
    expect(gifSrc(ex, 'female')).toBe('exercise-media/clip/9025.mp4')
    expect(isVideoSrc(gifSrc(ex, 'male'))).toBe(true)
  })


  it('keeps configurable desktop image and clip bases', async () => {
    vi.stubEnv('VITE_IMG_BASE', 'https://cdn.test/images/')
    vi.stubEnv('VITE_GIF_BASE', 'https://cdn.test/videos/')
    const { imgSrc, gifSrc } = await import('../src/exercises')
    expect(imgSrc(ex, 'male')).toBe('https://cdn.test/images/0025.webp')
    expect(gifSrc(ex, 'male')).toBe('https://cdn.test/videos/0025.mp4')
    expect(imgSrc(ex, 'female')).toBe('https://cdn.test/images/9025.webp')
    expect(gifSrc(ex, 'female')).toBe('https://cdn.test/videos/9025.mp4')
  })
  it('keeps desktop MP4 loops when a retired Android option is present', async () => {
    vi.stubEnv('VITE_CLIP_EXT', 'webp')
    const { gifSrc } = await import('../src/exercises')
    expect(gifSrc(ex, 'male')).toBe('exercise-media/clip/0025.mp4')
  })

})
