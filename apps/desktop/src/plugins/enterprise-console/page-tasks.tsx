/**
 * Task page — real `/api/biz-tasks` data (read-only this slice). Fields mirror
 * the server's `biz_tasks_json` / `_row_to_dict`; state tones are honest.
 */

import { StatusDot, type StatusTone } from '@hermes/plugin-sdk'

import { ConsoleRows, fmtEpoch, QueryBody, useConsoleQuery } from './page-kit'

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
  const query = useConsoleQuery<BizTasksResp>(['enterprise-console', 'biz-tasks'], '/api/biz-tasks')

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
                </div>
              </li>
            ))}
          </ConsoleRows>
        )}
      </QueryBody>
    </div>
  )
}
