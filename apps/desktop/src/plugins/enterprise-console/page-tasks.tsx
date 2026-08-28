/**
 * Task page — real `/api/biz-tasks` data + minimal control actions (retry /
 * close / escalate) that post to the server and refetch the authoritative
 * result. The server owns the state machine; the client never fabricates a
 * transition or a success.
 */

import { StatusDot, type StatusTone } from '@hermes/plugin-sdk'

import { ConfirmAction } from './actions'
import { ConsoleRows, fmtEpoch, QueryBody, useConsoleQuery } from './page-kit'
import { useTransport } from './transport'

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

export function TasksPage() {
  const transport = useTransport()
  const query = useConsoleQuery<BizTasksResp>(TASKS_KEY, '/api/biz-tasks')

  return (
    <div data-page-status="ready" data-testid="console-page-tasks">
      <QueryBody emptyText="no tasks" isEmpty={data => !data.available || data.tasks.length === 0} query={query}>
        {data => (
          <ConsoleRows testId="console-tasks">
            {data.tasks.map(task => (
              <li
                className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1.5 text-sm"
                key={task.task_id}
              >
                <div className="min-w-0">
                  <div className="truncate">{task.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {task.carrier} · {fmtEpoch(task.ts_updated)} · {task.attempts}/{task.max_retries}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {task.stalled ? <span className="text-xs text-amber-600">stalled</span> : null}
                  <span className="inline-flex items-center gap-1 text-xs">
                    <StatusDot tone={TASK_TONE[task.state] ?? 'muted'} />
                    {task.state}
                  </span>
                  {task.state !== 'closed' ? (
                    <>
                      <ConfirmAction
                        invalidateKey={TASKS_KEY}
                        run={() => transport.post('/api/biz-task-retry', { task_id: task.task_id })}
                        testId={`console-task-retry-${task.task_id}`}
                        title="Retry this task?"
                      >
                        retry
                      </ConfirmAction>
                      <ConfirmAction
                        invalidateKey={TASKS_KEY}
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
    </div>
  )
}
