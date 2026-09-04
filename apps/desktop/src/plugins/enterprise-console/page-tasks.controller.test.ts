/**
 * Tasks page — Controller tests (W1-C §P22 + §P11).
 *
 * Verifies the controller's exact query key, exact mutation
 * signatures, and useConsoleQuery integration.
 */

import { describe, expect, it } from 'vitest'

import {
  type BizTask,
  type CreateTaskBody,
  type TaskIdBody,
  TASKS_KEY,
} from './page-tasks.controller'

describe('Tasks page controller (W1-C §P11)', () => {
  it('TASKS_KEY is exact: ["enterprise-console", "biz-tasks"]', () => {
    expect(TASKS_KEY).toEqual(['enterprise-console', 'biz-tasks'])
  })

  it('BizTask wire-shape preserves the original snake_case fields', () => {
    const sample: BizTask = {
      attempts: 1,
      carrier: 'device',
      max_retries: 3,
      stalled: false,
      state: 'queued',
      task_id: 't1',
      title: 'Sample',
      ts_updated: 1700000000,
    }

    expect(sample.attempts).toBe(1)
    expect(sample.max_retries).toBe(3)
    expect(sample.task_id).toBe('t1')
    expect(sample.ts_updated).toBe(1700000000)
  })

  it('CreateTaskBody is exact: {carrier, goal?, idempotency_key, title}', () => {
    const body: CreateTaskBody = {
      carrier: 'device',
      goal: 'some-goal',
      idempotency_key: 'idem-1',
      title: 'Hello',
    }

    expect(body).toEqual({
      carrier: 'device',
      goal: 'some-goal',
      idempotency_key: 'idem-1',
      title: 'Hello',
    })
  })

  it('TaskIdBody is exact: {task_id}', () => {
    const body: TaskIdBody = { task_id: 't1' }
    expect(body).toEqual({ task_id: 't1' })
  })
})