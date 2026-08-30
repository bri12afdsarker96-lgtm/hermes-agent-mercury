/**
 * Reminders page — Direct behavior test (W1-C-REMEDIATION-01 §P11).
 *
 * Same ConfirmAction testid-limitation as Tasks (see
 * page-tasks.behavior.test.tsx for details): the per-row cancel
 * ConfirmAction uses ConfirmDialog which has no testid for its
 * confirm button. So per-row cancel is asserted via:
 *   - The Cancel trigger testid is present only when
 *     canCancelFromState (derived by VM) is true.
 *   - VM tests prove canCancelFromState = state === 'active'.
 *
 * The CREATE flow is provable end-to-end via FormAction (which
 * exposes submit testid). Authoritative refetch + timezone body
 * + idempotency rotation are all exercised through the create
 * submit path.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { HermesApiError } from './fetch-transport'
import { RemindersPage } from './page-reminders'
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

interface ReminderWire {
  generation: number
  reminder_id: string
  scheduled_for: number
  state: string
  subject_id: string
  subject_type: string
  timezone: string
  title: string
}

type RemindersResponse =
  | { available: boolean; reminders: ReminderWire[] }
  | { available: boolean; reminders: undefined }

class RecordingTransport extends BaseHermesTransport {
  readonly requests: string[] = []
  readonly posts: Array<{ route: string; body: unknown }> = []
  private failNextPost: string | null = null
  private failForever: Set<string> = new Set()
  private remindersResponse: RemindersResponse = { available: true, reminders: [] }
  getCount = 0

  constructor(initial: RemindersResponse) {
    super()
    this.remindersResponse = initial
  }

  setRemindersResponse(next: RemindersResponse) {
    this.remindersResponse = next
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

    if (path === '/api/reminders') {
      this.getCount += 1

      return this.remindersResponse as T
    }

    throw new HermesApiError(404, 'error', `unexpected route: ${path}`)
  }

  async upload<T>(): Promise<T> {
    throw new HermesApiError(404, 'error', 'upload not used by reminders')
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
    effective_permissions: ['reminder.write', 'kb.delete'],
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

describe('Reminders direct behavior (W1-C-REM-01 §P11)', () => {
  let transport: RecordingTransport

  beforeEach(() => {
    transport = new RecordingTransport({ available: true, reminders: [] })
    $transport.set(transport)
    $whoami.set(who())
  })

  afterEach(() => {
    $transport.set(null)
    $whoami.set(null)
    cleanup()
  })

  // -----------------------------------------------------------------------
  // §P11 A — server `available` propagation
  // -----------------------------------------------------------------------

  it('available=false + non-empty reminders → empty state (no fabricated row)', async () => {
    transport.setRemindersResponse({
      available: false,
      reminders: [
        {
          generation: 1,
          reminder_id: 'r1',
          scheduled_for: 1_700_000_000,
          state: 'active',
          subject_id: 'biz-1',
          subject_type: 'biz_task',
          timezone: 'UTC',
          title: 'Should not render',
        },
      ],
    })

    wrap(<RemindersPage />)

    await waitFor(() => expect(screen.getByText('no reminders')).toBeTruthy())
    expect(screen.queryByText('Should not render')).toBeNull()
    expect(screen.queryByTestId('console-reminder-row-r1')).toBeNull()
    expect(screen.queryByTestId('console-reminder-cancel-r1')).toBeNull()
  })

  // -----------------------------------------------------------------------
  // §P11 B — state gating: cancel only when state === 'active'
  // VM-derived canCancelFromState is CONSUMED by the rendered page.
  // -----------------------------------------------------------------------

  it('active reminder + reminder.write → cancel present (VM flag consumed)', async () => {
    transport.setRemindersResponse({
      available: true,
      reminders: [
        {
          generation: 1,
          reminder_id: 'r1',
          scheduled_for: 1_700_000_000,
          state: 'active',
          subject_id: 'biz-1',
          subject_type: 'biz_task',
          timezone: 'UTC',
          title: 'Active Reminder',
        },
      ],
    })

    wrap(<RemindersPage />)

    await waitFor(() => expect(screen.getByText('Active Reminder')).toBeTruthy())
    expect(screen.getByTestId('console-reminder-cancel-r1')).toBeTruthy()
  })

  it('cancelled reminder → cancel absent (VM flag consumed)', async () => {
    transport.setRemindersResponse({
      available: true,
      reminders: [
        {
          generation: 1,
          reminder_id: 'r2',
          scheduled_for: 1_700_000_000,
          state: 'cancelled',
          subject_id: 'biz-1',
          subject_type: 'biz_task',
          timezone: 'UTC',
          title: 'Cancelled Reminder',
        },
      ],
    })

    wrap(<RemindersPage />)

    await waitFor(() => expect(screen.getByText('Cancelled Reminder')).toBeTruthy())
    expect(screen.queryByTestId('console-reminder-cancel-r2')).toBeNull()
  })

  it('exhausted reminder → cancel absent (VM flag consumed)', async () => {
    transport.setRemindersResponse({
      available: true,
      reminders: [
        {
          generation: 1,
          reminder_id: 'r3',
          scheduled_for: 1_700_000_000,
          state: 'exhausted',
          subject_id: 'biz-1',
          subject_type: 'biz_task',
          timezone: 'UTC',
          title: 'Exhausted Reminder',
        },
      ],
    })

    wrap(<RemindersPage />)

    await waitFor(() => expect(screen.getByText('Exhausted Reminder')).toBeTruthy())
    expect(screen.queryByTestId('console-reminder-cancel-r3')).toBeNull()
  })

  // -----------------------------------------------------------------------
  // §P11 C — without reminder.write: create absent, cancel absent
  // -----------------------------------------------------------------------

  it('without reminder.write → create absent AND cancel absent', async () => {
    transport.setRemindersResponse({
      available: true,
      reminders: [
        {
          generation: 1,
          reminder_id: 'r1',
          scheduled_for: 1_700_000_000,
          state: 'active',
          subject_id: 'biz-1',
          subject_type: 'biz_task',
          timezone: 'UTC',
          title: 'Active Reminder',
        },
      ],
    })
    setWhoami([])

    wrap(<RemindersPage />)

    await waitFor(() => expect(screen.getByText('Active Reminder')).toBeTruthy())
    expect(screen.queryByTestId('console-reminder-create')).toBeNull()
    expect(screen.queryByTestId('console-reminder-cancel-r1')).toBeNull()
  })

  // -----------------------------------------------------------------------
  // §P11 D — create validation + timezone body + authoritative refetch
  // -----------------------------------------------------------------------

  it('empty subject id → submit disabled (no request fired)', async () => {
    transport.setRemindersResponse({ available: true, reminders: [] })

    wrap(<RemindersPage />)

    await waitFor(() =>
      expect(screen.getByTestId('console-reminder-create')).toBeTruthy(),
    )

    act(() => { fireEvent.click(screen.getByTestId('console-reminder-create')) })
    await waitFor(() =>
      expect(screen.getByTestId('console-reminder-create-submit')).toBeTruthy(),
    )

    // The submit button should be disabled because subjectId is empty
    const submit = screen.getByTestId('console-reminder-create-submit') as HTMLButtonElement
    expect(submit.disabled).toBe(true)

    // No POST should have been fired
    expect(transport.posts.length).toBe(0)
  })

  it('create → POST /api/reminder-create body {scheduled_for, idempotency_key, subject_id, subject_type, timezone, title?} + authoritative GET', async () => {
    transport.setRemindersResponse({ available: true, reminders: [] })

    wrap(<RemindersPage />)

    await waitFor(() =>
      expect(screen.getByTestId('console-reminder-create')).toBeTruthy(),
    )

    act(() => { fireEvent.click(screen.getByTestId('console-reminder-create')) })
    await waitFor(() =>
      expect(screen.getByTestId('console-reminder-subject')).toBeTruthy(),
    )

    fireEvent.change(screen.getByTestId('console-reminder-subject'), {
      target: { value: 'biz-1' },
    })

    // Compute expected epoch from the same string the form will
    // receive on change (matches browser datetime-local semantics).
    const expectedScheduledFor = Math.floor(new Date('2024-06-15T14:30').getTime() / 1000)

    fireEvent.change(screen.getByTestId('console-reminder-when'), {
      target: { value: '2024-06-15T14:30' },
    })

    const getCountBefore = transport.getCount
    await waitFor(() =>
      expect(screen.getByTestId('console-reminder-create-submit')).toBeTruthy(),
    )
    fireEvent.click(screen.getByTestId('console-reminder-create-submit'))

    await waitFor(() =>
      expect(transport.posts.some((p) => p.route === '/api/reminder-create')).toBe(true),
    )
    const post = transport.posts.find((p) => p.route === '/api/reminder-create')
    const body = post?.body as Record<string, unknown>
    expect(body.scheduled_for).toBe(expectedScheduledFor)
    expect(typeof body.scheduled_for).toBe('number')
    expect(typeof body.idempotency_key).toBe('string')
    expect((body.idempotency_key as string).length).toBeGreaterThan(0)
    expect(body.subject_id).toBe('biz-1')
    expect(body.subject_type).toBe('biz_task')
    expect(typeof body.timezone).toBe('string')
    expect((body.timezone as string).length).toBeGreaterThan(0)
    // title is undefined (not entered)
    expect(body.title).toBeUndefined()
    // Authoritative refetch
    expect(transport.getCount).toBeGreaterThan(getCountBefore)
  })

  // -----------------------------------------------------------------------
  // §P11 E — temporal idempotency
  // -----------------------------------------------------------------------

  it('idempotency: failed create keeps same key, success rotates to new key', async () => {
    transport.setRemindersResponse({ available: true, reminders: [] })
    setWhoami(['reminder.write', 'kb.delete'])

    transport.failPostOnce('/api/reminder-create')

    wrap(<RemindersPage />)

    await waitFor(() =>
      expect(screen.getByTestId('console-reminder-create')).toBeTruthy(),
    )
    act(() => { fireEvent.click(screen.getByTestId('console-reminder-create')) })
    await waitFor(() =>
      expect(screen.getByTestId('console-reminder-subject')).toBeTruthy(),
    )
    fireEvent.change(screen.getByTestId('console-reminder-subject'), {
      target: { value: 'biz-1' },
    })
    fireEvent.change(screen.getByTestId('console-reminder-when'), {
      target: { value: '2024-06-15T14:30' },
    })
    await waitFor(() =>
      expect(screen.getByTestId('console-reminder-create-submit')).toBeTruthy(),
    )
    fireEvent.click(screen.getByTestId('console-reminder-create-submit'))

    await waitFor(() =>
      expect(transport.posts.some((p) => p.route === '/api/reminder-create')).toBe(true),
    )
    const firstPost = transport.posts.find((p) => p.route === '/api/reminder-create')
    const firstKey = (firstPost?.body as { idempotency_key?: string })?.idempotency_key
    expect(firstKey).toBeTruthy()

    // Second create (same form instance): same key after failure
    act(() => { fireEvent.click(screen.getByTestId('console-reminder-create')) })
    await waitFor(() =>
      expect(screen.getByTestId('console-reminder-create-submit')).toBeTruthy(),
    )
    fireEvent.click(screen.getByTestId('console-reminder-create-submit'))
    await waitFor(
      () => expect(transport.posts.filter((p) => p.route === '/api/reminder-create').length).toBe(2),
    )
    const secondPost = transport.posts.filter((p) => p.route === '/api/reminder-create')[1]
    const secondKey = (secondPost?.body as { idempotency_key?: string })?.idempotency_key
    expect(secondKey).toBe(firstKey)

    // Third create (after success): new key K2
    act(() => { fireEvent.click(screen.getByTestId('console-reminder-create')) })
    await waitFor(() =>
      expect(screen.getByTestId('console-reminder-create-submit')).toBeTruthy(),
    )
    fireEvent.click(screen.getByTestId('console-reminder-create-submit'))
    await waitFor(
      () => expect(transport.posts.filter((p) => p.route === '/api/reminder-create').length).toBe(3),
    )
    const thirdPost = transport.posts.filter((p) => p.route === '/api/reminder-create')[2]
    const thirdKey = (thirdPost?.body as { idempotency_key?: string })?.idempotency_key
    expect(thirdKey).toBeTruthy()
    expect(thirdKey).not.toBe(firstKey)
  })

  it('failed create → no optimistic reminder row in DOM', async () => {
    transport.setRemindersResponse({ available: true, reminders: [] })
    transport.failPostOnce('/api/reminder-create')
    setWhoami(['reminder.write', 'kb.delete'])

    wrap(<RemindersPage />)

    await waitFor(() =>
      expect(screen.getByTestId('console-reminder-create')).toBeTruthy(),
    )
    act(() => { fireEvent.click(screen.getByTestId('console-reminder-create')) })
    await waitFor(() =>
      expect(screen.getByTestId('console-reminder-subject')).toBeTruthy(),
    )
    fireEvent.change(screen.getByTestId('console-reminder-subject'), {
      target: { value: 'biz-1' },
    })
    fireEvent.change(screen.getByTestId('console-reminder-when'), {
      target: { value: '2024-06-15T14:30' },
    })
    await waitFor(() =>
      expect(screen.getByTestId('console-reminder-create-submit')).toBeTruthy(),
    )
    fireEvent.click(screen.getByTestId('console-reminder-create-submit'))

    await waitFor(() =>
      expect(transport.posts.some((p) => p.route === '/api/reminder-create')).toBe(true),
    )

    // No fabricated reminder row
    expect(screen.queryByText('Untitled reminder')).toBeNull()
  })
})


// ============================================================================
// CONTINUATION-03 LEVEL 7: ConfirmAction rendered mutation click-through.
// Strategy: click the cancel trigger → screen.getByRole('dialog') →
// fireEvent.keyDown(Enter). The dialog's onKeyDown handler invokes
// the real ConfirmDialog.run() → real onConfirm → real controller
// mutation → real invalidate → real authoritative GET.
// ============================================================================

describe('Reminders ConfirmAction click-through (CONTINUATION-03 §LEVEL 7)', () => {
  let transport: RecordingTransport

  beforeEach(() => {
    transport = new RecordingTransport({ available: true, reminders: [] })
    $transport.set(transport)
    $whoami.set(who())
  })

  afterEach(() => {
    $transport.set(null)
    $whoami.set(null)
    cleanup()
  })


/**
 * Helper: open a ConfirmAction dialog for a given row trigger testid
 * and dispatch Enter to confirm. Returns the dialog element.
 */
