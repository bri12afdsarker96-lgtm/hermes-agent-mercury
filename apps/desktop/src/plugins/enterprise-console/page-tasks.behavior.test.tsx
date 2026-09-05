/**
 * Tasks page — Direct behavior test (W1-C-REMEDIATION-01 §P10 +
 * CONTINUATION-03 §LEVEL 3 / LEVEL 6).
 *
 * Executes the REAL page path against a recording transport.
 *
 * ConfirmAction click-through strategy (per CONTINUATION-03 LEVEL 3):
 * The `ConfirmDialog` rendered by `ConfirmAction` exposes an
 * `onKeyDown` handler on `DialogContent` that listens for
 * Enter / Space and triggers the real `run()` flow (which calls
 * the real controller mutation + real `invalidateQueries`). We
 * dispatch Enter on the dialog (`screen.getByRole('dialog')`) to
 * drive the rendered mutation end-to-end — without mocking the
 * primitive, without calling controller mutations directly, and
 * without adding any testid.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { HermesApiError } from './fetch-transport'
import { TasksPage } from './page-tasks'
import { $whoami } from './session'
import {
  $transport,
  BaseHermesTransport,
  type TransportRequest,
} from './transport'
import type { Whoami } from './types'

// ---------------------------------------------------------------------------
// jsdom polyfills (required for Dialog / Button rendering in jsdom)
// ---------------------------------------------------------------------------

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
  Element.prototype.hasPointerCapture = vi.fn(() => false)
  Element.prototype.releasePointerCapture = vi.fn()
})

// ---------------------------------------------------------------------------
// Recording transport
// ---------------------------------------------------------------------------

interface BizTaskWire {
  attempts: number
  carrier: string
  max_retries: number
  state: string
  task_id: string
  title: string
  ts_updated: number
}

type TasksResponse =
  | { available: boolean; tasks: BizTaskWire[] }
  | { available: boolean; tasks: undefined }

class RecordingTransport extends BaseHermesTransport {
  readonly requests: string[] = []
  readonly posts: Array<{ route: string; body: unknown }> = []
  private failNextPost: string | null = null
  private failForever: Set<string> = new Set()
  private tasksResponse: TasksResponse = { available: true, tasks: [] }
  getCount = 0

  constructor(initial: TasksResponse) {
    super()
    this.tasksResponse = initial
  }

  setTasksResponse(next: TasksResponse) {
    this.tasksResponse = next
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

    if (path === '/api/biz-tasks') {
      this.getCount += 1

      return this.tasksResponse as T
    }

    throw new HermesApiError(404, 'error', `unexpected route: ${path}`)
  }

  async upload<T>(): Promise<T> {
    throw new HermesApiError(404, 'error', 'upload not used by tasks')
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
    effective_permissions: ['biztask.write', 'biztask.escalate', 'kb.delete'],
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

describe('Tasks direct behavior (W1-C-REM-01 §P10)', () => {
  let transport: RecordingTransport

  beforeEach(() => {
    transport = new RecordingTransport({ available: true, tasks: [] })
    $transport.set(transport)
    $whoami.set(who())
  })

  afterEach(() => {
    $transport.set(null)
    $whoami.set(null)
    cleanup()
  })

  // -----------------------------------------------------------------------
  // §P10 A — server `available` propagation (no fabrication)
  // -----------------------------------------------------------------------

  it('available=false + non-empty tasks → empty state (no fabricated row)', async () => {
    transport.setTasksResponse({
      available: false,
      tasks: [
        {
          attempts: 1,
          carrier: 'device',
          max_retries: 3,
          state: 'running',
          task_id: 't1',
          title: 'Should not render',
          ts_updated: 1_700_000_000,
        },
      ],
    })

    wrap(<TasksPage />)

    await waitFor(() => expect(screen.getByText('no tasks')).toBeTruthy())
    expect(screen.queryByText('Should not render')).toBeNull()
    expect(screen.queryByTestId('console-task-row-t1')).toBeNull()
    // No mutation controls leaked through
    expect(screen.queryByTestId('console-task-retry-t1')).toBeNull()
    expect(screen.queryByTestId('console-task-escalate-t1')).toBeNull()
    expect(screen.queryByTestId('console-task-close-t1')).toBeNull()
  })

  it('available=true + non-empty tasks → row visible with action controls', async () => {
    transport.setTasksResponse({
      available: true,
      tasks: [
        {
          attempts: 1,
          carrier: 'device',
          max_retries: 3,
          state: 'running',
          task_id: 't1',
          title: 'Task One',
          ts_updated: 1_690_000_000,
        },
      ],
    })

    wrap(<TasksPage />)

    await waitFor(() => expect(screen.getByText('Task One')).toBeTruthy())
    expect(screen.getByTestId('console-task-retry-t1')).toBeTruthy()
    expect(screen.getByTestId('console-task-close-t1')).toBeTruthy()
  })

  // -----------------------------------------------------------------------
  // §P10 B — closed + all permissions → 0 mutation controls
  // VM-derived canRetry/canEscalate/canClose are CONSUMED here.
  // -----------------------------------------------------------------------

  it('closed task + all permissions → retry/escalate/close ABSENT (VM flag consumed)', async () => {
    transport.setTasksResponse({
      available: true,
      tasks: [
        {
          attempts: 3,
          carrier: 'device',
          max_retries: 3,
          state: 'closed',
          task_id: 't1',
          title: 'Closed Task',
          ts_updated: 1_700_000_000,
        },
      ],
    })
    setWhoami(['biztask.write', 'biztask.escalate', 'kb.delete'])

    wrap(<TasksPage />)

    await waitFor(() => expect(screen.getByText('Closed Task')).toBeTruthy())
    expect(screen.getByText('closed')).toBeTruthy()
    expect(screen.queryByTestId('console-task-retry-t1')).toBeNull()
    expect(screen.queryByTestId('console-task-escalate-t1')).toBeNull()
    expect(screen.queryByTestId('console-task-close-t1')).toBeNull()
  })

  // -----------------------------------------------------------------------
  // §P10 C — permission matrix (eligibility × permission)
  // -----------------------------------------------------------------------

  it('biztask.write only → retry + close present, escalate absent', async () => {
    transport.setTasksResponse({
      available: true,
      tasks: [
        {
          attempts: 1,
          carrier: 'device',
          max_retries: 3,
          state: 'running',
          task_id: 't1',
          title: 'Task W',
          ts_updated: 1_700_000_000,
        },
      ],
    })
    setWhoami(['biztask.write', 'kb.delete'])

    wrap(<TasksPage />)

    await waitFor(() => expect(screen.getByText('Task W')).toBeTruthy())
    expect(screen.getByTestId('console-task-retry-t1')).toBeTruthy()
    expect(screen.getByTestId('console-task-close-t1')).toBeTruthy()
    expect(screen.queryByTestId('console-task-escalate-t1')).toBeNull()
  })

  it('biztask.escalate only → escalate present, retry + close absent', async () => {
    transport.setTasksResponse({
      available: true,
      tasks: [
        {
          attempts: 1,
          carrier: 'device',
          max_retries: 3,
          state: 'running',
          task_id: 't1',
          title: 'Task E',
          ts_updated: 1_700_000_000,
        },
      ],
    })
    setWhoami(['biztask.escalate'])

    wrap(<TasksPage />)

    await waitFor(() => expect(screen.getByText('Task E')).toBeTruthy())
    expect(screen.getByTestId('console-task-escalate-t1')).toBeTruthy()
    expect(screen.queryByTestId('console-task-retry-t1')).toBeNull()
    expect(screen.queryByTestId('console-task-close-t1')).toBeNull()
  })

  // -----------------------------------------------------------------------
  // §P10 E — failed create: no fabricated row + no success refetch
  // -----------------------------------------------------------------------

  it('failed create → no fabricated row, no success refetch', async () => {
    transport.setTasksResponse({ available: true, tasks: [] })
    transport.failPostOnce('/api/biz-task-create')

    setWhoami(['biztask.write', 'biztask.escalate', 'kb.delete'])
    wrap(<TasksPage />)

    await waitFor(() =>
      expect(screen.getByTestId('console-task-create')).toBeTruthy(),
    )

    const getCountBefore = transport.getCount
    act(() => { fireEvent.click(screen.getByTestId('console-task-create')) })
    await waitFor(() =>
      expect(screen.getByTestId('console-task-create-title')).toBeTruthy(),
    )
    fireEvent.change(screen.getByTestId('console-task-create-title'), {
      target: { value: 'New Task' },
    })
    await waitFor(() =>
      expect(screen.getByTestId('console-task-create-submit')).toBeTruthy(),
    )
    fireEvent.click(screen.getByTestId('console-task-create-submit'))

    await waitFor(() =>
      expect(transport.posts.some((p) => p.route === '/api/biz-task-create')).toBe(true),
    )

    // Failed create: no row should appear, no additional GET
    expect(screen.queryByText('New Task')).toBeNull()
    expect(transport.getCount).toBe(getCountBefore)
  })

  // -----------------------------------------------------------------------
  // §P10 F — idempotency: failure preserves key, success rotates
  // -----------------------------------------------------------------------

  it('idempotency: failed create keeps same key, success rotates to new key', async () => {
    transport.setTasksResponse({ available: true, tasks: [] })
    setWhoami(['biztask.write', 'biztask.escalate', 'kb.delete'])

    // First create: server failure (key K1 stays)
    transport.failPostOnce('/api/biz-task-create')

    wrap(<TasksPage />)

    await waitFor(() =>
      expect(screen.getByTestId('console-task-create')).toBeTruthy(),
    )
    act(() => { fireEvent.click(screen.getByTestId('console-task-create')) })
    await waitFor(() =>
      expect(screen.getByTestId('console-task-create-title')).toBeTruthy(),
    )
    fireEvent.change(screen.getByTestId('console-task-create-title'), {
      target: { value: 'First Task' },
    })
    await waitFor(() =>
      expect(screen.getByTestId('console-task-create-submit')).toBeTruthy(),
    )
    fireEvent.click(screen.getByTestId('console-task-create-submit'))

    await waitFor(() =>
      expect(transport.posts.some((p) => p.route === '/api/biz-task-create')).toBe(true),
    )
    const firstPost = transport.posts.find((p) => p.route === '/api/biz-task-create')
    const firstKey = (firstPost?.body as { idempotency_key?: string })?.idempotency_key
    expect(firstKey).toBeTruthy()

    // Second create (still same form instance): retry → success
    // Same key must be used (no rotation on failure).
    act(() => { fireEvent.click(screen.getByTestId('console-task-create')) })
    await waitFor(() =>
      expect(screen.getByTestId('console-task-create-submit')).toBeTruthy(),
    )
    fireEvent.click(screen.getByTestId('console-task-create-submit'))
    await waitFor(
      () => expect(transport.posts.filter((p) => p.route === '/api/biz-task-create').length).toBe(2),
    )
    const secondPost = transport.posts.filter((p) => p.route === '/api/biz-task-create')[1]
    const secondKey = (secondPost?.body as { idempotency_key?: string })?.idempotency_key
    expect(secondKey).toBe(firstKey)

    // Third create (after success): a new key K2 must be used
    act(() => { fireEvent.click(screen.getByTestId('console-task-create')) })
    await waitFor(() =>
      expect(screen.getByTestId('console-task-create-title')).toBeTruthy(),
    )
    fireEvent.change(screen.getByTestId('console-task-create-title'), {
      target: { value: 'First Task Third' },
    })
    await waitFor(() =>
      expect(screen.getByTestId('console-task-create-submit')).toBeTruthy(),
    )
    fireEvent.click(screen.getByTestId('console-task-create-submit'))
    await waitFor(
      () => expect(transport.posts.filter((p) => p.route === '/api/biz-task-create').length).toBe(3),
    )
    const thirdPost = transport.posts.filter((p) => p.route === '/api/biz-task-create')[2]
    const thirdKey = (thirdPost?.body as { idempotency_key?: string })?.idempotency_key
    expect(thirdKey).toBeTruthy()
    expect(thirdKey).not.toBe(firstKey)
  })

  // -----------------------------------------------------------------------
  // §P10 G — POST body shape + authoritative refetch + carrier default
  // -----------------------------------------------------------------------

  it('POST body shape is exact: {carrier, goal?, idempotency_key, title} + authoritative refetch', async () => {
    transport.setTasksResponse({ available: true, tasks: [] })
    setWhoami(['biztask.write', 'biztask.escalate', 'kb.delete'])

    wrap(<TasksPage />)

    await waitFor(() =>
      expect(screen.getByTestId('console-task-create')).toBeTruthy(),
    )
    const getCountBefore = transport.getCount
    act(() => { fireEvent.click(screen.getByTestId('console-task-create')) })
    await waitFor(() =>
      expect(screen.getByTestId('console-task-create-title')).toBeTruthy(),
    )
    fireEvent.change(screen.getByTestId('console-task-create-title'), {
      target: { value: 'Test' },
    })
    await waitFor(() =>
      expect(screen.getByTestId('console-task-create-submit')).toBeTruthy(),
    )
    fireEvent.click(screen.getByTestId('console-task-create-submit'))

    await waitFor(() =>
      expect(transport.posts.some((p) => p.route === '/api/biz-task-create')).toBe(true),
    )
    const post = transport.posts.find((p) => p.route === '/api/biz-task-create')
    const body = post?.body as Record<string, unknown>
    expect(body.carrier).toBe('device')
    expect(typeof body.idempotency_key).toBe('string')
    expect((body.idempotency_key as string).length).toBeGreaterThan(0)
    expect(body.title).toBe('Test')
    // goal is undefined (no goal entered)
    expect(body.goal).toBeUndefined()
    // Authoritative refetch: invalidateTASKS_KEY triggers a fresh GET
    expect(transport.getCount).toBeGreaterThan(getCountBefore)
  })
})


// ============================================================================
// CONTINUATION-03 LEVEL 6: ConfirmAction rendered mutation click-through.
// Strategy: click the trigger (opens ConfirmDialog via ConfirmAction),
// then dispatch Enter on the dialog (`screen.getByRole('dialog')`).
// The dialog's onKeyDown handler invokes the real ConfirmDialog.run()
// which calls the real ConfirmAction.onConfirm → real controller
// mutation → real query invalidation → real authoritative GET.
// ============================================================================

describe('Tasks ConfirmAction click-through (CONTINUATION-03 §LEVEL 6)', () => {
  let transport: RecordingTransport

  beforeEach(() => {
    // Re-initialize so nested tests have a fresh transport
    // (outer describe's beforeEach ran first and set module-scoped $transport)
    transport = new RecordingTransport({ available: true, tasks: [] })
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
 * and dispatch Enter to confirm. Returns the dialog element so
 * callers can also assert its presence.
 */
