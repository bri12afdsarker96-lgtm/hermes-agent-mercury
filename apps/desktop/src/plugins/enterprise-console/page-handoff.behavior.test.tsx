/**
 * Handoff page — Direct behavior test (W1-C-REMEDIATION-01 §P12 +
 * CONTINUATION-03 §LEVEL 3 / LEVEL 8).
 *
 * ConfirmAction click-through strategy: claim / requeue are exercised
 * through the rendered page by clicking the row action trigger,
 * locating the rendered dialog via role=dialog, dispatching Enter on
 * that dialog, and then asserting the real POST plus authoritative
 * refetch / failure-no-refetch behavior.
 *
 * Reply is exercised end-to-end through the existing FormAction
 * text + submit path.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { HermesApiError } from './fetch-transport'
import { HandoffPage } from './page-handoff'
import { $whoami } from './session'
import {
  $transport,
  BaseHermesTransport,
  type TransportRequest,
} from './transport'
import type { Whoami } from './types'

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
  Element.prototype.hasPointerCapture = vi.fn(() => false)
  Element.prototype.releasePointerCapture = vi.fn()
})

// ---------------------------------------------------------------------------
// Recording transport
// ---------------------------------------------------------------------------

interface HandoffWire {
  agent_id: null | string
  claim_age_s: null | number
  expires_in_s: null | number
  msg_id: string
  state: string
  status: null | string
  text: string
  thread_id: string
}

type HandoffsResponse =
  | { available: boolean; handoffs: HandoffWire[] }
  | { available: boolean; handoffs: undefined }

class RecordingTransport extends BaseHermesTransport {
  readonly requests: string[] = []
  readonly posts: Array<{ route: string; body: unknown }> = []
  private failNextPost: string | null = null
  private failForever: Set<string> = new Set()
  private handoffsResponse: HandoffsResponse = { available: true, handoffs: [] }
  getCount = 0

  constructor(initial: HandoffsResponse) {
    super()
    this.handoffsResponse = initial
  }

  setHandoffsResponse(next: HandoffsResponse) {
    this.handoffsResponse = next
  }

  failPostOnce(route: string) {
    this.failNextPost = route
  }

  failPostForever(route: string) {
    this.failForever.add(route)
  }

  async request<T>(path: string, opts?: TransportRequest): Promise<T> {
    this.requests.push(path)
    const method = opts?.method ?? 'GET'

    if (method === 'POST') {
      this.posts.push({ route: path, body: opts?.body })

      if (this.failNextPost && this.failNextPost === path) {
        this.failNextPost = null
        throw new HermesApiError(500, 'error', 'forced server failure')
      }

      if (this.failForever.has(path)) {
        throw new HermesApiError(500, 'error', 'forced permanent failure')
      }

      return { ok: true } as unknown as T
    }

    if (path === '/api/handoffs') {
      this.getCount += 1

      return this.handoffsResponse as T
    }

    throw new HermesApiError(404, 'error', `unexpected route: ${path}`)
  }

  async upload<T>(): Promise<T> {
    throw new HermesApiError(404, 'error', 'upload not used by handoffs')
  }
}

// ---------------------------------------------------------------------------
// Setup helpers
// ---------------------------------------------------------------------------

function wrap(node: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })

  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

function who(partial: Partial<Whoami> = {}): Whoami {
  return {
    capability_revision: 0,
    data_scope: { mode: 'legacy_tenant_scope', scopes: [] },
    effective_permissions: ['inbox.claim', 'inbox.reply', 'inbox.requeue'],
    name: 'alice',
    principal_id: 'p1',
    product_capabilities: {},
    role: 'tenant_admin',
    tenant_id: 't1',
    ...partial,
  }
}

function setWhoami(perms: string[]) {
  $whoami.set(who({ effective_permissions: perms }))
}

// ---------------------------------------------------------------------------
// Test sequence
// ---------------------------------------------------------------------------

describe('Handoff direct behavior (W1-C-REM-01 §P12)', () => {
  let transport: RecordingTransport

  beforeEach(() => {
    transport = new RecordingTransport({ available: true, handoffs: [] })
    $transport.set(transport)
    $whoami.set(who())
  })

  afterEach(() => {
    $transport.set(null)
    $whoami.set(null)
    cleanup()
  })

  // -----------------------------------------------------------------------
  // §P12 A — server `available` propagation
  // -----------------------------------------------------------------------

  it('available=false + non-empty handoffs → empty state (no fabricated row)', async () => {
    transport.setHandoffsResponse({
      available: false,
      handoffs: [
        {
          agent_id: null,
          claim_age_s: null,
          expires_in_s: null,
          msg_id: 'm1',
          state: 'parked',
          status: null,
          text: 'Should not render',
          thread_id: 't1',
        },
      ],
    })

    wrap(<HandoffPage />)

    await waitFor(() => expect(screen.getByText('no handoffs')).toBeTruthy())
    expect(screen.queryByText('Should not render')).toBeNull()
    expect(screen.queryByTestId('console-handoff-row-m1')).toBeNull()
    expect(screen.queryByTestId('console-handoff-claim-m1')).toBeNull()
    expect(screen.queryByTestId('console-handoff-reply-m1')).toBeNull()
    expect(screen.queryByTestId('console-handoff-requeue-m1')).toBeNull()
  })

  // -----------------------------------------------------------------------
  // §P12 B — independent row gating (VM flags consumed)
  // -----------------------------------------------------------------------

  it('unclaimed (agent_id=null) + inbox.claim → claim present', async () => {
    transport.setHandoffsResponse({
      available: true,
      handoffs: [
        {
          agent_id: null,
          claim_age_s: null,
          expires_in_s: null,
          msg_id: 'm1',
          state: 'parked',
          status: null,
          text: 'Unclaimed Handoff',
          thread_id: 't1',
        },
      ],
    })

    wrap(<HandoffPage />)

    await waitFor(() => expect(screen.getByText('Unclaimed Handoff')).toBeTruthy())
    expect(screen.getByTestId('console-handoff-claim-m1')).toBeTruthy()
  })

  it('claimed (agent_id non-null) → claim absent', async () => {
    transport.setHandoffsResponse({
      available: true,
      handoffs: [
        {
          agent_id: 'agent-1',
          claim_age_s: 5,
          expires_in_s: 300,
          msg_id: 'm1',
          state: 'open',
          status: 'claimed',
          text: 'Claimed Handoff',
          thread_id: 't1',
        },
      ],
    })

    wrap(<HandoffPage />)

    await waitFor(() => expect(screen.getByText('Claimed Handoff')).toBeTruthy())
    expect(screen.queryByTestId('console-handoff-claim-m1')).toBeNull()
  })

  it('status=claimed → reply present (FormAction)', async () => {
    transport.setHandoffsResponse({
      available: true,
      handoffs: [
        {
          agent_id: 'agent-1',
          claim_age_s: 5,
          expires_in_s: 300,
          msg_id: 'm1',
          state: 'open',
          status: 'claimed',
          text: 'Claimed Handoff',
          thread_id: 't1',
        },
      ],
    })

    wrap(<HandoffPage />)

    await waitFor(() => expect(screen.getByText('Claimed Handoff')).toBeTruthy())
    expect(screen.getByTestId('console-handoff-reply-m1')).toBeTruthy()
  })

  it('status != claimed → reply absent', async () => {
    transport.setHandoffsResponse({
      available: true,
      handoffs: [
        {
          agent_id: null,
          claim_age_s: null,
          expires_in_s: null,
          msg_id: 'm1',
          state: 'parked',
          status: null,
          text: 'Unclaimed Handoff',
          thread_id: 't1',
        },
      ],
    })

    wrap(<HandoffPage />)

    await waitFor(() => expect(screen.getByText('Unclaimed Handoff')).toBeTruthy())
    expect(screen.queryByTestId('console-handoff-reply-m1')).toBeNull()
  })

  it('state=parked → requeue present', async () => {
    transport.setHandoffsResponse({
      available: true,
      handoffs: [
        {
          agent_id: 'agent-1',
          claim_age_s: 30,
          expires_in_s: 300,
          msg_id: 'm1',
          state: 'parked',
          status: 'claimed',
          text: 'Parked Handoff',
          thread_id: 't1',
        },
      ],
    })

    wrap(<HandoffPage />)

    await waitFor(() => expect(screen.getByText('Parked Handoff')).toBeTruthy())
    expect(screen.getByTestId('console-handoff-requeue-m1')).toBeTruthy()
  })

  it('state != parked → requeue absent', async () => {
    transport.setHandoffsResponse({
      available: true,
      handoffs: [
        {
          agent_id: 'agent-1',
          claim_age_s: 5,
          expires_in_s: 300,
          msg_id: 'm1',
          state: 'open',
          status: 'claimed',
          text: 'Open Handoff',
          thread_id: 't1',
        },
      ],
    })

    wrap(<HandoffPage />)

    await waitFor(() => expect(screen.getByText('Open Handoff')).toBeTruthy())
    expect(screen.queryByTestId('console-handoff-requeue-m1')).toBeNull()
  })

  // -----------------------------------------------------------------------
  // §P12 C — permission gating: absent permission → control absent
  // -----------------------------------------------------------------------

  it('without inbox.claim → claim absent (even if row eligible)', async () => {
    transport.setHandoffsResponse({
      available: true,
      handoffs: [
        {
          agent_id: null,
          claim_age_s: null,
          expires_in_s: null,
          msg_id: 'm1',
          state: 'parked',
          status: null,
          text: 'Unclaimed Handoff',
          thread_id: 't1',
        },
      ],
    })
    setWhoami([])

    wrap(<HandoffPage />)

    await waitFor(() => expect(screen.getByText('Unclaimed Handoff')).toBeTruthy())
    expect(screen.queryByTestId('console-handoff-claim-m1')).toBeNull()
  })

  it('without inbox.reply → reply absent (even if status=claimed)', async () => {
    transport.setHandoffsResponse({
      available: true,
      handoffs: [
        {
          agent_id: 'agent-1',
          claim_age_s: 5,
          expires_in_s: 300,
          msg_id: 'm1',
          state: 'open',
          status: 'claimed',
          text: 'Claimed Handoff',
          thread_id: 't1',
        },
      ],
    })
    setWhoami(['inbox.claim', 'inbox.requeue'])

    wrap(<HandoffPage />)

    await waitFor(() => expect(screen.getByText('Claimed Handoff')).toBeTruthy())
    expect(screen.queryByTestId('console-handoff-reply-m1')).toBeNull()
  })

  it('without inbox.requeue → requeue absent (even if state=parked)', async () => {
    transport.setHandoffsResponse({
      available: true,
      handoffs: [
        {
          agent_id: 'agent-1',
          claim_age_s: 30,
          expires_in_s: 300,
          msg_id: 'm1',
          state: 'parked',
          status: 'claimed',
          text: 'Parked Handoff',
          thread_id: 't1',
        },
      ],
    })
    setWhoami(['inbox.claim', 'inbox.reply'])

    wrap(<HandoffPage />)

    await waitFor(() => expect(screen.getByText('Parked Handoff')).toBeTruthy())
    expect(screen.queryByTestId('console-handoff-requeue-m1')).toBeNull()
  })

  // -----------------------------------------------------------------------
  // §P12 D — reply FormAction: exact POST body + authoritative refetch
  // -----------------------------------------------------------------------

  it('reply click → POST /api/handoff-reply {msg_id, text} + authoritative GET', async () => {
    transport.setHandoffsResponse({
      available: true,
      handoffs: [
        {
          agent_id: 'agent-1',
          claim_age_s: 5,
          expires_in_s: 300,
          msg_id: 'm1',
          state: 'open',
          status: 'claimed',
          text: 'Claimed Handoff',
          thread_id: 't1',
        },
      ],
    })
    setWhoami(['inbox.reply'])

    wrap(<HandoffPage />)

    await waitFor(() => expect(screen.getByText('Claimed Handoff')).toBeTruthy())

    act(() => { fireEvent.click(screen.getByTestId('console-handoff-reply-m1')) })
    await waitFor(() =>
      expect(screen.getByTestId('console-handoff-reply-text-m1')).toBeTruthy(),
    )
    fireEvent.change(screen.getByTestId('console-handoff-reply-text-m1'), {
      target: { value: 'on it' },
    })

    const getCountBefore = transport.getCount
    await waitFor(() =>
      expect(screen.getByTestId('console-handoff-reply-m1-submit')).toBeTruthy(),
    )
    fireEvent.click(screen.getByTestId('console-handoff-reply-m1-submit'))

    await waitFor(() =>
      expect(transport.posts.some((p) => p.route === '/api/handoff-reply')).toBe(true),
    )
    const replyPost = transport.posts.find((p) => p.route === '/api/handoff-reply')
    expect(replyPost?.body).toEqual({ msg_id: 'm1', text: 'on it' })
    // Authoritative refetch
    expect(transport.getCount).toBeGreaterThan(getCountBefore)
  })

  it('empty reply text → submit disabled (no request fired)', async () => {
    transport.setHandoffsResponse({
      available: true,
      handoffs: [
        {
          agent_id: 'agent-1',
          claim_age_s: 5,
          expires_in_s: 300,
          msg_id: 'm1',
          state: 'open',
          status: 'claimed',
          text: 'Claimed Handoff',
          thread_id: 't1',
        },
      ],
    })
    setWhoami(['inbox.reply'])

    wrap(<HandoffPage />)

    await waitFor(() => expect(screen.getByText('Claimed Handoff')).toBeTruthy())
    act(() => { fireEvent.click(screen.getByTestId('console-handoff-reply-m1')) })
    await waitFor(() =>
      expect(screen.getByTestId('console-handoff-reply-m1-submit')).toBeTruthy(),
    )

    const submit = screen.getByTestId('console-handoff-reply-m1-submit') as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    expect(transport.posts.length).toBe(0)
  })

  // -----------------------------------------------------------------------
  // §P12 E — failed mutation: no optimistic ownership/status/state change
  // -----------------------------------------------------------------------

  it('failed reply → no optimistic owner/status/state mutation in DOM', async () => {
    transport.setHandoffsResponse({
      available: true,
      handoffs: [
        {
          agent_id: 'agent-1',
          claim_age_s: 5,
          expires_in_s: 300,
          msg_id: 'm1',
          state: 'open',
          status: 'claimed',
          text: 'Claimed Handoff',
          thread_id: 't1',
        },
      ],
    })
    transport.failPostOnce('/api/handoff-reply')
    setWhoami(['inbox.reply'])

    wrap(<HandoffPage />)

    await waitFor(() => expect(screen.getByText('Claimed Handoff')).toBeTruthy())
    act(() => { fireEvent.click(screen.getByTestId('console-handoff-reply-m1')) })
    await waitFor(() =>
      expect(screen.getByTestId('console-handoff-reply-text-m1')).toBeTruthy(),
    )
    fireEvent.change(screen.getByTestId('console-handoff-reply-text-m1'), {
      target: { value: 'try' },
    })
    const getCountBefore = transport.getCount
    await waitFor(() =>
      expect(screen.getByTestId('console-handoff-reply-m1-submit')).toBeTruthy(),
    )
    fireEvent.click(screen.getByTestId('console-handoff-reply-m1-submit'))

    await waitFor(() =>
      expect(transport.posts.some((p) => p.route === '/api/handoff-reply')).toBe(true),
    )

    // The handoff still shows the server's original agent_id and status.
    // Use getAllByText + a function matcher to find the row container.
    const matches = screen.getAllByText(
      (content, element) => {
        if (!element) {return false}

        return element.tagName === 'DIV' &&
          (element.textContent ?? '').includes('agent-1') &&
          (element.textContent ?? '').includes('claimed')
      }
    )

    expect(matches.length).toBeGreaterThan(0)
    // No additional refetch on failure
    expect(transport.getCount).toBe(getCountBefore)
  })

  // -----------------------------------------------------------------------
  // §P12 F — 501 not_implemented: honest module unavailable state
  // (existing shared test in pages.test.tsx covers this; we add a
  // behavior test that proves our glue does NOT fabricate a row.)
  // -----------------------------------------------------------------------

  it('not_implemented 501 response → no fabricated row', async () => {
    class UnavailableTransport extends BaseHermesTransport {
      async request<T>(): Promise<T> {
        throw new HermesApiError(501, 'not_implemented', 'module unavailable')
      }
      async upload<T>(): Promise<T> {
        throw new HermesApiError(404, 'error', 'upload not used')
      }
    }
    $transport.set(new UnavailableTransport())

    wrap(<HandoffPage />)

    // The 501 response must NOT fabricate a row. Either the
    // QueryBody shows the unavailable state OR the empty state.
    // In neither case should any console-handoffs (rows) appear.
    await waitFor(() => {
      // No row was ever rendered
      expect(screen.queryByTestId('console-handoffs')).toBeNull()
    })
    // Also no per-row testids (no leaked synthetic data)
    expect(screen.queryByTestId('console-handoff-row-m1')).toBeNull()
    expect(screen.queryByTestId('console-handoff-claim-m1')).toBeNull()
  })
})


// ============================================================================
// CONTINUATION-03 LEVEL 8: ConfirmAction rendered mutation click-through.
// Strategy: click the trigger → screen.getByRole('dialog') →
// fireEvent.keyDown(Enter). The dialog's onKeyDown handler invokes
// the real ConfirmDialog.run() → real onConfirm → real controller
// mutation → real invalidate → real authoritative GET.
// ============================================================================

describe('Handoff ConfirmAction click-through (CONTINUATION-03 §LEVEL 8)', () => {
  let transport: RecordingTransport

  beforeEach(() => {
    transport = new RecordingTransport({ available: true, handoffs: [] })
    $transport.set(transport)
    $whoami.set(who())
  })

  afterEach(() => {
    $transport.set(null)
    $whoami.set(null)
    cleanup()
  })

  /**
   * Helper: open a ConfirmAction dialog and dispatch Enter.
   */
  async function openAndConfirm(rowTriggerTestId: string) {
    fireEvent.click(screen.getByTestId(rowTriggerTestId))
    const dialog = await screen.findByRole('dialog')
    fireEvent.keyDown(dialog, { key: 'Enter', code: 'Enter' })

    return dialog
  }

  // D1 · Claim success
  it('ConfirmAction claim: trigger → Enter → POST /api/handoff-claim {msg_id} (perm inbox.claim) + authoritative GET', async () => {
    transport.setHandoffsResponse({
      available: true,
      handoffs: [
        {
          agent_id: null,
          claim_age_s: null,
          expires_in_s: null,
          msg_id: 'm1',
          state: 'parked',
          status: null,
          text: 'Unclaimed Handoff',
          thread_id: 't1',
        },
      ],
    })

    wrap(<HandoffPage />)

    await waitFor(() => expect(screen.getByText('Unclaimed Handoff')).toBeTruthy())
    const getCountBefore = transport.getCount

    await openAndConfirm('console-handoff-claim-m1')

    await waitFor(() =>
      expect(transport.posts.some((p) => p.route === '/api/handoff-claim')).toBe(true),
    )
    const claimPost = transport.posts.find((p) => p.route === '/api/handoff-claim')
    expect(claimPost?.body).toEqual({ msg_id: 'm1' })
    // Authoritative refetch
    expect(transport.getCount).toBeGreaterThan(getCountBefore)
  })

  // D2 · Requeue success
  it('ConfirmAction requeue: trigger → Enter → POST /api/handoff-requeue {msg_id} (perm inbox.requeue) + authoritative GET', async () => {
    transport.setHandoffsResponse({
      available: true,
      handoffs: [
        {
          agent_id: 'agent-1',
          claim_age_s: 30,
          expires_in_s: 300,
          msg_id: 'm1',
          state: 'parked',
          status: 'claimed',
          text: 'Parked Handoff',
          thread_id: 't1',
        },
      ],
    })

    wrap(<HandoffPage />)

    await waitFor(() => expect(screen.getByText('Parked Handoff')).toBeTruthy())
    const getCountBefore = transport.getCount

    await openAndConfirm('console-handoff-requeue-m1')

    await waitFor(() =>
      expect(transport.posts.some((p) => p.route === '/api/handoff-requeue')).toBe(true),
    )
    const post = transport.posts.find((p) => p.route === '/api/handoff-requeue')
    expect(post?.body).toEqual({ msg_id: 'm1' })
    expect(transport.getCount).toBeGreaterThan(getCountBefore)
  })

  // D3 · ConfirmAction failure (use Claim as the rendered path)
  it('ConfirmAction claim failure: server rejects → no owner/status/state fabrication, no success refetch', async () => {
    transport.setHandoffsResponse({
      available: true,
      handoffs: [
        {
          agent_id: null,
          claim_age_s: null,
          expires_in_s: null,
          msg_id: 'm1',
          state: 'parked',
          status: null,
          text: 'Unclaimed Handoff',
          thread_id: 't1',
        },
      ],
    })
    transport.failPostForever('/api/handoff-claim')

    wrap(<HandoffPage />)

    await waitFor(() => expect(screen.getByText('Unclaimed Handoff')).toBeTruthy())
    const getCountBefore = transport.getCount

    await openAndConfirm('console-handoff-claim-m1')

    await waitFor(() =>
      expect(transport.posts.some((p) => p.route === '/api/handoff-claim')).toBe(true),
    )
    // Failure: NO additional GET
    expect(transport.getCount).toBe(getCountBefore)
    // Row still renders with original server state (no client ownership fabrication)
    expect(screen.getByText('Unclaimed Handoff')).toBeTruthy()

    // agent_id still null (no client ownership inference)
    const matches = screen.getAllByText(
      (content, element) => {
        if (!element) {return false}

        return element.tagName === 'DIV' && (element.textContent ?? '').includes('unclaimed')
      },
    )

    expect(matches.length).toBeGreaterThan(0)
    // claim trigger still available (no client state mutation)
    expect(screen.getByTestId('console-handoff-claim-m1')).toBeTruthy()
  })
})
