/**
 * Reminders page — responsive hooks (LINE F).
 *
 * Per LINE F §P8: no critical control clipping, no inaccessible
 * horizontal overflow, table/list fallback usable at narrow width.
 *
 * CSS class-string assertions only (jsdom does not run layout).
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
})
