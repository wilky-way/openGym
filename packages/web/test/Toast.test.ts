
// circle about 170 by 230 CSS px over the list and the button under it: its corners were a pill's
// 99px on a box that tall, and the box only ever got half the screen's width to wrap in (Android
// QA, v1.3.9). One line still has to read as a pill.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const css: any = readFileSync(new URL('../src/components/widgets.css', import.meta.url), 'utf8')
const rule: any = css.match(/\n#toast\{([^}]*)\}/)[1]
const px: any = (v: any) => {
  const token: any = v.match(/^var\((--[\w-]+)\)$/)
  const value: any = token ? css.match(new RegExp(`${token[1]}:\\s*([^;]+);`))[1].trim() : v
  return parseFloat(value)
}

describe('the toast', () => {
  it('rounds its corners like a pill on one line, not like a circle on four', () => {
    const radius: any = px(rule.match(/border-radius:([^;]+);/)[1].trim())
    const pad: any = parseFloat(rule.match(/padding:(\d+)px/)[1])
    const size: any = parseFloat(rule.match(/font-size:(\d+)px/)[1])
    const oneLine: any = 2 * pad + size * 1.29   // body line-height
    expect(radius).toBeGreaterThanOrEqual(oneLine / 2)   // one line: fully rounded ends
    expect(radius).toBeLessThanOrEqual(oneLine / 2 + 4)  // four lines: a box with round corners
  })

  // left:50% leaves a box without a width half the screen to wrap in: the same message stood as
  // a column about 206 CSS px wide and as tall.
  it('wraps a long message across the screen, not in half of it', () => {
    expect(rule).toMatch(/left:50%/)
    expect(rule).toMatch(/width:max-content;max-width:88vw/)
  })
})

// The W09 subset must include the display and interaction states W23 will later reconcile.
describe('toast visibility and action rules', () => {
  it('shows live messages and enables the Undo surface', () => {
    expect(css).toMatch(/#toast\.show\{opacity:1;transform:translateX\(-50%\) translateY\(0\)\}/)
    expect(css).toMatch(/#toast\.has-action\{pointer-events:auto;display:flex;/)
    expect(css).toMatch(/#toast \.toast-act\{[^}]*min-height:36px/)
    expect(css).toMatch(/#toast \.toast-act:active\{/)
  })
  it('clears the workout bottom edge and the running timer', () => {
    expect(css).toContain('body.no-tabbar #toast{bottom:calc(24px + var(--sab))}')
    expect(css).toContain('body.no-tabbar.resting #toast{bottom:calc(100px + var(--sab))}')
  })
})
