/**
 * Reminders page — a11y / keyboard test (LINE F).
 *
 * Per LINE F §P8: keyboard reachable actions, focus visible, status
 * not color-only, dialog/form labels, empty/error text readable.
 *
 * Pure render-only checks. No controller changes.
 *
 * Per P1-VIS-V2-REMEDIATION-01:
 *   - The 4 V0 tests are the W1-C contract (preserved verbatim except
 *     fixtures now only include the 2 V2 VM fields the View still
 *     consumes: stateLabel + scheduledForDisplay + timezone etc.; the
 *     removed relativeOffset/relativeOffsetTone/detail fields are gone
 *     from the VM contract).
 *   - 2 status-strip tests updated: text now asserts the honest
 *     product copy "Reminder service available/unavailable" — no
 *     `/api/...` developer path on the visible product UI.
 *   - The relative-offset scheduling badge test is REMOVED (the
 *     runtime feature is gone).
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
            stateLabel: 'active',
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
            stateLabel: 'cancelled',
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

  // V2-R3 remediation — visible product copy is honest availability
  // language; no internal /api/ paths leak into the visible product UI.
  it('productized status strip uses honest availability copy (available)', () => {
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
            stateLabel: 'active',
          },
        ]}
        remindersError={null}
        remindersIsPending={false}
      />,
    )
    const strip = screen.getByTestId('console-reminders-status')
    expect(strip).toBeTruthy()
    expect(strip.getAttribute('data-ec-state')).toBe('available')
    expect(strip.textContent).toMatch(/Reminder service available/)
    expect(strip.textContent).toMatch(/1 reminder\b/)
    // No /api/... REST path on visible product UI
    expect(strip.textContent).not.toMatch(/\/api\//)
  })

  it('productized status strip uses honest availability copy (unavailable)', () => {
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
    expect(strip.textContent).toMatch(/Reminder service unavailable/)
    expect(strip.textContent).not.toMatch(/\/api\//)
  })
})