async function openAndConfirm(rowTriggerTestId: string) {
  fireEvent.click(screen.getByTestId(rowTriggerTestId))
  const dialog = await screen.findByRole('dialog')
  fireEvent.keyDown(dialog, { key: 'Enter', code: 'Enter' })

  return dialog
}

// B1 · Retry success — full rendered mutation path
it('ConfirmAction retry: trigger → ConfirmDialog Enter → POST /api/biz-task-retry {task_id} + authoritative GET', async () => {
  transport.setTasksResponse({
    available: true,
    tasks: [
      {
        attempts: 1,
        carrier: 'device',
        max_retries: 3,
        state: 'running',
        task_id: 't1',
        title: 'Task R',
        ts_updated: 1_700_000_000,
      },
    ],
  })
  setWhoami(['biztask.write', 'kb.delete'])

  wrap(<TasksPage />)

  await waitFor(() => expect(screen.getByText('Task R')).toBeTruthy())
  const getCountBefore = transport.getCount

  await openAndConfirm('console-task-retry-t1')

  await waitFor(() =>
    expect(transport.posts.some((p) => p.route === '/api/biz-task-retry')).toBe(true),
  )
  const retryPost = transport.posts.find((p) => p.route === '/api/biz-task-retry')
  expect(retryPost?.body).toEqual({ task_id: 't1' })
  // Authoritative refetch: TASKS_KEY invalidate → at least one more GET
  expect(transport.getCount).toBeGreaterThan(getCountBefore)
})

