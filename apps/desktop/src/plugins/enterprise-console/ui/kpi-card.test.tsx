import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { KpiCard } from './kpi-card'

afterEach(cleanup)

function Icon() {
  return <svg />
}

describe('KpiCard', () => {
  it('renders an em dash when the server has no figure yet, never a zero', () => {
    // The workbench KPI strip has no aggregation endpoint. Coercing a missing
    // value to 0 would present "0 pending items" as though it were real.
    const { getByText, queryByText } = render(<KpiCard icon={Icon} label="今日待处理" value={null} />)

    expect(getByText('—')).toBeTruthy()
    expect(queryByText('0')).toBe(null)
  })

  it('treats an omitted value the same as an explicit null', () => {
    const { getByText } = render(<KpiCard icon={Icon} label="今日待处理" />)

    expect(getByText('—')).toBeTruthy()
  })

  it('renders a real figure when the server supplies one', () => {
    const { getByText } = render(<KpiCard icon={Icon} label="今日待处理" value={1234} />)

    expect(getByText('1,234')).toBeTruthy()
  })

  it('holds the figure geometry while loading so the strip does not reflow', () => {
    const { container } = render(<KpiCard icon={Icon} label="今日待处理" loading value={12} />)

    expect(container.querySelector('[data-slot="ec-kpi-skeleton"]')).toBeTruthy()
    expect(container.querySelector('[data-slot="ec-kpi-value"]')).toBe(null)
  })

  it('states the delta direction in text, not only by colour or glyph', () => {
    const { container, getByText } = render(
      <KpiCard delta={{ direction: 'up', label: '较昨日', value: 2 }} icon={Icon} label="今日待处理" value={12} />
    )

    // The glyph is aria-hidden, so the direction has to survive in real text.
    expect(getByText('增加 2，')).toBeTruthy()
    expect(container.querySelector('[data-slot="ec-kpi-delta"]')?.textContent).toContain('较昨日')
  })

  it('renders a flat delta rather than hiding it — no change is a real answer', () => {
    const { getByText } = render(
      <KpiCard delta={{ direction: 'flat', label: '较昨日', value: 0 }} icon={Icon} label="今日待处理" value={12} />
    )

    expect(getByText('持平 0，')).toBeTruthy()
  })

  it('omits the delta row entirely when no baseline is supplied', () => {
    const { container } = render(<KpiCard icon={Icon} label="今日待处理" value={12} />)

    expect(container.querySelector('[data-slot="ec-kpi-delta"]')).toBe(null)
  })

  it('carries the module accent as a data attribute rather than an inline style', () => {
    const { container } = render(<KpiCard accent="knowledge" icon={Icon} label="知识待审核" value={3} />)
    const card = container.querySelector('[data-slot="ec-kpi-card"]')

    expect(card?.getAttribute('data-ec-accent')).toBe('knowledge')
    expect(card?.getAttribute('style')).toBe(null)
  })

  it('defaults to the brand accent', () => {
    const { container } = render(<KpiCard icon={Icon} label="今日待处理" value={1} />)

    expect(container.querySelector('[data-slot="ec-kpi-card"]')?.getAttribute('data-ec-accent')).toBe('brand')
  })
})
