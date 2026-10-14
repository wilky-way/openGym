import { configureUx, createBrowserUx } from '../src/platform/ux'
// @vitest-environment happy-dom
import { act, createRef, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Icon, { ICON_NAMES } from '../src/components/Icon'
import { DEFAULT_GLYPH, GLYPHS, glyphOf, KNOWN_GLYPHS } from '../src/lib/glyphs'
import { bindUI, Button, Check, MultiSelectRow, NumberField, SearchField, Section, Segmented, SelectRow, Switch, TextArea, TextField, type UIStore } from '../src/components/ui'

let host: HTMLDivElement, root: Root
beforeEach(() => {
  configureUx(createBrowserUx())
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-15T12:00:00Z'))
  host = document.createElement('div'); document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers() })
const render = (node: ReactNode) => act(() => root.render(node))
const click = (selector: string) => act(() => host.querySelector<HTMLElement>(selector)!.click())
const input = (selector: string, value: string) => act(() => {
  const el = host.querySelector<HTMLInputElement>(selector)!
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
})

describe('UI control contracts', () => {
  it('keeps switch and checkbox controlled and forwards accessibility props', () => {
    const change = vi.fn()
    render(<><Switch checked onChange={change} aria-label="Reminder" /><Check checked={false} label="Done" onChange={change} size={44} /></>)
    expect(host.querySelector('[role="switch"]')!.getAttribute('aria-checked')).toBe('true')
    click('[role="switch"]'); expect(change).toHaveBeenLastCalledWith(false)
    expect(host.querySelector('[role="switch"]')!.getAttribute('aria-label')).toBe('Reminder')
    click('[role="checkbox"]'); expect(change).toHaveBeenLastCalledWith(true)
    expect(host.querySelector('[role="checkbox"]')!.getAttribute('aria-checked')).toBe('false')
    render(<Switch checked disabled onChange={change} />)
    change.mockClear(); click('[role="switch"]'); expect(change).not.toHaveBeenCalled()
  })

  it('preserves segmented empty selection and typed option values', () => {
    const change = vi.fn()
    const options = [{ value: 1, label: 'One', icon: 'plus' }, { value: 2, label: 'Two' }]
    render(<Segmented options={options} value={null} allowEmpty onChange={change} />)
    expect(host.querySelector('.seg-sel')).toBeNull()
    click('button'); expect(change).toHaveBeenCalledWith(1)
    render(<Segmented options={options} value={2} onChange={change} />)
    expect(host.querySelector('.seg-sel')).toBeTruthy()
    expect(host.querySelector('.seg')!.getAttribute('style')).toContain('--i: 1')
    expect(host.querySelector('button.on')!.getAttribute('aria-pressed')).toBe('true')
  })

  it('forwards text refs, clears searches, and preserves button and section content', () => {
    const ref = createRef<HTMLInputElement>(), clear = vi.fn()
    render(<Section title="Title" footer="Footer"><TextField ref={ref} defaultValue="Draft" className="custom" /><TextArea defaultValue="Notes" /><SearchField value="Query" onChange={() => {}} onClear={clear} /><Button variant="primary" size="small" icon="plus" trailingIcon="chevronRight">Save</Button></Section>)
    expect(ref.current!.value).toBe('Draft')
    expect(ref.current!.className).toBe('field custom')
    expect(host.querySelector('textarea')!.value).toBe('Notes')
    click('.clear'); expect(clear).toHaveBeenCalledOnce()
    expect(host.querySelector('.btn')!.className).toBe('btn primary small ')
    expect(host.querySelector('.sect-t')!.textContent).toBe('Title')
    expect(host.querySelector('.sect-f')!.textContent).toBe('Footer')
  })

  it('distinguishes a nullable empty effort from failure and drops a superseded draft', () => {
    const change = vi.fn()
    render(<NumberField value={4} nullable onChange={change} />)
    input('input', ''); expect(change).toHaveBeenLastCalledWith(null)
    render(<NumberField value={null} nullable onChange={change} />)
    input('input', '0'); expect(change).toHaveBeenLastCalledWith(0)
    render(<NumberField value={7} nullable onChange={change} />)
    expect(host.querySelector('input')!.value).toBe('7')
  })

  it('binds the picker store, filters locally, closes before committing, and reports empty results', () => {
    const order: string[] = [], change = vi.fn((v: string) => order.push(v))
    const close = vi.fn(() => order.push('close'))
    const store: UIStore = { getState: () => ({ openSheet: make => { render(<div className="sheet">{make(close)}</div>); return 'handle' } }) }
    bindUI(store)
    const options = [{ value: 'a', label: 'Alpha', subtitle: 'First' }, { value: 'b', label: 'Beta' }]
    render(<SelectRow title="Choose" value="a" options={options} onChange={change} search={{ match: (o, q) => String(o.label).toLowerCase().includes(q.toLowerCase()), placeholder: 'Search', emptyLabel: 'Nothing found' }} />)
    expect(host.querySelector('.lrow-v')!.textContent).toBe('Alpha')
    click('.lrow')
    input('input', 'Beta')
    expect(host.querySelectorAll('.sheet .lrow')).toHaveLength(1)
    click('.sheet .lrow'); expect(order).toEqual(['close', 'b'])
    input('input', 'absent'); expect(host.querySelector('.empty')!.textContent).toContain('Nothing found')
    click('.clear'); expect(host.querySelectorAll('.sheet .lrow')).toHaveLength(2)
  })

  it('updates multi-selection locally even before the caller persists its values', () => {
    const toggle = vi.fn(), close = vi.fn()
    bindUI({ getState: () => ({ openSheet: make => render(<div className="sheet">{make(close)}</div>) }) })
    render(<MultiSelectRow title="Muscles" values={['a']} options={[{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }]} onToggle={toggle} doneLabel="Finish" />)
    expect(host.querySelector('.lrow-v')!.textContent).toBe('Alpha')
    click('.lrow'); click('.sheet .lrow:nth-child(2)')
    expect(toggle).toHaveBeenCalledWith('b')
    expect(host.querySelectorAll('.sheet .lrow.on')).toHaveLength(2)
    click('.sheet .lrow:nth-child(1)'); expect(host.querySelectorAll('.sheet .lrow.on')).toHaveLength(1)
    click('.btn'); expect(close).toHaveBeenCalledOnce()
  })
})

describe('icons and routine glyphs', () => {
  it('renders every named icon with hidden SVG semantics and preserves size/style overrides', () => {
    for (const name of ICON_NAMES) {
      render(<Icon name={name} size={28} style={{ height: 30 }} data-test="icon" />)
      const svg = host.querySelector('svg')!
      expect(svg.getAttribute('data-icon')).toBe(name)
      expect(svg.getAttribute('viewBox')).toBe('0 0 24 24')
      expect(svg.getAttribute('aria-hidden')).toBe('true')
      expect(svg.style.width).toBe('28px')
      expect(svg.style.height).toBe('30px')
    }
    render(<Icon name="missing" />); expect(host.innerHTML).toBe('')
  })

  it('recognizes current keys and old emoji without migrating saved values', () => {
    for (const key of [...GLYPHS, ...KNOWN_GLYPHS]) expect(glyphOf(key)).toBe(key)
    expect(glyphOf('💪')).toBe('arm')
    expect(glyphOf('🏋️‍♀️')).toBe('dumbbell')
    expect(glyphOf('💪️‍unknown')).toBe('arm')
    expect(glyphOf('')).toBe(DEFAULT_GLYPH)
    expect(glyphOf(null)).toBe(DEFAULT_GLYPH)
    expect(glyphOf('unknown')).toBe(DEFAULT_GLYPH)
  })
})
