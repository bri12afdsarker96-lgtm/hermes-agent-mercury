/**
 * Reminders page — a11y / keyboard test (LINE F).
 *
 * Per LINE F §P8: keyboard reachable actions, focus visible, status
 * not color-only, dialog/form labels, empty/error text readable.
 *
 * Pure render-only checks. No controller changes.
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
  it('Schedule section label is exposed via aria-labelledby (not nested h2)', () => {
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
    // The Schedule label is rendered as a span (not a nested heading) so
    // the panel-header h2 above remains the only heading on the page.
    const heading = document.getElementById('console-reminders-schedule-heading')
    expect(heading).toBeTruthy()
    expect(heading?.tagName.toLowerCase()).toBe('span')
    expect(heading?.textContent).toBe('Schedule')
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
})
