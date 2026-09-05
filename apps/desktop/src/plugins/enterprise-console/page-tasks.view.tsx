/**
 * Tasks page — Presentational View layer.
 *
 * Receives fully-derived VMs + action slots from the glue. NO
 * transport, NO useQueryClient, NO session atom, NO permission
 * authority, NO `./actions` import.
 *
 * Per W1-C-REMEDIATION-01 §P5 + §P7:
 *   - Available flag is propagated from the SERVER (glue),
 *     never fabricated as `true` here.
 *   - Action slot receives per-row eligibility flags
 *     (canRetry / canEscalate / canClose) derived by the VM
 *     from server row state — the view does NOT recompute.
 *   - View is a dependency leaf (only presentational imports).
 *
 * Per W1-C §P26: visible copy, className, layout hierarchy,
 * testids, button labels, placeholder text, status text, and
 * section order match pre-split exactly.
 */

import { StatusDot } from '@hermes/plugin-sdk'
import type { ReactNode } from 'react'

import { ConsoleRows, QueryBody } from './page-kit'
import type { BizTaskView } from './page-tasks.view-model'
import { PageStatusBadge } from './status-badge'
import { ConsolePanel, PageHeader } from './ui'

// ---------------------------------------------------------------------------
// Action slot props (per §P7)
// ---------------------------------------------------------------------------

export interface TaskRowActionsSlotProps {
  taskId: string
  canRetry: boolean
  canEscalate: boolean
  canClose: boolean
}

// ---------------------------------------------------------------------------
// Top-level View
// ---------------------------------------------------------------------------

export interface TasksViewProps {
  available: boolean
  tasks: BizTaskView[]
  tasksIsPending: boolean
  tasksError: unknown
  tasksRowActionsSlot: (props: TaskRowActionsSlotProps) => ReactNode
  createSlot: ReactNode
}

export function TasksView({
  available,
  tasks,
  tasksIsPending,
  tasksError,
  tasksRowActionsSlot,
  createSlot,
}: TasksViewProps) {
  return (
    <div
      className="mx-auto flex w-full max-w-[96rem] flex-col px-(--ec-page-inset-x) py-(--ec-page-inset-y)"
      data-page-status="ready"
      data-testid="console-page-tasks"
    >
      <PageHeader
        actions={createSlot}
        purpose="Create and operate business tasks through the server-owned task state machine."
        status={<PageStatusBadge status="ready" />}
        title="Tasks"
      />

      <ConsolePanel divided title="Task queue">
        <QueryBody
          emptyText="no tasks"
          isEmpty={(data: { available: boolean; tasks: unknown[] }) =>
            !data.available || data.tasks.length === 0
          }
          query={{
            data: { available, tasks },
            error: tasksError,
            isPending: tasksIsPending,
          }}
        >
          {() => (
            <ConsoleRows testId="console-tasks">
              {tasks.map((task) => (
                <li
                  className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
                  data-testid={`console-task-row-${task.taskId}`}
                  key={task.taskId}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-(--ui-text-primary)">{task.title}</div>
                    <div className="text-(--ui-text-tertiary)">
                      {task.carrier} · {task.tsUpdatedDisplay} · {task.attemptsDisplay}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {task.stalled ? <span className="text-xs text-amber-600">stalled</span> : null}
                    <span className="inline-flex items-center gap-1 text-xs">
                      <StatusDot tone={task.tone} />
                      {task.state}
                    </span>
                    {tasksRowActionsSlot({
                      taskId: task.taskId,
                      canRetry: task.canRetry,
                      canEscalate: task.canEscalate,
                      canClose: task.canClose,
                    })}
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
