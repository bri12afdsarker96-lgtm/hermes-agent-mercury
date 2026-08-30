/**
 * Handoff page — a11y / keyboard test (LINE F).
 *
 * Per LINE F §P8: keyboard reachable actions, focus visible, status
 * not color-only, empty/error text readable.
 *
 * Pure render-only checks. No controller changes.
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

describe('Handoff a11y (LINE F)', () => {
  it('Handoff queue panel exposes one real level-2 heading with accessible name "Handoff queue"', () => {
    wrap(
      <HandoffsView
        available
        handoffRowActionsSlot={() => null}
        handoffs={[]}
        handoffsError={null}
        handoffsIsPending={false}
      />,
    )
    // Per ConsolePanel contract: title="..." renders <h2>{title}</h2>.
    // The page-level PageHeader above is <h1>, so this is the only h2
    // named "Handoff queue" on the page.
    const heading = screen.getByRole('heading', { level: 2, name: 'Handoff queue' })
    expect(heading).toBeTruthy()
    expect(heading.tagName.toLowerCase()).toBe('h2')
  })

  it('empty state text is informative', () => {
    wrap(
      <HandoffsView
        available
        handoffRowActionsSlot={() => null}
        handoffs={[]}
        handoffsError={null}
        handoffsIsPending={false}
      />,
    )
    expect(screen.getByText(/^no handoffs/)).toBeTruthy()
  })

  it('handoff row exposes aria-label combining msgId + threadId + state + age', () => {
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
    expect(row.getAttribute('aria-label')).toContain('m1')
    expect(row.getAttribute('aria-label')).toContain('t1')
    expect(row.getAttribute('aria-label')).toContain('parked')
    expect(row.getAttribute('aria-label')).toContain('30s')
  })

  it('status is NOT color-only: state text in DOM', () => {
    wrap(
      <HandoffsView
        available
        handoffRowActionsSlot={() => null}
        handoffs={[
          {
            msgId: 'm2',
            text: 'urgent',
            threadId: 't2',
            agentDisplay: 'agent-1',
            statusDisplay: ' · claimed',
            state: 'escalated',
            ageSeconds: 90,
            ageTone: 'bad',
            stateTone: 'warn',
            canClaim: false,
            canReply: false,
            canRequeue: false,
          },
        ]}
        handoffsError={null}
        handoffsIsPending={false}
      />,
    )
    expect(screen.getByText('escalated')).toBeTruthy()
    expect(screen.getByLabelText('state escalated')).toBeTruthy()
    expect(screen.getByLabelText('age 90 seconds')).toBeTruthy()
  })
})