async function openAndConfirm(rowTriggerTestId: string) {
  fireEvent.click(screen.getByTestId(rowTriggerTestId))
  const dialog = await screen.findByRole('dialog')
  fireEvent.keyDown(dialog, { key: 'Enter', code: 'Enter' })

  return dialog
}

// C1 · Cancel success
it('ConfirmAction cancel: trigger → ConfirmDialog Enter → POST /api/reminder-cancel {reminder_id} + authoritative GET', async () => {
  transport.setRemindersResponse({
    available: true,
    reminders: [
      {
        generation: 1,
        reminder_id: 'r1',
        scheduled_for: 1_700_000_000,
        state: 'active',
        subject_id: 'biz-1',
        subject_type: 'biz_task',
        timezone: 'UTC',
        title: 'Active Reminder',
      },
    ],
  })

  wrap(<RemindersPage />)

  await waitFor(() => expect(screen.getByText('Active Reminder')).toBeTruthy())
  const getCountBefore = transport.getCount

  await openAndConfirm('console-reminder-cancel-r1')

  await waitFor(() =>
    expect(transport.posts.some((p) => p.route === '/api/reminder-cancel')).toBe(true),
  )
  const cancelPost = transport.posts.find((p) => p.route === '/api/reminder-cancel')
  expect(cancelPost?.body).toEqual({ reminder_id: 'r1' })
  // Authoritative refetch: REMINDERS_KEY invalidate → at least one more GET
  expect(transport.getCount).toBeGreaterThan(getCountBefore)
})

