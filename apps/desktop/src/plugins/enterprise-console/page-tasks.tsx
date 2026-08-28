/**
 * Task page — real `/api/biz-tasks` data + minimal control actions (retry /
 * close / escalate) that post to the server and refetch the authoritative
 * result. The server owns the state machine; the client never fabricates a
 * transition or a success.
 */

import { Input, StatusDot, type StatusTone, Textarea } from '@hermes/plugin-sdk'
import { useState } from 'react'

import { ConfirmAction, FormAction } from './actions'
import { ConsoleRows, fmtEpoch, QueryBody, useConsoleQuery } from './page-kit'
import { PageStatusBadge } from './status-badge'
import { useTransport } from './transport'
import { ConsolePanel, PageHeader } from './ui'

interface BizTask {
  attempts: number
  carrier: string
  max_retries: number
  stalled?: boolean
  state: string
  task_id: string
  title: string
  ts_updated: number
}

interface BizTasksResp {
  available: boolean
  counts?: Record<string, number>
  tasks: BizTask[]
}

const TASKS_KEY = ['enterprise-console', 'biz-tasks'] as const

const TASK_TONE: Record<string, StatusTone> = {
  closed: 'muted',
  created: 'muted',
  escalated: 'warn',
  failed: 'bad',
  queued: 'muted',
  running: 'good',
  succeeded: 'good'
}

function CreateTask() {
  const transport = useTransport()
  const [title, setTitle] = useState('')
  const [carrier, setCarrier] = useState('device')
  const [goal, setGoal] = useState('')
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID())

  return (
    <FormAction
      canSubmit={title.trim().length > 0}
      invalidateKey={TASKS_KEY}
      onSuccess={() => setIdempotencyKey(crypto.randomUUID())}
      permission="biztask.write"
      submit={() =>
        transport.post('/api/biz-task-create', {
          carrier,
          goal: goal || undefined,
          idempotency_key: idempotencyKey,
          title: title.trim()
        })
      }
      submitLabel="Create"
      testId="console-task-create"
      title="Create task"
      trigger="new task"
    >
      <Input
        data-testid="console-task-create-title"
        onChange={event => setTitle(event.target.value)}
        placeholder="title"
        value={title}
      />
      <select
        className="rounded-md border border-border bg-transparent px-2 py-1 text-sm"
        onChange={event => setCarrier(event.target.value)}
        value={carrier}
      >
        <option value="device">device</option>
        <option value="broadcast">broadcast</option>
        <option value="workflow">workflow</option>
      </select>
      <Textarea onChange={event => setGoal(event.target.value)} placeholder="goal (optional)" value={goal} />
    </FormAction>
  )
}

export function TasksPage() {
  const transport = useTransport()
  const query = useConsoleQuery<BizTasksResp>(TASKS_KEY, '/api/biz-tasks')

  return (
    <div
      className="mx-auto flex w-full max-w-[96rem] flex-col px-(--ec-page-inset-x) py-(--ec-page-inset-y)"
      data-page-status="ready"
      data-testid="console-page-tasks"
    >
      <PageHeader
        actions={<CreateTask />}
        purpose="Create and operate business tasks through the server-owned task state machine."
        status={<PageStatusBadge status="ready" />}
        title="Tasks"
      />

      <ConsolePanel divided title="Task queue">
        <QueryBody emptyText="no tasks" isEmpty={data => !data.available || data.tasks.length === 0} query={query}>
          {data => (
            <ConsoleRows testId="console-tasks">
              {data.tasks.map(task => (
                <li
                  className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
                  key={task.task_id}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-(--ui-text-primary)">{task.title}</div>
                    <div className="text-(--ui-text-tertiary)">
                      {task.carrier} · {fmtEpoch(task.ts_updated)} · {task.attempts}/{task.max_retries}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {task.stalled ? <span className="text-xs text-amber-600">stalled</span> : null}
                    <span className="inline-flex items-center gap-1 text-xs">
                      <StatusDot tone={TASK_TONE[task.state] ?? 'muted'} />
                      {task.state}
                    </span>
                    {task.state !== 'closed' ? (
                      <>
                        <ConfirmAction
                          invalidateKey={TASKS_KEY}
                          permission="biztask.write"
                          run={() => transport.post('/api/biz-task-retry', { task_id: task.task_id })}
                          testId={`console-task-retry-${task.task_id}`}
                          title="Retry this task?"
                        >
                          retry
                        </ConfirmAction>
                        <ConfirmAction
                          invalidateKey={TASKS_KEY}
                          permission="biztask.escalate"
                          run={() => transport.post('/api/biz-task-escalate', { task_id: task.task_id })}
                          testId={`console-task-escalate-${task.task_id}`}
                          title="Escalate this task?"
                        >
                          escalate
                        </ConfirmAction>
                        <ConfirmAction
                          description="This closes the task on the server."
                          destructive
                          invalidateKey={TASKS_KEY}
                          permission="biztask.write"
                          run={() => transport.post('/api/biz-task-close', { task_id: task.task_id })}
                          testId={`console-task-close-${task.task_id}`}
                          title="Close this task?"
                        >
                          close
                        </ConfirmAction>
                      </>
                    ) : null}
                  </div>
                </li>
              ))}
            </ConsoleRows>
          )}
        </QueryBody>
      </ConsolePanel>
    </div>
  )
}