// B2 · Escalate success
it('ConfirmAction escalate: trigger → Enter → POST /api/biz-task-escalate {task_id} (perm biztask.escalate) + authoritative GET', async () => {
  transport.setTasksResponse({
    available: true,
    tasks: [
      {
        attempts: 1,
        carrier: 'device',
        max_retries: 3,
        state: 'running',
        task_id: 't1',
        title: 'Task Esc',
        ts_updated: 1_700_000_000,
      },
    ],
  })
  setWhoami(['biztask.escalate'])

  wrap(<TasksPage />)

  await waitFor(() => expect(screen.getByText('Task Esc')).toBeTruthy())
  const getCountBefore = transport.getCount

  await openAndConfirm('console-task-escalate-t1')

  await waitFor(() =>
    expect(transport.posts.some((p) => p.route === '/api/biz-task-escalate')).toBe(true),
  )
  const post = transport.posts.find((p) => p.route === '/api/biz-task-escalate')
  expect(post?.body).toEqual({ task_id: 't1' })
  expect(transport.getCount).toBeGreaterThan(getCountBefore)
})

// B3 · Close success (destructive)
it('ConfirmAction close: trigger → Enter → POST /api/biz-task-close {task_id} (perm biztask.write, destructive) + authoritative GET', async () => {
  transport.setTasksResponse({
    available: true,
    tasks: [
      {
        attempts: 1,
        carrier: 'device',
        max_retries: 3,
        state: 'running',
        task_id: 't1',
        title: 'Task C',
        ts_updated: 1_700_000_000,
      },
    ],
  })
  setWhoami(['biztask.write', 'kb.delete'])

  wrap(<TasksPage />)

  await waitFor(() => expect(screen.getByText('Task C')).toBeTruthy())
  const getCountBefore = transport.getCount

  await openAndConfirm('console-task-close-t1')

  await waitFor(() =>
    expect(transport.posts.some((p) => p.route === '/api/biz-task-close')).toBe(true),
  )
  const post = transport.posts.find((p) => p.route === '/api/biz-task-close')
  expect(post?.body).toEqual({ task_id: 't1' })
  expect(transport.getCount).toBeGreaterThan(getCountBefore)
})

