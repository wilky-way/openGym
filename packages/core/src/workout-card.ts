import type { ExportWorkout, WorkoutExportOptions } from './export-types'
import type { ExerciseIndex } from './exercises'
// A finished workout as a picture, for "Share as image" in its detail sheet (#453): plain text
// loses its layout in most chat apps, a card keeps it. Three steps, so the part that decides what
// the card says and where it goes is testable without a canvas:
//   workoutCardModel  — what the card says: name, date, duration, sets, volume, new bests and
//                       how hard each muscle was worked
//   layoutWorkoutCard — where everything goes, given a way to measure text
//   drawWorkoutCard   — paints a layout onto a 2D canvas context
// Nothing here stores anything; the workout is read, never written.
import { sessionSections, workoutVolume, workoutDuration, workoutDay, doneUnits } from '@opengym/core/history'
import { EXIDX } from '@opengym/core/exercises'
import { isWarmupRow } from '@opengym/core/workout-model'
import { MUSCLES, INERT, levelsOf, loadOfWorkouts } from '@opengym/core/muscles'
import { fmtDate, fmtDur, fmtNum, fmtVol, capWords } from '@opengym/core/format'
import { t, exerciseNameClass } from '@opengym/core/i18n-core'

export const CARD_WIDTH = 1080
const PAD = 88
const MIN_HEIGHT = 720
// More than this many new bests and the rest are counted instead of listed: a card that grows
// past a phone screen is not glanceable any more.
export const MAX_RECORDS = 6
const TITLE_LINES = 2
const STAT_SIZE = 56
const MAP_MAX_HEIGHT = 560

/**
 * What the card says. `unit` is the profile's, `nameOf(entry)` the exercise's display name — the
 * same pair "Copy as text" takes (workoutText). Sets are work sets, as the volume is: warm-ups are
 * left out of both, the way they are left out of records and progression everywhere else. A
 * per-side set counts once per side, as the workout screen counts it. `levels` is the finish
 * summary's muscle map for this one session (levelsOf over loadOfWorkouts), null when no set
 * reached a muscle the map can show — a card of only cardio has nothing to shade.
 */
export function workoutCardModel(w: ExportWorkout, { unit, nameOf }: WorkoutExportOptions, index: ExerciseIndex = EXIDX): WorkoutCardModel {
  const entries = w.entries || []
  const sets = entries.reduce((n, e) => n + (e.sets || []).reduce((m, s) => m + (isWarmupRow(s) ? 0 : doneUnits(s)), 0), 0)
  // New bests in the order the sheet lists the exercises, each named once — a combined session
  // can hold the same lift twice.
  const prs = new Set(w.prs || [])
  const records: { id: string; name: string }[] = []
  for (const i of sessionSections(entries).flatMap(section => section.units).flat()) {
    const entry = entries[i]
    if (!entry || !prs.has(entry.id) || records.some(r => r.id === entry.id)) continue
    const name = nameOf(entry)
    records.push({ id: entry.id, name: exerciseNameClass(index[entry.id]) ? capWords(name) : name })
  }
  const day = workoutDay(w)
  const ms = workoutDuration(w)
  const levels = levelsOf(loadOfWorkouts([w], undefined, index), undefined) as Record<string, number>
  return {
    title: w.name || '',
    date: day ? fmtDate(day, true, true) : '',
    // Imported history has no clock: an unknown duration is left out rather than shown as 0.
    stats: [
      ...(ms >= 60000 ? [{ label: t('Duration'), value: fmtDur(ms) }] : []),
      { label: t('Sets'), value: fmtNum(sets) },
      { label: t('Volume'), value: fmtVol(w.vol ?? workoutVolume(w, index), unit) },
    ],
    records: records.map(r => r.name),
    levels: MUSCLES.some(m => (levels[m] ?? 0) > 0) ? levels : null,
  }
}

// Greedy word wrap to `max` lines; the last line that does not fit is cut with an ellipsis.
// A word wider than the line on its own (a long German compound) is cut too, never overflowed.
export function wrapText(text: unknown, width: number, measure: (text: string) => number, max: number) {
  const words = String(text || '').split(/\s+/).filter(Boolean)
  const lines = []
  let line = ''
  for (let i = 0; i < words.length; i++) {
    const next = line ? line + ' ' + words[i] : words[i]!
    if (measure(next) <= width) { line = next; continue }
    if (line) lines.push(line)
    line = words[i]!
    if (lines.length === max) break
  }
  if (line && lines.length < max) lines.push(line)
  const rest = lines.join(' ').length < words.join(' ').length
  return lines.map((l, i) => (i === lines.length - 1 && (rest || measure(l) > width) ? ellipsize(l, width, measure) : l))
}
function ellipsize(text: string, width: number, measure: (text: string) => number) {
  let s = text
  while (s && measure(s + '…') > width) s = s.slice(0, -1)
  return s.trimEnd() + '…'
}

