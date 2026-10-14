import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import LineChart, { type ChartPoint } from '../src/components/LineChart'

const points: ChartPoint[] = [{ t: Date.UTC(2026, 0, 1), y: 70 }, { t: Date.UTC(2026, 0, 2), y: 71 }]
const render = (props: React.ComponentProps<typeof LineChart>) => renderToStaticMarkup(<LineChart {...props} />)
describe('chart bounds integration regressions', () => {
  it.each([
    { points: [] },
    { points: [{ ...points[0]!, y: NaN }] },
    { points: [{ ...points[0]!, t: NaN }] },
    { points: [{ ...points[0]!, y: Infinity }] },
    { points, series: [{ points: [], color: 'red' }] },
    { points, series: [{ points: [{ ...points[0]!, y: NaN }], color: 'red' }] },
    { points, series: [{ points: [{ ...points[0]!, t: NaN }], color: 'red' }] },
  ])('shows the empty state for invalid or empty bounds: %j', props => {
    const html = render(props)
    expect(html).toContain('No data yet')
    expect(html).not.toContain('<svg')
    expect(html).not.toMatch(/NaN|Infinity/)
  })
  it('retains a valid ordinary chart when the optional series list is empty', () => {
    expect(render({ points, series: [] })).toBe(render({ points }))
    expect(render({ points })).toContain('<svg')
  })
  it('renders a million-point dataset without a spread argument limit', () => {
    const million = Array.from({ length: 1_000_000 }, (_, i) => ({ t: points[0]!.t + i * 1000, y: i % 10 }))
    const html = render({ points: million, axes: false })
    expect(html).toContain('<polyline')
    expect(html).not.toMatch(/NaN|Infinity/)
  }, 30_000)
})
