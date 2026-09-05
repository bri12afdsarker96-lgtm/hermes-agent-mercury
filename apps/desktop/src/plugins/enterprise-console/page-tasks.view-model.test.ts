/**
 * Tasks page — ViewModel tests (W1-C §P10).
 *
 * Pure-function tests for the page-tasks.view-model derivations.
 * No React, no transport, no session atom, no mocks.
 */

import { describe, expect, it } from 'vitest'

import type { BizTask } from './page-tasks.controller'
import {
  type BizTaskView,
  deriveBizTask,
  deriveBizTasks,
  isTasksEmpty,
  TASK_TONE,
  taskTone,
} from './page-tasks.view-model'

const fmtEpoch = (s: number | null | undefined) => `ts:${s ?? 'null'}`

const T1: BizTask = {
  attempts: 1,
  carrier: 'device',
  max_retries: 3,
  stalled: false,
  state: 'queued',
  task_id: 't1',
  title: 'First task',
  ts_updated: 1700000000,
}

const T2: BizTask = {
  ...T1,
  attempts: 3,
  carrier: 'broadcast',
  max_retries: 3,
  state: 'closed',
  task_id: 't2',
  title: 'Closed task',
  ts_updated: 1700000100,
}

const T3: BizTask = {
  ...T1,
  stalled: true,
  state: 'running',
  task_id: 't3',
  title: 'Stalled running',
}

describe('taskTone (per P10 tone truth)', () => {
  it('maps closed → muted', () => {
    expect(taskTone('closed')).toBe('muted')
  })
  it('maps created → muted', () => {
    expect(taskTone('created')).toBe('muted')
  })
  it('maps escalated → warn', () => {
    expect(taskTone('escalated')).toBe('warn')
  })
  it('maps failed → bad', () => {
    expect(taskTone('failed')).toBe('bad')
  })
  it('maps queued → muted', () => {
    expect(taskTone('queued')).toBe('muted')
  })
  it('maps running → good', () => {
    expect(taskTone('running')).toBe('good')
  })
  it('maps succeeded → good', () => {
    expect(taskTone('succeeded')).toBe('good')
  })
  it('defaults unknown → muted', () => {
    expect(taskTone('some-new-state')).toBe('muted')
  })
  it('TASK_TONE table has all pre-split states', () => {
    expect(TASK_TONE).toEqual({
      closed: 'muted',
      created: 'muted',
      escalated: 'warn',
      failed: 'bad',
      queued: 'muted',
      running: 'good',
      succeeded: 'good',
    })
  })
})

describe('deriveBizTask (wire → presentation)', () => {
  it('returns snake_case → camelCase mapping', () => {
    const v: BizTaskView = deriveBizTask(T1, fmtEpoch)
    expect(v.taskId).toBe('t1')
    expect(v.title).toBe('First task')
    expect(v.carrier).toBe('device')
    expect(v.state).toBe('queued')
    expect(v.tone).toBe('muted')
    expect(v.stalled).toBe(false)
    expect(v.isClosed).toBe(false)
    expect(v.canRetry).toBe(true)
    expect(v.canEscalate).toBe(true)
    expect(v.canClose).toBe(true)
    expect(v.attemptsDisplay).toBe('1/3')
    expect(v.tsUpdatedDisplay).toBe('ts:1700000000')
    expect(v.attempts).toBe(1)
    expect(v.maxRetries).toBe(3)
    expect(v.tsUpdated).toBe(1700000000)
  })

  it('closed task: canRetry/canEscalate/canClose = false', () => {
    const v = deriveBizTask(T2, fmtEpoch)
    expect(v.isClosed).toBe(true)
    expect(v.canRetry).toBe(false)
    expect(v.canEscalate).toBe(false)
    expect(v.canClose).toBe(false)
    expect(v.tone).toBe('muted')
  })

  it('stalled flag preserved', () => {
    const v = deriveBizTask(T3, fmtEpoch)
    expect(v.stalled).toBe(true)
    expect(v.tone).toBe('good') // running
  })
})

describe('deriveBizTasks (multi-row)', () => {
  it('returns [] for null/undefined', () => {
    expect(deriveBizTasks(null, fmtEpoch)).toEqual([])
    expect(deriveBizTasks(undefined, fmtEpoch)).toEqual([])
  })
  it('maps each row', () => {
    const out = deriveBizTasks([T1, T2, T3], fmtEpoch)
    expect(out).toHaveLength(3)
    expect(out[0]?.taskId).toBe('t1')
    expect(out[1]?.taskId).toBe('t2')
    expect(out[2]?.taskId).toBe('t3')
  })
})

describe('isTasksEmpty (per P9 empty semantics)', () => {
  it('returns true for null', () => {
    expect(isTasksEmpty(null)).toBe(true)
  })
  it('returns true when available=false', () => {
    expect(isTasksEmpty({ available: false, tasks: [{ a: 1 }] })).toBe(true)
  })
  it('returns true when tasks is empty', () => {
    expect(isTasksEmpty({ available: true, tasks: [] })).toBe(true)
  })
  it('returns false when available=true and tasks non-empty', () => {
    expect(isTasksEmpty({ available: true, tasks: [{}] })).toBe(false)
  })
})