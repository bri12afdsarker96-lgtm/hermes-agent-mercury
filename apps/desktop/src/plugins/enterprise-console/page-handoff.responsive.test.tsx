/**
 * Handoff page — responsive hooks (LINE F).
 *
 * Per LINE F §P8.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { HandoffsView } from './page-handoff.view'

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

afterEach(cleanup)

describe('Handoff responsive hooks (LINE F)', () => {
  it('handoff row uses flex-wrap so actions wrap on narrow viewports', () => {
    wrap(
      <HandoffsView
        available
        handoffRowActionsSlot={() => null}
        handoffs={[
          {
            msgId: 'm1',
            text: 'help',
            threadId: 't1',
            agentDisplay: 'unclaimed',
            statusDisplay: '',
            state: 'parked',
            ageSeconds: 30,
            ageTone: 'warn',
            stateTone: 'muted',
            canClaim: true,
            canReply: false,
            canRequeue: false,
          },
        ]}
        handoffsError={null}
        handoffsIsPending={false}
      />,
    )
    const row = screen.getByTestId('console-handoff-row-m1')
    expect(row.className).toContain('flex-wrap')
    const actionWrap = row.querySelector('div.flex.shrink-0') as HTMLElement
    expect(actionWrap).toBeTruthy()
    expect(actionWrap.className).toContain('flex-wrap')
  })

  it('page wrapper carries max-width', () => {
    const { container } = wrap(
      <HandoffsView
        available
        handoffRowActionsSlot={() => null}
        handoffs={[]}
        handoffsError={null}
        handoffsIsPending={false}
      />,
    )

    const pageWrapper = container.querySelector(
      '[data-testid="console-page-handoff"]',
    ) as HTMLElement

    expect(pageWrapper.className).toContain('max-w-[96rem]')
  })
})
