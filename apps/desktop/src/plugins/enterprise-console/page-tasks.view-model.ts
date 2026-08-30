/**
 * Tasks page — ViewModel layer (Stable ViewModel derivation).
 *
 * Pure functions only. No transport, no query hooks, no session atom,
 * no permission authority, no mutation authority.
 *
 * Per W1-C §P10:
 *   - Wire row → presentation row mapping
 *   - State → StatusTone mapping
 *   - Display formatting via injected fmtEpoch
 *   - Stalled / isClosed derivation
 *   - Tone table exact match against pre-split
 */

import type { StatusTone } from '@hermes/plugin-sdk'

import type { BizTask } from './page-tasks.controller'

// ---------------------------------------------------------------------------
// Tone table (matches pre-split exactly)
// ---------------------------------------------------------------------------

export const TASK_TONE: Record<string, StatusTone> = {
  closed: 'muted',
  created: 'muted',
  escalated: 'warn',
  failed: 'bad',
  queued: 'muted',
  running: 'good',
  succeeded: 'good',
}

export function taskTone(state: string): StatusTone {
  return TASK_TONE[state] ?? 'muted'
}

// ---------------------------------------------------------------------------
// Presentation shape
// ---------------------------------------------------------------------------

export interface BizTaskView {
  taskId: string
  title: string
  carrier: string
  state: string
  tone: StatusTone
  stalled: boolean
  isClosed: boolean
  // Display values
  attemptsDisplay: string
  tsUpdatedDisplay: string
  // Action eligibility (presentation-side; authority still in action seam)
  canRetry: boolean
  canEscalate: boolean
  canClose: boolean
  // Raw values preserved for any other display
  attempts: number
  maxRetries: number
  tsUpdated: number
}

// ---------------------------------------------------------------------------
// Pure derivation
// ---------------------------------------------------------------------------

export function deriveBizTask(
  task: BizTask,
  fmtEpoch: (seconds: null | number | undefined) => string
): BizTaskView {
  const state = task.state
  const isClosed = state === 'closed'
  // Visible action gating (matches pre-split: only when not closed):
  const canRetry = !isClosed
  const canEscalate = !isClosed
  const canClose = !isClosed

  return {
    taskId: task.task_id,
    title: task.title,
    carrier: task.carrier,
    state,
    tone: taskTone(state),
    stalled: Boolean(task.stalled),
    isClosed,
    canRetry,
    canEscalate,
    canClose,
    attemptsDisplay: `${task.attempts}/${task.max_retries}`,
    tsUpdatedDisplay: fmtEpoch(task.ts_updated),
    attempts: task.attempts,
    maxRetries: task.max_retries,
    tsUpdated: task.ts_updated,
  }
}

export function deriveBizTasks(
  rows: BizTask[] | null | undefined,
  fmtEpoch: (seconds: null | number | undefined) => string
): BizTaskView[] {
  if (!rows) {
    return []
  }

  return rows.map((row) => deriveBizTask(row, fmtEpoch))
}

// ---------------------------------------------------------------------------
// Empty state helper (matches pre-split isEmpty logic)
// ---------------------------------------------------------------------------

export function isTasksEmpty(data: { available: boolean; tasks: unknown[] } | null | undefined): boolean {
  if (!data) {
    return true
  }

  return !data.available || data.tasks.length === 0
}