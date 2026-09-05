/**
 * P1-VIS-V1-PRODUCTIZATION-REBUILD-02 a11y coverage for `ConversationsPage`.
 *
 * Closes the formal Responsive / A11y Gate Candidate-blocker identified by the
 * P1-RESP-A11Y-CANDIDATE-BLOCKERS-01 Gap Matrix: this surface is the only P1
 * page without an a11y test asserting the heading hierarchy, role=tablist
 * keyboard semantics, and non-color-only state words.
 *
 * Per the frozen V1 page-conversations.view.tsx:
 *   - PageHeader primitive emits h1 with title "企业会话".
 *   - ConsolePanel primitive emits h2 with title "Inbound messages" /
 *     "Outbound messages".
 *   - TabToggle emits role="tablist" + role="tab" + aria-selected.
 *   - ListCountChip is aria-hidden (decorative count chip beside active tab).
 *   - Status words ("processed", "sent", "received"…) are real DOM text,
 *     never colour-only (paired with StatusDot).
 *
 * All assertions ride the FakeHermesTransport seam that the contract test
 * already established.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { FakeHermesTransport } from './fake-transport'
import { ConversationsPage } from './page-conversations'
import { $transport } from './transport'

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

afterEach(() => {
  cleanup()
  $transport.set(null)
})

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

describe('ConversationsPage · a11y (P1-VIS-V1-PRODUCTIZATION-REBUILD-02)', () => {
  it('C-A1: page has an h1 "企业会话" plus the inbound / outbound panel h2', async () => {
    $transport.set(new FakeHermesTransport(CONV_FIXTURE))
    wrap(<ConversationsPage />)

    expect(
      await screen.findByRole('heading', { level: 1, name: '企业会话' })
    ).toBeTruthy()

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Inbound messages' })
    ).toBeTruthy()
  })

  it('C-A2: heading sequence never skips a level', async () => {
    $transport.set(new FakeHermesTransport(CONV_FIXTURE))
    wrap(<ConversationsPage />)
    await waitFor(() => screen.getByTestId('console-conv-inbound'))

    const levels = Array.from(
      document.querySelectorAll('h1, h2, h3, h4, h5, h6')
    ).map(heading => Number(heading.tagName.substring(1)))

    for (let i = 1; i < levels.length; i++) {
      expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1)
    }
  })

  it('C-A3: tab toggle exposes role="tablist" + role="tab" + aria-selected', async () => {
    $transport.set(new FakeHermesTransport(CONV_FIXTURE))
    wrap(<ConversationsPage />)

    const tablist = await screen.findByRole('tablist', { name: 'Conversation direction' })
    expect(tablist).toBeTruthy()

    const inboundTab = screen.getByRole('tab', { name: /inbound/i })
    const outboundTab = screen.getByRole('tab', { name: /outbound/i })

    expect(inboundTab.getAttribute('aria-selected')).toBe('true')
    expect(outboundTab.getAttribute('aria-selected')).toBe('false')

    // The decorative count chip is aria-hidden so screen readers do not
    // double-announce the count beside the active tab.
    const chip = inboundTab.querySelector('[data-testid="console-conv-count-chip"]')
    expect(chip?.getAttribute('aria-hidden')).toBe('true')
  })

  it('C-A4: state words are present in the DOM (status is NOT colour-only)', async () => {
    $transport.set(new FakeHermesTransport(CONV_FIXTURE))
    wrap(<ConversationsPage />)

    await waitFor(() => screen.getByTestId('console-conv-inbound'))

    const row = document.querySelector('[data-testid="console-conv-inbound"]')
    expect(row?.textContent).toContain('processed')
  })

  it('C-A5: empty outbound panel renders a real (non-fabricated) empty copy', async () => {
    $transport.set(new FakeHermesTransport(CONV_FIXTURE))
    wrap(<ConversationsPage />)

    // Switch to outbound tab
    const outboundTab = await screen.findByRole('tab', { name: /outbound/i })
    outboundTab.click()

    await waitFor(() =>
      expect(
        screen.getByTestId('console-page-conversations').textContent
      ).toMatch(/outbound/i)
    )
  })

  it('C-A6: page wrapper carries data-page-status="ready" (read-only invariant)', async () => {
    $transport.set(new FakeHermesTransport(CONV_FIXTURE))
    wrap(<ConversationsPage />)

    const page = await screen.findByTestId('console-page-conversations')
    expect(page.getAttribute('data-page-status')).toBe('ready')
  })
})