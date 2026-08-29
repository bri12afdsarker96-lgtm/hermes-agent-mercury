/**
 * Tasks page — Controller layer.
 *
 * Holds the HermesTransport query for the business tasks queue +
 * 4 mutations (create / retry / escalate / close). The create mutation
 * includes a server-validated idempotency key (crypto.randomUUID(),
 * refreshed on success). The server owns the state machine; the
 * console never fabricates a transition or a success.
 *
 * Wave 1 / Step 8 of W5-B0 Controller/View Contract Freeze. See
 * .hermes/plans/2026-08-29_wave1-contract-freeze.md §3.
 */

import { HermesApiError } from './fetch-transport'
import { useConsoleQuery } from './page-kit'
import { useTransport } from './transport'

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

export const TASKS_KEY = ['enterprise-console', 'biz-tasks'] as const

export interface BizTaskCreateBody {
  carrier: string
  goal?: string
  idempotency_key: string
  title: string
}

export interface BizTaskIdBody {
  task_id: string
}

export function useBizTasksData() {
  const transport = useTransport()

  return useConsoleQuery<BizTasksResp>(TASKS_KEY, '/api/biz-tasks')
}

/** Build a fresh UUID v4 idempotency key. */
export function newIdempotencyKey(): string {
  return crypto.randomUUID()
}

/** Build the four mutations bound to the active transport. */
export function makeBizTaskMutations(transport: ReturnType<typeof useTransport>) {
  return {
    create: async (body: BizTaskCreateBody) => {
      await transport.post('/api/biz-task-create', body)
    },
    retry: async (body: BizTaskIdBody) => {
      await transport.post('/api/biz-task-retry', body)
    },
    escalate: async (body: BizTaskIdBody) => {
      await transport.post('/api/biz-task-escalate', body)
    },
    close: async (body: BizTaskIdBody) => {
      await transport.post('/api/biz-task-close', body)
    },
  }
}

/** Human-readable error after HermesApiError / generic Error → string. */
export function normalizeBizTaskError(e: unknown): string {
  if (e instanceof HermesApiError) {
    if (e.code === 'forbidden') {
      return 'biztask.write / biztask.escalate permission required'
    }

    if (e.code === 'not_implemented') {
      return 'biz-tasks endpoint is not wired on this server yet'
    }

    if (e.code === 'conflict') {
      return 'idempotency key collision — server already processed this create'
    }

    return `${e.code}: ${e.message}`
  }

  return String((e as Error).message ?? e)
}