// The largest size up to `max` at which `text` fits `width`: a 12,345.5 kg volume shrinks to fit
// its tile rather than running into the next one.
function fitSize(text: string, width: number, measure: MeasureText, weight: number, max: number, min = 28) {
  let size = max
  while (size > min && measure(text, weight, size) > width) size -= 2
  return size
}

/**
 * Where everything goes. `measure(text, weight, size)` returns a width in pixels — the canvas's
 * measureText in the app, a fake in the tests. `rtl` mirrors the card for Arabic: text anchors
 * at the right edge, the tiles run right to left and the trophy sits to the right of its line.
 * `map` is `{ aspect }`, one body view's height over its width, to include the muscle map, or
 * null to leave it out; a model without levels has none either way. Returns the canvas size and
 * a flat list of items for drawWorkoutCard; a text item carries its size and weight, the font
 * family is the drawer's.
 */
export function layoutWorkoutCard(model: WorkoutCardModel, { measure, rtl = false, width = CARD_WIDTH, map = null }: { measure: MeasureText; rtl?: boolean; width?: number; map?: { aspect: number } | null }): WorkoutCardLayout {
  const items: CardItem[] = []
  const inner = width - PAD * 2
  const start = rtl ? width - PAD : PAD
  const dir = rtl ? -1 : 1
  let y = PAD
  const text = (str: string, size: number, weight: number, color: string, x = start, extra?: { anchor?: string }) => {
    items.push({ kind: 'text', text: str, x, y: y + size, size, weight, color, ...extra })
    y += Math.round(size * 1.3)
  }

  items.push({ kind: 'bar', x: start, y, w: 96 * dir, h: 10 })
  y += 10 + 52
  for (const line of wrapText(model.title, inner, s => measure(s, 700, 76), TITLE_LINES)) text(line, 76, 700, 'label')
  if (model.date) { y += 4; text(model.date, 38, 400, 'label2') }

  // The numbers as tiles, the way the finish summary shows them.
  y += 36
  const gap = 20
  const n = model.stats.length
  const tileW = (inner - gap * (n - 1)) / n
  const tileH = 150
  model.stats.forEach((stat, i) => {
    const x = rtl ? width - PAD - (i + 1) * tileW - i * gap : PAD + i * (tileW + gap)
    const textX = rtl ? x + tileW - 28 : x + 28
    const room = tileW - 56
    items.push({ kind: 'tile', x, y, w: tileW, h: tileH })
    const [label] = wrapText(stat.label, room, s => measure(s, 500, 28), 1)
    items.push({ kind: 'text', text: label!, x: textX, y: y + 28 + 28, size: 28, weight: 500, color: 'label2' })
    const size = fitSize(stat.value, room, measure, 700, STAT_SIZE)
    items.push({ kind: 'text', text: stat.value, x: textX, y: y + tileH - 32, size, weight: 700, color: 'label' })
  })
  y += tileH

  // Front and back side by side, as large as the width allows without running past a phone
  // screen, with the finish summary's five-step legend under them.
  if (map && model.levels) {
    y += 48
    const viewGap = 40
    let viewW = (inner - viewGap) / 2
    let viewH = viewW * map.aspect
    if (viewH > MAP_MAX_HEIGHT) { viewH = MAP_MAX_HEIGHT; viewW = viewH / map.aspect }
    const left = (width - (viewW * 2 + viewGap)) / 2
    items.push({ kind: 'map', view: 'front', x: left, y, w: viewW, h: viewH })
    items.push({ kind: 'map', view: 'back', x: left + viewW + viewGap, y, w: viewW, h: viewH })
    y += viewH + 32
    const sw = 26
    const swGap = 8
    const less = t('Less')
    const more = t('More')
    const labelGap = 16
    const total = measure(less, 400, 28) + labelGap + 5 * sw + 4 * swGap + labelGap + measure(more, 400, 28)
    let x = (width - total) / 2
    // Read the way the language reads: "Less" first on the reading side, the ramp toward "More".
    const parts = rtl ? [more, 4, 3, 2, 1, 0, less] : [less, 0, 1, 2, 3, 4, more]
    for (const part of parts) {
      if (typeof part === 'number') {
        items.push({ kind: 'swatch', x, y, size: sw, level: part })
        x += sw + (parts.indexOf(part) === parts.length - 2 ? labelGap : swGap)
      } else {
        const w = measure(part, 400, 28)
        // Drawn left-anchored whatever the direction, so the row lands where it was measured.
        items.push({ kind: 'text', text: part, x, y: y + sw - 3, size: 28, weight: 400, color: 'label2', anchor: 'left' })
        x += w + labelGap
      }
    }
    y += sw
  }

  if (model.records.length) {
    y += 52
    text(t('New personal records'), 34, 600, 'acc')
    y += 10
    const icon = 44
    const indent = icon + 22
    const shown = model.records.length > MAX_RECORDS ? model.records.slice(0, MAX_RECORDS - 1) : model.records
    for (const name of shown) {
      items.push({ kind: 'trophy', x: rtl ? start - icon : start, y: y + 4, size: icon })
      const [line] = wrapText(name, inner - indent, s => measure(s, 500, 42), 1)
      text(line!, 42, 500, 'label', start + indent * dir)
      y += 14
    }
    if (shown.length < model.records.length) text(t('and {0} more', model.records.length - shown.length), 38, 400, 'label2', start + indent * dir)
  }

  y += 64
  const height = Math.max(MIN_HEIGHT, Math.round(y + 34 + PAD))
  items.push({ kind: 'text', text: 'openGym', x: start, y: height - PAD, size: 34, weight: 700, color: 'acc' })
  return { width, height, rtl, items }
}