// B4 · ConfirmAction failure — server rejects → NO optimistic state,
// NO success refetch, failure remains visible.
it('ConfirmAction retry failure: server rejects → no optimistic state, no success refetch', async () => {
  transport.setTasksResponse({
    available: true,
    tasks: [
      {
        attempts: 1,
        carrier: 'device',
        max_retries: 3,
        state: 'running',
        task_id: 't1',
        title: 'Task F',
        ts_updated: 1_700_000_000,
      },
    ],
  })
  setWhoami(['biztask.write', 'kb.delete'])
  // Force the retry POST to fail
  transport.failPostForever('/api/biz-task-retry')

  wrap(<TasksPage />)

  await waitFor(() => expect(screen.getByText('Task F')).toBeTruthy())
  const getCountBefore = transport.getCount

  await openAndConfirm('console-task-retry-t1')

  await waitFor(() =>
    expect(transport.posts.some((p) => p.route === '/api/biz-task-retry')).toBe(true),
  )
  // Failure path: NO additional GET (no successful authoritative refetch)
  expect(transport.getCount).toBe(getCountBefore)
  // The row still renders with the original server state
  expect(screen.getByText('Task F')).toBeTruthy()
  expect(screen.getByText('running')).toBeTruthy()
  // Retry trigger remains available (no client state mutation)
  expect(screen.getByTestId('console-task-retry-t1')).toBeTruthy()
})
})
