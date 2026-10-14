import { ux } from '../platform/ux'
import { mapColors, CARD_FONT } from '../../../core/src/workout-card'
import type { WorkoutCardLayout } from '../../../core/src/workout-card'
import { MUSCLES, INERT } from '@opengym/core/muscles'
export { CARD_FONT, viewAspect, workoutCardModel, layoutWorkoutCard } from '../../../core/src/workout-card'

// The trophy from components/Icon.jsx, on its 24×24 grid, so the card and the app agree.
const TROPHY = [
  'M7.6 4h8.8v4.6a4.4 4.4 0 0 1-8.8 0Z',
  'M7.6 5.6H4.9v1.5a3 3 0 0 0 2.9 3M16.4 5.6h2.7v1.5a3 3 0 0 1-2.9 3M12 13v3.4M8.6 20.4h6.8l-.7-4H9.3Z',
]
/**
 * Paint a layout. `colors` holds bg, surface, tile, label, label2 and acc as CSS colours — the
 * app's current theme and accent, read off the root element by the caller. `map`, when the
 * layout has a map in it, is `{ body, levels }`: body-paths.js geometry for the profile's body
 * ({ front, back }) and the model's levels.
 */
export function drawWorkoutCard(ctx: CanvasRenderingContext2D, layout: WorkoutCardLayout, colors: CardColors, map: CardMap | null = null, family: string = CARD_FONT) {
  const { width, height, rtl, items } = layout
  const shades = mapColors(colors)
  ctx.fillStyle = colors.bg
  ctx.fillRect(0, 0, width, height)
  const inset = 36
  ctx.fillStyle = colors.surface
  roundRect(ctx, inset, inset, width - inset * 2, height - inset * 2, 48)
  ctx.fill()
  ctx.textBaseline = 'alphabetic'
  for (const item of items) {
    if (item.kind === 'bar') {
      ctx.fillStyle = colors.acc
      roundRect(ctx, Math.min(item.x, item.x + item.w), item.y, Math.abs(item.w), item.h, item.h / 2)
      ctx.fill()
    } else if (item.kind === 'tile') {
      ctx.fillStyle = colors.tile || colors.bg
      roundRect(ctx, item.x, item.y, item.w, item.h, 28)
      ctx.fill()
    } else if (item.kind === 'swatch') {
      ctx.fillStyle = shades.levels[item.level]!
      roundRect(ctx, item.x, item.y, item.size, item.size, 7)
      ctx.fill()
    } else if (item.kind === 'map') {
      const view = map?.body?.[item.view]
      if (view) drawView(ctx, view, item, map!.levels, shades)
    } else if (item.kind === 'trophy') {
      ctx.save()
      ctx.translate(item.x, item.y)
      ctx.scale(item.size / 24, item.size / 24)
      ctx.strokeStyle = colors.acc
      ctx.lineWidth = 1.7
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      for (const d of TROPHY) ctx.stroke(ux().path2D(d))
      ctx.restore()
    } else {
      ctx.direction = item.anchor === 'left' ? 'ltr' : rtl ? 'rtl' : 'ltr'
      ctx.textAlign = item.anchor === 'left' ? 'left' : 'start'
      ctx.fillStyle = colors[item.color] || colors.label
      ctx.font = `${item.weight} ${item.size}px ${family}`
      ctx.fillText(item.text, item.x, item.y)
    }
  }
}
function drawView(ctx: CanvasRenderingContext2D, view: BodyView, box: { x: number; y: number; w: number; h: number }, levels: Record<string, number>, shades: ReturnType<typeof mapColors>) {
  const [minX, minY, vw, vh] = String(view.vb).split(/\s+/).map(Number)
  ctx.save()
  ctx.translate(box.x, box.y)
  ctx.scale(box.w / vw!, box.h / vh!)
  ctx.translate(-minX!, -minY!)
  ctx.fillStyle = shades.sil
  for (const slug of INERT) for (const d of view.p[slug] || []) ctx.fill(ux().path2D(d))
  for (const slug of MUSCLES) {
    ctx.fillStyle = shades.levels[levels?.[slug] || 0]!
    for (const d of view.p[slug] || []) ctx.fill(ux().path2D(d))
  }
  ctx.restore()
}
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

export interface BodyView { vb: string; p: Record<string, string[]> }
export interface CardMap { body: Partial<Record<'front' | 'back', BodyView>>; levels: Record<string, number> }
export interface CardColors {
  bg: string; surface: string; tile?: string; label: string; label2: string; acc: string;
  [key: string]: string | undefined;
}
