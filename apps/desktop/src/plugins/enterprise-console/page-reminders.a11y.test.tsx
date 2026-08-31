/**
 * Reminders page — a11y / keyboard test (LINE F).
 *
 * Per LINE F §P8: keyboard reachable actions, focus visible, status
 * not color-only, dialog/form labels, empty/error text readable.
 *
 * Pure render-only checks. No controller changes.
 *
 * Per P1-VIS-V2 (Reminders productization):
 *   - The 4 V0 tests are the W1-C contract (preserved verbatim
 *     except fixtures now include the 4 V2 VM fields the View
 *     consumes).
 *   - 2 new tests cover the V2 status strip (HONEST availability
 *     reflection + reminder count) and the narrow-layout
 *     `scheduling in X` badge.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { RemindersView } from './page-reminders.view'

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

afterEach(cleanup)

describe('Reminders a11y (LINE F)', () => {
  it('Schedule panel exposes one real level-2 heading with accessible name "Schedule"', () => {
    wrap(
      <RemindersView
        available
        createSlot={null}
        reminderRowActionsSlot={() => null}
        reminders={[]}
        remindersError={null}
        remindersIsPending={false}
      />,
    )
    // Per ConsolePanel contract: title="..." renders <h2>{title}</h2>.
    // The page-level PageHeader above is <h1>, so this is the only h2
    // named "Schedule" on the page.
    const heading = screen.getByRole('heading', { level: 2, name: 'Schedule' })
    expect(heading).toBeTruthy()
    expect(heading.tagName.toLowerCase()).toBe('h2')
  })

  it('empty state text is informative', () => {
    wrap(
      <RemindersView
        available
        createSlot={null}
        reminderRowActionsSlot={() => null}
        reminders={[]}
        remindersError={null}
        remindersIsPending={false}
      />,
    )
    expect(screen.getByText(/^no reminders/)).toBeTruthy()
  })

  it('reminder row exposes aria-label combining title + scheduled + state', () => {
    wrap(
      <RemindersView
        available
        createSlot={null}
        reminderRowActionsSlot={() => null}
        reminders={[
          {
            reminderId: 'r1',
            title: 'follow up',
            subjectType: 'biz_task',
            subjectId: 't1',
            timezone: 'UTC',
            state: 'active',
            tone: 'good',
            canCancelFromState: true,
            scheduledFor: 0,
            scheduledForDisplay: 'now',
            generation: 1,
            subjectDisplay: 'biz_task:t1',
            relativeOffset: 'in 1m',
            relativeOffsetTone: 'good',
            stateLabel: 'active',
            detail: {
              title: 'follow up',
              stateLabel: 'active',
              stateTone: 'good',
              subjectDisplay: 'biz_task:t1',
              scheduledForDisplay: 'now',
              timezone: 'UTC',
              ownerDisplay: '—',
              generationLabel: 'generation 1',
              reminderId: 'r1',
            },
          },
        ]}
        remindersError={null}
        remindersIsPending={false}
      />,
    )
    const row = screen.getByTestId('console-reminder-row-r1')
    expect(row.getAttribute('aria-label')).toContain('follow up')
    expect(row.getAttribute('aria-label')).toContain('now')
    expect(row.getAttribute('aria-label')).toContain('active')
  })

  it('status is NOT color-only: state text in DOM', () => {
    wrap(
      <RemindersView
        available
        createSlot={null}
        reminderRowActionsSlot={() => null}
        reminders={[
          {
            reminderId: 'r2',
            title: 'next',
            subjectType: 'biz_task',
            subjectId: 't2',
            timezone: 'UTC',
            state: 'cancelled',
            tone: 'muted',
            canCancelFromState: false,
            scheduledFor: 0,
            scheduledForDisplay: 'later',
            generation: 1,
            subjectDisplay: 'biz_task:t2',
            relativeOffset: '',
            relativeOffsetTone: 'muted',
            stateLabel: 'cancelled',
            detail: {
              title: 'next',
              stateLabel: 'cancelled',
              stateTone: 'muted',
              subjectDisplay: 'biz_task:t2',
              scheduledForDisplay: 'later',
              timezone: 'UTC',
              ownerDisplay: '—',
              generationLabel: 'generation 1',
              reminderId: 'r2',
            },
          },
        ]}
        remindersError={null}
        remindersIsPending={false}
      />,
    )
    expect(screen.getByText('cancelled')).toBeTruthy()
    const stateBadge = screen.getByLabelText('state cancelled')
    expect(stateBadge).toBeTruthy()
  })

  // V2 PRODUCTIZATION — narrow layout hook + scheduling meta is rendered
  it('productized status strip exposes availability and count as accessible region', () => {
    wrap(
      <RemindersView
        available
        createSlot={null}
        reminderRowActionsSlot={() => null}
        reminders={[
          {
            reminderId: 'r1',
            title: 'follow up',
            subjectType: 'biz_task',
            subjectId: 't1',
            timezone: 'UTC',
            state: 'active',
            tone: 'good',
            canCancelFromState: true,
            scheduledFor: 0,
            scheduledForDisplay: 'now',
            generation: 1,
            subjectDisplay: 'biz_task:t1',
            relativeOffset: 'in 1m',
            relativeOffsetTone: 'good',
            stateLabel: 'active',
            detail: {
              title: 'follow up',
              stateLabel: 'active',
              stateTone: 'good',
              subjectDisplay: 'biz_task:t1',
              scheduledForDisplay: 'now',
              timezone: 'UTC',
              ownerDisplay: '—',
              generationLabel: 'generation 1',
              reminderId: 'r1',
            },
          },
        ]}
        remindersError={null}
        remindersIsPending={false}
      />,
    )
    const strip = screen.getByTestId('console-reminders-status')
    expect(strip).toBeTruthy()
    expect(strip.getAttribute('data-ec-state')).toBe('available')
    expect(strip.textContent).toMatch(/server-authoritative/)
    expect(strip.textContent).toMatch(/1 reminder\b/)
    // Relative offset badge is exposed with aria-label + StatusDot
    expect(screen.getByLabelText('scheduling in 1m')).toBeTruthy()
  })

  it('productized availability=false surfaces unavailable status strip without fabricating rows', () => {
    wrap(
      <RemindersView
        available={false}
        createSlot={null}
        reminderRowActionsSlot={() => null}
        reminders={[]}
        remindersError={null}
        remindersIsPending={false}
      />,
    )
    const strip = screen.getByTestId('console-reminders-status')
    expect(strip.getAttribute('data-ec-state')).toBe('unavailable')
    expect(strip.textContent).toMatch(/reminders unavailable/)
  })
})