/* ---------- colours ---------- */

// "#rgb", "#rrggbb", "rgb(…)" or "rgba(…)" as [r, g, b, a]; null for anything else.
export function parseColor(value: unknown): [number, number, number, number] | null {
  const s = String(value || '').trim()
  let m = s.match(/^#([0-9a-f]{3,8})$/i)
  if (m) {
    let h = m[1]!
    if (h.length === 3 || h.length === 4) h = [...h].map(c => c + c).join('')
    if (h.length !== 6 && h.length !== 8) return null
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16)
    return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1]
  }
  m = s.match(/^rgba?\(([^)]+)\)$/i)
  if (!m) return null
  const parts = m[1]!.split(/[\s,/]+/).filter(Boolean).map(p => (p.endsWith('%') ? parseFloat(p) / 100 : parseFloat(p)))
  if (parts.length < 3 || parts.some(Number.isNaN)) return null
  return [parts[0]!, parts[1]!, parts[2]!, parts.length > 3 ? parts[3]! : 1]
}
// CSS color-mix(in srgb, a p%, b): p of `a` over the rest of `b`, as an rgb() string. A canvas
// is handed plain rgb, so the card does not depend on how a WebView parses color-mix().
export function mixColor(a: string, b: string, p: number) {
  const x = parseColor(a)
  const y = parseColor(b)
  if (!x || !y) return x ? a : b
  const ch = (i: number) => Math.round(x[i]! * p + y[i]! * (1 - p))
  return `rgb(${ch(0)}, ${ch(1)}, ${ch(2)})`
}
/**
 * The muscle map's fills for the card, worked out the way index.css works them out for .bodymap:
 * the silhouette and an untouched muscle as a little label over the surface, levels 1–4 as more
 * and more accent over that. A semi-transparent label (the light theme's) is flattened onto the
 * surface first.
 */
export function mapColors({ label, surface, acc }: { label: string; surface: string; acc: string }) {
  const lab = parseColor(label)
  const flat = lab && lab[3] < 1 ? mixColor(`rgb(${lab[0]}, ${lab[1]}, ${lab[2]})`, surface, lab[3]) : label
  const base = mixColor(flat, surface, 0.11)
  return {
    sil: mixColor(flat, surface, 0.18),
    levels: [base, mixColor(acc, base, 0.32), mixColor(acc, base, 0.56), mixColor(acc, base, 0.78), acc],
  }
}

/* ---------- drawing ---------- */

export const CARD_FONT = "-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',Roboto,system-ui,sans-serif"

/** One body view's height over its width, from its `vb` ("minX minY width height"). */
export const viewAspect = (view?: { vb?: string } | null) => {
  const [, , w, h] = String(view?.vb || '').split(/\s+/).map(Number)
  return w! > 0 && h! > 0 ? h! / w! : 1.76
}


export interface WorkoutCardModel {
  title: string; date: string; stats: { label: string; value: string }[];
  records: string[]; levels: Record<string, number> | null;
}
export type MeasureText = (text: string, weight: number, size: number) => number
export type CardItem =
  | { kind: 'text'; text: string; x: number; y: number; size: number; weight: number; color: string; anchor?: string }
  | { kind: 'bar'; x: number; y: number; w: number; h: number }
  | { kind: 'tile'; x: number; y: number; w: number; h: number }
  | { kind: 'map'; view: 'front' | 'back'; x: number; y: number; w: number; h: number }
  | { kind: 'swatch'; x: number; y: number; size: number; level: number }
  | { kind: 'trophy'; x: number; y: number; size: number }
export interface WorkoutCardLayout { width: number; height: number; rtl: boolean; items: CardItem[] }
