import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { Timeline, type TimelineEvent } from './timeline'

afterEach(cleanup)

const EVENTS: TimelineEvent[] = [
  { id: 'e1', timestamp: '2026-03-04T09:15:00.000Z', title: 'Task created', tone: 'muted' },
  {
    description: 'Carrier reported a transport failure.',
    id: 'e2',
    timestamp: 1772620500000,
    title: 'Delivery failed',
    tone: 'bad'
  },
  { id: 'e3', timestamp: 1772706900000, title: 'Next reminder', tone: 'good', variant: 'schedule' }
]

describe('Timeline', () => {
  it('renders an ordered list with one <li> per event', () => {
    const { getByRole } = render(<Timeline events={EVENTS} label="Task history" />)
    const list = getByRole('list')

    expect(list.tagName).toBe('OL')
    expect(list.querySelectorAll('li')).toHaveLength(EVENTS.length)
  })

  it('applies the accessible name from label', () => {
    const { getByRole } = render(<Timeline events={EVENTS} label="Task history" />)

    expect(getByRole('list', { name: 'Task history' }).getAttribute('aria-label')).toBe('Task history')
  })

  it('renders a real <time> carrying a valid machine-readable dateTime', () => {
    const { getByRole } = render(<Timeline events={EVENTS} label="Task history" />)
    const times = getByRole('list').querySelectorAll('time')

    expect(times).toHaveLength(EVENTS.length)

    for (const el of times) {
      const iso = el.getAttribute('dateTime')

      expect(iso).toBeTruthy()
      expect(Number.isNaN(new Date(iso as string).getTime())).toBe(false)
    }

    expect(times[0].getAttribute('dateTime')).toBe('2026-03-04T09:15:00.000Z')
    expect(times[0].getAttribute('data-ec-mono')).toBe('')
  })

  it('renders no <time> at all for an event without a timestamp', () => {
    const { getByRole } = render(<Timeline events={[{ id: 'no-ts', title: 'Note added' }]} label="Task history" />)

    const list = getByRole('list')

    expect(list.querySelectorAll('li')).toHaveLength(1)
    expect(list.querySelectorAll('time')).toHaveLength(0)
    expect(list.textContent).toContain('Note added')
  })

  it('ignores an unparseable timestamp rather than fabricating one', () => {
    const { getByRole } = render(
      <Timeline events={[{ id: 'bad-ts', timestamp: 'not-a-date', title: 'Note added' }]} label="Task history" />
    )

    expect(getByRole('list').querySelectorAll('time')).toHaveLength(0)
  })

  it('distinguishes the schedule variant from the default dot variant', () => {
    const { getByRole } = render(<Timeline events={EVENTS} label="Task history" />)
    const items = getByRole('list').querySelectorAll('li')

    expect(items[0].getAttribute('data-ec-variant')).toBe('dot')
    expect(items[2].getAttribute('data-ec-variant')).toBe('schedule')

    const dotMarker = items[0].querySelector('[data-slot="ec-timeline-marker"]') as HTMLElement
    const scheduleMarker = items[2].querySelector('[data-slot="ec-timeline-marker"]') as HTMLElement

    // The future event is hollow: no fill, an outlined stroke instead.
    expect(scheduleMarker.className).toContain('bg-transparent')
    expect(scheduleMarker.className).toContain('border')
    expect(dotMarker.className).not.toContain('bg-transparent')

    // …and says so in text, since the marker itself is aria-hidden.
    expect(scheduleMarker.getAttribute('aria-hidden')).toBe('true')
    expect(items[2].textContent).toContain('scheduled')
  })

  it('conveys tone in text, not by colour alone', () => {
    const { getByRole } = render(<Timeline events={EVENTS} label="Task history" />)
    const items = getByRole('list').querySelectorAll('li')

    expect(items[0].textContent).toContain('Info')
    expect(items[1].textContent).toContain('Error')
    expect(items[2].textContent).toContain('Success')
  })

  it('renders the empty slot when there are no events, and nothing without one', () => {
    const { container, getByText } = render(
      <Timeline empty={<p>No activity yet</p>} events={[]} label="Task history" />
    )

    expect(getByText('No activity yet').tagName).toBe('P')
    expect(container.querySelectorAll('ol')).toHaveLength(0)

    cleanup()

    const bare = render(<Timeline events={[]} label="Task history" />)

    expect(bare.container.innerHTML).toBe('')
  })
})
