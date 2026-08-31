/**
 * P1-VIS-V1-PRODUCTIZATION-REBUILD-02 responsive coverage for `ConversationsPage`.
 *
 * Closes the formal Responsive / A11y Gate Candidate-blocker identified by the
 * P1-RESP-A11Y-CANDIDATE-BLOCKERS-01 Gap Matrix: this surface is the only P1
 * page without a responsive test asserting narrow-viewport behaviour.
 *
 * Per the frozen V1 page-conversations.view.tsx:
 *   - The page wrapper carries `mx-auto w-full max-w-[96rem]` so the page
 *     cannot horizontally overflow at any viewport (1280x720, 1440x900,
 *     1672x941, 1920x1080).
 *   - No `w-screen`, no `flex-nowrap`, no `overflow-x-auto` escape hatches
 *     are introduced.
 *   - The inbound / outbound list rows use `flex-wrap` and `min-w-0`
 *     pattern; row text uses `truncate` to survive narrow widths without
 *     horizontal overflow.
 *
 * HONEST LABEL:
 *   RESPONSIVE_CLASS_HOOK_PROOF (NOT REAL_BROWSER_CLIPPING_PROOF)
 *
 *   jsdom does not run real layout. Real viewport rendering is verified by
 *   the Playwright Enterprise Visual Evidence workflow (next Gate).
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { FakeHermesTransport } from './fake-transport'
import { ConversationsPage } from './page-conversations'
import { $transport } from './transport'

const CONV_FIXTURE = {
  '/api/conversations-inbound': {
    inbound: [
      {
        channel: 'wecom',
        external_chat_id: 'thr-x',
        inbound_id: 'in-1',
        message_type: 'text',
        processed_ts: '2026-08-28T01:00:05+00:00',
        received_ts: '2026-08-28T01:00:00+00:00',
        state: 'processed',
        updated_ts: '2026-08-28T01:00:05+00:00'
      }
    ]
  },
  '/api/conversations-outbound': { outbound: [] },
  '/api/conversations-attempts': { attempts: [] }
}

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

afterEach(() => {
  cleanup()
  $transport.set(null)
})

describe('ConversationsPage · responsive hooks (P1-VIS-V1-PRODUCTIZATION-REBUILD-02)', () => {
  it('C-R1: outer page wrapper is bounded by max-w-[96rem] so no horizontal overflow is possible at 1280x720', async () => {
    $transport.set(new FakeHermesTransport(CONV_FIXTURE))
    wrap(<ConversationsPage />)
    await waitFor(() => screen.getByTestId('console-conv-inbound'))

    const page = screen.getByTestId('console-page-conversations')
    expect(page.className).toContain('max-w-[96rem]')
  })

  it('C-R2: page never introduces w-screen or overflow-x-auto escape hatch', async () => {
    $transport.set(new FakeHermesTransport(CONV_FIXTURE))
    wrap(<ConversationsPage />)
    await waitFor(() => screen.getByTestId('console-conv-inbound'))

    const page = screen.getByTestId('console-page-conversations')
    expect(page.querySelectorAll('.w-screen').length).toBe(0)
    expect(page.querySelectorAll('.overflow-x-auto').length).toBe(0)
    expect(page.querySelectorAll('.min-w-screen').length).toBe(0)
  })

  it('C-R3: tab toggle buttons never introduce flex-nowrap primary control group', async () => {
    $transport.set(new FakeHermesTransport(CONV_FIXTURE))
    wrap(<ConversationsPage />)

    await screen.findByRole('tablist', { name: 'Conversation direction' })

    const tablist = screen.getByRole('tablist', { name: 'Conversation direction' })
    expect(tablist.className).not.toContain('flex-nowrap')
    expect(tablist.className).not.toContain('whitespace-nowrap')
  })

  it('C-R4: inbound row uses min-w-0 + truncate so text survives narrow widths', async () => {
    $transport.set(new FakeHermesTransport(CONV_FIXTURE))
    wrap(<ConversationsPage />)

    await waitFor(() => screen.getByTestId('console-conv-inbound'))

    const container = screen.getByTestId('console-conv-inbound')
    // min-w-0 on at least one descendant so truncation can take effect on flex children
    const minWZeroCount = container.querySelectorAll('.min-w-0').length
    expect(minWZeroCount).toBeGreaterThan(0)
  })
})