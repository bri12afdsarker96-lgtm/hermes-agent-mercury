/**
 * Tasks page — ViewModel derivation.
 *
 * Pure functions only: no transport, no query hooks, no React JSX.
 *
 * The view-model exposes per-row "isClosed" so the action button group
 * disappears on terminal state. Server tones stay centralized here.
 *
 * Wave 1 / Step 8 of W5-B0 Controller/View Contract Freeze.
 */

import type { StatusTone } from '@hermes/plugin-sdk'

import { type ConsolePage } from './catalog'
import { type CommonViewModelFields, deriveCommonViewModel } from './lib/view-model'
import type { BizTask } from './page-tasks.controller'

export interface BizTaskViewRow {
  attempts: number
  carrier: string
  isClosed: boolean
  isStalled: boolean
  maxRetries: number
  state: string
  taskId: string
  title: string
  tone: StatusTone
  tsUpdated: number
}

export interface BizTasksViewModel extends CommonViewModelFields {
  rows: readonly BizTaskViewRow[]
  isAvailable: boolean
  isEmpty: boolean
}

/** Centralized server-state → StatusTone. Unknown states default to
 *  'muted' (visible, neutral) per the audit-trail invariant. */
const TASK_TONE: Record<string, StatusTone> = {
  closed: 'muted',
  created: 'muted',
  escalated: 'warn',
  failed: 'bad',
  queued: 'muted',
  running: 'good',
  succeeded: 'good',
}

function deriveRow(task: BizTask): BizTaskViewRow {
  return {
    taskId: task.task_id,
    title: task.title,
    carrier: task.carrier,
    attempts: task.attempts,
    maxRetries: task.max_retries,
    isStalled: task.stalled === true,
    isClosed: task.state === 'closed',
    state: task.state,
    tone: TASK_TONE[task.state] ?? 'muted',
    tsUpdated: task.ts_updated,
  }
}

export function deriveBizTasksViewModel(args: {
  page: ConsolePage
  whoami: null | import('./types').Whoami
  data: { available: boolean; tasks: BizTask[] } | undefined
}): BizTasksViewModel {
  const { page, whoami, data } = args
  const common = deriveCommonViewModel({ page, whoami })

  const rows = (data?.tasks ?? []).map(deriveRow)
  const isAvailable = data?.available ?? false
  const isEmpty = !isAvailable || rows.length === 0

  return {
    ...common,
    rows,
    isAvailable,
    isEmpty,
  }
}