// C2 · Cancel failure
it('ConfirmAction cancel failure: server rejects → no optimistic cancelled state, no success refetch', async () => {
  transport.setRemindersResponse({
    available: true,
    reminders: [
      {
        generation: 1,
        reminder_id: 'r1',
        scheduled_for: 1_700_000_000,
        state: 'active',
        subject_id: 'biz-1',
        subject_type: 'biz_task',
        timezone: 'UTC',
        title: 'Active Reminder',
      },
    ],
  })
  setWhoami(['reminder.write', 'kb.delete'])
  transport.failPostForever('/api/reminder-cancel')

  wrap(<RemindersPage />)

  await waitFor(() => expect(screen.getByText('Active Reminder')).toBeTruthy())
  const getCountBefore = transport.getCount

  await openAndConfirm('console-reminder-cancel-r1')

  await waitFor(() =>
    expect(transport.posts.some((p) => p.route === '/api/reminder-cancel')).toBe(true),
  )
  // Failure path: NO additional GET
  expect(transport.getCount).toBe(getCountBefore)
  // The reminder row still shows 'active' (no client-side state fabrication)
  expect(screen.getByText('active')).toBeTruthy()
  // Cancel trigger remains available
  expect(screen.getByTestId('console-reminder-cancel-r1')).toBeTruthy()
})
})
