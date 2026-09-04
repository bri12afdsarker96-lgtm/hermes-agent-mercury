/**
 * Tasks page — Controller layer (Functional Controller).
 *
 * The controller owns the **only** server-touching surface for the
 * Tasks page (per W1-C §P22):
 *
 *   Queries (exact route + exact query key):
 *     - GET /api/biz-tasks
 *       queryKey: ['enterprise-console', 'biz-tasks']
 *
 *   Mutations (server writes; all invalidate exact query key):
 *     - POST /api/biz-task-create   permission biztask.write
 *       body {carrier, goal?, idempotency_key, title}
 *     - POST /api/biz-task-retry    permission biztask.write
 *       body {task_id}
 *     - POST /api/biz-task-escalate permission biztask.escalate
 *       body {task_id}
 *     - POST /api/biz-task-close    permission biztask.write
 *       body {task_id} (destructive)
 *
 * The controller MUST NOT (per W1-C §P22):
 *   - invent server state or capability state
 *   - introduce a second mutation framework
 *   - own presentation markup or form-text state
 */

import { useCallback } from 'react'

import { useTransport } from './transport'

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const TASKS_KEY = ['enterprise-console', 'biz-tasks'] as const

// ---------------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------------

export interface BizTask {
  attempts: number
  carrier: string
  max_retries: number
  stalled?: boolean
  state: string
  task_id: string
  title: string
  ts_updated: number
}

export interface BizTasksResp {
  available: boolean
  counts?: Record<string, number>
  tasks: BizTask[]
}

// ---------------------------------------------------------------------------
// Query hook
// ---------------------------------------------------------------------------

export function useKbTasks() {
  // useConsoleQuery is in page-kit (shared seam). We re-export the same
  // call from the controller for glue convenience.
  // The hook call site is the controller — the view does NOT call it.
  return useTasksQuery()
}

// Helper that imports useConsoleQuery; the controller re-uses the
// existing page-kit helper without introducing a new query framework.
import { useConsoleQuery } from './page-kit'

function useTasksQuery() {
  return useConsoleQuery<BizTasksResp>(TASKS_KEY, '/api/biz-tasks')
}

// ---------------------------------------------------------------------------
// Mutation callbacks
// ---------------------------------------------------------------------------

export interface CreateTaskBody {
  carrier: string
  goal: string | undefined
  idempotency_key: string
  title: string
}

export interface TaskIdBody {
  task_id: string
}

export function useTasksMutations() {
  const transport = useTransport()

  const createTask = useCallback(
    (body: CreateTaskBody) =>
      transport.post('/api/biz-task-create', body),
    [transport]
  )

  const retryTask = useCallback(
    (task_id: string) =>
      transport.post('/api/biz-task-retry', { task_id }),
    [transport]
  )

  const escalateTask = useCallback(
    (task_id: string) =>
      transport.post('/api/biz-task-escalate', { task_id }),
    [transport]
  )

  const closeTask = useCallback(
    (task_id: string) =>
      transport.post('/api/biz-task-close', { task_id }),
    [transport]
  )

  return {
    createTask,
    retryTask,
    escalateTask,
    closeTask,
  }
}