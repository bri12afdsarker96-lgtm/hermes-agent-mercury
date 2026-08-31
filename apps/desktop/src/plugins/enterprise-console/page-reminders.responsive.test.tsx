/**
 * Reminders page — responsive hooks (LINE F).
 *
 * Per LINE F §P8: no critical control clipping, no inaccessible
 * horizontal overflow, table/list fallback usable at narrow width.
 *
 * CSS class-string assertions only (jsdom does not run layout).
 *
 * Per P1-VIS-V2-REMEDIATION-01:
 *   - V0 tests preserved verbatim (fixtures slimmed to the V2 VM
 *     fields the View still consumes; removed relativeOffset and
 *     detail fields are gone).
 *   - 1 test verifies the row carries `data-ec-reminder-state` and
 *     the timezone `data-ec-mono` span — the narrow-layout debugging
 *     hooks used by the design system.
 *   - The relative-offset hook is REMOVED from the row layout.
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

describe('Reminders responsive hooks (LINE F)', () => {
  it('reminder row uses flex-wrap so actions wrap on narrow viewports', () => {
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
    expect(row.className).toContain('flex-wrap')
    const actionWrap = row.querySelector('div.flex.shrink-0') as HTMLElement
    expect(actionWrap).toBeTruthy()
    expect(actionWrap.className).toContain('flex-wrap')
  })

  it('page wrapper carries max-width so the page does not overflow horizontally', () => {
    const { container } = wrap(
      <RemindersView
        available
        createSlot={null}
        reminderRowActionsSlot={() => null}
        reminders={[]}
        remindersError={null}
        remindersIsPending={false}
      />,
    )

    const pageWrapper = container.querySelector(
      '[data-testid="console-page-reminders"]',
    ) as HTMLElement

    expect(pageWrapper.className).toContain('max-w-[96rem]')
  })

  // V2 PRODUCTIZATION — narrow-layout hook
  it('row carries data-ec-reminder-state and row mono-span for narrow layout debugging', () => {
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
    expect(row.getAttribute('data-ec-reminder-state')).toBe('active')
    expect(row.querySelector('[data-ec-mono]')).toBeTruthy()
  })
})
